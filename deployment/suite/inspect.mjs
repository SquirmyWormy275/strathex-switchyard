/** Closed read-only access to the active installed workspace; no endpoint on stdout. */
import {join} from "node:path";
import {applicationStateRoot} from "./application.mjs";
import {privateRead} from "../../tools/layout-studio/private-fs.mjs";
import {endpointIdentity,requestInstance} from "../../tools/layout-studio/instance.mjs";
import {gitIndexPaths} from "../../tools/layout-studio/git-index-inputs.mjs";
import {historySelection} from "../../tools/layout-studio/git-history-inputs.mjs";
const uuid=value=>typeof value==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const usage="Usage: switchyard inspect tasks [--provider codex|claude-code]\n       switchyard inspect inventory --task UUID\n       switchyard inspect index --task UUID -- PATH [PATH...]\n       switchyard inspect history --task UUID [--depth 1..6] -- PATH [PATH...]\nReads the active workspace only. Returns metadata, never grants authority or performs a scan.";
export function parseInspectionArgs(args){
 if(!Array.isArray(args)||args.some(value=>typeof value!=="string"))throw Error(usage);
 if(args.length===1&&args[0]==="--help")return{help:true};
 const kind=args[0];if(!["tasks","inventory","index","history"].includes(kind))throw Error(usage);
 const separator=args.indexOf("--"),options=separator<0?args.slice(1):args.slice(1,separator),paths=separator<0?[]:args.slice(separator+1),parsed=new Map();
 for(let i=0;i<options.length;i+=2){const key=options[i],value=options[i+1];if(!["--task","--depth","--provider"].includes(key)||value===undefined||parsed.has(key)||value.startsWith("--"))throw Error(usage);parsed.set(key,value);}
 if(kind==="tasks"){
  const provider=parsed.get("--provider")??"codex";if(separator>=0||parsed.size>Number(parsed.has("--provider"))||!["codex","claude-code"].includes(provider))throw Error(usage);
  return{kind,provider,route:provider==="codex"?"coding/codex/list":"coding/claude/list",body:{}};
 }
 const taskId=parsed.get("--task");if(!uuid(taskId)||parsed.has("--provider")||kind!=="history"&&parsed.has("--depth"))throw Error(usage);
 if(kind==="inventory"){if(separator>=0||parsed.size!==1)throw Error(usage);return{kind,route:"coding/authority/scanner-inputs",schema:"switchyard-shield-input-inventory/v1",body:{taskId}};}
 if(separator<0||!paths.length||parsed.size!==1+Number(parsed.has("--depth")))throw Error(usage);
 if(kind==="index")return{kind,route:"coding/authority/index-inputs",schema:"switchyard-git-index-inputs/v1",body:{taskId,paths:gitIndexPaths(paths)}};
 const depth=parsed.get("--depth");if(depth!==undefined&&!/^[1-6]$/.test(depth))throw Error(usage);const selection=historySelection(paths,depth===undefined?4:Number(depth));return{kind,route:"coding/authority/history-inputs",schema:"switchyard-git-history-inputs/v1",body:{taskId,paths:selection.paths,depth:selection.depth}};
}
async function boundedJson(response){
 const reader=response.body?.getReader();if(!reader)throw Error("The local inspection returned no metadata.");let total=0;const chunks=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>1024*1024){await reader.cancel();throw Error("The local inspection exceeded its metadata bound.");}chunks.push(value);}return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));}
 catch{throw Error("The local inspection returned invalid or oversized metadata.");}
 finally{reader.releaseLock();}
}
export async function runInspectionCli(args,{endpointFile=join(applicationStateRoot(),"endpoint.json"),readEndpoint=privateRead,fetcher=fetch,probe=requestInstance,write=value=>console.log(value)}={}){
 const selected=parseInspectionArgs(args);if(selected.help){write(usage);return{help:true};}
 let text,endpoint,binding;
 try{text=await readEndpoint(endpointFile);endpoint=JSON.parse(text);binding=endpointIdentity(endpoint);}catch{throw Error("No valid saved Switchyard endpoint was found. Launch the installed application first; no inspection request was sent.");}
 const current=async()=>{if(await readEndpoint(endpointFile)!==text)throw Error("The saved application instance changed; no result was accepted.");const proof=await probe(endpoint);if(proof.authenticated!==true||proof.status!=="ready")throw Error("The saved application is not ready; no result was accepted.");};
 // Challenge-response authenticates the listener before disclosing its bearer.
 await current();const {url,token}=binding;
 let response;try{response=await fetcher(new URL("/api/suite/"+selected.route,url.origin),{method:"POST",redirect:"error",headers:{"Content-Type":"application/json",Origin:url.origin,Authorization:"Bearer "+token},body:JSON.stringify(selected.body),signal:AbortSignal.timeout(120000)});}catch{throw Error("The authenticated local inspection did not settle; no remote destination or retry was selected.");}
 if(response.status!==200){await response.body?.cancel();throw Error(`Local inspection refused (${response.status}). Check the active workspace and exact task/path selection.`);}
 const value=await boundedJson(response);let result;
 if(selected.kind==="tasks"){
  if(!Array.isArray(value)||value.length>512||value.some(row=>!row||typeof row!=="object"||!uuid(row.id)||row.provider!==selected.provider||["label","repositoryRoot","status"].some(key=>Object.hasOwn(row,key)&&(typeof row[key]!=="string"||row[key].length>8192))))throw Error("The local task inventory was invalid; no result was accepted.");
  result={kind:"bound-tasks",provider:selected.provider,activeWorkspaceOnly:true,tasks:value.map(row=>Object.fromEntries(["id","provider","label","repositoryRoot","status"].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))),authorityGranted:false,modelPromptSubmitted:false};
 }else{
  if(!value||value.schema!==selected.schema||value.taskId!==selected.body.taskId||value.sourceBytesReturned!==false||value.scanPerformed!==false||value.authorityGranted!==false||value.gateEligible!==false||value.completeness!=="incomplete")throw Error("The local response was not the exact incomplete read-only observation; no result was accepted.");result=value;
 }
 await current();write(JSON.stringify(result,null,2));return result;
}
