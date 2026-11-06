import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, rename, readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createSuiteStore } from "./suite-store.mjs";
import { repositoryIdentity } from "./coding-task-identity.mjs";
import { createCodexUnixTasks } from "./codex-unix-tasks.mjs";
import { openOwnedCodexListener, retireStoppedCodexListener } from "./codex-owned-listener.mjs";
import { codexDesignConfig } from "./agents.mjs";
import { createCodingTaskOwners } from "./coding-task-owners.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";
import { StudioTaskClient } from "../../apps/vscode-extension/src/studio-task-client.ts";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sy-owner-")), repositoryRoot = join(root, "repo"), keys = new Map(); await mkdir(repositoryRoot);
  const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c,p) => keys.get(c+":"+p), set: async (c,p,v) => keys.set(c+":"+p,v) } });
  await store.initialize("personal"); await store.update("personal", "fixture", s => { s.mode = "personal-companion"; });
  const task = { schema: "switchyard-coding-session/v1", launchPolicy: "read-only/on-request", nativeTransport: "owned-stdio", id: randomUUID(), provider: "codex", status: "registered", sessionId: "synthetic-private-native-thread", accountFingerprint: "a".repeat(64), repositoryRoot, repositoryIdentity: await repositoryIdentity(repositoryRoot) };
  await store.update("personal", "fixture-task", s => { s.codingSessions = [task]; });
  const controls = { login: task.accountFingerprint, stopped: true, fail: null, afterRead: async () => {}, allowResume: false, beforeResume: async () => {}, afterResume: async () => {}, observation: "idle" }, calls = [], owners = [], services = [], cleanup = [];
  function driverFactory(options) {
    calls.push("factory"); let started = false, closed = false;
    const owner = { scope: null, binding: null, accountFingerprint: null, privateOwnership: { root: join(root, "synthetic-listener-"+owners.length), rootIdentity: { device:"1",inode:"2",uid:1000,mode:448 } }, async stop() { calls.push("owner-stop"); closed = true; return { stopped: controls.stopped }; } }; owners.push(owner);
    async function stage(name, ...args) { if (controls.fail === name) throw Error("synthetic persistence refused"); await options[name]("personal", ...args); calls.push(name); }
    return {
      async account() {
        if (closed) throw Error("synthetic owner is closed");
        if (!started) {
          assert.equal((await store.snapshot("personal")).codingTaskOwners.at(-1).status, "reserved");
          await stage("onReserved", owner); owner.scope = { schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:1234,birth:"1",containment:"owned-linux-session" };
          await stage("onReady", owner.scope, owner); calls.push("native-started");
          owner.privateOwnership.socketIdentity = { device:"1",inode:"3",uid:1000,mode:384 }; owner.privateOwnership.aliasIdentity = { device:"1",inode:"4",uid:1000,mode:511 };
          await stage("onListening", owner); owner.accountFingerprint = controls.login; owner.binding = { exact: true }; await stage("onAuthenticated", owner); started = true;
        }
        return { type:"chatgpt",fingerprint:controls.login };
      },
      async read(id, path) { calls.push("read"); await controls.afterRead(); return { id,repositoryRoot:path,observation:controls.observation }; },
      async close() { calls.push("close"); closed = true; if(controls.closeThrows)throw Error("synthetic bridge exit unavailable"); return [{ stopped:controls.stopped }]; },
      async start() { throw Error("No native thread creation is allowed in this proof"); },
      async resume(id, path, c, {beforeEffect}) {
        assert.equal(controls.allowResume,true,"Only an explicitly opted-in provider double may load a synthetic task");
        await controls.beforeResume(); await beforeEffect(); calls.push("resume");
        try { await controls.afterResume(); await beforeEffect(); } catch(error) { error.resumedThreadId=id; throw error; }
        return {id,repositoryRoot:path,permissions:"read-only/on-request",modelPromptSubmitted:false,observation:"idle"};
      }
    };
  }
  function service(extra = {}) { const result = createCodingTaskOwners({ store, platform:"linux", driverFactory, retire:async(scope,ownership) => { calls.push("recover"); assert.ok(owners.some(o => o.scope?.id === scope.id && o.privateOwnership.root === ownership.root)); return { stopped:controls.stopped }; }, ...extra }); services.push(result); return result; }
  t.after(async () => { controls.stopped = true; for (const close of cleanup.toReversed()) await close(); for (const s of services) assert.ok((await s.close()).every(r => r.stopped)); await rm(root,{recursive:true}); });
  return { root,store,task,controls,calls,owners,service,beforeCleanup:close=>cleanup.push(close),request:()=>({requestId:randomUUID(),taskId:task.id}) };
}
test("persistent metadata ownership binds one original task/account/repository without task creation or IDE authority",async t=>{
  const f=await fixture(t),service=f.service(),request=f.request();
  const result=await service.open("personal",request);assert.equal(result.status,"bound");assert.equal(result.nativeTaskLoaded,false);assert.equal(result.ideAttached,false);
  const row=(await f.store.snapshot("personal")).codingTaskOwners[0];assert.equal(row.scope.id,f.owners[0].scope.id);assert.equal(row.accountFingerprint,f.task.accountFingerprint);
  assert.equal((await service.read("personal",request.requestId)).observation,"idle");assert.equal((await service.open("personal",request)).duplicatePrevented,true);assert.equal(f.owners.length,1);
  const other=f.service();await assert.rejects(other.read("personal",request.requestId),/does not own/);await assert.rejects(other.open("personal",f.request()),/retirement/);assert.equal(f.owners.length,1);
  assert.equal((await service.stopCompartment("personal")).stopped,true);assert.equal((await other.open("personal",request)).duplicatePrevented,true);assert.equal(f.owners.length,1);
  assert.equal((await other.open("personal",f.request())).status,"bound");assert.equal(f.owners.length,2);
  assert.equal(JSON.stringify(await other.list("personal")).includes(f.task.sessionId),false);
  async function scan(path) { for(const item of await readdir(path,{withFileTypes:true})){const name=join(path,item.name);if(item.isDirectory())await scan(name);else assert.equal((await readFile(name)).includes(Buffer.from(f.task.sessionId)),false);} } await scan(join(f.root,"state"));
});
test("two service instances serialize duplicate admission through the real private kernel lease",async t=>{
  const f=await fixture(t),one=f.service(),two=f.service(),request=f.request();
  const results=await Promise.all([one.open("personal",request),two.open("personal",request)]);assert.equal(results.filter(r=>r.duplicatePrevented).length,1);assert.equal(f.owners.length,1);
});
test("changed creator account or original task repository refuses binding and retires the exact owned listener",async t=>{
  for(const drift of ["account","repository","binding"]){
    const f=await fixture(t),service=f.service(),request=f.request();
    if(drift==="account")f.controls.login="b".repeat(64);
    else f.controls.afterRead=async()=>{f.controls.afterRead=async()=>{};if(drift==="repository"){await rename(f.task.repositoryRoot,f.task.repositoryRoot+"-original");await mkdir(f.task.repositoryRoot);}else await f.store.update("personal","fixture-drift",s=>{s.codingSessions[0].sessionId="another-native-thread";});};
    await assert.rejects(service.open("personal",request),/account|repository|binding/i);const row=(await f.store.snapshot("personal")).codingTaskOwners[0];assert.equal(row.status,"stopped");assert.equal(row.stoppedVerified,true);assert.equal(f.owners.length,1);
  }
});
test("persistence failures preserve no-replay request identity and cannot deliver later task reads",async t=>{
  for(const hook of ["onReserved","onReady","onListening","onAuthenticated"]){
    const f=await fixture(t),service=f.service(),request=f.request();f.controls.fail=hook;
    await assert.rejects(service.open("personal",request),/persistence/);assert.equal(f.calls.includes("read"),false);assert.equal((await service.open("personal",request)).duplicatePrevented,true);assert.equal(f.owners.length,1);
  }
});
test("unconfirmed native exit blocks replacement and recovery can only retire the original saved identity",async t=>{
  const f=await fixture(t),service=f.service(),request=f.request();await service.open("personal",request);f.controls.stopped=false;
  assert.equal((await service.stopCompartment("personal")).stopped,false);const other=f.service();await assert.rejects(other.open("personal",f.request()),/retirement/);await assert.rejects(other.recover("personal",request.requestId),/unconfirmed/);
  f.controls.stopped=true;assert.equal((await other.recover("personal",request.requestId)).stopped,true);assert.equal(f.calls.filter(c=>c==="recover").length,2);assert.equal(f.owners.length,1);
});
test("replaced protected ownership or revoked permission cannot return metadata from an older live connection",async t=>{
  const f=await fixture(t),service=f.service(),request=f.request();await service.open("personal",request);const reads=f.calls.filter(c=>c==="read").length;
  await f.store.update("personal","fixture-owner-drift",s=>{s.codingTaskOwners[0].ownershipDigest="0".repeat(64);});await assert.rejects(service.read("personal",request.requestId),/owner changed/);assert.equal(f.calls.filter(c=>c==="read").length,reads);
  await f.store.update("personal","fixture-mode-off",s=>{s.mode="keyboard-only";});await assert.rejects(service.read("personal",request.requestId));assert.equal((await service.stopCompartment("personal")).stopped,true);
});

test("protected task registry composes the actual owned Unix listener and bridge while the provider is a controlled double", { skip:process.platform!=="linux" }, async t=>{
  const f=await fixture(t);
  // The fixture account hash is obtained through the real transport, not guessed.
  let nativeOwner;
  const factory=options=>createCodexUnixTasks({ ...options, root:join(f.root,"tasks"),runtimeRoot:f.root,resolveCli:async()=>process.execPath,resolveMcp:async()=>[],
    async openListener(input){
      await copyFile(new URL("./test-support/codex-owned-listener-fixture.cjs",import.meta.url),join(input.cwd,"app-server"));
      await writeFile(join(input.cwd,"account"),"synthetic@example.invalid");
      await writeFile(join(input.cwd,"fixture.json"),JSON.stringify({repositoryRoot:f.task.repositoryRoot,config:{...codexDesignConfig(),mcp_servers:{}}}));
      return openOwnedCodexListener({...input,async onOwner(owner){nativeOwner=owner;await input.onOwner(owner);}});
    }
  });
  const probe=factory({store:f.store});const login=await probe.account("personal");assert.ok((await probe.close()).every(r=>r.stopped));
  f.task.accountFingerprint=login.fingerprint;await f.store.update("personal","fixture-known-account",s=>{s.codingSessions[0].accountFingerprint=login.fingerprint;});
  const service=f.service({driverFactory:factory,retire:retireStoppedCodexListener}),request=f.request();
  assert.equal((await service.open("personal",request)).status,"bound");assert.equal((await service.read("personal",request.requestId)).observation,"idle");
  const row=(await f.store.snapshot("personal")).codingTaskOwners[0];assert.deepEqual(row.scope,nativeOwner.scope);assert.deepEqual(row.privateOwnership,nativeOwner.privateOwnership);
  const calls=await readFile(join(f.root,"tasks/personal/calls"),"utf8");assert.equal(/thread\/(start|resume)|turn\/start/.test(calls),false);
  const review=await service.reviewLoad("personal",request.requestId), loaded=await service.load("personal",{ownerRequestId:request.requestId,requestId:randomUUID(),token:review.confirmation.token});
  assert.equal(loaded.nativeTaskLoaded,true);assert.equal(loaded.ideAttached,false);assert.equal(loaded.modelPromptSubmitted,false);
  const after=await readFile(join(f.root,"tasks/personal/calls"),"utf8");assert.equal(after.split("thread/resume\n").length-1,1);assert.equal(/thread\/start|turn\/start|thread\/inject_items/.test(after),false);
  assert.equal((await service.stopCompartment("personal")).stopped,true);assert.equal((await service.list("personal"))[0].stoppedVerified,true);
});

test("late ownership drift and stopped startup cannot acknowledge a retained connection as current",async t=>{
  const f=await fixture(t),service=f.service(),request=f.request();await service.open("personal",request);
  f.controls.afterRead=async()=>{await f.store.update("personal","fixture-late-owner-drift",s=>{s.codingTaskOwners[0].ownershipDigest="1".repeat(64);});};
  await assert.rejects(service.read("personal",request.requestId),/owner changed/);
  assert.equal((await service.stopCompartment("personal")).stopped,true);
  let entered,release;const ready=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
  f.controls.afterRead=async()=>{entered();await gate;};const second=f.request(),opening=service.open("personal",second).catch(e=>e);await ready;
  const stopping=service.stopCompartment("personal");release();assert.ok(await opening instanceof Error);assert.equal((await stopping).stopped,true);
  const row=(await f.store.snapshot("personal")).codingTaskOwners.find(r=>r.requestId===second.requestId);assert.equal(row.status,"stopped");assert.equal(row.stoppedVerified,true);
});

test("verified exit of an in-memory owner cannot retire a substituted protected native identity",async t=>{
  const f=await fixture(t),service=f.service(),request=f.request();await service.open("personal",request);
  const original=(await f.store.snapshot("personal")).codingTaskOwners[0].privateOwnership;
  await f.store.update("personal","fixture-substitute-native-owner",s=>{s.codingTaskOwners[0].privateOwnership.root=join(f.root,"unrelated-owner");});
  try { assert.equal((await service.stopCompartment("personal")).stopped,false);const row=(await f.store.snapshot("personal")).codingTaskOwners[0];assert.equal(row.stoppedVerified,false);assert.equal(row.privateOwnership.root,join(f.root,"unrelated-owner")); }
  finally { await f.store.update("personal","fixture-restore-original-native-owner",s=>{s.codingTaskOwners[0].privateOwnership=original;});assert.equal((await service.stopCompartment("personal")).stopped,true); }
});

test("reviewed owned loading consumes one exact token and preserves request identity across duplicate and restarted callers",async t=>{
  const f=await fixture(t),service=f.service(),owner=f.request();f.controls.allowResume=true;await service.open("personal",owner);
  const review=await service.reviewLoad("personal",owner.requestId),request={ownerRequestId:owner.requestId,requestId:randomUUID(),token:review.confirmation.token};
  assert.equal(f.calls.includes("resume"),false);const result=await service.load("personal",request);assert.equal(result.nativeTaskLoaded,true);assert.equal(result.nativeLoadAcknowledged,true);assert.equal(result.ideAttached,false);assert.equal(result.modelPromptSubmitted,false);
  assert.equal((await service.load("personal",request)).duplicatePrevented,true);assert.equal((await f.service().load("personal",request)).nativeTaskLoaded,false);assert.equal(f.calls.filter(c=>c==="resume").length,1);
  await assert.rejects(service.reviewLoad("personal",owner.requestId),/retained load/);await assert.rejects(service.load("personal",{...request,requestId:randomUUID()}),/already|consumed/);
  const text=await readFile(join(f.root,"state/personal.sealed.json"),"utf8");assert.equal(text.includes(f.task.sessionId),false);assert.equal(text.includes(review.confirmation.token),false);
});

test("load refuses substituted token, changed owner contents, policy or task permissions before a native resume",async t=>{
  for(const change of ["token","owner","policy","permissions","account"]){
    const f=await fixture(t),service=f.service(),owner=f.request();f.controls.allowResume=true;await service.open("personal",owner);
    const review=await service.reviewLoad("personal",owner.requestId),request={ownerRequestId:owner.requestId,requestId:randomUUID(),token:review.confirmation.token};
    if(change==="token")request.token=randomUUID();
    if(change==="owner")await f.store.update("personal","fixture-owner-substitution",s=>{s.codingTaskOwners[0].privateOwnership.root+="-substituted";});
    if(change==="policy")await f.store.update("personal","fixture-policy-change",s=>{s.mode="managed-companion";});
    if(change==="permissions")await f.store.update("personal","fixture-permission-change",s=>{s.codingSessions[0].launchPolicy="unsafe";});
    if(change==="account")f.controls.login="b".repeat(64);
    await assert.rejects(service.load("personal",request),undefined,change);assert.equal(f.calls.includes("resume"),false);
    // Restore only this synthetic protected owner so fixture retirement can verify.
    if(change==="owner")await f.store.update("personal","fixture-original-owner",s=>{s.codingTaskOwners[0].privateOwnership=structuredClone(f.owners[0].privateOwnership);});
  }
});

test("active and unfamiliar task states refuse loading without changing running permissions",async t=>{
  for(const status of ["active","waiting-on-approval","unknown"]){
    const f=await fixture(t),service=f.service(),owner=f.request();f.controls.allowResume=true;await service.open("personal",owner);const review=await service.reviewLoad("personal",owner.requestId);f.controls.observation=status;
    await assert.rejects(service.load("personal",{ownerRequestId:owner.requestId,requestId:randomUUID(),token:review.confirmation.token}),/idle/);assert.equal(f.calls.includes("resume"),false);assert.equal((await f.store.snapshot("personal")).codingTaskLoads[0].status,"refused-before-effect");
  }
});

test("load boundaries refuse asynchronous drift and retain exact late acknowledgement without replay",async t=>{
  for(const phase of ["beforeResume","afterResume"]){
    const f=await fixture(t),service=f.service(),owner=f.request();f.controls.allowResume=true;await service.open("personal",owner);const review=await service.reviewLoad("personal",owner.requestId),request={ownerRequestId:owner.requestId,requestId:randomUUID(),token:review.confirmation.token};
    f.controls[phase]=()=>f.store.update("personal","fixture-load-drift",s=>{s.codingSessions[0].sessionId="different-task";});
    await assert.rejects(service.load("personal",request),/binding changed/);const row=(await f.store.snapshot("personal")).codingTaskLoads[0];assert.equal(row.status,"outcome-unconfirmed");assert.equal(row.acknowledgedThreadId,phase==="afterResume"?f.task.sessionId:null);assert.equal(f.calls.filter(c=>c==="resume").length,phase==="afterResume"?1:0);
    assert.equal((await service.load("personal",request)).duplicatePrevented,true);assert.equal((await service.list("personal"))[0].stoppedVerified,true);
  }
});

test("concurrent reviewed requests cannot load one original owner twice",async t=>{
  const f=await fixture(t),service=f.service(),owner=f.request();f.controls.allowResume=true;await service.open("personal",owner);
  const reviews=await Promise.all([service.reviewLoad("personal",owner.requestId),service.reviewLoad("personal",owner.requestId)]);
  const results=await Promise.allSettled(reviews.map(review=>service.load("personal",{ownerRequestId:owner.requestId,requestId:randomUUID(),token:review.confirmation.token})));
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(f.calls.filter(c=>c==="resume").length,1);assert.equal((await f.store.snapshot("personal")).codingTaskLoads.length,1);
});

test("shutdown joins an in-flight load and prevents its late native effect",async t=>{
  const f=await fixture(t),service=f.service(),owner=f.request();f.controls.allowResume=true;await service.open("personal",owner);const review=await service.reviewLoad("personal",owner.requestId);
  let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);f.controls.beforeResume=async()=>{entered();await gate;};
  const loading=service.load("personal",{ownerRequestId:owner.requestId,requestId:randomUUID(),token:review.confirmation.token});const rejection=assert.rejects(loading,/stopped|owner changed/);await ready;
  let exited=false;const closing=service.stopCompartment("personal").then(result=>{exited=true;return result;});await new Promise(r=>setImmediate(r));assert.equal(exited,false);release();await rejection;assert.equal((await closing).stopped,true);assert.equal(f.calls.includes("resume"),false);assert.equal((await f.store.snapshot("personal")).codingTaskLoads[0].status,"outcome-unconfirmed");
});

async function routedFixture(t) {
  const f=await fixture(t);f.controls.allowResume=true;
  const suite=createSuite({store:f.store,platform:"linux",codingTaskOwnersFactory:options=>f.service(options),agents:{discovery:async()=>[],close:async()=>{}},voice:{discovery:async()=>({available:false})}});
  f.beforeCleanup(()=>suite.close());await suite.handle("/api/suite/bootstrap");
  const api=(action,body={})=>suite.handle("/api/suite/coding/codex/owners/"+action,{compartment:"personal",...body});
  return {...f,suite,api};
}

test("authenticated Studio routes compose real protected review/load state without accepting prompts or granting IDE authority",async t=>{
  const f=await routedFixture(t),token="s".repeat(43),server=createStudioServer({suite:f.suite,token,bridge:{close(){}}});server.listen(0,"127.0.0.1");await once(server,"listening");
  f.beforeCleanup(async()=>{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await server.cleanup();});const origin=`http://127.0.0.1:${server.address().port}`;
  const api=async(action,body={},auth=true)=>{const response=await fetch(origin+"/api/suite/coding/codex/owners/"+action,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({compartment:"personal",...body})});return {status:response.status,body:await response.json()};};
  const owner=f.request();assert.equal((await api("open",owner,false)).status,401);assert.equal(f.owners.length,0);
  assert.equal((await api("editor-target",{ownerRequestId:owner.requestId,loadRequestId:randomUUID()},false)).status,401);
  assert.equal((await api("editor-target",{ownerRequestId:owner.requestId,loadRequestId:randomUUID(),prompt:"never"})).status,409);
  assert.equal((await api("open",{...owner,prompt:"not allowed"})).status,409);assert.equal(f.owners.length,0);
  assert.equal((await api("open",owner)).body.status,"bound");const scope={ownerRequestId:owner.requestId};
  const review=await api("review-load",scope);assert.equal(review.status,200);assert.equal(f.calls.includes("resume"),false);
  const request={...scope,requestId:randomUUID(),token:review.body.confirmation.token};const loaded=await api("load",request);assert.equal(loaded.status,200);assert.equal(loaded.body.nativeTaskLoaded,true);assert.equal(loaded.body.ideAttached,false);
  assert.equal((await api("load",request)).body.duplicatePrevented,true);assert.equal((await api("loads")).body[0].nativeTaskLoaded,false);const snapshot=await f.suite.handle("/api/suite/snapshot",{compartment:"personal"});assert.equal(Object.hasOwn(snapshot,"codingTaskOwners"),false);assert.equal(Object.hasOwn(snapshot,"codingTaskLoads"),false);assert.equal(f.calls.filter(c=>c==="resume").length,1);
  assert.equal((await api("stop",scope)).body.stopped,true);assert.equal((await api("list")).body[0].stoppedVerified,true);
  assert.equal((await api("read",scope)).status,409);assert.equal((await api("recover",scope)).body.duplicatePrevented,true);
});

test("normal workspace selection retires exact owned connections and refuses inactive or externally selected task routes",async t=>{
  const f=await routedFixture(t),owner=f.request();await f.api("open",owner);
  await f.suite.handle("/api/suite/compartment/create",{compartment:"other",policy:"personal"});
  f.controls.stopped=false;await assert.rejects(f.suite.handle("/api/suite/compartment/select",{compartment:"other"}),/not verified exit/);assert.equal(await f.store.selection(),"personal");
  f.controls.stopped=true;await f.suite.handle("/api/suite/compartment/select",{compartment:"other"});assert.equal((await f.store.snapshot("personal")).codingTaskOwners[0].stoppedVerified,true);
  await assert.rejects(f.api("read",{ownerRequestId:owner.requestId}),/original task workspace/);
  await f.suite.handle("/api/suite/compartment/select",{compartment:"personal"});const next=f.request();await f.api("open",next);
  await f.store.selection("other");await assert.rejects(f.api("review-load",{ownerRequestId:next.requestId}),/original task workspace/);assert.equal(f.calls.includes("resume"),false);await f.store.selection("personal");
});

test("keyboard-only mode joins task-owner shutdown and preserves failed retirement without enabling new starts",async t=>{
  const f=await routedFixture(t),owner=f.request();await f.api("open",owner);f.controls.stopped=false;
  await assert.rejects(f.suite.handle("/api/suite/mode",{compartment:"personal",mode:"keyboard-only"}),/stop is unconfirmed/);assert.equal((await f.store.snapshot("personal")).mode,"keyboard-only");
  await assert.rejects(f.api("open",f.request()),/keyboard-only/i);await assert.rejects(f.suite.close(),/owner exit is unconfirmed/);f.controls.stopped=true;
});

test("an external workspace change during native project setup refuses the late task effect",async t=>{
  const f=await routedFixture(t),owner=f.request();await f.suite.handle("/api/suite/compartment/create",{compartment:"other",policy:"personal"});await f.api("open",owner);
  const review=await f.api("review-load",{ownerRequestId:owner.requestId});f.controls.beforeResume=()=>f.store.selection("other");
  await assert.rejects(f.api("load",{ownerRequestId:owner.requestId,requestId:randomUUID(),token:review.confirmation.token}),/no longer active/);assert.equal(f.calls.includes("resume"),false);assert.equal((await f.store.snapshot("personal")).codingTaskLoads[0].status,"outcome-unconfirmed");await f.store.selection("personal");
});


test("a failed bridge close still attempts original native owner retirement and cannot upgrade the uncertain bridge exit",async t=>{
  const f=await fixture(t),service=f.service(),owner=f.request();await service.open("personal",owner);f.controls.closeThrows=true;
  assert.equal((await service.stop("personal",owner.requestId)).stopped,false);assert.equal(f.calls.filter(c=>c==="owner-stop").length,1);assert.equal((await service.list("personal"))[0].stoppedVerified,false);
  await assert.rejects(f.service().open("personal",f.request()),/retirement/);f.controls.closeThrows=false;assert.equal((await service.stop("personal",owner.requestId)).stopped,true);
});

async function editorFixture(t) {
  const f = await routedFixture(t); f.task.sessionId = randomUUID();
  await f.store.update("personal", "fixture-editor-thread", s => { s.codingSessions[0].sessionId = f.task.sessionId; });
  const owner = f.request(); await f.api("open", owner);
  const endpoint = { socketPath: "/tmp/synthetic-private-editor-socket", socketDevice: "1", socketInode: "3", peerPid: 1234, peerBirth: "1", peerExecutableSha256: "c".repeat(64) };
  f.owners[0].binding = endpoint; f.owners[0].inspectBinding = async () => structuredClone(f.owners[0].binding);
  const review = await f.api("review-load", { ownerRequestId: owner.requestId });
  const load = { ownerRequestId: owner.requestId, requestId: randomUUID(), token: review.confirmation.token };
  await f.api("load", load);
  return { ...f, owner, load, input: { ownerRequestId: owner.requestId, loadRequestId: load.requestId }, endpoint };
}
test("a dedicated editor client uses only the original acknowledged task owner and rechecks after registration", async t => {
  const f=await fixture(t),service=f.service();f.controls.allowResume=true;f.task.sessionId=randomUUID();await f.store.update('personal','fixture-editor-id',s=>{s.codingSessions[0].sessionId=f.task.sessionId;});
  const request=f.request();await service.open('personal',request);const owner=f.owners[0];owner.binding={socketPath:'/tmp/synthetic-editor',socketDevice:'1',socketInode:'3',peerPid:1234,peerBirth:'1',peerExecutableSha256:'c'.repeat(64)};owner.inspectBinding=async()=>structuredClone(owner.binding);
  const review=await service.reviewLoad('personal',request.requestId),load={ownerRequestId:request.requestId,requestId:randomUUID(),token:review.confirmation.token};await service.load('personal',load);
  let created=0,registered=0;const client={synthetic:true};owner.openEditorClient=async({onClient})=>{created++;await onClient(client);return client;};const input={ownerRequestId:request.requestId,loadRequestId:load.requestId};
  await assert.rejects(service.openEditorClient('personal',{...input,loadRequestId:randomUUID()},{onClient:async()=>{registered++;}}));assert.equal(created,0);
  assert.equal(await service.openEditorClient('personal',input,{onClient:async c=>{assert.equal(c,client);registered++;}}),client);assert.equal(registered,1);
  await assert.rejects(service.openEditorClient('personal',input,{onClient:async()=>{f.controls.login='b'.repeat(64);}}));assert.equal(created,2);f.controls.login=f.task.accountFingerprint;
});
test("authenticated editor routes consume one reviewed launch permission without launching a terminal or exposing its protected record", async t => {
  const f = await editorFixture(t), token = "e".repeat(43), server = createStudioServer({ suite: f.suite, token, bridge: { close() {} } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  f.beforeCleanup(async () => { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await server.cleanup(); });
  const origin = `http://127.0.0.1:${server.address().port}`, input = { ...f.input, requestId: randomUUID(), editorId: randomUUID() };
  const api = async (action, body = {}, auth = true) => {
    const response = await fetch(origin + "/api/suite/coding/codex/editor/" + action, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ compartment: "personal", ...body }) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await api("review", input, false)).status, 401);
  for (const action of ["review", "issue", "consume", "return-target"]) { assert.equal((await api(action, { ...input, command: "never" })).status, 409); assert.equal((await api(action, input, false)).status, 401); }
  const review = await api("review", input); assert.equal(review.status, 200);
  const issued = await api("issue", { ...input, token: review.body.confirmation.token }); assert.equal(issued.status, 200); assert.equal(issued.body.terminalLaunchAuthorized, false);
  const consumed = await api("consume", { ...input, permit: issued.body.permit }); assert.equal(consumed.status, 200); assert.equal(consumed.body.terminalLaunchAuthorized, true); assert.equal(consumed.body.terminalLaunched, false); assert.equal(consumed.body.ideAttached, false);
  const duplicate = await api("consume", { ...input, permit: issued.body.permit }); assert.equal(duplicate.body.terminalLaunchAuthorized, false); assert.equal(duplicate.body.duplicatePrevented, true);
  await f.store.update("personal", "fixture-private-editor-record", state => { state.codingEditorConnections = [{ requestId: input.requestId, privateOwnership: "PRIVATE_EDITOR_OWNERSHIP" }]; });
  const snapshot = await f.suite.handle("/api/suite/snapshot", { compartment: "personal" }); assert.equal(snapshot.codingEditorAuthorizations, undefined); assert.equal(snapshot.codingEditorConnections, undefined); assert.equal(JSON.stringify(snapshot).includes("PRIVATE_EDITOR_OWNERSHIP"), false); assert.equal(JSON.stringify(snapshot).includes(issued.body.permit), false);
  assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations[0].status, "consumed"); assert.equal(f.calls.filter(c => c === "resume").length, 1);
  f.controls.login = "f".repeat(64); assert.equal((await api("review", { ...input, requestId: randomUUID() })).status, 409);
});
test("editor target preparation binds the acknowledged load and original endpoint without another resume, launch or authority claim", async t => {
  const f = await editorFixture(t), before = await f.store.snapshot("personal"), calls = f.calls.filter(c => c === "resume").length;
  const result = await f.api("editor-target", f.input);
  assert.equal(result.target.sessionId, f.task.sessionId); assert.equal(result.target.repositoryRoot, f.task.repositoryRoot); assert.equal(result.target.accountFingerprint, f.task.accountFingerprint); assert.deepEqual(result.target.endpoint, f.endpoint); assert.match(result.targetDigest, /^[a-f0-9]{64}$/);
  for (const key of ["authorityGranted", "terminalLaunched", "ideAttached", "nativeTaskLoaded", "modelPromptSubmitted", "completionVerified"]) assert.equal(result[key], false);
  assert.equal(result.nativeLoadAcknowledged, true); assert.deepEqual(await f.api("editor-target", f.input), result); assert.deepEqual(await f.store.snapshot("personal"), before); assert.equal(f.calls.filter(c => c === "resume").length, calls);
  for (const extra of [{ prompt: "never" }, { socketPath: "/tmp/foreign" }, { command: "never" }]) await assert.rejects(f.api("editor-target", { ...f.input, ...extra }), /unrelated fields/);
  await assert.rejects(f.api("editor-target", { ...f.input, loadRequestId: randomUUID() }), /acknowledged load/);
  await f.api("stop", { ownerRequestId: f.owner.requestId }); await assert.rejects(f.api("editor-target", f.input));
});
test("editor preparation refuses stale load, changed policy/account, non-idle task and incomplete endpoint identity", async t => {
  for (const drift of ["load", "policy", "account", "active", "endpoint", "new-host"]) {
    const f = await editorFixture(t);
    if (drift === "load") await f.store.update("personal", "fixture-late-load", s => { s.codingTaskLoads[0].status = "outcome-unconfirmed"; });
    if (drift === "policy") await f.store.update("personal", "fixture-late-policy", s => { s.mode = "managed-companion"; });
    if (drift === "account") f.controls.login = "d".repeat(64);
    if (drift === "active") f.controls.observation = "active";
    if (drift === "endpoint") f.owners[0].binding = { ...f.endpoint, peerBirth: null };
    if (drift === "new-host") await assert.rejects(f.service().editorTarget("personal", f.input), /does not own/);
    else await assert.rejects(f.api("editor-target", f.input), undefined, drift);
    assert.equal(f.calls.filter(c => c === "resume").length, 1);
  }
});
test("asynchronous editor inspection cannot conceal load replacement, endpoint drift or a policy change at its last boundary", async t => {
  for (const phase of ["read", "second-inspection", "policy"]) {
    const f = await editorFixture(t); let inspections = 0;
    if (phase === "read") f.controls.afterRead = () => f.store.update("personal", "fixture-editor-load-change", s => { s.codingTaskLoads[0].acknowledgedThreadId = randomUUID(); });
    f.owners[0].inspectBinding = async () => {
      if (++inspections === 2) {
        if (phase === "second-inspection") return { ...f.endpoint, socketInode: "99" };
        if (phase === "policy") await f.store.update("personal", "fixture-editor-policy-change", s => { s.mode = "managed-companion"; });
      }
      return structuredClone(f.endpoint);
    };
    await assert.rejects(f.api("editor-target", f.input)); assert.equal(f.calls.filter(c => c === "resume").length, 1);
  }
});
test("the editor client authenticates the real Studio route and reads original protected target metadata without another native effect", { skip: process.platform !== "linux" }, async t => {
  const f = await editorFixture(t), token = "p".repeat(43), instance = { id: randomUUID(), build: "e".repeat(64) };
  const server = createStudioServer({ suite: f.suite, token, instance, onApplicationStop() { throw Error("No stop request is authorized by this read-only proof"); }, bridge: { close() {} } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const endpointPath = join(f.root, "editor-endpoint.json"), origin = `http://127.0.0.1:${server.address().port}`;
  await writeFile(endpointPath, JSON.stringify({ schema: "switchyard-active-endpoint/v1", instance, pid: process.pid, url: origin + "/#access=" + token }), { mode: 0o600 });
  const client = new StudioTaskClient({ endpointPath });
  f.beforeCleanup(async () => { client.close(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await server.cleanup(); });
  const before = await f.store.snapshot("personal"), result = await client.editorTarget({ compartment: "personal", ...f.input });
  assert.equal(result.target.sessionId, f.task.sessionId); assert.equal(result.target.repositoryRoot, f.task.repositoryRoot); assert.deepEqual(result.target.endpoint, f.endpoint); assert.equal(result.authorityGranted, false); assert.equal(result.ideAttached, false);
  assert.equal(f.calls.filter(c => c === "resume").length, 1); assert.deepEqual(await f.store.snapshot("personal"), before);
  const selected = { compartment: "personal", ...f.input, requestId: randomUUID(), editorId: randomUUID() };
  const review = await client.reviewEditor(selected), issued = await client.issueEditor({ ...selected, token: review.confirmation.token });
  const consumed = await client.consumeEditor({ ...selected, permit: issued.permit });
  assert.equal(consumed.terminalLaunchAuthorized, true); assert.equal(consumed.terminalLaunched, false); assert.equal(consumed.ideAttached, false); assert.deepEqual(consumed.target, result.target);
  const replay = await client.consumeEditor({ ...selected, permit: issued.permit }); assert.equal(replay.duplicatePrevented, true); assert.equal(replay.terminalLaunchAuthorized, false);
  assert.equal((await f.store.snapshot("personal")).codingEditorAuthorizations[0].status, "consumed");
  const returnBefore = await f.store.snapshot("personal"); f.controls.observation = "active";
  await assert.rejects(client.editorTarget({ compartment: "personal", ...f.input }));
  const returning = await client.returnEditorTarget(selected); assert.deepEqual(returning, result); assert.equal(returning.authorityGranted, false);
  assert.deepEqual(await f.store.snapshot("personal"), returnBefore); assert.equal(f.calls.filter(c => c === "resume").length, 1);
  for (const changed of [{ editorId: randomUUID() }, { requestId: randomUUID() }, { loadRequestId: randomUUID() }]) await assert.rejects(client.returnEditorTarget({ ...selected, ...changed }));
  f.controls.observation = "unknown"; await assert.rejects(client.returnEditorTarget(selected)); f.controls.observation = "idle";
  const cancelledSelection = { ...selected, requestId: randomUUID() }, cancelledReview = await client.reviewEditor(cancelledSelection);
  const cancelledIssue = await client.issueEditor({ ...cancelledSelection, token: cancelledReview.confirmation.token });
  f.controls.afterRead = async () => { if ((await f.store.snapshot("personal")).codingEditorAuthorizations.find(row => row.requestId === cancelledSelection.requestId)?.status === "consumed") client.close(); };
  await assert.rejects(client.consumeEditor({ ...cancelledSelection, permit: cancelledIssue.permit }));
  f.controls.afterRead = async () => {};
  const replacementClient = new StudioTaskClient({ endpointPath }); f.beforeCleanup(() => replacementClient.close());
  const cancelledReplay = await replacementClient.consumeEditor({ ...cancelledSelection, permit: cancelledIssue.permit });
  assert.equal(cancelledReplay.duplicatePrevented, true); assert.equal(cancelledReplay.terminalLaunchAuthorized, false);
  f.controls.login = "f".repeat(64); await assert.rejects(replacementClient.returnEditorTarget(selected)); await assert.rejects(replacementClient.editorTarget({ compartment: "personal", ...f.input })); assert.equal(f.calls.filter(c => c === "resume").length, 1);
});
