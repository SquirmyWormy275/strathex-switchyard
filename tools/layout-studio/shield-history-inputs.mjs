/** Host-only historical scanner provenance. No caller revision reaches Git commands. */
import { historySelection } from "./git-history-inputs.mjs";
export const shieldHistoryFiles=request=>request.files.filter(file=>file.source?.kind==="git-history");
function selection(request){const files=shieldHistoryFiles(request);return historySelection([...new Set(files.map(file=>file.source.path))],files[0]?.source.depth);}
export function bindShieldHistoryWitness(request,report){
  const files=shieldHistoryFiles(request),selected=selection(request);
  if(!report||report.schema!=="switchyard-git-history-inputs/v1"||report.sourceBytesWitnessed!==true||report.sourceBytesReturned!==false||report.requestedDepth!==selected.depth||JSON.stringify(report.paths)!==JSON.stringify(selected.paths)||!Array.isArray(report.versions)||report.versions.length!==files.length||new Set(report.versions.map(row=>row.commit+":"+row.path)).size!==files.length||!/^[a-f0-9]{64}$/.test(report.historyMetadataSha256??""))throw Error("The complete selected historical version witness is unavailable.");
  const rows=new Map(report.versions.map(row=>[row.commit+":"+row.path,row]));
  for(const file of files){const row=rows.get(file.source.commit+":"+file.source.path);if(!row||row.objectId!==file.source.objectId||row.mode!==file.source.mode||row.sha256!==file.sha256||row.size!==file.size)throw Error("The reviewed historical source does not match its exact immutable blob.");}
  return{source:"git-history",head:report.head,paths:selected.paths,requestedDepth:selected.depth,historyMetadataSha256:report.historyMetadataSha256,stopping:report.stopping,shallow:report.shallow,rows:report.versions};
}
export async function resolveShieldHistoryWitness(request,resolve){
  if(!shieldHistoryFiles(request).length)return undefined;
  if(typeof resolve!=="function")throw Error("This execution host has no connected private history staging; no worktree substitute was selected.");
  const selected=selection(request);return resolve(selected.paths,selected.depth,report=>bindShieldHistoryWitness(request,report));
}
export function shieldHistoryStagingBytes(shield,report,bytes){
  if(JSON.stringify(bindShieldHistoryWitness(shield.request,report))!==JSON.stringify(shield.historyWitness)||!(bytes instanceof Map))throw Error("The original historical scanner scope changed before private staging.");
  return new Map(shieldHistoryFiles(shield.request).map(file=>{const content=bytes.get(file.source.objectId);if(!(content instanceof Uint8Array)||content.byteLength!==file.size)throw Error("The exact private historical blob bytes are unavailable.");return[file.path,{bytes:content,mode:file.source.mode}];}));
}
