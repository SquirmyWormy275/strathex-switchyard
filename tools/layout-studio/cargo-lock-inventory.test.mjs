import test from 'node:test';
import assert from 'node:assert/strict';
import {scannerFixture,cargoLockFixture} from './test-support/shield-scanner-fixture.mjs';
import {parseShieldScannerReport} from './repository-shield.mjs';
import {createHash} from 'node:crypto';
import {parseCargoVersion,compareCargoVersions,parseCargoLock,cargoPublicSource,cargoIdentity,cratesIoIdentity,validateCargoComponent,cargoCycloneDxComponent} from './shield-scanner-engine.mjs';
const packageText=(source=cargoPublicSource)=>`[[package]]\nname = "example"\nversion = "1.2.3"\nsource = ${JSON.stringify(source)}\n${source.startsWith('registry+')?'checksum = "'+'a'.repeat(64)+'"\n':''}`;
test('Cargo 3/4 declarations preserve source distinctions and keep private Git identities out of the BOM',()=>{
 for(const version of [3,4]){
  const text=`# Cargo-generated shape\nversion = ${version}\n[[package]]\nname = "local_app"\nversion = "0.1.0"\ndependencies = [\n "example", # selected declaration\n]\n${packageText()}\n${packageText('git+ssh://private.invalid/repo#'+'b'.repeat(40))}`;
  const rows=parseCargoLock(text);assert.deepEqual(rows.map(r=>r.sourceKind),['local','crates.io','git']);assert.equal(new Set(rows.map(r=>JSON.stringify([r.name,r.version,r.sourceSha256]))).size,3);
  const bom=rows.map(row=>cargoCycloneDxComponent({...row,lockPath:'Cargo.lock'}));assert.equal(bom[1].purl,'pkg:cargo/example@1.2.3');assert.equal(bom[2].purl,undefined);assert.equal(bom[1].hashes,undefined);assert.equal(JSON.stringify(bom).includes('private.invalid'),false);assert.equal(new Set(bom.map(r=>r['bom-ref'])).size,3);
 }
});
test('ambiguous keys, tables, strings, lists, duplicate package sources and unfinished input refuse the entire Cargo inventory',()=>{
 const valid='version = 4\n'+packageText();
 for(const text of [valid+'name = "replacement"\n',valid+'[metadata]\n',valid+packageText(),valid.replace('version = 4','version = 5'),valid.replace('name = "example"','name = \'example\''),valid+'dependencies = [\n "unfinished",\n',valid+'dependencies = ["a" "b"]\n',valid+'dependencies = ["a", "a"]\n',valid.replace('example','example\\/invalid'),valid.replace('1.2.3','1.2.3-beta.01'),valid.replace('a'.repeat(64),'invalid')])assert.throws(()=>parseCargoLock(text));
});
test('Cargo identity is bounded and independent of public registry identity',()=>{
 assert.deepEqual(cargoIdentity('Local_Crate','18446744073709551615.0.0'),{name:'Local_Crate',version:'18446744073709551615.0.0'});
 for(const [name,version] of [['name','18446744073709551616.0.0'],['name','01.2.3'],['name','1.2'],['../name','1.2.3'],['name','1.2.3+build..part']])assert.throws(()=>cargoIdentity(name,version));
 assert.throws(()=>cratesIoIdentity('Local_Crate','1.2.3'));assert.equal(cratesIoIdentity('normal-crate','1.2.3').ecosystem,'crates.io');
});
test('closed Cargo components cannot promote private sources, declared checksums or unrelated paths',()=>{
 const component={...parseCargoLock('version = 4\n'+packageText())[0],lockPath:'nested/Cargo.lock'};assert.equal(validateCargoComponent(component),component);
 for(const change of [{sourceKind:'git'},{sourceSha256:'b'.repeat(64)},{lockPath:'../Cargo.lock'},{lockPath:'/Cargo.lock'},{lockPath:'package-lock.json'},{verified:true},{dependenciesSha256:null},{declaredSha256:null}])assert.throws(()=>validateCargoComponent({...component,...change}));
});
test('Cargo size and count bounds refuse without any package resolution or I/O',()=>{
 for(const text of ['version = 4\n'+'#'.repeat(8193),'version = 4\n'+'\n'.repeat(32768),'version = 4\n'+packageText()+'dependencies = ['+Array.from({length:4097},(_,i)=>'"d'+i+'"').join(',')+']','version = 4\n'+packageText()+'\x00'])assert.throws(()=>parseCargoLock(text));
});

test('Cargo rejects non-TOML whitespace, controls, surrogate escapes and empty source declarations', () => {
  const valid = 'version = 4\n' + packageText();
  for (const text of [
    valid.replace('version = 4', 'version\u00a0= 4'),
    valid + '# invalid comment\x7f\n',
    valid + 'dependencies = ["\\ud800"]\n',
    valid + 'dependencies = ["\\ud800\\udc00"]\n',
    valid + 'dependencies = ["\ud800"]\n',
    'version = 4\n' + packageText('git+'),
    'version = 4\n' + packageText('registry+')
  ]) assert.throws(() => parseCargoLock(text));
  assert.equal(parseCargoLock(valid + 'dependencies = ["\\u0061"]\n').length, 1);
});


test('Cargo feeds match only exact public registry identities and host validation reconstructs the declared BOM',async()=>{
 const f=cargoLockFixture({action:'shield_supply_chain'}),r=await f.scan();assert.equal(r.sbom.components.length,3);assert.deepEqual(r.findings.map(x=>x.ruleId),['RUSTSEC-synthetic-only']);assert.equal(r.outcome,'failed');assert.equal(r.completeness,'incomplete');assert.equal(JSON.stringify(r).includes('private.invalid'),false);
 for(const gap of ['cargo_resolution_not_performed','license_metadata','package_source_or_integrity','publisher_provenance_not_verified','advisory_severity_unassessed'])assert.ok(r.gaps.includes(gap));
 const shield={engine:r.engine,requestSha256:createHash('sha256').update(JSON.stringify(f.request)).digest('hex'),request:f.request};assert.deepEqual(parseShieldScannerReport(JSON.stringify(r),shield,f.request.action),r);
 for(const change of [r=>{r.sbom.components[2].sourceKind='crates.io';},r=>{r.cycloneDx.components[2].purl='pkg:cargo/example@1.2.3';},r=>{r.sbom.components[1].declaredSha256=null;},r=>{r.sbom.components.push(r.sbom.components[1]);}]){const changed=structuredClone(r);change(changed);assert.throws(()=>parseShieldScannerReport(JSON.stringify(changed),shield,f.request.action));}
});
test('unsupported Cargo syntax returns no partial inventory and a clean selected feed stays incomplete',async()=>{
 const invalid=await scannerFixture({action:'release_shield',files:{'Cargo.lock':'version = 4\n'+packageText()+'[unsupported]\n'}}).scan();assert.equal(invalid.sbom.components.length,0);assert.ok(invalid.gaps.includes('unsupported_cargo_lock'));
 const clean=await cargoLockFixture({action:'release_shield',clean:true}).scan();assert.equal(clean.outcome,'incomplete');assert.equal(clean.findings.length,0);assert.equal(clean.cycloneDx.compositions[0].aggregate,'unknown');
});

test('Cargo SemVer preserves literal prerelease/build identity while comparing precedence without build metadata',()=>{
 const ordered=['1.0.0-alpha','1.0.0-alpha.1','1.0.0-alpha.beta','1.0.0-beta','1.0.0-beta.2','1.0.0-beta.11','1.0.0-rc.1','1.0.0'];
 for(let i=0;i<ordered.length;i++)for(let j=0;j<ordered.length;j++)assert.equal(compareCargoVersions(ordered[i],ordered[j]),Math.sign(i-j));
 for(const [a,b] of [['1.0.0-9007199254740992','1.0.0-9007199254740993'],['18446744073709551614.0.0','18446744073709551615.0.0'],['1.0.0-999999999999999999999999999','1.0.0-1000000000000000000000000000'],['1.0.0-A','1.0.0-a']])assert.equal(compareCargoVersions(a,b),-1);
 assert.equal(compareCargoVersions('1.2.3-rc.2+001','1.2.3-rc.2+different'),0);
 const lock='version = 4\n'+packageText().replace('1.2.3','1.2.3-rc.2+001')+packageText().replace('1.2.3','1.2.3-rc.2+002');
 const components=parseCargoLock(lock).map(c=>cargoCycloneDxComponent({...c,lockPath:'Cargo.lock'}));
 assert.equal(components.length,2);assert.notEqual(components[0]['bom-ref'],components[1]['bom-ref']);assert.equal(components[0].version,'1.2.3-rc.2+001');assert.equal(components[0].purl,'pkg:cargo/example@1.2.3-rc.2%2B001');
});
test('Cargo version grammar rejects malformed identifiers, overflow, whitespace and oversized declarations',()=>{
 for(const version of ['1.2.3-','1.2.3+','1.2.3-a..b','1.2.3+a..b','1.2.3-01','1.2.3-a.01','1.2.3-ä','1.2.3+a_b','1.2.3++a','v1.2.3','1.2.3\n',' 1.2.3','1.2.18446744073709551616','1.2.3+'+'a'.repeat(251)])assert.throws(()=>parseCargoVersion(version),version);
 for(const version of ['1.2.3-0','1.2.3-0a','1.2.3--','1.2.3+0001','1.2.3-a-b+0.00','1.2.3+'+'a'.repeat(250)])assert.ok(parseCargoVersion(version));
});
