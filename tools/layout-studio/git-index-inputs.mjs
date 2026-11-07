/** Literal Git index blobs. Object hashes verify raw bytes; no filters or source excerpts. */
import { createHash } from "node:crypto";

export const gitIndexLimits = Object.freeze({ paths: 64, entries: 4096, fileBytes: 256 * 1024, totalBytes: 448 * 1024, listingBytes: 256 * 1024, outputBytes: 512 * 1024 });
// Base64 and the reviewed envelope must still fit the native 512 KiB request.
export const gitIndexWindowsRawLimit = 320 * 1024;
export const gitIndexListingQuery = Object.freeze(["ls-files", "--stage", "-z"]);
export const gitIndexBatchQuery = Object.freeze(["cat-file", "--batch"]);
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
function path(value) {
  if (typeof value !== "string" || !value || value.length > 512 || value.split("/").length > 32 || /[\\\x00-\x1f\x7f:*?\[\]]/.test(value) || value.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || /[. ]$/.test(part) || /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) throw Error("Choose literal portable index paths without traversal, Git metadata or platform aliases.");
  return value;
}
export function gitIndexPaths(value) {
  if (!Array.isArray(value) || !value.length || value.length > gitIndexLimits.paths) throw Error("Choose 1–64 exact index input paths.");
  const selected = value.map(path);
  if (new Set(selected.map(p => p.toLowerCase())).size !== selected.length) throw Error("Index input paths repeat or collide across platforms.");
  return selected.sort();
}
export function selectGitIndexEntries(output, selectedPaths, objectIdLength) {
  const selected = gitIndexPaths(selectedPaths);
  if (![40, 64].includes(objectIdLength) || typeof output !== "string" || Buffer.byteLength(output) > gitIndexLimits.listingBytes || !output.endsWith("\0")) throw Error("The exact bounded Git index listing is unavailable.");
  const lines = output.slice(0, -1).split("\0"), entries = new Map(), keys = new Set();
  if (lines.length > gitIndexLimits.entries) throw Error("The Git index exceeds the supported metadata bound.");
  for (const line of lines) {
    const match = /^(100644|100755|120000|160000) ([a-f0-9]+) 0\t(.+)$/.exec(line);
    if (!match || match[2].length !== objectIdLength || /^0+$/.test(match[2])) throw Error("The index contains unmerged, sparse or unsupported object metadata.");
    const name = path(match[3]), key = name.toLowerCase();
    if (keys.has(key)) throw Error("The index contains repeated or platform-ambiguous paths.");
    keys.add(key); entries.set(name, { path: name, mode: match[1], objectId: match[2] });
  }
  return selected.map(name => {
    const entry = entries.get(name);
    if (!entry || !["100644", "100755"].includes(entry.mode)) throw Error("Each selected index input must be one exact stage-zero regular blob; links, submodules and missing paths are refused.");
    return entry;
  });
}
export function gitIndexBatchInput(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > gitIndexLimits.paths || entries.some(e => !e || typeof e !== "object" || Object.keys(e).sort().join() !== "mode,objectId,path" || !["100644", "100755"].includes(e.mode) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(e.objectId ?? "") || /^0+$/.test(e.objectId) || e.objectId.length !== entries[0].objectId.length)) throw Error("Only derived bounded regular Git object identities may reach the blob query.");
  gitIndexPaths(entries.map(e => e.path));
  return entries.map(e => e.objectId + "\n").join("");
}
/** Reconstruct the complete bounded regular-file index tree without native effects. */
export function gitIndexTreeFromEntries(entries) {
  gitIndexBatchInput(entries);
  const root = new Map(), algorithm = entries[0].objectId.length === 40 ? "sha1" : "sha256";
  for (const entry of entries) {
    let directory = root;
    const parts = entry.path.split("/");
    for (const [i, name] of parts.entries()) {
      // Git can store these names; the portable scanner contract cannot.
      if (Buffer.from(name).toString("utf8") !== name) throw Error("Index tree names must be exact UTF-8.");
      const key = name.toLowerCase(), existing = directory.get(key), leaf = i === parts.length - 1;
      if (existing && (existing.name !== name || leaf || !existing.children)) throw Error("Index tree paths collide as files, directories or platform aliases.");
      if (leaf) directory.set(key, { name, mode: entry.mode, objectId: entry.objectId });
      else {
        if (!existing) directory.set(key, { name, children: new Map() });
        directory = directory.get(key).children;
      }
    }
  }
  const tree = directory => {
    const children = [...directory.values()].map(child => ({ ...child, order: Buffer.from(child.name + (child.children ? "/" : "")) }));
    children.sort((a, b) => Buffer.compare(a.order, b.order));
    const bytes = Buffer.concat(children.flatMap(child => [Buffer.from(`${child.children ? "40000" : child.mode} ${child.name}\0`), Buffer.from(child.children ? tree(child.children) : child.objectId, "hex")]));
    return createHash(algorithm).update(`tree ${bytes.length}\0`).update(bytes).digest("hex");
  };
  return tree(root);
}
/** Callback bytes are private and borrowed; callers must copy only when needed. */
export async function witnessGitIndexBatch(output, entries, consume = async () => {}) {
  if (typeof output !== "string" || Buffer.byteLength(output) > gitIndexLimits.outputBytes) throw Error("The exact index blob output exceeds its bound.");
  gitIndexBatchInput(entries);
  const buffer = Buffer.from(output), rows = []; let offset = 0, total = 0;
  try {
    for (const entry of entries) {
      const end = buffer.indexOf(10, offset);
      if (end < offset || end - offset > 96) throw Error("Invalid bounded Git blob header.");
      const match = /^([a-f0-9]+) blob (0|[1-9][0-9]*)$/.exec(buffer.subarray(offset, end).toString("ascii"));
      if (!match || match[1] !== entry.objectId) throw Error("The native Git blob identity or type changed.");
      const size = Number(match[2]); total += size;
      if (!Number.isSafeInteger(size) || size > gitIndexLimits.fileBytes || total > gitIndexLimits.totalBytes || end + size + 1 >= buffer.length || buffer[end + size + 1] !== 10) throw Error("A Git index blob is truncated or exceeds its exact byte bound.");
      const bytes = buffer.subarray(end + 1, end + size + 1);
      const actual = createHash(entry.objectId.length === 40 ? "sha1" : "sha256").update(`blob ${size}\0`).update(bytes).digest("hex");
      if (actual !== entry.objectId) throw Error("The raw index bytes do not match their Git object identity.");
      const row = { ...entry, size, sha256: hash("sha256", bytes) };
      await consume(row, bytes); rows.push(row); offset = end + size + 2;
    }
    if (offset !== buffer.length) throw Error("Unexpected trailing Git object output.");
    return rows;
  } finally { buffer.fill(0); }
}
export function gitIndexWitnessReport({ head, listing, rows, observedAt }) {
  const result = { schema: "switchyard-git-index-inputs/v1", version: 1, source: "git-index", head,
    indexMetadataSha256: hash("sha256", listing), rows, observedAt, sourceBytesWitnessed: true, sourceBytesReturned: false,
    scanPerformed: false, authorityGranted: false, gateEligible: false, completeness: "incomplete",
    limits: { ...gitIndexLimits }, gaps: ["repository_scope_unverified", "worktree_not_scanned", "git_history_not_scanned", "selected_index_blobs_only"] };
  return { ...result, metadataSha256: hash("sha256", JSON.stringify(result)) };
}
