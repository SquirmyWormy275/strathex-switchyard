/** Host-only pipeline evidence over the existing exact reviewed namespace. */
import { randomBytes } from "node:crypto";
import { InMemoryTestEnvironmentBroker } from "../../packages/control-plane/src/brokers.ts";
import { createDurableAbortControl } from "../../packages/control-plane/src/execution-cancellation.ts";
import { HostReceiptEvidenceFactory } from "../../apps/windows-companion/src/receipt-evidence.ts";
import { SandboxedRepositoryExecutionBroker } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { LinuxHostValidatedRepositoryRecipeRunner } from "../../apps/linux-companion/src/linux-repository-runtime.ts";
import { scopeHash } from "./confirmations.mjs";

export async function pipelineEvidence({store,compartment,provider,policyVersion,now}) {
  const key = await store.withResourceLock("repository-execution",scopeHash(["pipeline-receipt-key",compartment]),async lease=>{
    let encoded = await store.credential(compartment,"pipeline-receipt-key",undefined,{provider});
    if(encoded === undefined || encoded === null){encoded=randomBytes(32).toString("base64");await store.credential(compartment,"pipeline-receipt-key",encoded,{provider});if(await store.credential(compartment,"pipeline-receipt-key",undefined,{provider})!==encoded)throw Error("Pipeline receipt key readback failed.");}
    lease.assert();if(typeof encoded!=="string"||!/^[A-Za-z0-9+/]{43}=$/.test(encoded))throw Error("The protected pipeline receipt key did not verify.");return Buffer.from(encoded,"base64");
  });
  try{return new HostReceiptEvidenceFactory({authenticationKey:key,policyVersion,exactVersions:{suite:"switchyard-reviewed-pipeline/v1"},clock:()=>new Date(now())});}finally{key.fill(0);}
}

export function pipelineDependencies({policy,runtime,review,target,receiptEvidence,now,resolveScannerFixtures}) {
  const metadata = new InMemoryTestEnvironmentBroker(policy);
  const recipe = {version:"switchyard-reviewed-pipeline/v1",repositoryRoot:review.repositoryRoot,gates:[{name:review.action,executable:review.recipe.executable,args:review.recipe.args,timeoutMs:review.recipe.timeoutMs}],productionHostPatterns:["prod","localhost","127.0.0.1","::1"],allowedDevelopmentHosts:[],environmentAllowlist:[]};
  return {
    recipes:{forTarget:actual=>actual.id===target.id?recipe:undefined},
    testEnvironment:{prepare:async request=>{
      const prepared=await metadata.prepare(request);
      if(!prepared.environment)return prepared;
      // Metadata only: the process always uses the exact manifest environment.
      // The real input, network and credential boundary is the namespace.
      return {...prepared,environment:{...prepared.environment,environment:{NODE_ENV:"test",SXSY_TEST_MODE:"1",SXSY_NETWORK:"deny"}}};
    }},
    execute:async request=>{
      const control=await createDurableAbortControl(request.executionControl,{fallbackDeadline:request.permit?.expiresAt});
      try {
        if(control.signal.aborted)return {status:control.reason()==="deadline"?"timed_out":control.reason()==="cancelled"?"cancelled":"unavailable",effectDisposition:"not_started",summary:"The exact pipeline was cancelled, expired or could not verify durable control before execution."};
        const resolver={resolve:async root=>{if(root!==review.repositoryRoot)throw Error("The pipeline repository changed.");return {execute:(action,options)=>runtime.execute(action,{...options,signal:control.signal})};},list:async()=>[{canonicalRepositoryRoot:review.repositoryRoot,expectedSha256:review.manifestSha256,status:"active"}]};
        const fixtures={resolve:async input=>{if(!input.scannerFixtureIds.length&&!input.advisoryFixtureIds.length)return [];if(typeof resolveScannerFixtures!=="function")throw Error("Scanner and advisory fixtures are not connected to this pipeline route.");return resolveScannerFixtures(input);}};
        const runner=new LinuxHostValidatedRepositoryRecipeRunner(resolver,receiptEvidence,fixtures,()=>new Date(now()));
        return await new SandboxedRepositoryExecutionBroker(resolver,runner).execute(request);
      } finally {control.dispose();}
    }
  };
}
