import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as socketServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioEditorLauncher } from "../src/studio-editor-launch.ts";
import { StudioTaskClient } from "../src/studio-task-client.ts";
import type { TerminalLike, TerminalOptionsLike, VscodeLike } from "../src/vscode-like.ts";
// @ts-expect-error Exercise the shipped signed gateway.
import { createInstanceGateway } from "../../../tools/layout-studio/instance.mjs";
// @ts-expect-error Exercise real encrypted state and Linux kernel leases.
import { createSuiteStore } from "../../../tools/layout-studio/suite-store.mjs";
// @ts-expect-error Exercise real durable permission consumption.
import { createCodingEditorAuthorizations } from "../../../tools/layout-studio/coding-editor-authorizations.mjs";
// @ts-expect-error Use exact owned synthetic process retirement.
import { stopOwnedChild } from "../../../tools/layout-studio/owned-process.mjs";

async function fixture(t: TestContext, nativeImage = false) {
  const root = await mkdtemp(join(tmpdir(), "sel-")), repositoryRoot = join(root, "repo"), executable = nativeImage ? await realpath(process.execPath) : join(root, "codex"), socketPath = join(root, "s"), endpointPath = join(root, "endpoint.json");
  await mkdir(repositoryRoot); if (!nativeImage) { await copyFile("/usr/bin/sleep", executable); await chmod(executable, 0o700); } const image = await readFile(executable);
  const socket = socketServer(() => { throw Error("No native connection is permitted in this proof"); }); socket.listen(socketPath); await once(socket, "listening"); await chmod(socketPath, 0o600);
  const ingressPath = join(root, "e"), ingress = socketServer(() => { throw Error("No native TUI connection is permitted in this launcher-double proof"); }); ingress.listen(ingressPath); await once(ingress, "listening"); await chmod(ingressPath, 0o600); const ingressInfo = await lstat(ingressPath);
  const repoInfo = await lstat(repositoryRoot), socketInfo = await lstat(socketPath), selected = { compartment: "personal", ownerRequestId: randomUUID(), loadRequestId: randomUUID() };
  const target = { schema: "switchyard-codex-editor-target/v1", ownerRequestId: selected.ownerRequestId, loadRequestId: selected.loadRequestId, taskId: randomUUID(), sessionId: randomUUID(), repositoryRoot, repositoryIdentity: { device: String(repoInfo.dev), inode: String(repoInfo.ino) }, accountFingerprint: "b".repeat(64), permissions: "read-only/on-request", endpoint: { socketPath, socketDevice: String(socketInfo.dev), socketInode: String(socketInfo.ino), peerPid: process.pid, peerBirth: "1", peerExecutableSha256: createHash("sha256").update(image).digest("hex") } };
  const observation = () => ({ target: structuredClone(target), targetDigest: createHash("sha256").update(JSON.stringify(target)).digest("hex"), metadataObserved: true, nativeLoadAcknowledged: true, nativeTaskLoaded: false, authorityGranted: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false });
  const keys = new Map<string,string>(), store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c: string,p: string) => keys.get(c+":"+p), set: async (c: string,p: string,v: string) => keys.set(c+":"+p,v) } });
  await store.initialize("personal"); await store.update("personal", "fixture", (s: any) => { s.mode = "personal-companion"; });
  const controls: { observation?: "idle" | "active"; after?: (action: string) => Promise<void> | void; check?: () => Promise<void> | void; createThrows?: boolean; afterCreate?: () => void; showThrows?: boolean; processPending?: boolean; connectionAfter?: (action: string) => void | Promise<void>; stopped?: boolean; expectUncertain?: boolean } = {};
  const auth = createCodingEditorAuthorizations({ store, owners: { editorTarget: async () => { assert.notEqual(controls.observation, "active"); return observation(); }, editorReturnTarget: async () => observation() } });
  const routes: string[] = [], token = "x".repeat(43), instance = { id: randomUUID(), build: "f".repeat(64) };
  const connectionRoutes: string[] = [];
  const gateway = createInstanceGateway({ token, identity: instance, onStop: () => { throw Error("No stop operation"); }, onEditorTarget: observation, onEditorAuthorization: async (action: string, { compartment, ...input }: any) => { routes.push(action); const result = await auth[action === "return-target" ? "returnTarget" : action](compartment,input); await controls.after?.(action); return result; }, onEditorConnection: async (action: string, {compartment: _compartment, peer, ...selection}: any) => {
    connectionRoutes.push(action); const flags={terminalLaunched:false,ideAttached:false,authorityGranted:false,completionVerified:false};
    if(action==='pin-peer'){assert.ok(peer.pid>0);assert.equal(peer.executableSha256,target.endpoint.peerExecutableSha256);}
    const result=action==='stop'?{...selection,status:controls.stopped===false?'uncertain':'stopped',protocolAcknowledgementRecorded:true,stoppedVerified:controls.stopped!==false,...flags}
      :{requestId:selection.requestId,status:action==='open'?'ready':'acknowledged',peerVerified:action!=='open',protocolAcknowledged:action!=='open',...flags,...(action==='open'?{duplicatePrevented:false,endpoint:{socketPath:ingressPath,socketDevice:String(ingressInfo.dev),socketInode:String(ingressInfo.ino)}}:{})};
    await controls.connectionAfter?.(action);return{schema:'switchyard-editor-connection-result/v1',action,selection,result};
  } });
  let origin: string; const server = createServer((req,res) => { assert.equal(req.headers.authorization,undefined); void gateway(req,res,origin); }); server.listen(0,"127.0.0.1"); await once(server,"listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
  await writeFile(endpointPath,JSON.stringify({schema:"switchyard-active-endpoint/v1",instance,pid:process.pid,url:origin+"/#access="+token}),{mode:0o600});
  const client = new StudioTaskClient({endpointPath}), activeListeners = new Set<(t: TerminalLike | undefined) => unknown>(), closeListeners = new Set<(t: TerminalLike) => unknown>();
  const children: ChildProcess[] = [];
  const calls: TerminalOptionsLike[] = [], terminals: TerminalLike[] = [], state = {focused:true}; let activeTerminal: TerminalLike | undefined;
  const window = { state,terminals,get activeTerminal(){return activeTerminal;},createTerminal(options: TerminalOptionsLike){calls.push(options);if(controls.createThrows)throw Error("synthetic partial creation failure");const child=spawn(executable,nativeImage?["-e","setInterval(()=>{},1000)"]:["60"],{stdio:"ignore"});children.push(child);const terminal:TerminalLike={name:options.name,processId:controls.processPending?new Promise<number>(()=>{}):once(child,"spawn").then(()=>child.pid),show(){if(controls.showThrows)throw Error("synthetic focus failure");activeTerminal=terminal;for(const listener of activeListeners)listener(terminal);}};terminals.push(terminal);controls.afterCreate?.();return terminal;},onDidChangeActiveTerminal(listener:(t:TerminalLike|undefined)=>unknown){activeListeners.add(listener);return{dispose(){activeListeners.delete(listener);}};},onDidCloseTerminal(listener:(t:TerminalLike)=>unknown){closeListeners.add(listener);return{dispose(){closeListeners.delete(listener);}};}};
  const workspaceListeners = new Set<() => unknown>(), workspace = {workspaceFolders:[{uri:{scheme:"file",fsPath:repositoryRoot}}], onDidChangeWorkspaceFolders(listener: () => unknown) { workspaceListeners.add(listener); return {dispose(){workspaceListeners.delete(listener);}}; }},host = {window,workspace} as unknown as Pick<VscodeLike,"window"|"workspace">;
  const launcher = new StudioEditorLauncher({client,host,executable,assertCurrent:async()=>{await controls.check?.();}});
  t.after(async()=>{
    const failures: unknown[] = [];
    for (const cleanup of [
      async()=>{if(controls.expectUncertain)await assert.rejects(launcher.close());else await launcher.close();},
      async()=>{await auth.close();},
      async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));},
      async()=>{await new Promise<void>(resolve=>socket.close(()=>resolve()));},
      async()=>{await new Promise<void>(resolve=>ingress.close(()=>resolve()));},
      ...children.map(child=>async()=>{assert.equal((await stopOwnedChild(child)).stopped,true);}),
      async()=>{assert.equal(activeListeners.size,0);assert.equal(closeListeners.size,0);assert.equal(workspaceListeners.size,0);},
      async()=>{await rm(root,{recursive:true});},
    ]) { try { await cleanup(); } catch(error) { failures.push(error); } }
    if(failures.length)throw new AggregateError(failures,"Launcher fixture cleanup failed");
  });
  return {root,repositoryRoot,executable,socketPath,ingressPath,endpointPath,children,connectionRoutes,terminalClosed:(terminal:TerminalLike)=>{terminals.splice(terminals.indexOf(terminal),1);for(const listener of closeListeners)listener(terminal);},selected,target,client,store,launcher,controls,routes,calls,terminals,state,workspace,window,changeWorkspace:()=>{for(const listener of workspaceListeners)listener();}};
}
const linux = {skip:process.platform!=="linux"};
test("reviewed signed permission reaches one exact Terminal object without claiming native attachment",linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);
  assert.equal(f.calls.length,0);assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations,undefined);
  const result=await f.launcher.launch(review);assert.deepEqual(f.routes.slice(0,3),["review","issue","consume"]);assert.ok(f.routes.slice(3).every(r=>r==="return-target"));assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{name:"Switchyard · Codex task",cwd:f.repositoryRoot,shellPath:f.executable,shellArgs:["resume","--remote","unix://"+f.ingressPath,"--sandbox","read-only","--ask-for-approval","on-request","--cd",f.repositoryRoot,f.target.sessionId]});
  assert.equal(result.focusVerified,true);assert.equal(result.terminalObjectReturned,true);assert.equal(result.ideAttached,false);assert.equal(result.nativeTaskLoaded,false);assert.equal(result.modelPromptSubmitted,false);assert.equal(f.window.activeTerminal,f.terminals[0]);
  assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations[0].status,"consumed");await assert.rejects(f.launcher.launch(review));await assert.rejects(f.launcher.launch(structuredClone(review)));assert.equal(f.calls.length,1);
});

test("signed exact terminal process observation retains a real synthetic PID without claiming native task attachment",linux,async t=>{
  const f=await fixture(t,true),review=await f.launcher.review(f.selected);await f.launcher.launch(review);const child=f.children[0]!;
  const before=await f.store.snapshot("personal"),first=await f.launcher.processIdentity(review);assert.equal(first.pid,child.pid);assert.deepEqual(await f.launcher.processIdentity(review),first);assert.deepEqual(await f.store.snapshot("personal"),before);
  const observed=f.launcher.observation(review);assert.equal(observed.nativeProcessObserved,true);assert.equal(observed.ideAttached,false);assert.equal(observed.nativeTaskLoaded,false);assert.equal(f.calls.length,1);assert.ok(f.routes.slice(3).every(r=>r==="return-target"));
  assert.equal((await stopOwnedChild(child)).stopped,true);await assert.rejects(f.launcher.processIdentity(review));assert.equal(f.calls.length,1);
});
test("terminal process observation refuses an unlaunched, removed or account-drifted exact object without creating another",linux,async t=>{
  for(const phase of ["unlaunched","removed","account"]){const f=await fixture(t),review=await f.launcher.review(f.selected);if(phase!=="unlaunched")await f.launcher.launch(review);const count=f.calls.length;if(phase==="removed")f.terminals.splice(0);if(phase==="account")f.target.accountFingerprint="e".repeat(64);await assert.rejects(f.launcher.processIdentity(review));assert.equal(f.calls.length,count);assert.equal(f.launcher.observation(review).nativeProcessObserved,phase!=="unlaunched");}
});
test("launcher shutdown cancels an absent process PID and joins the launch and exact connection retirement",linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);f.controls.processPending=true;
  let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});f.controls.afterCreate=()=>entered();
  const pending=assert.rejects(f.launcher.launch(review));await ready;await f.launcher.close();await pending;assert.equal(f.calls.length,1);assert.equal(f.launcher.observation(review).nativeProcessObserved,false);assert.equal(f.connectionRoutes.filter(a=>a==='stop').length,1);
});

test("concurrent launches reserve the exact review before awaiting authorization",linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected),results=await Promise.allSettled([f.launcher.launch(review),f.launcher.launch(review)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.calls.length,1);assert.equal(f.routes.filter(r=>r==="consume").length,1);
});
test("focus, workspace, executable, socket and repository replacement refuse before the terminal effect",linux,async t=>{
  for(const drift of ["focus","workspace","executable","socket","repository","context"]){
    const f=await fixture(t),review=await f.launcher.review(f.selected);
    if(drift==="focus")f.state.focused=false;
    if(drift==="workspace")f.workspace.workspaceFolders=[];
    if(drift==="executable")await writeFile(f.executable,"changed bytes\n");
    if(drift==="socket"){await rename(f.socketPath,f.socketPath+"-old");await symlink(f.socketPath+"-old",f.socketPath);}
    if(drift==="repository"){await rename(f.repositoryRoot,f.repositoryRoot+"-old");await mkdir(f.repositoryRoot);}
    if(drift==="context")f.controls.check=()=>{throw Error("original admission revoked");};
    await assert.rejects(f.launcher.launch(review),()=>true,drift);assert.equal(f.calls.length,0);await assert.rejects(f.launcher.launch(review));
  }
});
test("drift or cancelled delivery after durable consumption cannot retry a launch",linux,async t=>{
  for(const phase of ["issue-focus","consume-focus","consume-close","consume-executable"]){const f=await fixture(t),review=await f.launcher.review(f.selected);f.controls.after=async action=>{if(action===phase.split("-")[0]){if(phase.endsWith("close"))f.client.close();else if(phase.endsWith("executable"))await writeFile(f.executable,"substituted after consumption\n");else f.state.focused=false;}};await assert.rejects(f.launcher.launch(review));assert.equal(f.calls.length,0);await assert.rejects(f.launcher.launch(review));assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations[0].status,phase.startsWith("issue")?"issued":"consumed");}
});
test("partial creation and failed focus retain the attempted identity without retrying or disposing user terminals",linux,async t=>{
  for(const phase of ["create","show","after-create"]){const f=await fixture(t),review=await f.launcher.review(f.selected);if(phase==="create")f.controls.createThrows=true;if(phase==="show")f.controls.showThrows=true;if(phase==="after-create")f.controls.afterCreate=()=>{f.state.focused=false;};await assert.rejects(f.launcher.launch(review));const observed=f.launcher.observation(review);assert.equal(observed.terminalCreationRequested,true);assert.equal(observed.terminalObjectReturned,phase!=="create");assert.equal(observed.focusVerified,false);assert.equal(observed.ideAttached,false);await assert.rejects(f.launcher.launch(review));await f.launcher.close();assert.equal(f.calls.length,1);assert.equal(f.terminals.length,phase==="create"?0:1);}
});
test("unmatched executable bytes and shutdown cannot create a confirmation or terminal",linux,async t=>{
  const f=await fixture(t);await writeFile(f.executable,"wrong native image\n");await assert.rejects(f.launcher.review(f.selected));assert.deepEqual(f.routes,[]);assert.equal(f.calls.length,0);await f.launcher.close();await assert.rejects(f.launcher.review(f.selected));
});
test("shutdown joins an in-flight context check and fences every later terminal operation",linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  f.controls.check=async()=>{entered();await held;};const launching=assert.rejects(f.launcher.launch(review));await started;
  let joined=false;const closing=f.launcher.close().then(()=>{joined=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(joined,false);
  release();await launching;await closing;assert.equal(joined,true);assert.equal(f.calls.length,0);assert.deepEqual(f.routes,["review"]);
});
test("returning to a reviewed active task uses its exact terminal object without another authorization or creation",linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);await f.launcher.launch(review);const original=f.terminals[0];
  const neighbor=f.window.createTerminal({name:original.name});neighbor.show();assert.equal(f.window.activeTerminal,neighbor);
  f.controls.observation="active";
  const before=await f.store.snapshot("personal"),result=await f.launcher.focus(review);assert.equal(result.focusVerified,true);assert.equal(result.ideAttached,false);assert.equal(f.window.activeTerminal,original);assert.equal(f.calls.length,2);assert.deepEqual(f.routes.slice(0,3),["review","issue","consume"]);assert.ok(f.routes.slice(3).length>0);assert.ok(f.routes.slice(3).every(r=>r==="return-target"));assert.deepEqual(await f.store.snapshot("personal"),before);
  f.terminals.splice(f.terminals.indexOf(original),1);neighbor.show();await assert.rejects(f.launcher.focus(review));assert.equal(f.window.activeTerminal,neighbor);assert.equal(f.calls.length,2);assert.equal(f.launcher.observation(review).focusVerified,false);
});
test("returning to a retained terminal refuses account drift, another window context and shutdown without creating a replacement",linux,async t=>{
  for(const drift of ["account","workspace","shutdown"]){const f=await fixture(t),review=await f.launcher.review(f.selected);await f.launcher.launch(review);if(drift==="account")f.target.accountFingerprint="e".repeat(64);if(drift==="workspace")f.workspace.workspaceFolders=[];if(drift==="shutdown")await f.launcher.close();await assert.rejects(f.launcher.focus(review));assert.equal(f.calls.length,1);assert.deepEqual(f.routes.slice(0,3),["review","issue","consume"]);assert.ok(f.routes.slice(3).every(r=>r==="return-target"));assert.equal(f.launcher.observation(review).ideAttached,false);}
});

test("return cannot create a terminal or use an unconsumed authorization and fences a cancelled metadata reply",linux,async t=>{
  for(const phase of ["before-launch","journal","reply"]){const f=await fixture(t),review=await f.launcher.review(f.selected);
    if(phase!=="before-launch")await f.launcher.launch(review);
    const before=f.calls.length;
    if(phase==="journal")await f.store.update("personal","fixture-lost-authorization",(s:any)=>{s.codingEditorAuthorizations[0].status="issued";});
    if(phase==="reply")f.controls.after=action=>{if(action==="return-target")f.client.cancelPending();};
    await assert.rejects(f.launcher.focus(review));assert.equal(f.calls.length,before);assert.equal(f.launcher.observation(review).focusVerified,false);assert.equal(f.launcher.observation(review).ideAttached,false);
  }
});


test("lost connection replies, substituted ingress and failed peer observation cannot recreate a spent terminal",linux,async t=>{
 for(const failure of ['lost-open','socket','peer','observe']){
  const f=await fixture(t),review=await f.launcher.review(f.selected);
  f.controls.connectionAfter=async action=>{
   if(failure==='lost-open'&&action==='open')f.client.cancelPending();
   if(failure==='socket'&&action==='open'){await rename(f.ingressPath,f.ingressPath+'-original');await writeFile(f.ingressPath,'PRIVATE replacement',{mode:0o600});}
   if(failure===action)throw Error('synthetic exact connection refusal');
   if(failure==='peer'&&action==='pin-peer')throw Error('synthetic peer refusal');
  };
  await assert.rejects(f.launcher.launch(review));assert.equal(f.calls.length,['peer','observe'].includes(failure)?1:0);assert.equal(f.launcher.observation(review).protocolAcknowledgementObserved,false);
  assert.equal(f.connectionRoutes.filter(a=>a==='open').length,1);assert.equal(f.connectionRoutes.filter(a=>a==='stop').length,1);await assert.rejects(f.launcher.launch(review));
  if(failure==='socket')assert.equal(await readFile(f.ingressPath,'utf8'),'PRIVATE replacement');
 }
});
test("closing the exact retained terminal withdraws acknowledgement and joins one retirement without disposing neighbors",linux,async t=>{
 const f=await fixture(t),review=await f.launcher.review(f.selected);assert.equal((await f.launcher.launch(review)).protocolAcknowledgementObserved,true);const original=f.terminals[0]!;const neighbor=f.window.createTerminal({name:original.name});
 f.terminalClosed(original);assert.equal(f.launcher.observation(review).protocolAcknowledgementObserved,false);await f.launcher.close();assert.equal(f.connectionRoutes.filter(a=>a==='stop').length,1);assert.ok(f.terminals.includes(neighbor));assert.equal(f.calls.length,2);
});
test("unconfirmed exact retirement is reported by joined launcher shutdown",linux,async t=>{
 const f=await fixture(t),review=await f.launcher.review(f.selected);await f.launcher.launch(review);f.controls.stopped=false;f.controls.expectUncertain=true;
 await assert.rejects(f.launcher.close(),/no longer current/);assert.equal(f.connectionRoutes.filter(a=>a==='stop').length,1);assert.equal(f.launcher.observation(review).protocolAcknowledgementObserved,false);
});

test('a removed and reopened Linux project requires a fresh review even at the same path',linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected),original=f.workspace.workspaceFolders[0];
  f.workspace.workspaceFolders=[];f.changeWorkspace();f.workspace.workspaceFolders=[original];f.changeWorkspace();
  await assert.rejects(f.launcher.launch(review));assert.equal(f.calls.length,0);assert.equal(f.routes.includes('consume'),false);
  const fresh=await f.launcher.review(f.selected);assert.equal((await f.launcher.launch(fresh)).protocolAcknowledgementObserved,true);assert.equal(f.calls.length,1);
});
test('Linux project identity is checked again after the signed review response',linux,async t=>{
  const f=await fixture(t);f.controls.after=action=>{if(action==='review')f.changeWorkspace();};
  await assert.rejects(f.launcher.review(f.selected));assert.equal(f.calls.length,0);assert.deepEqual(f.routes,['review']);
});
test('replaced, ambiguous and non-file workspace folders cannot inherit a Linux project review',linux,async t=>{
  for(const drift of ['replacement','duplicate','remote']){
    const f=await fixture(t),review=await f.launcher.review(f.selected);
    if(drift==='replacement')f.workspace.workspaceFolders=[{uri:{scheme:'file',fsPath:f.target.repositoryRoot}}];
    if(drift==='duplicate')f.workspace.workspaceFolders.push(f.workspace.workspaceFolders[0]);
    if(drift==='remote')f.workspace.workspaceFolders[0].uri.scheme='vscode-remote';
    await assert.rejects(f.launcher.launch(review));assert.equal(f.calls.length,0);assert.equal(f.connectionRoutes.length,0);
  }
});
test('Linux workspace change during carrier open retires the original attempt before terminal creation',linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);f.controls.connectionAfter=action=>{if(action==='open')f.changeWorkspace();};
  await assert.rejects(f.launcher.launch(review));assert.equal(f.calls.length,0);await f.launcher.close();assert.equal(f.connectionRoutes.filter(v=>v==='stop').length,1);
});
test('Linux project departure retires the retained carrier and preserves its exact user terminal',linux,async t=>{
  for(const uncertain of [false,true]){
    const f=await fixture(t),review=await f.launcher.review(f.selected);await f.launcher.launch(review);const terminal=f.terminals[0];
    f.controls.stopped=!uncertain;f.controls.expectUncertain=uncertain;f.changeWorkspace();
    assert.equal(f.launcher.observation(review).protocolAcknowledgementObserved,false);assert.equal(f.launcher.observation(review).focusVerified,false);
    await assert.rejects(f.launcher.focus(review));if(uncertain)await assert.rejects(f.launcher.close());else await f.launcher.close();
    assert.equal(f.connectionRoutes.filter(v=>v==='stop').length,1);assert.equal(f.calls.length,1);assert.equal(f.terminals[0],terminal);
  }
});

test('shutdown joins an already-started signed terminal retirement response',linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);await f.launcher.launch(review);
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
  f.controls.connectionAfter=async action=>{if(action==='stop'){enter();await held;}};f.terminalClosed(f.terminals[0]);await entered;
  let closed=false;const closing=f.launcher.close().then(()=>{closed=true;});
  try{await new Promise(r=>setImmediate(r));assert.equal(closed,false);}finally{release();}
  await closing;assert.equal(f.connectionRoutes.filter(v=>v==='stop').length,1);assert.equal(f.calls.length,1);assert.equal(f.terminals.length,0);
});
