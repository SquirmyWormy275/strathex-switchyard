/** Read-only preparation hints. These names never constitute a scan or grant. */
import { scopeHash } from "./confirmations.mjs";
import { ignoredBuildTreeNames } from "./ignored-tree-policy.mjs";

const buildTrees = ignoredBuildTreeNames;
const secretNames = Object.freeze([".env", ".env.*", ".npmrc", ".pypirc", "credentials.json", "credentials.*.json", "*.pem", "*.key", "*.p12", "*.pfx"]);
export const shieldInventoryQueries = Object.freeze({
  tracked: Object.freeze(["ls-files", "-z"]),
  untracked: Object.freeze(["ls-files", "--others", "--exclude-standard", "-z"]),
  ignored: Object.freeze(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory", "-z"]),
  relevantIgnored: Object.freeze(["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--",
    ...secretNames.map(name => `:(glob)**/${name}`), ...buildTrees.map(name => `:(exclude,glob)**/${name}/**`)])
});

function literalPath(value, directory = false) {
  const path = directory && value.endsWith("/") ? value.slice(0, -1) : value;
  if (!path || path.length > 512 || path.startsWith("/") || /[\\\x00-\x1f\x7f:*?\[\]]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || /[. ]$/.test(part) || /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) throw Error("Scanner inventory contains an unsupported literal path.");
  return path;
}
function list(value, directories = false) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 262144 || value && !value.endsWith("\0")) throw Error("Scanner inventory is not a bounded NUL-terminated list.");
  const entries = value ? value.slice(0, -1).split("\0") : [];
  if (entries.length > 4096) throw Error("Scanner inventory exceeds its path bound.");
  const seen = new Set();
  return entries.map(entry => {
    const path = literalPath(entry, directories), key = path.toLowerCase();
    if (seen.has(key)) throw Error("Scanner inventory contains repeated or platform-ambiguous paths.");
    seen.add(key); return { path, directory: directories && entry.endsWith("/") };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function relevantSecret(path) {
  const name = path.split("/").at(-1).toLowerCase();
  return name === ".env" || name.startsWith(".env.") || [".npmrc", ".pypirc", "credentials.json"].includes(name) || /^credentials\..+\.json$/.test(name) || /\.(pem|key|p12|pfx)$/.test(name);
}
export function buildShieldInputInventory({ tracked, untracked, ignored, relevantIgnored }) {
  const files = list(tracked), newFiles = list(untracked), ignoredEntries = list(ignored, true), secrets = list(relevantIgnored);
  const selected = new Set([...files, ...newFiles].map(file => file.path.toLowerCase()));
  if (selected.size !== files.length + newFiles.length || secrets.some(file => selected.has(file.path.toLowerCase()) || !relevantSecret(file.path) || file.path.split("/").some(part => buildTrees.includes(part)))) throw Error("Scanner inventory classifications are inconsistent.");
  for (const file of secrets) if (!ignoredEntries.some(entry => entry.directory ? file.path.startsWith(entry.path + "/") : file.path === entry.path)) throw Error("Relevant ignored input is outside the observed ignored inventory.");
  if (ignoredEntries.some(entry => !entry.directory && selected.has(entry.path.toLowerCase()))) throw Error("Ignored inventory overlaps selected source paths.");
  const secretPaths = new Set(secrets.map(file => file.path));
  const rows = [
    ...files.map(file => ({ path: file.path, source: "tracked", kind: "file-path", recommendation: "review-for-scan" })),
    ...newFiles.map(file => ({ path: file.path, source: "untracked", kind: "file-path", recommendation: "review-for-scan" })),
    ...ignoredEntries.filter(entry => !secretPaths.has(entry.path)).map(entry => ({ path: entry.path, source: "ignored", kind: entry.directory ? "directory-prefix" : "file-path", recommendation: entry.directory && entry.path.split("/").some(part => buildTrees.includes(part)) ? "review-build-tree-exclusion" : "needs-classification" })),
    ...secrets.map(file => ({ path: file.path, source: "ignored", kind: "file-path", recommendation: "review-secret-input" }))
  ];
  if (rows.length > 4096) throw Error("Combined scanner inventory exceeds its path bound.");
  const result = { schema: "switchyard-shield-input-inventory/v1", version: 1, policy: "bounded-metadata-preview/v1", rows,
    sourceBytesWitnessed: false, sourceBytesReturned: false, scanPerformed: false, authorityGranted: false, gateEligible: false, completeness: "incomplete",
    gaps: ["file_bytes_not_witnessed", "staged_bytes_not_inspected", "ignored_build_tree_contents_not_inspected", "unknown_ignored_paths_require_classification", "repository_scope_unverified"],
    buildTreeNames: [...buildTrees], relevantIgnoredNames: [...secretNames] };
  if (Buffer.byteLength(JSON.stringify(result)) > 480 * 1024) throw Error("Scanner inventory report exceeds its byte bound.");
  return { ...result, metadataDigest: scopeHash(result) };
}
