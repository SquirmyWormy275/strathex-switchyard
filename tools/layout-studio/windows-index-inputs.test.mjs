import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildWindowsIndexPacket, windowsIndexRequest, windowsIndexRawLimit, windowsIndexRequestLimit } from "./windows-index-inputs.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture({ sizes = [24], algorithm = "sha1" } = {}) {
  const rows = sizes.map((size, i) => { const bytes = Buffer.alloc(size, i + 1); return { row: { path: `source-${i}.js`, mode: i % 2 ? "100755" : "100644", objectId: createHash(algorithm).update(`blob ${size}\0`).update(bytes).digest("hex"), size, sha256: sha(bytes) }, bytes }; });
  return { action: "shield_change_scan", indexWitness: { source: "git-index", head: "a".repeat(algorithm === "sha1" ? 40 : 64), indexMetadataSha256: "b".repeat(64), rows: rows.map(item => item.row) }, indexBytes: new Map(rows.map(({ row, bytes }) => [".switchyard-index/" + row.path, { bytes, mode: row.mode }])), inputFiles: rows.map(({ row }) => ({ path: ".switchyard-index/" + row.path, sha256: row.sha256, size: row.size, classification: "non-production" })) };
}
test("private Windows packet preserves exact reviewed index bytes, original object hashes and both hash formats without broadening stdin", () => {
  for(const algorithm of ["sha1","sha256"]){const f=fixture({sizes:[0,24],algorithm}),packet=buildWindowsIndexPacket(f),native=windowsIndexRequest({schema:"synthetic-base",inputFiles:f.inputFiles},packet);assert.equal(packet.files.length,2);assert.deepEqual(packet.witness,f.indexWitness);assert.equal(packet.files[1].contentBase64,Buffer.from(f.indexBytes.get(f.inputFiles[1].path).bytes).toString("base64"));assert.equal(native.packetSha256,sha(JSON.stringify(packet)));assert.equal(native.witnessSha256,sha(JSON.stringify(f.indexWitness)));assert.ok(Buffer.byteLength(native.text)<windowsIndexRequestLimit);assert.equal(f.indexBytes.get(f.inputFiles[1].path).bytes.length,24);}
});
test("private Windows packet refuses general execution, unowned aliases, missing buffers and changed bytes, modes or object witnesses", () => {
  for(const action of ["run_target","pipeline_local_gate","local_commit"])assert.throws(()=>buildWindowsIndexPacket({...fixture(),action}));
  for(const mutate of [f=>{f.indexBytes.clear();},f=>{f.inputFiles[0].sha256="c".repeat(64);},f=>{f.indexWitness.rows[0].objectId="d".repeat(40);},f=>{f.indexWitness.rows[0].mode="120000";},f=>{f.indexWitness.rows[0].path="../foreign";},f=>{f.indexWitness.rows[0].source="invented";},f=>{f.indexBytes.get(f.inputFiles[0].path).bytes[0]^=1;},f=>{f.indexBytes.set("engine.mjs",{bytes:Buffer.from("synthetic"),mode:"100644"});},f=>{f.inputFiles[0].path="unowned.js";},f=>{f.indexWitness.rows.reverse();}]){const f=fixture({sizes:[24,25]});mutate(f);assert.throws(()=>buildWindowsIndexPacket(f));}
});
test("private Windows content has its own 320 KiB transport subset and complete encoded request still fits the original 512 KiB bound", () => {
  const exact=fixture({sizes:[256*1024,windowsIndexRawLimit-256*1024]}),packet=buildWindowsIndexPacket(exact);assert.ok(Buffer.byteLength(windowsIndexRequest({inputFiles:exact.inputFiles},packet).text)<windowsIndexRequestLimit);
  assert.throws(()=>buildWindowsIndexPacket(fixture({sizes:[256*1024+1]})));assert.throws(()=>buildWindowsIndexPacket(fixture({sizes:[256*1024,windowsIndexRawLimit-256*1024+1]})),/320 KiB/);
  assert.throws(()=>windowsIndexRequest({metadata:"x".repeat(windowsIndexRequestLimit)},packet),/original 512 KiB/);assert.throws(()=>windowsIndexRequest({indexInputs:packet},packet),/newly constructed/);
});
test("native index verifier refuses a non-disposable environment before selecting its helper or creating a proof root",()=>{
  const script=fileURLToPath(new URL("../../scripts/verify-windows-index-native.mjs",import.meta.url)),env={GITHUB_ACTIONS:"false",RUNNER_OS:"Windows",NODE_NO_WARNINGS:"1",...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})},result=spawnSync(process.execPath,["--experimental-transform-types",script,"--synthetic","--helper=Z:\\unselected\\Switchyard.Hotkeys.exe"],{env,encoding:"utf8",timeout:5000,maxBuffer:32768});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.equal(result.stdout,"");assert.match(result.stderr,/Use the disposable Windows CI index proof/);
});
