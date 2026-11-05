import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./task-authority-fixture.mjs";
import { createRepositoryExecution } from "../repository-execution.mjs";
import { createScannerFixtures } from "../scanner-fixtures.mjs";
import { createScannerAuthority, signScannerFixture } from "../../../scripts/b122-scanner-fixture.mjs";
import { scannerFixture } from "./shield-scanner-fixture.mjs";
import { connectedExecutionActions } from "../repository-execution-actions.mjs";
import { scopeHash } from "../confirmations.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");

// Real task/Git/crypto/kernel boundaries; the Windows guest runner is doubled.
export async function windowsExecutionFixture(t, { action = "run_target", pipelineReport = "complete", signedFeeds = false, shield = false, clean = false, resolveScannerFixtures } = {}) {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("win32") }), prerequisites = { helperSha256: "c".repeat(64), recipeRuntime: { path: "C:\\owned\\node.exe", sha256: "b".repeat(64) }, nodeVersion: "24.14.0" };
  const sample=shield?scannerFixture({action,files:{"app.js":clean?"const ordinary=1;":"-----BEGIN PRIVATE KEY-----\neval(untrusted);","package-lock.json":JSON.stringify({lockfileVersion:3,packages:{"node_modules/synthetic":{version:"1.0.0",license:"MIT"}}})},advisory:[{ecosystem:"npm",name:"synthetic",version:"1.0.0",advisories:clean?[]:[{id:"GHSA-synthetic-only",severity:"high"}]}]}):undefined;
  if(sample)sample.content.set("request.json",Buffer.from(JSON.stringify(sample.request)));
  const program=shield?await readFile(new URL("../shield-scanner-engine.mjs",import.meta.url)):Buffer.from("process.stdout.write('synthetic Windows recipe')"),catalog=Buffer.from(JSON.stringify({schema:"sxsy-b122.windows-sandbox-catalog",version:1,recipes:[{id:action,executable:"C:\\B122\\tools\\node.exe",executableSha256:prerequisites.recipeRuntime.sha256,arguments:shield?["{INPUT_ROOT}\\program.mjs","request.json"]:["{INPUT_ROOT}\\program.mjs"],workingRoot:shield?"input":"work",workingDirectory:".",environment:action==="run_target"?{}:{NODE_ENV:"test"},timeoutMs:5000,maxOutputBytes:shield?524288:4096,artifacts:[]}]}));
  const input = (path, bytes) => ({ path, sha256: sha(bytes), size: bytes.length, classification: "non-production" });
  const bytes = Buffer.from(JSON.stringify({ schema: "switchyard-windows-reviewed-run/v1", version: 1, recipeId: action, catalogPath: "guest.json", catalogSha256: sha(catalog), inputFiles: [input("program.mjs", program), input("guest.json", catalog),...(sample?[...sample.content].map(([path,b])=>input(path,b)):[])] }));
  for (const [path, body] of [["run.json",bytes],["guest.json",catalog],["program.mjs",program],...(sample?[...sample.content]:[])]) await writeFile(join(f.root,path),body);
  const grantInput = { ...f.proposed, paths: ["task.txt", "run.json", "guest.json", "program.mjs",...(sample?[...sample.content.keys()]:[])], classifications: { includedUntracked: ["run.json", "guest.json", "program.mjs",...(sample?[...sample.content.keys()]:[])] }, actions: [action] }, approved = await f.service.review("personal",grantInput), grant = await f.service.issue("personal",{...grantInput,token:approved.confirmation.token});
  let fixtures, fixtureResolver = resolveScannerFixtures;
  if (signedFeeds||shield) {
    fixtures = createScannerFixtures({ store: f.store, stateDirectory: join(f.stage, "signed-fixtures"), now: f.now }); f.onCleanup(() => fixtures.close());
    fixtureResolver = (c, input) => fixtures.resolve(c, input);
    const authority = await createScannerAuthority({ outputDirectory: join(f.stage, "authority"), authorityId: "synthetic-windows-pipeline", allowedKinds: ["scanner", "advisory"], expiresAt: new Date(f.now() + 86400000).toISOString(), now: new Date(f.now()) });
    const perform = async (action, payload) => { const r = await fixtures.review("personal", { requestId: randomUUID(), action, ...payload }); assert.equal((await fixtures.apply("personal", { requestId: r.review.requestId, token: r.confirmation.token })).status, "completed"); };
    await perform("install-trust", { policy: JSON.parse(await readFile(authority.trustPolicyPath, "utf8")) });
    for (const kind of ["scanner", "advisory"]) { const contentPath=join(f.stage,kind+"-feed.bin");await writeFile(contentPath,sample?sample.content.get(sample.request[kind].path):"synthetic Windows pipeline feed");const outputDirectory = join(f.stage, kind + "-feed"); await signScannerFixture({ ...authority, contentPath, outputDirectory, id: "synthetic-" + kind, kind, feedVersion: "synthetic-v1", toolName: shield?"switchyard-baseline-scanner":"synthetic-tool", toolVersion: "1", expiresAt: new Date(f.now() + 3600000).toISOString(), maximumAgeSeconds: 3600, now: new Date(f.now()) }); await perform("install-fixture", { manifestPath: join(outputDirectory, "manifest.json") }); }
  }
  let stopHook=async()=>undefined;let stopRequests=0;let effects=0,hold=false,artifacts=false,backendStatus="completed",entered;const waiting=new Map(),entry=new Promise(resolve=>{entered=resolve;});
  const runner = {
    prerequisites:async()=>structuredClone(prerequisites),recover:async()=>({cleaned:true}),list:async c=>(await f.store.snapshot(c)).repositoryWindowsRuns??[],
    run:async(c,context,plan,guard,signal,expectedAction)=>{
      assert.equal(expectedAction,action);
      await guard();const state=await f.store.snapshot(c),review=state.repositoryExecutionReviews.find(row=>row.operationId===context.operationId);
      assert.equal(review.checkpoint.digest,scopeHash(review.checkpoint.payload));assert.equal(review.engine,"windows-sandbox");assert.equal(review.scopeDigest,context.scopeDigest);assert.equal(context.provider,"codex");assert.equal(plan.manifestSha256,sha(bytes));assert.ok(state.repositoryExecutionJournal.some(event=>event.kind==="checkpoint.created"));effects++;
      await f.store.update(c,"synthetic-Windows-native-ready",state=>{(state.repositoryWindowsRuns??=[]).push({schema:"switchyard-windows-reviewed-runner/v1",...context,action,planDigest:scopeHash(plan),status:"executing",cleanupPending:true});});entered();
      let cancelled=false;if(hold)await new Promise(resolve=>{waiting.set(context.operationId,()=>{cancelled=true;resolve();});signal.addEventListener("abort",()=>{cancelled=true;resolve();},{once:true});if(signal.aborted){cancelled=true;resolve();}});waiting.delete(context.operationId);
      const result={status:cancelled?"cancelled":backendStatus,summary:"Synthetic Windows backend result",receiptPath:join(f.stage,"synthetic-windows-receipt.json")};
      if(artifacts || action !== "run_target"){
        const root=join(f.stage,"execution","windows",c,"results",context.operationId,"sandbox-11111111-2222-4333-8444-555555555555");await mkdir(root,{recursive:true});result[backendStatus==="failed"?"diagnosticRoot":"resultRoot"]=root;result.programExitCode=backendStatus==="failed"?7:0;result.validatedOutputs=[];result.resultManifestSha256="e".repeat(64);result.recipeCatalogSha256=sha(catalog);result.sandboxHelperSha256=prerequisites.helperSha256;
        const report = { schema: "sxsy-b122.windows-repository-recipe-result", version: 1, coverage: ["correctness", ...(action === "pipeline_clean_reproduction" ? ["reproduction"] : []), "isolation", "production_data", "ambient_credentials"].map(dimension => ({ dimension, status: pipelineReport === "unavailable" && dimension === "correctness" ? "unavailable" : "covered", fixtureId: "approved:synthetic-program" })), scannerFixtureIds: signedFeeds ? ["synthetic-scanner"] : [], advisoryFixtureIds: signedFeeds ? ["synthetic-advisory"] : [] };
        for(const [path,text] of [["process.stdout.txt", action === "run_target" ? "synthetic output\nAuthorization: Bearer synthetic-value-123456789" : pipelineReport === "malformed" ? "untyped output" : JSON.stringify(sample?await sample.scan():report)],["process.stderr.txt","synthetic diagnostic"]]){const bytes=Buffer.from(text);await writeFile(join(root,path),bytes);result.validatedOutputs.push({path,size:bytes.length,sha256:sha(bytes)});}
      }
      await f.store.update(c,"synthetic-Windows-native-result",state=>{const row=state.repositoryWindowsRuns.find(row=>row.operationId===context.operationId);row.status="settled";row.cleanupPending=false;row.nativeExitVerified=true;row.result=result;row.backendObservation=result;});return result;
    },
    stopOperation:async(_c,id)=>{stopRequests++;const override=await stopHook(id);if(override)return override;const wake=waiting.get(id);wake?.();return{accepted:Boolean(wake),stopped:Boolean(wake)};},
    stopCompartment:async()=>{for(const wake of waiting.values())wake();return{stopped:true,cleaned:true};},close:async()=>{for(const wake of waiting.values())wake();}
  };
  const services=[];const create=()=>{const execution=createRepositoryExecution({store:f.store,authority:f.service,stateDirectory:join(f.stage,"execution"),platform:"win32",windowsRunner:runner,resolveScannerFixtures:fixtureResolver,isActive:async()=>true,now:f.now});services.push(execution);return execution;};
  f.onCleanup(async()=>{for(const execution of services)await execution.close();});const execution=create(),proposed={requestId:randomUUID(),authorityId:grant.id,manifestPath:"run.json",manifestSha256:sha(bytes),action};
  return {fixtures,sample,outputs:()=>{artifacts=true;},backendStatus:value=>{backendStatus=value;},onStop:fn=>{stopHook=fn;},stopRequests:()=>stopRequests,...f,execution,create,proposed,grant,grantInput,prerequisites,effects:()=>effects,hold:()=>{hold=true;},entered:entry};
}
