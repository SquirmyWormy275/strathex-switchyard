import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createSuiteStore} from "./suite-store.mjs";
import {scopeHash} from "./confirmations.mjs";
import {createWindowsStorageSetup} from "./windows-storage-setup.mjs";
import {repositoryEffectJournal} from "./repository-effect-journal.mjs";
import {DurableBudgetManager} from "../../packages/control-plane/src/budgets.ts";
import {ReceiptLedger} from "../../packages/control-plane/src/receipts.ts";
import {once} from "node:events";
import {createSuite} from "./suite.mjs";
import {createStudioServer} from "./serve.mjs";
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),"switchyard-host-setup-")),keys=new Map(),store=createSuiteStore({root,secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>{keys.set(c+p,v);}}});await store.initialize("personal");await store.initialize("work","work");await store.update("personal","fixture",state=>{state.mode="personal-companion";});
 let time=Date.now(),calls=0,probes=0,active=true,resultStatus="completed",installed=null,absent=true,handler=async()=>{};let binding={clientSid:"S-1-5-21-1-2-3-1001",ownerScope:"a".repeat(64),helperSha256:"b".repeat(64),setupSha256:"c".repeat(64)};
 const native={identity:async(context={})=>{probes++;await context.check?.();return structuredClone(binding);},observe:async(b,context={})=>{probes++;await context.check?.();return installed?{status:"bootstrap-ready",...installed,protocolVerified:true,nativeRecordId:randomUUID()}:{status:"unavailable",installationAbsentVerified:absent,nativeRecordId:randomUUID()};},
  perform:async(input,context)=>{
   await handler("before-ready");await context.check();const row=(await store.snapshot("personal")).windowsStorageReviews.find(row=>row.installationId===input.installationId&&row.action===input.action&&row.status==="applying");assert.equal(row.status,"applying");assert.equal((await new DurableBudgetManager(repositoryEffectJournal(store,"personal",{domain:"storage"})).list()).some(claim=>claim.operationId===row.requestId&&claim.state==="running"),true);calls++;
   if(resultStatus==="completed")installed=input.action==="install-bootstrap"?{installationId:input.installationId,serviceImageSha256:input.brokerImageSha256,ownerScope:input.binding.ownerScope}:null;
   await handler("after-effect");return {status:resultStatus,effectStarted:resultStatus!=="cancelled",nativeRecordId:randomUUID(),nativeExitVerified:true};
  },reconcile:async()=>({stopped:true}),stop:async()=>({stopped:true}),close:async()=>{}};
 const cleanup=[],create=()=>createWindowsStorageSetup({store,platform:"win32",native,isActive:async()=>active,now:()=>time}),service=create();t.after(async()=>{for(const fn of cleanup)await fn();await service.close().catch(()=>{});await rm(root,{recursive:true,force:true});});
 return {store,service,create,native,onCleanup:fn=>cleanup.push(fn),proposal:{requestId:randomUUID(),action:"install-bootstrap"},calls:()=>calls,probes:()=>probes,advance:n=>{time+=n;},active:value=>{active=value;},changeBinding:()=>{binding={...binding,helperSha256:"d".repeat(64)};},absent:value=>{absent=value;},handler:value=>{handler=value;},result:value=>{resultStatus=value;}};
}
test("exact host setup and removal use separate one-use reviews, admitted budgets and receipts without physical/provider authority",async t=>{
 const f=await fixture(t),review=await f.service.review("personal",f.proposal),input={requestId:f.proposal.requestId,token:review.confirmation.token};assert.equal(review.brokerImplemented,false);assert.equal(review.volumeOpened,false);assert.equal(review.confirmation.record.action,"configure_windows_storage");assert.equal(Object.hasOwn(review.review,"clientSid"),false);
 await assert.rejects(f.service.apply("personal",{...input,token:randomUUID()}),/approval/);assert.equal(f.calls(),0);const result=await f.service.apply("personal",input);assert.equal(result.status,"completed",JSON.stringify(result));assert.equal(result.nativeExitVerified,true);assert.ok(result.receiptId);assert.equal(f.calls(),1);assert.equal((await f.service.apply("personal",input)).receiptId,result.receiptId);assert.equal(f.calls(),1);
 const removal={requestId:randomUUID(),action:"remove-bootstrap"},removedReview=await f.service.review("personal",removal);assert.equal(removedReview.review.installationId,review.review.installationId);assert.equal((await f.service.apply("personal",{requestId:removal.requestId,token:removedReview.confirmation.token})).status,"completed");assert.equal(f.calls(),2);
 const receipts=await new ReceiptLedger(repositoryEffectJournal(f.store,"personal",{domain:"storage"})).list();assert.equal(receipts.length,2);assert.equal(receipts.every(receipt=>receipt.action==="configure_windows_storage"&&receipt.completeness==="complete"),true);
 const serialized=JSON.stringify(await f.store.snapshot("personal"));assert.equal(serialized.includes(review.confirmation.token),false);assert.equal(serialized.includes(removedReview.confirmation.token),false);
});
test("Work, keyboard-only, inactive hosts and injected path/program fields cannot obtain host setup approval",async t=>{
 const f=await fixture(t);await assert.rejects(f.service.review("work",f.proposal),/Personal/);assert.equal(f.probes(),0);
 for(const extra of [{program:"foreign"},{clientSid:"foreign"},{installationId:randomUUID()},{approved:true}])await assert.rejects(f.service.review("personal",{...f.proposal,...extra}));assert.equal(f.probes(),0);
 await f.store.update("personal","keyboard-only",state=>{state.mode="keyboard-only";});await assert.rejects(f.service.review("personal",f.proposal),/companion mode/);assert.equal(f.probes(),0);await f.store.update("personal","fixture-mode",state=>{state.mode="personal-companion";});f.active(false);await assert.rejects(f.service.review("personal",f.proposal),/Select Personal/);assert.equal(f.probes(),0);
});
test("stale images, mode changes and expired confirmations cannot start the reviewed native effect",async t=>{
 for(const change of ["image","mode","expiry"]){const f=await fixture(t),review=await f.service.review("personal",f.proposal);if(change==="image")f.changeBinding();else if(change==="mode")await f.store.update("personal","changed-mode",state=>{state.modeSelectedAt=Date.now();});else f.advance(300001);await assert.rejects(f.service.apply("personal",{requestId:f.proposal.requestId,token:review.confirmation.token}));assert.equal(f.calls(),0);}
});
test("unavailable broker metadata cannot authorize replacement of an unverified original installation",async t=>{
 const f=await fixture(t);f.absent(false);await assert.rejects(f.service.review("personal",f.proposal),/present or unverified/);assert.equal(f.calls(),0);assert.equal((await f.store.snapshot("personal")).windowsStorageReviews,undefined);
});
test("lost final row persistence recovers only a protected passing receipt without repeating native setup",async t=>{
 const f=await fixture(t),review=await f.service.review("personal",f.proposal),input={requestId:f.proposal.requestId,token:review.confirmation.token},update=f.store.update;let fault=true;f.store.update=async(...args)=>{if(fault&&args[1]==="windows-storage-result"){fault=false;throw Error("Synthetic final result loss");}return update(...args);};await assert.rejects(f.service.apply("personal",input),/final result loss/);assert.equal(f.calls(),1);
 const restarted=f.create();await restarted.recover();const result=await restarted.apply("personal",input);assert.equal(result.status,"completed");assert.equal(result.recoveredWithoutReplay,true);assert.equal(f.calls(),1);await restarted.close();
});
test("unknown elevated setup retains its budget and blocks replay or a fresh operation",async t=>{
 const f=await fixture(t);f.result("outcome-unconfirmed");const review=await f.service.review("personal",f.proposal),input={requestId:f.proposal.requestId,token:review.confirmation.token},result=await f.service.apply("personal",input);assert.equal(result.status,"incomplete");assert.equal(result.effectDisposition,"ambiguous");assert.equal((await f.service.apply("personal",input)).replayed,true);assert.equal(f.calls(),1);await f.service.recover();
 const claims=await new DurableBudgetManager(repositoryEffectJournal(f.store,"personal",{domain:"storage"})).list();assert.equal(claims.some(claim=>claim.state==="running"),true);assert.equal((await new ReceiptLedger(repositoryEffectJournal(f.store,"personal",{domain:"storage"})).list()).length,0);await assert.rejects(f.service.review("personal",{...f.proposal,requestId:randomUUID()}),/existing Windows setup/);assert.equal(f.calls(),1);
 assert.equal((await f.service.stopCompartment("personal")).stopped,false,"stopping the unprivileged guardian cannot establish an unknown elevated worker's exit");
});
test("workspace changes after a real admitted effect prevent a passing setup receipt",async t=>{
 const f=await fixture(t);f.handler(async stage=>{if(stage==="after-effect")await f.store.update("personal","changed-after-effect",state=>{state.modeSelectedAt=Date.now();});});const review=await f.service.review("personal",f.proposal),result=await f.service.apply("personal",{requestId:f.proposal.requestId,token:review.confirmation.token});assert.equal(f.calls(),1);assert.equal(result.status,"incomplete");assert.equal(result.effectDisposition,"ambiguous");assert.equal((await new ReceiptLedger(repositoryEffectJournal(f.store,"personal",{domain:"storage"})).list()).length,0);
});
test("failed atomic admission cannot request elevation or leave a partly started budget",async t=>{
 const f=await fixture(t),review=await f.service.review("personal",f.proposal),update=f.store.update;let fault=true;f.store.update=async(...args)=>{if(fault&&args[1]==="repository-effect-journal"){fault=false;throw Error("Synthetic atomic admission failure");}return update(...args);};const result=await f.service.apply("personal",{requestId:f.proposal.requestId,token:review.confirmation.token});assert.equal(result.status,"incomplete");assert.equal(result.effectDisposition,"not_started");assert.equal(result.failurePhase,"admission");assert.equal(f.calls(),0);assert.equal((await new DurableBudgetManager(repositoryEffectJournal(f.store,"personal",{domain:"storage"})).list()).length,0);
});
test("a mode change immediately before atomic receipt commit cannot publish a stale passing setup receipt",async t=>{
 const f=await fixture(t),review=await f.service.review("personal",f.proposal),update=f.store.update;let fault=true;
 f.store.update=async(...args)=>{if(fault&&f.calls()===1&&args[1]==="repository-effect-journal"){fault=false;await update("personal","synthetic-final-commit-race",state=>{state.modeSelectedAt=Date.now();});}return update(...args);};
 const result=await f.service.apply("personal",{requestId:f.proposal.requestId,token:review.confirmation.token});assert.equal(f.calls(),1);assert.equal(result.status,"incomplete");assert.equal(result.failurePhase,"receipt-recording");assert.equal((await new ReceiptLedger(repositoryEffectJournal(f.store,"personal",{domain:"storage"})).list()).length,0);
});
test("the authenticated suite exposes exact host setup review/apply while ordinary snapshots and Work cannot receive its private records",async t=>{
 const f=await fixture(t),suite=createSuite({store:f.store,storageSetup:f.service,agents:{discovery:async()=>[],close:async()=>{}},voice:{discovery:async()=>({available:false})}}),server=createStudioServer({suite,bridge:{close(){}},token:"s".repeat(43)});server.listen(0,"127.0.0.1");await once(server,"listening");f.onCleanup(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.cleanup();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 async function api(path,body={},status=200,authenticated=true){const response=await fetch(origin+"/api/suite/"+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(authenticated?{Authorization:`Bearer ${server.accessToken}`}:{})},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
 await api("bootstrap");const baseline=await api("snapshot"),definitions=value=>scopeHash([value.profile,value.workflow,value.roleBindings??[],value.mode]);
 await api("host/windows-storage/review",f.proposal,401,false);await api("host/windows-storage/review",{...f.proposal,path:"C:\\foreign"},409);const before=f.probes();await api("host/windows-storage/review",{...f.proposal,compartment:"work"},409);assert.equal(f.probes(),before);assert.equal(f.calls(),0);
 const review=await api("host/windows-storage/review",f.proposal),input={requestId:f.proposal.requestId,token:review.confirmation.token};await api("host/windows-storage/apply",{...input,approved:true},409);await api("host/windows-storage/apply",{...input,token:randomUUID()},409);const result=await api("host/windows-storage/apply",input);assert.equal(result.status,"completed");assert.equal((await api("host/windows-storage/apply",input)).receiptId,result.receiptId);assert.equal(f.calls(),1);
 await f.store.update("personal","synthetic-private-native-marker",state=>{state.windowsStorageNative=[{id:randomUUID(),privateMarker:"synthetic-private-host-ownership"}];});
 const snapshot=await api("snapshot");assert.equal(definitions(snapshot),definitions(baseline));for(const field of ["windowsStorageNative","windowsStorageReviews","windowsStorageJournal"])assert.equal(Object.hasOwn(snapshot,field),false);assert.equal(JSON.stringify(snapshot).includes("synthetic-private-host-ownership"),false);assert.equal((await api("host/windows-storage/list")).length,1);await api("host/windows-storage/list",{compartment:"work"},409);await api("host/windows-storage/inspect",{pid:12345},409);
});
