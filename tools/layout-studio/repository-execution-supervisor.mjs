/** Host-only runtime port. No HTTP command, process ID or imported permission enters it. */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { isAbsolute } from "node:path";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const actions = new Set(["run_target", "launch_web_app", "venv", "rebuild_venv", "pipeline_local_gate", "pipeline_clean_reproduction", "shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"]);
const fields = ["action", "operationId", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "executionRoot", "isolation", "manifestSha256", "executable", "executableSha256", "args", "cwd", "environment", "lifecycle", "timeoutMs", "maxOutputBytes", "linuxExecutable"];
function exactRequest(request, binding) {
  const r = structuredClone(request);
  if (Object.keys(r).some(k => !fields.includes(k)) || !isAbsolute(r.executable ?? "") || !isAbsolute(r.cwd ?? "") || !isAbsolute(r.executionRoot ?? "") || !sha(r.executableSha256) || !["repository", "disposable"].includes(r.isolation) || !["foreground", "managed"].includes(r.lifecycle) || !Number.isSafeInteger(r.timeoutMs) || r.timeoutMs < 1 || r.timeoutMs > 600000 || !Number.isSafeInteger(r.maxOutputBytes) || r.maxOutputBytes < 1 || r.maxOutputBytes > 524288 || !Array.isArray(r.args) || r.args.length > 256 || r.args.some(a => typeof a !== "string" || a.length > 8192 || /[\0\r\n]/.test(a)) || !r.environment || Array.isArray(r.environment) || Object.keys(r.environment).length > 64) throw new Error("The exact reviewed runtime command exceeds its native contract.");
  for (const key of ["action", "operationId", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "manifestSha256"]) if (r[key] !== binding[key]) throw new Error("The execution supervisor rejected a substituted operation, task, authority, manifest or repository.");
  return r;
}
export function createRepositoryExecutionSupervisors({ store, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped, isActive = async () => true, now = Date.now } = {}) {
  const resources = new Map(), seen = new Set(), generations = new Map(); let closed = false;
  const keyFor = (c,id) => `${c}:${id}`;
  async function update(c,id,action,fn) { return store.update(c,action,s => { const r = s.repositoryExecutions?.find(r => r.operationId === id); if (!r) throw new Error("The protected execution ownership record changed."); return fn(r); }); }
  async function observeExit(c, row) {
    if (!row.ownedRuntime) return row.stoppedVerified === true;
    if (!await guardianStopped(row.ownedRuntime)) return false;
    await update(c,row.operationId,"repository-execution-observed-exit",r => { if (r.ownedRuntime?.id !== row.ownedRuntime.id) throw new Error("The exact retained execution guardian changed."); r.stoppedVerified = true; }); return true;
  }
  async function stopped(c) { let all = true; for (const r of (await store.snapshot(c)).repositoryExecutions ?? []) if (r.stoppedVerified !== true) { if (!await observeExit(c,r)) all = false; } return all; }
  async function reconcile(c) {
    seen.add(c);
    const roots=new Set(((await store.snapshot(c)).repositoryExecutions??[]).filter(r=>r.stoppedVerified!==true&&!resources.has(keyFor(c,r.operationId))).map(r=>r.repositoryRoot));
    for(const root of roots)await store.withResourceLock("repository-execution",digest([c,root]),async lease=>{
      for(const row of (await store.snapshot(c)).repositoryExecutions??[])if(row.repositoryRoot===root&&row.stoppedVerified!==true){
        lease.assert();
        if(row.ownedRuntime)await observeExit(c,row);
        else await update(c,row.operationId,"repository-execution-no-ack-recovery",r=>{if(r.ownedRuntime)throw Error("The retained native readiness identity changed.");r.status="not-started";r.stoppedVerified=true;r.noStartAcknowledgementVerified=true;});
      }
    });
    return {stopped:await stopped(c)};
  }
  async function stopCompartment(c) {
    generations.set(c,(generations.get(c) ?? 0)+1);
    const owned = [...resources.values()].filter(r => r.compartment === c); owned.forEach(r => r.controller.abort());
    await Promise.allSettled(owned.map(r => r.done));
    const exits = await Promise.all(owned.flatMap(r => [...r.clients].map(p => p.stop().catch(() => false))));
    const verified = exits.every(Boolean) && await stopped(c);
    if (verified) for (const [key,r] of resources) if (r.compartment === c && [...r.clients].every(p=>p.closed)) resources.delete(key);
    return { stopped: verified };
  }
  async function stopOperation(c,operationId) {
    const row=(await store.snapshot(c)).repositoryExecutions?.find(r=>r.operationId===operationId);
    if(!row)return {accepted:false,summary:"No exact protected execution exists; no process was guessed."};
    const resource=resources.get(keyFor(c,operationId));
    if(resource?.process)await resource.process.terminateTree();
    else if(resource){resource.controller.abort();await resource.done;}
    const verified=await observeExit(c,(await store.snapshot(c)).repositoryExecutions.find(r=>r.operationId===operationId));
    return {accepted:verified,summary:verified?"The exact owned execution has independently verified exit; prior program effects and uncertain outcomes remain preserved.":"The retained execution has no verified exit; no arbitrary process was terminated."};
  }
  return {
    forOperation(c, value, authorize) {
      const binding = structuredClone(value), generation = generations.get(c) ?? 0;
      if (!uuid(binding.operationId) || !uuid(binding.authorityId) || !sha(binding.targetSnapshotId) || !sha(binding.manifestSha256) || !actions.has(binding.action) || typeof binding.sessionId !== "string" || !binding.sessionId || !isAbsolute(binding.repositoryRoot ?? "") || !["codex", "claude-code"].includes(binding.provider) || typeof authorize !== "function") throw new Error("Choose one exact host execution operation and native task scope.");
      seen.add(c);
      const check = async () => { if (closed || generation !== (generations.get(c) ?? 0) || !await isActive(c)) throw new Error("This owned execution was stopped or its workspace is no longer selected."); await store.authorize(c,{provider:binding.provider}); await authorize(); };
      return {
        async start(input) {
          const request = exactRequest(input,binding), key = keyFor(c,binding.operationId);
          if (resources.has(key)) throw new Error("This execution operation already has an owned native process. It cannot be replayed.");
          if (typeof store.withResourceLock !== "function") throw new Error("Owned execution requires the protected kernel resource lease.");
          let resolveReady, rejectReady, resolveExit; const ready = new Promise((r,j) => { resolveReady=r; rejectReady=j; }), exit = new Promise(r => { resolveExit=r; });
          const stdout = new Readable({read(){}}), stderr = new Readable({read(){}}), resource = { compartment:c, controller:new AbortController(), clients:new Set(), done:null, process:null };
          resources.set(key,resource);
          let reserved = false, readySaved = false, settledSaved = false, result, owner;
          resource.done = Promise.resolve().then(() => store.withResourceLock("repository-execution",digest([c,binding.repositoryRoot]),async lease => {
            const current = async () => { lease.assert(); await check(); };
            try {
              await current();
              const state = await store.snapshot(c);
              if (state.repositoryExecutions?.some(r => r.operationId === binding.operationId)) throw new Error("This protected execution operation already exists. No native process was replayed.");
              if (!await stopped(c)) throw new Error("A retained execution guardian has not independently verified exit. No replacement was started.");
              await store.update(c,"repository-execution-reserve",s => {
                const rows = s.repositoryExecutions ?? [], retained = rows.filter(r => r.stoppedVerified !== true || !["settled", "not-started"].includes(r.status));
                s.repositoryExecutions = [...retained,...rows.filter(r => !retained.includes(r)).slice(-16)];
                if (s.repositoryExecutions.length >= 32 || s.repositoryExecutions.some(r => r.operationId === binding.operationId)) throw new Error("The execution ownership inventory is full or changed; existing evidence was preserved.");
                s.repositoryExecutions.push({ schema:"switchyard-owned-execution/v1", ...binding, supervisorId:`managed:${digest([c,binding])}`, commandDigest:digest(request), executionRoot:request.executionRoot, status:"reserved", stoppedVerified:false, at:now() });
              },{provider:binding.provider}); reserved=true;
              result = await runOwnedNativeCommand({ executable:request.executable, args:request.args, cwd:request.cwd, env:request.environment, expectedExecutableSha256:request.executableSha256, linuxExecutable:request.linuxExecutable, resource, signal:resource.controller.signal, timeout:request.timeoutMs, maxOutputBytes:request.maxOutputBytes, captureStderrBytes:4096, command, guardianStopped,
                onReady:async scope => {
                  await current(); owner=scope;
                  await update(c,binding.operationId,"repository-execution-ready",r => { if (r.commandDigest !== digest(request) || r.status !== "reserved") throw new Error("The exact protected executable request changed."); r.status="running"; r.ownedRuntime=scope; r.stoppedVerified=false; }); readySaved=true;
                  await current();
                  resource.process = { supervisorId:`managed:${digest([c,binding])}`, action:binding.action, operationId:binding.operationId, targetSnapshotId:binding.targetSnapshotId, sessionId:binding.sessionId, authorityId:binding.authorityId, pid:scope.guardianPid, startedAt:new Date(now()).toISOString(), stdout, stderr, recovered:false, wait:()=>exit, isAlive:async()=>!await guardianStopped(scope), terminateTree:async()=> { await update(c,binding.operationId,"repository-execution-stop-request",r=>{r.stopRequestedAt ??= now();}); resource.controller.abort(); await resource.done; if (!await guardianStopped(scope)) throw new Error("The exact execution guardian exit remains unconfirmed."); } };
                  resolveReady(resource.process);
                },
                onStopped:async scope => { if (!await guardianStopped(scope)) throw new Error("The execution guardian has not independently verified exit."); if (readySaved) await update(c,binding.operationId,"repository-execution-native-exit",r => { if (r.ownedRuntime?.id !== scope.id) throw new Error("The retained execution guardian changed."); r.stoppedVerified=true; }); }
              });
              await current();
              await update(c,binding.operationId,"repository-execution-result",r => { r.status="settled"; r.finishedAt=now(); r.result={ status:result.status, exitCode:result.exitCode, stdout:result.stdout, stderr:result.stderr }; });
              settledSaved=true;
            } finally {
              const stops = await Promise.all([...resource.clients].map(p=>p.stop().catch(()=>false))), nativeStopped = stops.every(Boolean) && (!owner || await guardianStopped(owner));
              if (reserved && !settledSaved) await update(c,binding.operationId,"repository-execution-unconfirmed",r => { r.status=readySaved?"outcome-unconfirmed":"not-started"; r.stoppedVerified=nativeStopped; r.finishedAt=now(); });
              if (nativeStopped && resources.get(key) === resource) resources.delete(key);
            }
          })).then(() => {
            if (result && settledSaved) { stdout.push(result.stdout); stderr.push(result.stderr); resolveExit({code:result.exitCode ?? -1,signal:null,terminalEvidence:"trusted"}); }
            else resolveExit({code:-1,signal:null,terminalEvidence:"ambiguous"});
          }).catch(async error => { if(reserved)await update(c,binding.operationId,"repository-execution-diagnostic",r=>{r.failure={code:typeof error.code==="string"?error.code.slice(0,64):"EXECUTION_UNCONFIRMED",message:String(error.message??"The native result could not be verified.").slice(0,1024)};}).catch(()=>{}); rejectReady(new Error("The exact owned execution did not reach its protected startup boundary; inspect retained ownership before retrying.")); resolveExit({code:-1,signal:null,terminalEvidence:"ambiguous"}); }).finally(()=> { if (!resource.process) rejectReady(new Error("The exact execution returned no verified native startup identity.")); stdout.push(null); stderr.push(null); });
          return ready;
        },
        async recover(scope) { if (scope.repositoryRoot !== binding.repositoryRoot || scope.manifestSha256 !== binding.manifestSha256) throw new Error("Execution recovery scope changed."); return [...resources.values()].filter(r=>r.compartment===c && r.process?.operationId===binding.operationId).map(r=>r.process); },
        async observeOperation(request) {
          const r = (await store.snapshot(c)).repositoryExecutions?.find(r=>r.operationId===request.operationId);
          if (!r || ["action","targetSnapshotId","repositoryRoot","sessionId","authorityId"].some(k=>r[k]!==request[k]) || r.manifestSha256 !== binding.manifestSha256) return {state:"not_owner",operationId:request.operationId,summary:"No exact protected execution binding was found."};
          const base={operationId:r.operationId,action:r.action,targetSnapshotId:r.targetSnapshotId,repositoryRoot:r.repositoryRoot,sessionId:r.sessionId,authorityId:r.authorityId,effectDisposition:"ambiguous",summary:"Retained owned execution metadata; external task completion is not inferred."};
          if (r.ownedRuntime && !await observeExit(c,r)) return {...base,state:"active"};
          if (r.status === "settled" && r.stoppedVerified === true && r.result) return {...base,state:"terminal",status:r.result.status === "completed" && r.result.exitCode === 0?"completed":r.result.status === "timed-out"?"timed_out":"failed",effectDisposition:"committed",evidenceDigest:digest([r.operationId,r.commandDigest,r.ownedRuntime,r.result]),toolVersions:{nativeGuardian:"switchyard-runtime-command/v1",manifest:`sha256:${r.manifestSha256}`},summary:"The exact owned program returned its protected native result and independently verified exit; project/task completion remains unverified."};
          if (r.ownedRuntime && r.stopRequestedAt && await guardianStopped(r.ownedRuntime)) return {...base,state:"terminal",status:"cancelled",effectDisposition:"committed",summary:"The exact owned process exited after its durable stop request. The program's prior effects and original unconfirmed outcome remain preserved."};
          return {...base,state:"terminal",status:"incomplete",effectDisposition:r.status === "not-started"?"not_started":"ambiguous"};
        }
      };
    },
    async list(c) { return ((await store.snapshot(c)).repositoryExecutions ?? []).map(r=>({operationId:r.operationId,action:r.action,supervisorId:r.supervisorId,status:r.status,stoppedVerified:r.stoppedVerified,taskCompletionVerified:false})); },
    stopCompartment,stopOperation,reconcile,
    async close() { closed=true; const results=await Promise.all([...seen].map(stopCompartment)); if(results.some(r=>!r.stopped)) throw new Error("Retained execution ownership still needs independent exit verification."); }
  };
}
