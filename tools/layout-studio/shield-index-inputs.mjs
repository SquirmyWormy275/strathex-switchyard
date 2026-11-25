/** Host-only binding between reviewed scanner aliases and witnessed Git index bytes. */
import { gitIndexPaths } from "./git-index-inputs.mjs";

export function shieldIndexFiles(request) { return request.files.filter(file => file.source?.kind === "git-index"); }
export function bindShieldIndexWitness(request, report) {
  const files = shieldIndexFiles(request), paths = gitIndexPaths(files.map(file => file.source.path));
  if (!report || report.schema !== "switchyard-git-index-inputs/v1" || report.sourceBytesWitnessed !== true || report.sourceBytesReturned !== false || report.rows?.length !== files.length || new Set(report.rows.map(row => row.path)).size !== files.length) throw Error("The exact scanner index input witness is unavailable.");
  const rows = new Map(report.rows.map(row => [row.path, row]));
  for (const file of files) {
    const row = rows.get(file.source.path);
    if (!row || row.objectId !== file.source.objectId || row.mode !== file.source.mode || row.sha256 !== file.sha256 || row.size !== file.size) throw Error("The reviewed scanner source does not match the exact staged Git blob.");
  }
  return { source: "git-index", head: report.head, indexMetadataSha256: report.indexMetadataSha256, rows: paths.map(path => rows.get(path)) };
}
export async function resolveShieldIndexWitness(request, resolveIndexInputs) {
  const files = shieldIndexFiles(request);
  if (!files.length) return undefined;
  if (typeof resolveIndexInputs !== "function") throw Error("This execution host has no connected task-bound index byte staging; no worktree substitute was selected.");
  const paths = gitIndexPaths(files.map(file => file.source.path));
  return resolveIndexInputs(paths, report => bindShieldIndexWitness(request, report));
}
export function shieldIndexStagingBytes(shield, report, bytes) {
  const witnessed = bindShieldIndexWitness(shield.request, report);
  if (JSON.stringify(witnessed) !== JSON.stringify(shield.indexWitness) || !(bytes instanceof Map)) throw Error("The original scanner index scope changed before private staging.");
  return new Map(shieldIndexFiles(shield.request).map(file => {
    const content = bytes.get(file.source.path);
    if (!(content instanceof Uint8Array) || content.byteLength !== file.size) throw Error("The exact private staged blob bytes are unavailable.");
    return [file.path, { bytes: content, mode: file.source.mode }];
  }));
}
