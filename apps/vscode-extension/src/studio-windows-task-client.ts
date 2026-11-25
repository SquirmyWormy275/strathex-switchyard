/** Windows wire contracts over the shared signed transport. A verified native
 * endpoint reader is required; there is no plain file or credential fallback. */
import { createHash } from "node:crypto";
import { studioEditorChoices, studioEditorProjects, type StudioEditorProjects, type StudioEditorChoices } from "./studio-editor-choices.ts";
import { StudioInstanceTransport,type StudioInstanceOperation } from "./studio-instance-transport.ts";
import { windowsEditorEndpoint,windowsEditorLocalPath,type WindowsEditorEndpoint } from "./codex-windows-terminal.ts";
import type { StudioEditorSelection,StudioEditorRequest,StudioEditorReview,StudioEditorAuthorization,StudioEditorObservation,StudioEditorTarget,StudioEditorConnectionObservation,StudioEditorConnectionRecord } from "./studio-task-client.ts";

export interface WindowsEditorBinding {
  readonly schema:"switchyard-windows-codex-stdio-binding/v1";
  readonly scope:Readonly<{schema:"switchyard-runtime-command/v1";id:string;guardianPid:number;birth:string;containment:"windows-job"}>;
  readonly peerPid:number;readonly peerBirth:string;readonly peerExecutableSha256:string;
}
export interface WindowsEditorImage {readonly path:string;readonly sha256:string;readonly device:string;readonly inode:string;readonly size:string;}
export interface WindowsEditorPeer {readonly processId:number;readonly expectedBirth:string;readonly image:WindowsEditorImage;}
export type WindowsEditorTarget=Omit<StudioEditorTarget,"endpoint">&{readonly endpoint:WindowsEditorBinding};
export type WindowsEditorObservation=Omit<StudioEditorObservation,"target">&{readonly target:WindowsEditorTarget};
export type WindowsEditorReview=Omit<StudioEditorReview,"target">&{readonly target:WindowsEditorTarget};
export type WindowsEditorAuthorization=Omit<StudioEditorAuthorization,"target">&{readonly target?:WindowsEditorTarget};
export interface WindowsEditorConnectionReady extends StudioEditorConnectionObservation {readonly duplicatePrevented:false;readonly endpoint:WindowsEditorEndpoint;}
const ids=["ownerRequestId","loadRequestId","requestId","editorId"] as const;
const flags=["terminalLaunched","ideAttached","authorityGranted","completionVerified"];
const authFlags=["terminalLaunchAuthorized","terminalLaunched","ideAttached","modelPromptSubmitted","completionVerified"];
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==="object" && !Array.isArray(v);
const exact=(v:unknown,names:readonly string[]):v is Record<string,unknown>=>object(v) && Object.keys(v).sort().join()===names.slice().sort().join();
function requireValue(v:unknown):asserts v{if(!v)throw Error("The original Windows Switchyard editor target did not validate.");}
const hash=(v:unknown):v is string=>typeof v==="string" && /^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==="string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) && v!=="00000000-0000-0000-0000-000000000000";
const integer=(v:unknown,zero=false):v is string=>typeof v==="string" && (zero?/^(?:0|[1-9][0-9]{0,19})$/:/^[1-9][0-9]{0,19}$/).test(v) && BigInt(v)<=0xffffffffffffffffn;
const pid=(v:unknown):v is number=>Number.isSafeInteger(v) && (v as number)>0 && (v as number)<=2147483647;
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
function selection(v:unknown,extra?:"token"|"permit"):StudioEditorRequest&Record<string,unknown>{
  requireValue(exact(v,["compartment",...ids,...(extra?[extra]:[])]) && typeof v.compartment==="string" && /^[a-z][a-z0-9-]{0,63}$/.test(v.compartment) && ids.every(k=>uuid(v[k])) && (!extra||uuid(v[extra])));
  return Object.freeze({...v}) as unknown as StudioEditorRequest&Record<string,unknown>;
}
export function windowsEditorBinding(value:unknown):Readonly<WindowsEditorBinding>{
  requireValue(exact(value,["schema","scope","peerPid","peerBirth","peerExecutableSha256"]) && value.schema==="switchyard-windows-codex-stdio-binding/v1" && pid(value.peerPid) && integer(value.peerBirth) && hash(value.peerExecutableSha256));
  const scope=value.scope;requireValue(exact(scope,["schema","id","guardianPid","birth","containment"]) && scope.schema==="switchyard-runtime-command/v1" && scope.containment==="windows-job" && uuid(scope.id) && pid(scope.guardianPid) && scope.guardianPid!==value.peerPid && integer(scope.birth));
  return Object.freeze({...value,scope:Object.freeze({...scope})}) as unknown as WindowsEditorBinding;
}
export function windowsEditorPeer(value:unknown):Readonly<WindowsEditorPeer>{
  requireValue(exact(value,["processId","expectedBirth","image"]) && pid(value.processId) && integer(value.expectedBirth));const image=value.image;
  requireValue(exact(image,["path","sha256","device","inode","size"]) && windowsEditorLocalPath(image.path) && image.path.length>3 && hash(image.sha256) && integer(image.device,true) && BigInt(image.device)<=0xffffffffn && integer(image.inode) && integer(image.size) && BigInt(image.size)<=512n*1024n*1024n);
  return Object.freeze({...value,image:Object.freeze({...image})}) as unknown as WindowsEditorPeer;
}
function target(value:unknown,s:StudioEditorSelection):WindowsEditorTarget{
  requireValue(exact(value,["schema","ownerRequestId","loadRequestId","taskId","sessionId","repositoryRoot","repositoryIdentity","accountFingerprint","permissions","endpoint"]) && value.schema==="switchyard-codex-editor-target/v1" && value.ownerRequestId===s.ownerRequestId && value.loadRequestId===s.loadRequestId && uuid(value.taskId) && uuid(value.sessionId) && windowsEditorLocalPath(value.repositoryRoot) && hash(value.accountFingerprint) && value.permissions==="read-only/on-request");
  const repo=value.repositoryIdentity;requireValue(exact(repo,["device","inode"]) && integer(repo.device,true) && BigInt(repo.device)<=0xffffffffn && integer(repo.inode));
  return Object.freeze({...value,repositoryIdentity:Object.freeze({...repo}),endpoint:windowsEditorBinding(value.endpoint)}) as unknown as WindowsEditorTarget;
}
function observation(value:unknown,s:StudioEditorSelection):WindowsEditorObservation{
  const effects=["nativeTaskLoaded","authorityGranted","terminalLaunched","ideAttached","modelPromptSubmitted","completionVerified"];
  requireValue(exact(value,["target","targetDigest","metadataObserved","nativeLoadAcknowledged",...effects]) && value.metadataObserved===true && value.nativeLoadAcknowledged===true && effects.every(k=>value[k]===false) && hash(value.targetDigest) && value.targetDigest===digest(value.target));
  return Object.freeze({...value,target:target(value.target,s)}) as unknown as WindowsEditorObservation;
}
function review(value:unknown,s:StudioEditorRequest):WindowsEditorReview{
  requireValue(exact(value,["status","selection","target","confirmation",...authFlags]) && value.status==="requires-confirmation" && authFlags.every(k=>value[k]===false) && exact(value.selection,ids) && ids.every(k=>(value.selection as Record<string,unknown>)[k]===s[k]));
  const selected=target(value.target,s),confirmation=value.confirmation;requireValue(exact(confirmation,["token","record"]) && uuid(confirmation.token));const r=confirmation.record;
  requireValue(exact(r,["id","action","sessionId","targetSnapshotId","scopeDigest","reason","reauthenticated","createdAt","expiresAt"]) && uuid(r.id) && r.action==="launch_codex_editor" && r.sessionId===selected.sessionId && hash(r.scopeDigest) && r.reauthenticated===false);
  requireValue(r.targetSnapshotId===digest(["switchyard-editor-launch/v1",s.compartment,Object.fromEntries(ids.map(k=>[k,s[k]]))]) && typeof r.reason==="string" && r.reason.length>0 && r.reason.length<=2048 && !/[\x00-\x1f\x7f]/.test(r.reason) && typeof r.createdAt==="string" && typeof r.expiresAt==="string");
  const created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt),now=Date.now();requireValue(Number.isFinite(created) && created<=now && expires>now && expires-created===300000);
  return Object.freeze({...value,target:selected,selection:Object.freeze({...value.selection}),confirmation:Object.freeze({...confirmation,record:Object.freeze({...r})})}) as unknown as WindowsEditorReview;
}
function authorization(value:unknown,s:StudioEditorRequest,action:"editorIssue"|"editorConsume"):WindowsEditorAuthorization{
  requireValue(object(value));const duplicate=value.duplicatePrevented===true,extra=duplicate?["duplicatePrevented"]:action==="editorIssue"?["permit","expiresAt","targetDigest"]:["target","targetDigest","expiresAt"];
  requireValue(exact(value,[...ids,"status",...authFlags,...extra]) && ids.every(k=>value[k]===s[k]) && ["issued","consumed"].includes(value.status as string) && authFlags.filter(k=>k!=="terminalLaunchAuthorized").every(k=>value[k]===false) && value.terminalLaunchAuthorized===(!duplicate && action==="editorConsume"));
  if(action==="editorConsume"||!duplicate)requireValue(value.status===(action==="editorIssue"?"issued":"consumed"));
  if(!duplicate){requireValue(hash(value.targetDigest) && Number.isSafeInteger(value.expiresAt) && (value.expiresAt as number)>Date.now() && (value.expiresAt as number)<=Date.now()+30000);
    if(action==="editorIssue")requireValue(uuid(value.permit));else {requireValue(digest(value.target)===value.targetDigest);return Object.freeze({...value,target:target(value.target,s)}) as unknown as WindowsEditorAuthorization;}}
  return Object.freeze({...value}) as unknown as WindowsEditorAuthorization;
}
type Action="open"|"pin-peer"|"observe"|"stop"|"recover";
const operations={open:"editorConnectionOpen","pin-peer":"editorConnectionPeer",observe:"editorConnectionObserve",stop:"editorConnectionStop",recover:"editorConnectionRecover"} as const;
type Result=StudioEditorConnectionObservation|StudioEditorConnectionRecord|WindowsEditorConnectionReady;
function connection(value:unknown,s:StudioEditorRequest,action:Action):Result{
  requireValue(exact(value,["schema","action","selection","result"]) && value.schema==="switchyard-editor-connection-result/v1" && value.action===action && exact(value.selection,ids) && ids.every(k=>(value.selection as Record<string,unknown>)[k]===s[k]));const r=value.result;
  requireValue(object(r) && r.requestId===s.requestId && flags.every(k=>r[k]===false));
  if(action==="stop"||action==="recover"||action==="open"&&r.duplicatePrevented===true){
    const extra=[...(r.duplicatePrevented===true?["duplicatePrevented"]:[]),...(r.recoveryBlocked===true?["recoveryBlocked"]:[])];
    requireValue(exact(r,[...ids,"status","protocolAcknowledgementRecorded","stoppedVerified",...flags,...extra]) && ids.every(k=>r[k]===s[k]) && typeof r.protocolAcknowledgementRecorded==="boolean" && ["reserved","upstream","ingress-reserved","ready","peer-pinned","peer-requested","connected","acknowledged","uncertain","stopped"].includes(r.status as string) && r.stoppedVerified===(r.status==="stopped") && (action==="recover"||r.recoveryBlocked===undefined));
    if(action==="stop")requireValue(["stopped","uncertain"].includes(r.status as string));return Object.freeze({...r}) as unknown as StudioEditorConnectionRecord;
  }
  const opening=action==="open";requireValue(exact(r,["requestId","status","peerVerified","protocolAcknowledged",...flags,...(opening?["endpoint","duplicatePrevented"]:[])]) && ["ready","peer-requested","connected","acknowledged"].includes(r.status as string) && typeof r.peerVerified==="boolean" && typeof r.protocolAcknowledged==="boolean" && r.protocolAcknowledged===(r.status==="acknowledged") && (!r.protocolAcknowledged||r.peerVerified));
  if(opening){requireValue(r.duplicatePrevented===false && r.status==="ready" && !r.peerVerified);return Object.freeze({...r,endpoint:windowsEditorEndpoint(r.endpoint)}) as unknown as WindowsEditorConnectionReady;}
  return Object.freeze({...r}) as unknown as StudioEditorConnectionObservation;
}

export class StudioWindowsTaskClient {
  private readonly transport:StudioInstanceTransport;
  constructor(options:Readonly<{readEndpoint:()=>Promise<string>;assertCurrent:()=>void|Promise<void>}>){this.transport=new StudioInstanceTransport(options);}
  async editorProjects(): Promise<StudioEditorProjects> {
    return studioEditorProjects(await this.transport.exchange("editorProjects", Object.freeze({})), windowsEditorLocalPath);
  }
  async editorChoices(repositoryRoot:string):Promise<StudioEditorChoices>{
    requireValue(windowsEditorLocalPath(repositoryRoot) && Buffer.byteLength(repositoryRoot)<=4096);
    return studioEditorChoices(await this.transport.exchange("editorChoices",Object.freeze({repositoryRoot})),repositoryRoot);
  }
  async editorTarget(input:StudioEditorSelection):Promise<WindowsEditorObservation>{
    requireValue(exact(input,["compartment","ownerRequestId","loadRequestId"]) && typeof input.compartment==="string" && /^[a-z][a-z0-9-]{0,63}$/.test(input.compartment) && uuid(input.ownerRequestId) && uuid(input.loadRequestId));const s=Object.freeze({...input});return observation(await this.transport.exchange("editorTarget",s),s);
  }
  async returnEditorTarget(input:StudioEditorRequest):Promise<WindowsEditorObservation>{const s=selection(input);return observation(await this.transport.exchange("editorReturnTarget",s),s);}
  async reviewEditor(input:StudioEditorRequest):Promise<WindowsEditorReview>{const s=selection(input);return review(await this.transport.exchange("editorReview",s),s);}
  async issueEditor(input:StudioEditorRequest&{readonly token:string}):Promise<WindowsEditorAuthorization>{const s=selection(input,"token");return authorization(await this.transport.exchange("editorIssue",s),s,"editorIssue");}
  async consumeEditor(input:StudioEditorRequest&{readonly permit:string}):Promise<WindowsEditorAuthorization>{const s=selection(input,"permit");return authorization(await this.transport.exchange("editorConsume",s),s,"editorConsume");}
  async openEditorConnection(input:StudioEditorRequest):Promise<WindowsEditorConnectionReady|StudioEditorConnectionRecord>{const s=selection(input);return connection(await this.transport.exchange(operations.open,s),s,"open") as WindowsEditorConnectionReady|StudioEditorConnectionRecord;}
  async pinEditorPeer(input:StudioEditorRequest&{readonly peer:WindowsEditorPeer}):Promise<StudioEditorConnectionObservation>{requireValue(exact(input,["compartment",...ids,"peer"]));const {peer,...rest}=input,s=selection(rest),selectedPeer=windowsEditorPeer(peer);return connection(await this.transport.exchange(operations["pin-peer"],Object.freeze({...s,peer:selectedPeer})),s,"pin-peer") as StudioEditorConnectionObservation;}
  private async observe(action:"observe"|"stop"|"recover",input:StudioEditorRequest):Promise<Result>{const s=selection(input);return connection(await this.transport.exchange(operations[action] as StudioInstanceOperation,s),s,action);}
  async observeEditorConnection(input:StudioEditorRequest):Promise<StudioEditorConnectionObservation>{return this.observe("observe",input) as Promise<StudioEditorConnectionObservation>;}
  async stopEditorConnection(input:StudioEditorRequest):Promise<StudioEditorConnectionRecord>{return this.observe("stop",input) as Promise<StudioEditorConnectionRecord>;}
  async recoverEditorConnection(input:StudioEditorRequest):Promise<StudioEditorConnectionRecord>{return this.observe("recover",input) as Promise<StudioEditorConnectionRecord>;}
  cancelPending():void{this.transport.cancelPending();}
  close():void{this.transport.close();}
}
