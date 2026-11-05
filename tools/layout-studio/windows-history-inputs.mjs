/** Private historical bytes for native staging; never persist encoded source content. */
import {createHash} from "node:crypto";
import {validateRepositoryInputs} from "../../apps/windows-companion/src/repository-inputs.ts";
import {historySelection,gitHistoryLimits} from "./git-history-inputs.mjs";
import {shieldHistoryPrefix,shieldIndexPrefix,shieldReservedPath} from "./shield-scanner-engine.mjs";
export const windowsHistoryRawLimit=320*1024,windowsHistoryRequestLimit=512*1024;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),oid=value=>typeof value==="string"&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)&&!/^0+$/.test(value),exact=(value,fields)=>value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).sort().join()===fields.slice().sort().join();
export function buildWindowsHistoryPacket({action,historyWitness,historyBytes,inputFiles}){
 const files=validateRepositoryInputs(inputFiles),witness=historyWitness;
 if(!["shield_codebase_audit","release_shield"].includes(action)||!exact(witness,["source","head","paths","requestedDepth","historyMetadataSha256","stopping","shallow","rows"])||witness.source!=="git-history"||!oid(witness.head)||!/^[a-f0-9]{64}$/.test(witness.historyMetadataSha256??"")||typeof witness.shallow!=="boolean"||!exact(witness.stopping,["kind","nextFirstParent"])||!["root","depth","shallow"].includes(witness.stopping.kind)||(witness.stopping.kind==="root"?witness.stopping.nextFirstParent!==null:!oid(witness.stopping.nextFirstParent)||witness.stopping.nextFirstParent.length!==witness.head.length)||witness.stopping.kind==="shallow"&&!witness.shallow||!Array.isArray(witness.rows)||witness.rows.length<1||witness.rows.length>48||!(historyBytes instanceof Map))throw Error("Private Windows history packets require the exact bounded historical Shield witness.");
 const selection=historySelection(witness.paths,witness.requestedDepth),allowed=new Map(files.map(file=>[file.path,file])),encoded=[],seen=new Set(),used=new Set(),commits=new Set();let total=0;
 if(selection.paths.some(shieldReservedPath)||JSON.stringify(selection.paths)!==JSON.stringify(witness.paths)||historyBytes.size!==witness.rows.length||files.filter(file=>file.path.startsWith(shieldHistoryPrefix)).length!==witness.rows.length||files.some(file=>file.path.startsWith(shieldIndexPrefix)))throw Error("The private historical packet does not match its exact reserved reviewed inputs.");
 for(const row of witness.rows){
  const path=shieldHistoryPrefix+row?.commit+"/"+row?.path,declared=allowed.get(path),content=historyBytes.get(path);
  if(!exact(row,["commit","path","mode","objectId","size","sha256"])||!oid(row.commit)||!oid(row.objectId)||row.commit.length!==witness.head.length||row.objectId.length!==witness.head.length||!selection.paths.includes(row.path)||seen.has(path)||!["100644","100755"].includes(row.mode)||!/^[a-f0-9]{64}$/.test(row.sha256??"")||!Number.isSafeInteger(row.size)||row.size<0||row.size>gitHistoryLimits.fileBytes||!declared||declared.size!==row.size||declared.sha256!==row.sha256||!exact(content,["bytes","mode"])||content.mode!==row.mode||!(content.bytes instanceof Uint8Array)||content.bytes.byteLength!==row.size)throw Error("A historical Windows source changed from its exact reviewed commit/blob bytes.");
  seen.add(path);used.add(row.path);commits.add(row.commit);total+=row.size;if(total>windowsHistoryRawLimit||commits.size>selection.depth)throw Error("Historical Windows bytes exceed the bounded encoded-transport subset.");
  if(createHash(row.objectId.length===40?"sha1":"sha256").update(`blob ${row.size}\0`).update(content.bytes).digest("hex")!==row.objectId||sha(content.bytes)!==row.sha256)throw Error("Private historical bytes do not match their raw Git blob identity.");
  encoded.push({path,contentBase64:Buffer.from(content.bytes.buffer,content.bytes.byteOffset,content.bytes.byteLength).toString("base64")});
 }
 if(used.size!==selection.paths.length)throw Error("Each selected historical path needs its reviewed versions.");
 return{schema:"switchyard-windows-history-bytes/v1",action,witness:structuredClone(witness),files:encoded};
}
export function windowsHistoryRequest(base,packet){
 if(!base||typeof base!=="object"||Object.hasOwn(base,"indexInputs")||Object.hasOwn(base,"historyInputs"))throw Error("Use one newly constructed private historical Windows request.");
 const request={...base,historyInputs:packet},text=JSON.stringify(request);if(Buffer.byteLength(text)>windowsHistoryRequestLimit)throw Error("The complete historical Windows request exceeds the original 512 KiB stdin bound.");return{request,text,packetSha256:sha(JSON.stringify(packet)),witnessSha256:sha(JSON.stringify(packet.witness))};
}
