import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, rename, readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSuiteStore } from "./suite-store.mjs";
import { repositoryIdentity } from "./coding-task-identity.mjs";
import { createCodexUnixTasks } from "./codex-unix-tasks.mjs";
import { openOwnedCodexListener, retireStoppedCodexListener } from "./codex-owned-listener.mjs";
import { codexDesignConfig } from "./agents.mjs";
import { createCodingTaskOwners } from "./coding-task-owners.mjs";
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sy-owner-")), repositoryRoot = join(root, "repo"), keys = new Map(); await mkdir(repositoryRoot);
  const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (c,p) => keys.get(c+":"+p), set: async (c,p,v) => keys.set(c+":"+p,v) } });
  await store.initialize("personal"); await store.update("personal", "fixture", s => { s.mode = "personal-companion"; });
  const task = { id: randomUUID(), provider: "codex", status: "registered", sessionId: "synthetic-private-native-thread", accountFingerprint: "a".repeat(64), repositoryRoot, repositoryIdentity: await repositoryIdentity(repositoryRoot) };
  await store.update("personal", "fixture-task", s => { s.codingSessions = [task]; });
  const controls = { login: task.accountFingerprint, stopped: true, fail: null, afterRead: async () => {} }, calls = [], owners = [], services = [];
  function driverFactory(options) {
    calls.push("factory"); let started = false, closed = false;
    const owner = { scope: null, binding: null, accountFingerprint: null, privateOwnership: { root: join(root, "synthetic-listener-"+owners.length), rootIdentity: { device:"1",inode:"2",uid:1000,mode:448 } }, async stop() { closed = true; return { stopped: controls.stopped }; } }; owners.push(owner);
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
      async read(id, path) { calls.push("read"); await controls.afterRead(); return { id,repositoryRoot:path,observation:"idle" }; },
      async close() { calls.push("close"); closed = true; return [{ stopped:controls.stopped }]; },
      async start() { throw Error("No native thread creation is allowed in this proof"); }, async resume() { throw Error("No native task loading is allowed in this proof"); }
    };
  }
  function service(extra = {}) { const result = createCodingTaskOwners({ store, platform:"linux", driverFactory, retire:async(scope,ownership) => { calls.push("recover"); assert.ok(owners.some(o => o.scope?.id === scope.id && o.privateOwnership.root === ownership.root)); return { stopped:controls.stopped }; }, ...extra }); services.push(result); return result; }
  t.after(async () => { controls.stopped = true; for (const s of services) assert.ok((await s.close()).every(r => r.stopped)); await rm(root,{recursive:true}); });
  return { root,store,task,controls,calls,owners,service,request:()=>({requestId:randomUUID(),taskId:task.id}) };
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
