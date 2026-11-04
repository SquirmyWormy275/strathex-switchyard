import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { createWindowsReviewedRunner } from "./windows-reviewed-runner.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

// Explicit native service/VM doubles; encrypted state, file reads and kernel
// leases are real. No disk, VM, account, keyboard or runtime copy is created.
async function fixture(t) {
  const stage = await mkdtemp(join(tmpdir(), "switchyard-windows-runner-contract-")), root = join(stage, "repository"), stateDirectory = join(stage, "runs"), keys = new Map(), calls = [], consumers = [], services = [];
  await mkdir(root); const secrets = { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } };
  const store = createSuiteStore({ root: join(stage, "private"), secrets }); await store.initialize("personal"); await store.update("personal", "fixture", state => { state.mode = "personal-companion"; });
  const runtime = "b".repeat(64), program = Buffer.from("process.stdout.write('synthetic')"), catalog = Buffer.from(JSON.stringify({ schema: "sxsy-b122.windows-sandbox-catalog", version: 1, recipes: [{ id: "run_target", executable: "C:\\B122\\tools\\node.exe", executableSha256: runtime, arguments: ["{INPUT_ROOT}\\program.mjs"], workingRoot: "work", workingDirectory: ".", environment: {}, timeoutMs: 5000, maxOutputBytes: 4096, artifacts: [] }] }));
  const input = (path, bytes) => ({ path, sha256: sha(bytes), size: bytes.length, classification: "non-production" });
  const manifest = Buffer.from(JSON.stringify({ schema: "switchyard-windows-reviewed-run/v1", version: 1, recipeId: "run_target", catalogPath: "guest.json", catalogSha256: sha(catalog), inputFiles: [input("program.mjs", program), input("guest.json", catalog)] }));
  for (const [path, bytes] of [["run.json",manifest],["guest.json",catalog],["program.mjs",program]]) await writeFile(join(root,path),bytes);
  const context = { operationId: randomUUID(), scopeDigest: "a".repeat(64), provider: "codex" }, plan = { repositoryRoot: root, sourceIdentity: { device: "1", inode: "2" }, manifestPath: "run.json", manifestSha256: sha(manifest), allowedFiles: [["run.json",manifest],["guest.json",catalog],["program.mjs",program]].map(([path,bytes]) => ({ path,digest:`sha256:${sha(bytes)}` })) };
  let recoverCalls = 0; let active = true, guestExited = true, unknownExit = false, cleanupAllowed = true, hold = false, stageHold = false, enter, releaseStage, stageEntered, hook = async () => {};
  const entered = new Promise(resolve => { enter = resolve; }), staged = new Promise(resolve => { stageEntered = resolve; }), stagingGate = new Promise(resolve => { releaseStage = resolve; });
  const identities = { helperSha256: "c".repeat(64), recipeRuntime: { path: "C:\\owned\\node.exe", sha256: runtime }, nodeVersion: "24.14.0" };
  const servicesFactory = async ({consumerStopped}) => {
    consumers.push(consumerStopped);
    const asset = name => ({ prepare: async (c, binding, input, authorize) => {
      calls.push(name); assert.equal(await consumerStopped(c,binding.operationId),false); if (typeof input === "function") await input(); else await authorize(); await hook(name);
      if (name === "inputs" && stageHold) { stageEntered(); await stagingGate; }
      if (name === "images") return { createVolume: async () => { calls.push("volume"); return { operationId: binding.operationId, exchangeQuotaEnforced: true }; } };
      return { operationId: binding.operationId, root: join(stage,name), helperFilename:"b122-sandbox-worker.exe", assertCurrent: async () => { await hook(name+"-assert"); } };
    }, cleanup: async (c,id) => { assert.equal(await consumerStopped(c,id),true); calls.push("cleanup-"+name); return {cleaned:cleanupAllowed}; }, stopCompartment:async()=>({stopped:true}), close:async()=>{} });
    return { inputs:asset("inputs"),tools:asset("tools"),images:asset("images"),sessions:{ recover:async()=>{recoverCalls++;return{stopped:guestExited};},consumerStopped:async()=>guestExited,forOperation:(_c,binding)=>({operationId:binding.operationId}),stopCompartment:async()=>({stopped:guestExited}),close:async()=>{} } };
  };
  const backendFactory = options => ({ execute: async request => {
    calls.push("backend"); assert.equal(options.requireReviewedInputs,true); assert.equal(options.requireBoundedExchange,true); assert.equal(options.runner.operationId,request.operationId); assert.equal(request.reviewedInputs.operationId,request.operationId); assert.equal(request.reviewedExchange.operationId,request.operationId); assert.equal(request.expectedHelperSha256,identities.helperSha256); assert.equal(request.expectedRecipeCatalogSha256,sha(catalog));
    await options.effectGuard.check(); guestExited = false; await hook("backend"); enter();
    if (hold) await new Promise(resolve=>{request.signal.addEventListener("abort",resolve,{once:true});if(request.signal.aborted)resolve();});
    guestExited = !unknownExit; return {status:request.signal.aborted?"cancelled":"completed",summary:"Synthetic backend result",receiptPath:join(stage,"synthetic-receipt.json")};
  } });
  const create = (otherStore=store) => { const service=createWindowsReviewedRunner({store:otherStore,stateDirectory,platform:"win32",pins:async()=>identities,servicesFactory,backendFactory,isActive:async()=>active});services.push(service);return service; };
  const runner = create();
  t.after(async()=>{active=true;guestExited=true;cleanupAllowed=true;identities.helperSha256="c".repeat(64);identities.nodeVersion="24.14.0";identities.recipeRuntime.sha256=runtime;releaseStage();for(const service of services){await service.recover("personal");await service.close();}await rm(stage,{recursive:true,force:true});});
  return {recoverCalls:()=>recoverCalls,store,runner,create,context,plan,calls,consumers,identities,entered,staged,releaseStage,run:(binding=context,proposed=plan)=>runner.run("personal",binding,proposed,async()=>{}),hold:()=>{hold=true;},holdStaging:()=>{stageHold=true;},unknownExit:()=>{unknownExit=true;},observeExit:()=>{guestExited=true;unknownExit=false;},active:value=>{active=value;},cleanup:value=>{cleanupAllowed=value;},hook:fn=>{hook=fn;},otherStore:()=>createSuiteStore({root:join(stage,"private"),secrets})};
}
test("one host-only Windows Run connects exact staging, bounded storage, backend admission and separate native-owner cleanup",async t=>{
 const f=await fixture(t),prerequisites=await f.runner.prerequisites();assert.equal(prerequisites.recipeRuntime.sha256,f.identities.recipeRuntime.sha256);prerequisites.recipeRuntime.sha256="f".repeat(64);const result=await f.run();assert.equal(result.status,"completed");assert.equal(result.providerTaskCompletionVerified,false);
 assert.deepEqual(f.calls.slice(0,5),["inputs","tools","images","volume","backend"]);assert.deepEqual(f.calls.slice(5).sort(),["cleanup-images","cleanup-inputs","cleanup-tools"]);
 const row=(await f.store.snapshot("personal")).repositoryWindowsRuns[0];assert.equal(row.cleanupPending,false);assert.equal(row.status,"settled");assert.equal(row.result.status,"completed");
 const before=f.calls.length;assert.equal((await f.run()).replayed,true);assert.equal(f.calls.length,before);
 await assert.rejects(f.run(f.context,{...f.plan,manifestPath:"changed.json"}),/different exact review/);assert.equal(f.calls.length,before);
});
test("a live preparation remains fenced across independent runner/store instances before any VM exists",async t=>{
 const f=await fixture(t);f.holdStaging();const running=f.run();await f.staged;
 const other=f.create(f.otherStore());assert.equal((await other.recover("personal")).cleaned,false);assert.equal(await f.consumers[1]("personal",f.context.operationId),false);assert.equal(f.calls.some(name=>name.startsWith("cleanup-")),false);
 f.releaseStage();assert.equal((await running).status,"completed");assert.equal((await other.recover("personal")).cleaned,true);
});
test("unknown guest exit preserves every asset and blocks a fresh operation until exact exit-only reconciliation",async t=>{
 const f=await fixture(t);f.unknownExit();assert.equal((await f.run()).status,"incomplete","an injected completion cannot substitute for independent native/VM exit");assert.equal((await f.runner.list("personal"))[0].cleanupPending,true);assert.equal(f.calls.some(name=>name.startsWith("cleanup-")),false);
 await assert.rejects(f.run({...f.context,operationId:randomUUID()}),/native owners and storage/);assert.equal(f.calls.filter(name=>name==="backend").length,1);
 f.observeExit();assert.equal((await f.runner.recover("personal")).cleaned,true);const row=(await f.runner.list("personal"))[0];assert.equal(row.cleanupPending,false);assert.equal(row.result.status,"incomplete");assert.equal((await f.store.snapshot("personal")).repositoryWindowsRuns[0].backendObservation.status,"completed");assert.equal(f.calls.filter(name=>name==="backend").length,1);
});
test("scope revocation during preparation starts no guest and retires only independently stopped staged assets",async t=>{
 const f=await fixture(t);f.hook(async phase=>{if(phase==="inputs")f.active(false);});await assert.rejects(f.run(),/workspace changed/);assert.equal(f.calls.includes("backend"),false);
 const row=(await f.runner.list("personal"))[0];assert.equal(row.status,"outcome-unconfirmed");assert.equal(row.cleanupPending,false);f.active(true);assert.equal((await f.run()).replayed,true);assert.equal(f.calls.filter(name=>name==="inputs").length,1);
});
test("an uncertain reservation or result cannot replay while late cleanup preserves the original outcome",async t=>{
 const f=await fixture(t),original=f.store.update;let fail=true;f.store.update=async(...args)=>{const value=await original(...args);if(fail&&args[1]==="windows-run-reserve"){fail=false;throw Error("Synthetic ambiguous reservation");}return value;};
 await assert.rejects(f.run(),/ambiguous reservation/);assert.equal(f.calls.length,0);assert.equal((await f.run()).replayed,true);assert.equal(f.calls.length,0);
 assert.equal((await f.runner.recover("personal")).cleaned,true);assert.equal((await f.runner.list("personal"))[0].status,"outcome-unconfirmed");assert.equal(f.calls.includes("backend"),false);
});
test("mode shutdown cancels the exact guest boundary, awaits its result and keeps that result distinct from storage retirement",async t=>{
 const f=await fixture(t);f.hold();const running=f.run();await f.entered;const stopped=await f.runner.stopCompartment("personal");assert.equal((await running).status,"cancelled");assert.equal(stopped.cleaned,true);assert.equal(stopped.stopped,true);assert.equal(f.calls.filter(name=>name==="backend").length,1);assert.equal((await f.runner.list("personal"))[0].result.status,"cancelled");
});

test("another process cannot reconcile or stop the guest while its original Run lease is still held",async t=>{
 const f=await fixture(t);f.hold();const running=f.run();await f.entered;const other=f.create(f.otherStore()),before=f.recoverCalls();
 assert.equal((await other.recover("personal")).cleaned,false);assert.equal(f.recoverCalls(),before,"Guest recovery must follow the exact preparation lease, even after startup");
 await f.runner.stopCompartment("personal");assert.equal((await running).status,"cancelled");assert.equal((await other.recover("personal")).cleaned,true);
});

test("storage cleanup uncertainty remains separate from a verified backend result and blocks a replacement",async t=>{
 const f=await fixture(t);f.cleanup(false);const result=await f.run();assert.equal(result.status,"completed");const original=(await f.runner.list("personal"))[0];assert.equal(original.cleanupPending,true);
 await assert.rejects(f.run({...f.context,operationId:randomUUID()}),/native owners and storage/);f.cleanup(true);assert.equal((await f.runner.recover("personal")).cleaned,true);const recovered=(await f.runner.list("personal"))[0];assert.deepEqual(recovered.result,original.result);assert.equal(recovered.cleanupPending,false);assert.equal(f.calls.filter(name=>name==="backend").length,1);
});
test("an unsupported or substituted host runtime cannot reserve staging or start a guest",async t=>{
 for(const invalid of ["version","runtime","helper"]){const f=await fixture(t);if(invalid==="version")f.identities.nodeVersion="25.0.0";if(invalid==="runtime")f.identities.recipeRuntime.sha256="f".repeat(64);if(invalid==="helper")f.identities.helperSha256="unknown";await assert.rejects(f.run());assert.equal(f.calls.length,0);assert.equal((await f.runner.list("personal")).length,0);}
});

test("a durable exact cancellation from another instance reaches only its original held guest without replay or a PID substitute",async t=>{
 const f=await fixture(t);f.hold();const running=f.run();await f.entered;const other=f.create(f.otherStore());
 assert.deepEqual(await other.stopOperation("personal",randomUUID()),{accepted:false,stopped:false});const requested=await other.stopOperation("personal",f.context.operationId);assert.equal(requested.accepted,true);assert.equal(requested.stopped,false);
 const result=await Promise.race([running,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error("The durable cancellation was not observed")),8000);timer.unref?.();})]);assert.equal(result.status,"cancelled");assert.equal(f.calls.filter(name=>name==="backend").length,1);assert.equal((await f.runner.list("personal"))[0].result.status,"cancelled");
 const duplicate=await f.run();assert.equal(duplicate.replayed,true);assert.equal(duplicate.status,"cancelled");assert.equal((await other.stopOperation("personal",f.context.operationId)).stopped,true);
});
