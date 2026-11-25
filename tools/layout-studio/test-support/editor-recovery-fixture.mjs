/** Synthetic crash fixture only. No installed CLI, native account or model. */
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomUUID,createHash } from 'node:crypto';
import { join } from 'node:path';
import { createSuiteStore } from '../suite-store.mjs';
import { createCodingEditorAuthorizations } from '../coding-editor-authorizations.mjs';
import { createCodingEditorConnections } from '../coding-editor-connections.mjs';
import { openOwnedCodexListener } from '../codex-owned-listener.mjs';
const input=createInterface({input:process.stdin}),[line]=await once(input,'line'),config=JSON.parse(line);input.close();
const provider=await openOwnedCodexListener({executable:process.execPath,cwd:config.providerRoot,runtimeRoot:config.providerRoot}),control=await provider.connect();
const store=createSuiteStore({root:join(config.root,'state'),secrets:{get:async()=>Buffer.alloc(32,23).toString('base64'),set:async()=>{throw Error('The fixed synthetic key must exist.');}}});
await store.initialize('personal');await store.update('personal','fixture',s=>{s.mode='personal-companion';});
const selected={requestId:randomUUID(),editorId:randomUUID(),ownerRequestId:randomUUID(),loadRequestId:randomUUID()};
const target={schema:'switchyard-codex-editor-target/v1',ownerRequestId:selected.ownerRequestId,loadRequestId:selected.loadRequestId,taskId:randomUUID(),sessionId:randomUUID(),repositoryRoot:'/synthetic/repository',repositoryIdentity:{device:'1',inode:'2'},accountFingerprint:provider.accountFingerprint,permissions:'read-only/on-request',endpoint:await provider.inspectBinding()};
const owners={async editorTarget(){await control.recheckAccount();return{target,targetDigest:createHash('sha256').update(JSON.stringify(target)).digest('hex'),metadataObserved:true,nativeLoadAcknowledged:true,nativeTaskLoaded:false,authorityGranted:false,terminalLaunched:false,ideAttached:false,modelPromptSubmitted:false,completionVerified:false};},openEditorClient:(_c,_s,options)=>provider.openEditorClient(options)};owners.editorReturnTarget=owners.editorTarget;
const authorizations=createCodingEditorAuthorizations({store,owners}),review=await authorizations.review('personal',selected),issued=await authorizations.issue('personal',{...selected,token:review.confirmation.token});await authorizations.consume('personal',{...selected,permit:issued.permit});
const connections=createCodingEditorConnections({store,owners,authorizations,root:config.socketRoot}),opened=await connections.open('personal',selected);
process.stdout.write(JSON.stringify({selected,opened,providerScope:provider.scope,providerOwnership:provider.privateOwnership})+'\n');
