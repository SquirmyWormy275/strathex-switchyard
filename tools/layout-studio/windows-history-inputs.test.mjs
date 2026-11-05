import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {buildWindowsHistoryPacket,windowsHistoryRequest,windowsHistoryRawLimit,windowsHistoryRequestLimit} from "./windows-history-inputs.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function fixture({sizes=[24],algorithm="sha1",name="app.js"}={}){
 const rows=sizes.map((size,i)=>{const bytes=Buffer.alloc(size,i+1),row={commit:String.fromCharCode(97+i).repeat(algorithm==="sha1"?40:64),path:name,mode:"100644",objectId:createHash(algorithm).update(`blob ${size}\0`).update(bytes).digest("hex"),size,sha256:sha(bytes)};return{row,bytes,path:".switchyard-history/"+row.commit+"/"+name};});return{action:"shield_codebase_audit",historyWitness:{source:"git-history",head:rows[0].row.commit,paths:[name],requestedDepth:4,historyMetadataSha256:"b".repeat(64),stopping:{kind:"root",nextFirstParent:null},shallow:false,rows:rows.map(item=>item.row)},historyBytes:new Map(rows.map(item=>[item.path,{bytes:item.bytes,mode:item.row.mode}])),inputFiles:rows.map(item=>({path:item.path,sha256:item.row.sha256,size:item.row.size,classification:"non-production"}))};
}
test("historical Windows packets preserve separate commit versions, exact raw blob identities and private byte hashes in both Git formats",()=>{
 for(const algorithm of ["sha1","sha256"]){const f=fixture({sizes:[0,24],algorithm}),packet=buildWindowsHistoryPacket(f),native=windowsHistoryRequest({schema:"synthetic",inputFiles:f.inputFiles},packet);assert.equal(packet.files.length,2);assert.deepEqual(packet.witness,f.historyWitness);assert.equal(native.packetSha256,sha(JSON.stringify(packet)));assert.equal(native.witnessSha256,sha(JSON.stringify(f.historyWitness)));assert.equal(packet.files[1].contentBase64,f.historyBytes.get(f.inputFiles[1].path).bytes.toString("base64"));assert.ok(Buffer.byteLength(native.text)<windowsHistoryRequestLimit);}
});
test("historical Windows packets reject general actions, malformed ancestry metadata, unowned aliases, duplicate rows and altered bytes",()=>{
 for(const action of ["run_target","pipeline_local_gate","shield_change_scan","shield_supply_chain"])assert.throws(()=>buildWindowsHistoryPacket({...fixture(),action}));
 for(const change of [f=>f.historyBytes.clear(),f=>{f.historyWitness.rows[0].commit="HEAD";},f=>{f.historyWitness.rows[0].objectId="c".repeat(40);},f=>{f.historyWitness.rows[0].mode="120000";},f=>{f.historyWitness.rows[0].path="../foreign";},f=>{f.historyWitness.requestedDepth=7;},f=>{f.historyWitness.stopping.kind="depth";},f=>{f.historyWitness.stopping.nextFirstParent="c".repeat(40);},f=>{f.historyWitness.paths=[".switchyard-index/app.js"];},f=>{f.historyWitness.rows.push(f.historyWitness.rows[0]);},f=>{f.inputFiles[0].path="unowned.js";},f=>{f.historyBytes.get(f.inputFiles[0].path).bytes[0]^=1;},f=>{f.inputFiles.push({path:".switchyard-index/app.js",sha256:sha(""),size:0,classification:"non-production"});},f=>{f.historyWitness.command="invented";}]){const f=fixture({sizes:[24,25]});change(f);assert.throws(()=>buildWindowsHistoryPacket(f));}
});
test("historical Windows bytes retain the 320 KiB subset and the complete encoded stdin limit stays 512 KiB",()=>{
 const f=fixture({sizes:[256*1024,windowsHistoryRawLimit-256*1024]}),packet=buildWindowsHistoryPacket(f);assert.ok(Buffer.byteLength(windowsHistoryRequest({inputFiles:f.inputFiles},packet).text)<windowsHistoryRequestLimit);assert.throws(()=>buildWindowsHistoryPacket(fixture({sizes:[256*1024+1]})));assert.throws(()=>buildWindowsHistoryPacket(fixture({sizes:[256*1024,windowsHistoryRawLimit-256*1024+1]})),/bounded encoded/);assert.throws(()=>windowsHistoryRequest({metadata:"x".repeat(windowsHistoryRequestLimit)},packet),/original 512 KiB/);for(const key of ["historyInputs","indexInputs"])assert.throws(()=>windowsHistoryRequest({[key]:packet},packet),/newly constructed/);
});

test("native history verifier refuses a non-disposable environment before selecting its helper or creating a proof root",()=>{
  const script=fileURLToPath(new URL("../../scripts/verify-windows-history-native.mjs",import.meta.url)),env={GITHUB_ACTIONS:"false",RUNNER_OS:"Windows",NODE_NO_WARNINGS:"1",...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})},result=spawnSync(process.execPath,["--experimental-transform-types",script,"--synthetic","--helper=Z:\\unselected\\Switchyard.Hotkeys.exe"],{env,encoding:"utf8",timeout:5000,maxBuffer:32768});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.equal(result.stdout,"");assert.match(result.stderr,/Use the disposable Windows CI history proof/);
});
