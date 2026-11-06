import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { chmod, lstat, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
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

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sel-")), repositoryRoot = join(root, "repo"), executable = join(root, "codex"), socketPath = join(root, "s"), endpointPath = join(root, "endpoint.json");
  await mkdir(repositoryRoot); const image = "synthetic executable bytes; never executed\n"; await writeFile(executable, image, { mode: 0o700 });
  const socket = socketServer(() => { throw Error("No native connection is permitted in this proof"); }); socket.listen(socketPath); await once(socket, "listening"); await chmod(socketPath, 0o600);
  const repoInfo = await lstat(repositoryRoot), socketInfo = await lstat(socketPath), selected = { compartment: "personal", ownerRequestId: randomUUID(), loadRequestId: randomUUID() };
  const target = { schema: "switchyard-codex-editor-target/v1", ownerRequestId: selected.ownerRequestId, loadRequestId: selected.loadRequestId, taskId: randomUUID(), sessionId: randomUUID(), repositoryRoot, repositoryIdentity: { device: String(repoInfo.dev), inode: String(repoInfo.ino) }, accountFingerprint: "b".repeat(64), permissions: "read-only/on-request", endpoint: { socketPath, socketDevice: String(socketInfo.dev), socketInode: String(socketInfo.ino), peerPid: process.pid, peerBirth: "1", peerExecutableSha256: createHash("sha256").update(image).digest("hex") } };
  const observation = () => ({ target: structuredClone(target), targetDigest: createHash("sha256").update(JSON.stringify(target)).digest("hex"), metadataObserved: true, nativeLoadAcknowledged: true, nativeTaskLoaded: false, authorityGranted: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false });
  const keys = new Map<string,string>(), store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c: string,p: string) => keys.get(c+":"+p), set: async (c: string,p: string,v: string) => keys.set(c+":"+p,v) } });
  await store.initialize("personal"); await store.update("personal", "fixture", (s: any) => { s.mode = "personal-companion"; });
  const auth = createCodingEditorAuthorizations({ store, owners: { editorTarget: async () => observation() } });
  const controls: { after?: (action: string) => Promise<void> | void; check?: () => Promise<void> | void; createThrows?: boolean; afterCreate?: () => void; showThrows?: boolean } = {};
  const routes: string[] = [], token = "x".repeat(43), instance = { id: randomUUID(), build: "f".repeat(64) };
  const gateway = createInstanceGateway({ token, identity: instance, onStop: () => { throw Error("No stop operation"); }, onEditorTarget: observation, onEditorAuthorization: async (action: string, { compartment, ...input }: any) => { routes.push(action); const result = await auth[action](compartment,input); await controls.after?.(action); return result; } });
  let origin: string; const server = createServer((req,res) => { assert.equal(req.headers.authorization,undefined); void gateway(req,res,origin); }); server.listen(0,"127.0.0.1"); await once(server,"listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
  await writeFile(endpointPath,JSON.stringify({schema:"switchyard-active-endpoint/v1",instance,pid:process.pid,url:origin+"/#access="+token}),{mode:0o600});
  const client = new StudioTaskClient({endpointPath}), activeListeners = new Set<(t: TerminalLike | undefined) => unknown>(), closeListeners = new Set<(t: TerminalLike) => unknown>();
  const calls: TerminalOptionsLike[] = [], terminals: TerminalLike[] = [], state = {focused:true}; let activeTerminal: TerminalLike | undefined;
  const window = { state,terminals,get activeTerminal(){return activeTerminal;},createTerminal(options: TerminalOptionsLike){calls.push(options);if(controls.createThrows)throw Error("synthetic partial creation failure");const terminal:TerminalLike={name:options.name,show(){if(controls.showThrows)throw Error("synthetic focus failure");activeTerminal=terminal;for(const listener of activeListeners)listener(terminal);}};terminals.push(terminal);controls.afterCreate?.();return terminal;},onDidChangeActiveTerminal(listener:(t:TerminalLike|undefined)=>unknown){activeListeners.add(listener);return{dispose(){activeListeners.delete(listener);}};},onDidCloseTerminal(listener:(t:TerminalLike)=>unknown){closeListeners.add(listener);return{dispose(){closeListeners.delete(listener);}};}};
  const workspace = {workspaceFolders:[{uri:{fsPath:repositoryRoot}}]},host = {window,workspace} as unknown as Pick<VscodeLike,"window"|"workspace">;
  const launcher = new StudioEditorLauncher({client,host,executable,assertCurrent:async()=>{await controls.check?.();}});
  t.after(async()=>{await launcher.close();await auth.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>socket.close(()=>resolve()));assert.equal(activeListeners.size,0);assert.equal(closeListeners.size,0);await rm(root,{recursive:true});});
  return {root,repositoryRoot,executable,socketPath,endpointPath,selected,target,client,store,launcher,controls,routes,calls,terminals,state,workspace,window};
}
const linux = {skip:process.platform!=="linux"};
test("reviewed signed permission reaches one exact Terminal object without claiming native attachment",linux,async t=>{
  const f=await fixture(t),review=await f.launcher.review(f.selected);
  assert.equal(f.calls.length,0);assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations,undefined);
  const result=await f.launcher.launch(review);assert.deepEqual(f.routes,["review","issue","consume"]);assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{name:"Switchyard · Codex task",cwd:f.repositoryRoot,shellPath:f.executable,shellArgs:["resume","--remote","unix://"+f.socketPath,"--sandbox","read-only","--ask-for-approval","on-request","--cd",f.repositoryRoot,f.target.sessionId]});
  assert.equal(result.focusVerified,true);assert.equal(result.terminalObjectReturned,true);assert.equal(result.ideAttached,false);assert.equal(result.nativeTaskLoaded,false);assert.equal(result.modelPromptSubmitted,false);assert.equal(f.window.activeTerminal,f.terminals[0]);
  assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations[0].status,"consumed");await assert.rejects(f.launcher.launch(review));await assert.rejects(f.launcher.launch(structuredClone(review)));assert.equal(f.calls.length,1);
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
