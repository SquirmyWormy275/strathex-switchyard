import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectSourceHaptics } from "./haptic-capabilities.mjs";
import { createSuite } from "./suite.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { compileDeviceKey } from "./vial-keycodes.mjs";
import sourceManifest, { decodeCatalogSource } from "./catalog-source.mjs";
import { gzipSync } from "node:zlib";
test("catalog provenance encodings retain every field and reject corrupt or oversized compressed data", async () => {
  const raw = await readFile(new URL("../../third_party/model-f-catalog/SOURCES.json", import.meta.url));
  assert.deepEqual(sourceManifest, JSON.parse(raw)); assert.deepEqual(decodeCatalogSource(gzipSync(raw), "gzip-json/v1"), sourceManifest);
  assert.throws(() => decodeCatalogSource(gzipSync(raw), "json/v1")); assert.throws(() => decodeCatalogSource(raw, "gzip-json/v1"));
  assert.throws(() => decodeCatalogSource(gzipSync(Buffer.alloc(1024 * 1024 + 1)), "gzip-json/v1"));
  assert.throws(() => decodeCatalogSource(Buffer.alloc(1024 * 1024 + 1), "json/v1")); assert.throws(() => decodeCatalogSource(raw, "unknown"));
  const corrupt = gzipSync(raw); corrupt[corrupt.length - 8] ^= 1; assert.throws(() => decodeCatalogSource(corrupt, "gzip-json/v1"));
});
const catalog=JSON.parse(await readFile(new URL("./model-f-catalog.json",import.meta.url),"utf8"));
const snapshot=(id="wcass:f77",vialProtocol=4)=>{const d=catalog.definitions[id];return{schema:"switchyard-device-snapshot/v1",capturedAt:new Date().toISOString(),identity:{deviceId:"a".repeat(64),keyboardId:d.firmwareIdentity.keyboardId,viaProtocol:9,vialProtocol},definition:structuredClone(d.definition),rows:d.definition.matrix.rows,cols:d.definition.matrix.cols,layoutOptions:0};};

test("exact F77 source declarations remain distinct from live state, fitted hardware, timing and control authority",()=>{
  for(const[id,protocol]of[["wcass:f77",4],["leyden:f77:vial",6]]){const s=snapshot(id,protocol),before=JSON.stringify(s),result=inspectSourceHaptics(catalog,s);assert.equal(result.sourceSupport,"declared-solenoid");assert.equal(result.source.definitionId,id);assert.match(result.source.sha256,/^[a-f0-9]{64}$/);assert.equal(result.firmwareAuthenticated,false);assert.equal(result.physicalHardwareVerified,false);assert.equal(result.electricalLimitsVerified,false);assert.equal(result.timingLimits,"unverified");assert.equal(result.liveState,"unavailable");assert.equal(result.controlAvailability,"unavailable");assert.deepEqual(result.allowedOperations,[]);assert.equal(result.hidTransactions,0);assert.equal(JSON.stringify(s),before);assert.equal(result.protocolAudit.provenance,"pinned-source-review");assert.equal(result.protocolAudit.definitionId,id);assert.equal(result.protocolAudit.commit,result.source.commit);assert.equal(result.protocolAudit.stateQuery,"not-exposed-in-audited-source");assert.equal(result.protocolAudit.control,"not-exposed-in-audited-source");assert.equal(result.protocolAudit.files.length,id==="wcass:f77"?10:16);for(const file of result.protocolAudit.files){assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.match(file.gitBlobSha,/^[a-f0-9]{40}$/);}result.protocolAudit.files[0].sha256="changed";assert.notEqual(inspectSourceHaptics(catalog,s).protocolAudit.files[0].sha256,"changed");result.source.commit="changed";assert.notEqual(inspectSourceHaptics(catalog,s).source.commit,"changed");}
});
test("unknown, conflicting or wrong-protocol source identities and caller-authored capabilities cannot enable haptics",()=>{
  const changed=snapshot();changed.definition.name+=" changed";const unknown=snapshot();unknown.identity.keyboardId="ffffffffffffffff";
  for(const s of[changed,unknown,snapshot("wcass:f77",6),snapshot("leyden:f77:vial",4),snapshot("wcass:f62",4),{identity:{protocol:"original-xwhatsit-0.9"}},null]){const result=inspectSourceHaptics(catalog,s);assert.equal(result.sourceSupport,"unverified");assert.equal(result.source,null);assert.equal(result.protocolAudit,null);assert.deepEqual(result.allowedOperations,[]);}
  const forged=snapshot();forged.haptics={protocolAudit:{control:"enabled"},liveState:"enabled",electricalLimitsVerified:true,allowedOperations:["set-dwell","fire"]};const result=inspectSourceHaptics(catalog,forged);assert.equal(result.liveState,"unavailable");assert.equal(result.protocolAudit.control,"not-exposed-in-audited-source");assert.equal(result.electricalLimitsVerified,false);assert.deepEqual(result.allowedOperations,[]);
  forged.haptics=result;for(const code of[0x5ce7,0x5ce9,0x5cf2,{kind:"haptic-enable"},{kind:"haptic-toggle"},{kind:"haptic-dwell",value:1}])assert.throws(()=>compileDeviceKey(forged,code),/prohibited|exceeds/);
});
test("protected historical F77 identification reports source support without opening HID, changing profiles or crossing compartments",async()=>{
  const root=await mkdtemp(join(tmpdir(),"sx-haptics-")),keys=new Map(),store=createSuiteStore({root,secrets:{get:async(c,p)=>keys.get(c+p),set:async(c,p,v)=>keys.set(c+p,v)}});let calls=0;const suite=createSuite({store,devices:{read(){calls++;throw Error("Unexpected HID access");}},agents:{close(){}},voice:{discovery:async()=>({available:false})}});
  try{await store.initialize("personal");await store.initialize("work","work");const s=snapshot();s.capturedAt="2000-01-01T00:00:00.000Z";await store.update("personal","synthetic-readout",state=>{state.deviceSnapshots=[s];});const before=await store.snapshot("personal"),result=await suite.handle("/api/suite/devices/identify",{deviceId:s.identity.deviceId,haptics:{enable:true}});assert.equal(result.haptics.sourceSupport,"declared-solenoid");assert.equal(result.snapshotStatus,"historical-readout");assert.equal(result.applied,false);assert.equal(calls,0);assert.deepEqual((await store.snapshot("personal")).deviceSnapshots,before.deviceSnapshots);assert.equal((await store.snapshot("personal")).profile,null);assert.equal((await store.snapshot("personal")).mode,"keyboard-only");await assert.rejects(suite.handle("/api/suite/devices/identify",{compartment:"work",deviceId:s.identity.deviceId}),/Read this exact device/);}finally{await suite.close();await rm(root,{recursive:true,force:true});}
});
