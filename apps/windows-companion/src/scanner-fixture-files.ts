/** Fixed-name fixture storage; source bytes are never executed. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";

export interface FixtureStorageIdentity { readonly device: string; readonly inode: string; readonly birth: string; }
export interface FixtureRemovalFile { readonly name: "manifest.json" | "content.bin"; readonly identity: FixtureStorageIdentity; readonly sha256: string; readonly bytes: number; }
export interface FixtureRemovalSnapshot {
  readonly schema: "sxsy-b122.scanner-fixture-removal/v1";
  readonly id: string;
  readonly manifestSha256: string;
  readonly contentSha256: string;
  readonly rootIdentity: FixtureStorageIdentity | null;
  readonly files: readonly FixtureRemovalFile[];
  readonly originalRemovalSha256: string | null;
}
const identity = (s: { dev: bigint; ino: bigint; birthtimeNs: bigint }): FixtureStorageIdentity => ({ device: s.dev.toString(), inode: s.ino.toString(), birth: s.birthtimeNs.toString() });
const same = (a: FixtureStorageIdentity, b: FixtureStorageIdentity) => a.device === b.device && a.inode === b.inode && a.birth === b.birth;
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const invalid = () => new Error("Preserve an unfamiliar, changed or substituted fixture storage path or file.");
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

/** Refuse existing links before creating a child; never recursively delete. */
export async function fixtureDirectory(path: string, create: boolean): Promise<FixtureStorageIdentity | null> {
  const target = resolve(path), root = parse(target).root;
  if (process.platform === "win32" && !/^[A-Za-z]:[\\/]/.test(target)) throw invalid();
  let current = root, previous = identity(await lstat(root, { bigint: true }));
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    const parent = await lstat(current, { bigint: true });
    if (!parent.isDirectory() || parent.isSymbolicLink() || !same(previous, identity(parent))) throw invalid();
    current = join(current, part);
    let value;
    try { value = await lstat(current, { bigint: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return null;
      try { await mkdir(current, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      value = await lstat(current, { bigint: true });
    }
    if (!value.isDirectory() || value.isSymbolicLink() || !samePath(await realpath(current), current)) throw invalid();
    previous = identity(value);
  }
  return previous;
}

async function fileFact(root: string, name: FixtureRemovalFile["name"], expectedSha256: string, maximum: number): Promise<FixtureRemovalFile | null> {
  const path = join(root, name); let named;
  try { named = await lstat(path, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || named.size < 1n || named.size > BigInt(maximum)) throw invalid();
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({ bigint: true }); if (!same(identity(before), identity(named)) || before.nlink !== 1n || before.size !== named.size) throw invalid();
    const hash = createHash("sha256"), buffer = Buffer.alloc(65536); let total = 0;
    while (total < Number(before.size)) { const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, Number(before.size) - total), total); if (!bytesRead) throw invalid(); hash.update(buffer.subarray(0, bytesRead)); total += bytesRead; }
    const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    const actual = hash.digest("hex");
    if (actual !== expectedSha256 || !same(identity(before), identity(current)) || current.isSymbolicLink() || current.nlink !== 1n || current.size !== before.size || current.mtimeNs !== before.mtimeNs || current.ctimeNs !== before.ctimeNs || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw invalid();
    return { name, identity: identity(before), sha256: actual, bytes: total };
  } finally { await file.close(); }
}

export async function inspectFixtureRemoval(root: string, id: string, manifestSha256: string, contentSha256: string, original?: FixtureRemovalSnapshot, expectedRootIdentity?: FixtureStorageIdentity): Promise<FixtureRemovalSnapshot> {
  const rootIdentity = await fixtureDirectory(root, false), originalRemovalSha256 = original ? sha(JSON.stringify(original)) : null;
  if (!rootIdentity) return { schema: "sxsy-b122.scanner-fixture-removal/v1", id, manifestSha256, contentSha256, rootIdentity: null, files: [], originalRemovalSha256 };
  if (original && (original.schema !== "sxsy-b122.scanner-fixture-removal/v1" || original.id !== id || original.manifestSha256 !== manifestSha256 || original.contentSha256 !== contentSha256 || !original.rootIdentity || !same(original.rootIdentity, rootIdentity))) throw invalid();
  if (expectedRootIdentity && !same(expectedRootIdentity, rootIdentity)) throw invalid();
  const names = await readdir(root); if (names.some(name => !["manifest.json", "content.bin"].includes(name))) throw invalid();
  const files: FixtureRemovalFile[] = [];
  for (const [name, expected, maximum] of [["manifest.json", manifestSha256, 1024 * 1024], ["content.bin", contentSha256, 64 * 1024 * 1024]] as const) {
    const fact = await fileFact(root, name, expected, maximum);
    if (!fact) { if (!original && !expectedRootIdentity) throw invalid(); continue; }
    if (original && !original.files.some(file => file.name === name && file.sha256 === fact.sha256 && same(file.identity, fact.identity))) throw invalid();
    files.push(fact);
  }
  const current = await fixtureDirectory(root, false); if (!current || !same(current, rootIdentity)) throw invalid();
  return { schema: "sxsy-b122.scanner-fixture-removal/v1", id, manifestSha256, contentSha256, rootIdentity, files, originalRemovalSha256 };
}

export async function removeReviewedFixture(root: string, snapshot: FixtureRemovalSnapshot, check: () => Promise<void>): Promise<void> {
  await check();
  for (const file of snapshot.files) {
    await check();
    const currentRoot = await fixtureDirectory(root, false); if (!snapshot.rootIdentity || !currentRoot || !same(snapshot.rootIdentity, currentRoot)) throw invalid();
    const current = await fileFact(root, file.name, file.sha256, file.name === "manifest.json" ? 1024 * 1024 : 64 * 1024 * 1024);
    if (!current || JSON.stringify(current) !== JSON.stringify(file)) throw invalid();
    await unlink(join(root, file.name));
  }
  if (snapshot.rootIdentity) {
    await check();
    const current = await fixtureDirectory(root, false); if (!current || !same(current, snapshot.rootIdentity) || (await readdir(root)).length) throw invalid();
    await rmdir(root);
  } else if (await fixtureDirectory(root, false)) throw invalid();
}
