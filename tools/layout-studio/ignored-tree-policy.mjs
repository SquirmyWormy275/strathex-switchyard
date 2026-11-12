/** Explicit Shield-only generated-tree exclusions; never source-byte evidence. */
import { join } from "node:path";
import { directoryIdentity } from "./private-fs.mjs";
import { scopeHash } from "./confirmations.mjs";

export const ignoredBuildTreeNames = Object.freeze(["node_modules", ".venv", "venv", ".tox", "__pycache__", ".mypy_cache", ".pytest_cache", ".cache", "dist", "build", "target", "coverage"]);
export function ignoredTreeRoots(value = []) {
  if (!Array.isArray(value) || value.length > 32) throw Error("Choose at most 32 exact ignored generated-tree roots.");
  const roots = value.map(path => {
    if (typeof path !== "string" || path.length > 512 || path.startsWith("/") || /[\\\x00-\x1f\x7f:*?\[\]]/.test(path)) throw Error("Choose literal ignored generated-tree roots.");
    const parts = path.split("/");
    if (parts.length > 32 || parts.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git" || /[. ]$/.test(part) || /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) || !ignoredBuildTreeNames.includes(parts.at(-1))) throw Error("Exclude only exact named generated directories; secret/configuration folders require file review.");
    return path;
  }).sort();
  const folded = roots.map(path => path.toLowerCase());
  if (new Set(folded).size !== roots.length || folded.some((path, index) => folded.some((other, j) => j !== index && path.startsWith(other + "/")))) throw Error("Ignored generated-tree roots must be distinct and non-overlapping.");
  return roots;
}
export function ignoredTreeQuery(roots) {
  const validated = ignoredTreeRoots(roots);
  if (!validated.length) throw Error("A generated-tree query requires an explicit exclusion.");
  return ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ".", ...validated.map(path => ":(exclude,literal)" + path)];
}
export function assertIgnoredTreeListing(output, roots) {
  if (typeof output !== "string" || Buffer.byteLength(output) > 262144 || output && !output.endsWith("\0")) throw Error("Ignored generated-tree listing is unavailable or malformed.");
  const entries = output ? output.slice(0, -1).split("\0") : [];
  if (entries.length > 4096 || new Set(entries).size !== entries.length || ignoredTreeRoots(roots).some(path => !entries.includes(path + "/"))) throw Error("Every excluded generated tree must currently be a whole ignored directory in Git's bounded listing.");
}
export async function ignoredTreeWitness(repositoryRoot, path, authorize = async () => {}) {
  ignoredTreeRoots([path]);
  const parents = []; let current = repositoryRoot;
  for (const part of ["", ...path.split("/")]) {
    await authorize(); if (part) current = join(current, part);
    const value = await directoryIdentity(current);
    parents.push({ path: current, device: value.dev.toString(), inode: value.ino.toString(), mode: value.mode.toString(), uid: value.uid.toString(), gid: value.gid.toString() });
  }
  // Directory metadata is a policy witness, never a digest of excluded bytes.
  for (const parent of parents) {
    await authorize(); const value = await directoryIdentity(parent.path);
    if (parent.device !== value.dev.toString() || parent.inode !== value.ino.toString() || parent.mode !== value.mode.toString() || parent.uid !== value.uid.toString() || parent.gid !== value.gid.toString()) throw Error("An ignored generated-tree directory changed during inspection.");
  }
  await authorize();
  return { path, digest: "policy-excluded-directory-sha256:" + scopeHash({ schema: "switchyard-shield-ignored-tree-policy/v1", repositoryRoot, path, parents }), classification: "excluded", source: "ignored" };
}
