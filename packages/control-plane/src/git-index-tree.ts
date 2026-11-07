/** Derive Git's logical index tree from metadata without writing cache or objects. */
import { createHash } from "node:crypto";

export interface GitIndexTreeEntry { readonly path: string; readonly mode: string; readonly objectId: string; }
interface TreeNode { name: string; mode?: string; objectId?: string; children?: Map<string, TreeNode>; }
export function gitIndexTreeFromEntries(entries: readonly GitIndexTreeEntry[], format: "sha1" | "sha256", portableNames = false): string {
  if (!Array.isArray(entries) || entries.length > 4096 || !["sha1", "sha256"].includes(format)) throw Error("The bounded Git index tree metadata is unavailable.");
  const root = new Map<string, TreeNode>(), length = format === "sha1" ? 40 : 64; let pathBytes = 0;
  for (const entry of entries) {
    if (!entry || Object.keys(entry).sort().join() !== "mode,objectId,path" || !["100644", "100755", "120000", "160000"].includes(entry.mode) || typeof entry.objectId !== "string" || entry.objectId.length !== length || !/^[a-f0-9]+$/.test(entry.objectId) || /^0+$/.test(entry.objectId)
        || typeof entry.path !== "string" || entry.path.length > 4096 || Buffer.from(entry.path).toString("utf8") !== entry.path || /[\0\\]/.test(entry.path)) throw Error("The Git index contains unsupported object or path metadata.");
    pathBytes += Buffer.byteLength(entry.path);
    const parts: string[] = entry.path.split("/");
    if (pathBytes > 262144 || parts.length > 64 || parts.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw Error("The Git index paths exceed their exact bounded tree scope.");
    let directory = root;
    for (const [i, name] of parts.entries()) {
      const key = portableNames ? name.toLowerCase() : name, existing = directory.get(key), leaf = i === parts.length - 1;
      if (existing && (existing.name !== name || leaf || !existing.children)) throw Error("Index tree paths collide as files, directories or platform aliases.");
      if (leaf) directory.set(key, { name, mode: entry.mode, objectId: entry.objectId });
      else { if (!existing) directory.set(key, { name, children: new Map() }); directory = directory.get(key)!.children!; }
    }
  }
  const tree = (directory: Map<string, TreeNode>): string => {
    const children = [...directory.values()].map(child => ({ ...child, order: Buffer.from(child.name + (child.children ? "/" : "")) }));
    children.sort((a, b) => Buffer.compare(a.order, b.order));
    const bytes = Buffer.concat(children.flatMap(child => [Buffer.from(`${child.children ? "40000" : child.mode} ${child.name}\0`), Buffer.from(child.children ? tree(child.children) : child.objectId!, "hex")]));
    return createHash(format).update(`tree ${bytes.length}\0`).update(bytes).digest("hex");
  };
  return tree(root);
}

export function gitIndexTreeFromListing(output: string, head: string): string {
  if (typeof output !== "string" || Buffer.byteLength(output) > 262144 || output !== "" && !output.endsWith("\0") || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head) || /^0+$/.test(head)) throw Error("The exact bounded Git index listing or object format is unavailable.");
  const entries = (output ? output.slice(0, -1).split("\0") : []).map(line => {
    const match = /^(100644|100755|120000|160000) ([a-f0-9]+) 0\t([\s\S]+)$/.exec(line);
    if (!match) throw Error("The index contains unmerged, sparse or unsupported tree metadata.");
    return { mode: match[1]!, objectId: match[2]!, path: match[3]! };
  });
  return gitIndexTreeFromEntries(entries, head.length === 40 ? "sha1" : "sha256", process.platform === "win32");
}
