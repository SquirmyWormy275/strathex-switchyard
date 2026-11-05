import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {writeFile,readFile} from "node:fs/promises";
import {join} from "node:path";
import {authorityFixture} from "./task-authority-fixture.mjs";
import {createRepositoryExecution} from "../repository-execution.mjs";
import {connectedExecutionActions} from "../repository-execution-actions.mjs";
import {createScannerFixtures} from "../scanner-fixtures.mjs";
import {createScannerAuthority,signScannerFixture} from "../../../scripts/b122-scanner-fixture.mjs";
const sha=value=>createHash("sha256").update(value).digest("hex");

export async function fixture(t,{action="pipeline_local_gate",report="complete",hold=false,signedFeeds=false}={}){
 const f=await authorityFixture(t,{executionActions:connectedExecutionActions("linux")});
 let fixtures, signingKeyPath;
 if(signedFeeds){
  fixtures=createScannerFixtures({store:f.store,stateDirectory:join(f.stage,"signed-fixtures")});f.onCleanup(()=>fixtures.close());
  const authority=await createScannerAuthority({outputDirectory:join(f.stage,"fixture-authority"),authorityId:"synthetic-pipeline-authority",allowedKinds:["scanner","advisory"],expiresAt:new Date(Date.now()+86400000).toISOString()});signingKeyPath=authority.privateKeyPath;
  const perform=async(action,payload)=>{const r=await fixtures.review("personal",{requestId:randomUUID(),action,...payload});const result=await fixtures.apply("personal",{requestId:r.review.requestId,token:r.confirmation.token});assert.equal(result.status,"completed");};
  await perform("install-trust",{policy:JSON.parse(await readFile(authority.trustPolicyPath,"utf8"))});
  const contentPath=join(f.stage,"synthetic-feed.bin");await writeFile(contentPath,"synthetic signed fixture definitions");
  for(const kind of["scanner","advisory"]){const id="synthetic-"+kind,outputDirectory=join(f.stage,id);await signScannerFixture({...authority,contentPath,outputDirectory,id,kind,feedVersion:"synthetic-feed-v1",toolName:"synthetic-fixture-tool",toolVersion:"1.0.0",expiresAt:new Date(Date.now()+3600000).toISOString(),maximumAgeSeconds:3600});await perform("install-fixture",{manifestPath:join(outputDirectory,"manifest.json")});}
 }

 let acknowledgeReady;const nativeReady=new Promise(resolve=>{acknowledgeReady=resolve;}),update=f.store.update;
 f.store.update=async(...args)=>{const result=await update(...args);if(args[1]==="repository-execution-ready")acknowledgeReady();return result;};
 const dimensions=["correctness",...(action==="pipeline_clean_reproduction"?["reproduction"]:[]),"isolation","production_data","ambient_credentials"],body={schema:"sxsy-b122.linux-repository-recipe-result",version:1,coverage:dimensions.map(dimension=>({dimension,status:report==="unavailable"&&dimension==="correctness"?"unavailable":"covered",fixtureId:"approved:synthetic-program"})),scannerFixtureIds:signedFeeds?["synthetic-scanner"]:[],advisoryFixtureIds:signedFeeds?["synthetic-advisory"]:[]};
 const program=`import assert from 'node:assert/strict';import{readFile,writeFile,access}from'node:fs/promises';import net from'node:net';
 ${signedFeeds?`await assert.rejects(access(${JSON.stringify(signingKeyPath)}));`:""}
 assert.equal(await readFile('input.txt','utf8'),'reviewed non-production input');assert.equal(process.env.HOME,undefined);assert.equal(process.env.NODE_ENV,'test');await assert.rejects(access(${JSON.stringify(join(f.root,"task.txt"))}));await assert.rejects(writeFile('input.txt','forbidden'));await writeFile('/tmp/pipeline-output','temporary');
 await new Promise((resolve,reject)=>{const s=net.connect(443,'1.1.1.1');s.once('error',()=>{s.destroy();resolve();});s.once('connect',()=>{s.destroy();reject(Error('Unexpected network'));});s.setTimeout(1000,()=>{s.destroy();reject(Error('Unconfirmed network denial'));});});
 ${hold?"setInterval(()=>{},1000);":report==="malformed"?"process.stdout.write('untyped program output');":`process.stdout.write(${JSON.stringify(JSON.stringify(body))});`}`;
 await writeFile(join(f.root,"program.mjs"),program);await writeFile(join(f.root,"input.txt"),"reviewed non-production input");
 const inputs=[["program.mjs",program],["input.txt","reviewed non-production input"]].map(([path,bytes])=>({path,sha256:sha(bytes),size:Buffer.byteLength(bytes),classification:"non-production"}));
 const manifest={schema:"sxsy-b122.repository-runtime",version:1,repositoryRoot:f.root,allowedHttpsUrls:[],recipes:{[action]:{kind:"process",executable:process.execPath,args:["program.mjs"],cwd:".",environment:{NODE_ENV:"test"},lifecycle:"foreground",isolation:"disposable",timeoutMs:hold?15000:5000,maxOutputBytes:8192,inputFiles:inputs}}};
 const bytes=JSON.stringify(manifest);await writeFile(join(f.root,"pipeline.json"),bytes);
 const grantInput={...f.proposed,paths:["task.txt","program.mjs","input.txt","pipeline.json"],classifications:{includedUntracked:["program.mjs","input.txt","pipeline.json"]},actions:[action]},approval=await f.service.review("personal",grantInput),grant=await f.service.issue("personal",{...grantInput,token:approval.confirmation.token});
 const execution=createRepositoryExecution({store:f.store,authority:f.service,stateDirectory:join(f.stage,"execution"),...(fixtures?{resolveScannerFixtures:(c,input)=>fixtures.resolve(c,input)}:{})});f.onCleanup(()=>execution.close());
 return {...f,fixtures,fixtureDirectory:join(f.stage,"signed-fixtures"),execution,grant,grantInput,nativeReady,proposed:{requestId:randomUUID(),authorityId:grant.id,manifestPath:"pipeline.json",manifestSha256:sha(bytes),action}};
}
export async function awaitNativeReady(f,running){await Promise.race([f.nativeReady,running.then(result=>{throw Error(`The pipeline returned ${result.status} before durable native readiness.`);})]);assert.equal((await f.store.snapshot("personal")).repositoryExecutions?.[0]?.status,"running");}

