import { randomUUID, createHash } from "node:crypto";
import { writeFile, readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { authorityFixture } from "./task-authority-fixture.mjs";
import { createRepositoryExecution } from "../repository-execution.mjs";
import { createRepositoryExecutionSupervisors } from "../repository-execution-supervisor.mjs";
import { createRepositoryExecutionStaging } from "../repository-execution-staging.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function executionFixture(t,{native=false,hold=false,profile=false}={}) {
  const f=await authorityFixture(t,{executionActions:["run_target"],profile});
  const program="process.stdout.write('exact reviewed run output')",programPath=join(f.root,"program.mjs");await writeFile(programPath,program);
  const recipe={schema:"sxsy-b122.repository-runtime",version:1,repositoryRoot:f.root,allowedHttpsUrls:[],recipes:{run_target:{kind:"process",executable:process.execPath,args:["program.mjs"],cwd:".",environment:{},lifecycle:"managed",isolation:"disposable",timeoutMs:5000,maxOutputBytes:4096,inputFiles:[{path:"program.mjs",sha256:sha(program),size:Buffer.byteLength(program),classification:"non-production"}]}}};
  const bytes=JSON.stringify(recipe);await writeFile(join(f.root,"run.json"),bytes);
  const grantInput={...f.proposed,paths:["task.txt","program.mjs","run.json"],classifications:{includedUntracked:["program.mjs","run.json"]},actions:["run_target"]};
  const approval=await f.service.review("personal",grantInput),grant=await f.service.issue("personal",{...grantInput,token:approval.confirmation.token});
  let effects=0;const owners=new Map();
  const command=async(_exe,_args,options)=>{const owner={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:12345,birth:"1",containment:process.platform==="linux"?"owned-linux-session":"windows-job"};owners.set(owner.id,false);await options.onGuardianReady(owner);effects++;if(hold){await new Promise(resolve=>{options.signal.addEventListener("abort",resolve,{once:true});if(options.signal.aborted)resolve();});owners.set(owner.id,true);throw Error("Synthetic native cancellation lost the program result");}owners.set(owner.id,true);return {status:"completed",exitCode:0,stdout:"synthetic program output",stderr:"",inputDelivered:true,treeExitVerified:true};};
  const supervisors=native?undefined:createRepositoryExecutionSupervisors({store:f.store,command,guardianStopped:async scope=>owners.get(scope.id)===true});
  // A portable test double exercises broker contracts without claiming a Windows/Linux OS boundary.
  const staging=native?undefined:createRepositoryExecutionStaging({store:f.store,stateDirectory:join(f.stage,"execution","inputs"),guardianStopped:async scope=>owners.get(scope.id)===true,providerFactory:state=>({async prepare(input){const base=join(state,"repository-execution-roots");await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,"inputs-"));for(const file of input.inputFiles){const target=join(root,file.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(join(input.repositoryRoot,file.path)));}return {root,isolation:"disposable",protections:{productionData:"denied",ambientCredentials:"denied"},release:()=>rm(root,{recursive:true})};}})});
  const execution=createRepositoryExecution({store:f.store,authority:f.service,stateDirectory:join(f.stage,"execution"),platform:native?process.platform:"linux",now:Date.now,...(native?{}:{supervisors,staging,namespaceFactory:port=>port})});
  f.onCleanup(()=>execution.close());
  const proposed={requestId:randomUUID(),authorityId:grant.id,manifestPath:"run.json",manifestSha256:sha(bytes),action:"run_target"};
  f.timings.report("execution-ready");
  return {...f,execution,grant,grantInput,recipe,proposed,effects:()=>effects};
}
