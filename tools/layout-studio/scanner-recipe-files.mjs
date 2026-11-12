/** Linux descriptor-anchored, exclusive scanner controls. No overwrite, replay or deletion. */
import { constants } from "node:fs";
import { mkdir, open, lstat, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { directoryIdentity } from "./private-fs.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const identity = s => ({ device: String(s.dev), inode: String(s.ino), birth: String(s.birthtimeNs) });
const same = (a, b) => a && b && a.device === b.device && a.inode === b.inode && a.birth === b.birth;
const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fail = () => Error("The scanner save directory or file changed; preserve it for review.");
const linux = () => { if (process.platform !== "linux") throw Error("Reviewed scanner saving requires the Linux descriptor boundary; Windows saving is not implemented."); };
const safeDirectory = s => s.isDirectory() && !s.isSymbolicLink() && Number(s.uid) === userInfo().uid && !(Number(s.mode) & 0o022);
const safeFile = s => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && Number(s.uid) === userInfo().uid && !(Number(s.mode) & 0o077);
const stable = (a, b) => same(identity(a), identity(b)) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const anchored = file => `/proc/self/fd/${file.fd}`;

export async function scannerSaveRoot(root) {
  linux(); const stat = await directoryIdentity(root); if (!safeDirectory(stat)) throw fail(); return identity(stat);
}
function validate(draft) {
  if (!/^switchyard-scan-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(draft.directory) || !Array.isArray(draft.files) || ![4, 5].includes(draft.files.length)) throw fail();
  const names = draft.files.map(f => f.path.slice(draft.directory.length + 1));
  if (new Set(names).size !== names.length || names.some(n => !["engine.mjs", "scanner.json", "advisory.json", "request.json", "recipe.json"].includes(n)) || ["engine.mjs", "scanner.json", "request.json", "recipe.json"].some(n => !names.includes(n))) throw fail();
  for (const f of draft.files) if (!f.path.startsWith(draft.directory + "/") || !Number.isSafeInteger(f.size) || f.size < 1 || f.size > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(f.sha256)) throw fail();
  return names;
}
async function withRoot(root, expected, fn) {
  linux(); if (!same(await scannerSaveRoot(root), expected)) throw fail();
  const handle = await open(root, flags);
  try {
    if (!safeDirectory(await handle.stat({ bigint: true })) || !same(identity(await handle.stat({ bigint: true })), expected)) throw fail();
    const check = async () => { if (!same(await scannerSaveRoot(root), expected) || !same(identity(await handle.stat({ bigint: true })), expected)) throw fail(); };
    await check(); return await fn(handle, check);
  } finally { await handle.close(); }
}
async function fact(directory, name, expected, known) {
  const path = `${anchored(directory)}/${name}`, handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!safeFile(before) || before.size !== BigInt(expected.size) || known && !same(identity(before), known)) throw fail();
    const bytes = Buffer.alloc(expected.size);
    try {
      let offset = 0; while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) throw fail(); offset += bytesRead; }
      const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
      if (sha(bytes) !== expected.sha256 || !safeFile(after) || !safeFile(named) || !stable(before, after) || !stable(before, named)) throw fail();
      return identity(before);
    } finally { bytes.fill(0); }
  } finally { await handle.close(); }
}

export async function writeScannerRecipeFiles(draft, rootIdentity, record, authorize) {
  const names = validate(draft);
  // Verify all rebuilt bytes before the first repository effect.
  for (const file of draft.files) if (typeof file.content !== "string" || Buffer.byteLength(file.content) !== file.size || sha(file.content) !== file.sha256) throw fail();
  return withRoot(draft.repositoryRoot, rootIdentity, async (root, checkRoot) => {
    await authorize(); await checkRoot(); await record({ kind: "directory-intent" });
    const child = `${anchored(root)}/${draft.directory}`;
    // EEXIST is a refusal, including an empty directory. Never adopt it.
    await mkdir(child, { mode: 0o700 });
    const directory = await open(child, flags);
    try {
      const stat = await directory.stat({ bigint: true }), directoryIdentity = identity(stat);
      if (!safeDirectory(stat) || Number(stat.mode) & 0o077 || !same(directoryIdentity, identity(await lstat(child, { bigint: true })))) throw fail();
      const check = async () => {
        await authorize(); await checkRoot();
        const named = await lstat(child, { bigint: true }), held = await directory.stat({ bigint: true });
        if (!safeDirectory(named) || !safeDirectory(held) || !same(identity(named), directoryIdentity) || !same(identity(held), directoryIdentity)) throw fail();
      };
      await root.sync(); await record({ kind: "directory-created", identity: directoryIdentity });
      const createdFiles = new Map();
      for (const [i, file] of draft.files.entries()) {
        await check(); await record({ kind: "file-intent", path: file.path }); await check();
        const handle = await open(`${anchored(directory)}/${names[i]}`, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        let created;
        try {
          const stat = await handle.stat({ bigint: true }); if (!safeFile(stat)) throw fail(); created = identity(stat); createdFiles.set(file.path, created);
          await record({ kind: "file-created", path: file.path, identity: created }); await check();
          await handle.writeFile(file.content, "utf8"); await handle.sync();
        } finally { await handle.close(); }
        await directory.sync(); await check(); await fact(directory, names[i], file, created);
        await record({ kind: "file-verified", path: file.path, identity: created });
      }
      await check();
      if (JSON.stringify((await readdir(anchored(directory))).sort()) !== JSON.stringify([...names].sort())) throw fail();
      for (const [i, file] of draft.files.entries()) await fact(directory, names[i], file, createdFiles.get(file.path));
      await check(); return { directoryIdentity };
    } finally { await directory.close(); }
  });
}

/** Recovery is observational: known identities must match; partial or unknown work is preserved. */
export async function inspectScannerRecipeFiles(draft, rootIdentity, progress) {
  const names = validate(draft);
  if (!progress.directoryIdentity || draft.files.some(f => progress.files?.[f.path]?.status !== "verified")) return { complete: false, reason: "The original save lacks verified ownership for every file; preserve partial or uncertain output." };
  return withRoot(draft.repositoryRoot, rootIdentity, async (root, checkRoot) => {
    const child = `${anchored(root)}/${draft.directory}`, directory = await open(child, flags);
    try {
      const check = async () => { await checkRoot(); const s = await lstat(child, { bigint: true }); if (!safeDirectory(s) || !same(identity(s), progress.directoryIdentity) || !same(identity(await directory.stat({ bigint: true })), progress.directoryIdentity)) throw fail(); };
      await check(); if (JSON.stringify((await readdir(anchored(directory))).sort()) !== JSON.stringify([...names].sort())) throw fail();
      for (const [i, file] of draft.files.entries()) await fact(directory, names[i], file, progress.files[file.path].identity);
      await check(); return { complete: true };
    } finally { await directory.close(); }
  });
}
