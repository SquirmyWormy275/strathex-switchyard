import {createHash} from "node:crypto";
import { npmArchiveFixture } from "./npm-archive-fixture.mjs";
import {scanShieldInputs,shieldEngineVersion} from "../shield-scanner-engine.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
export function licenseDeclarationsFixture({ action } = {}) {
  const declarations = { choice: "(MIT OR GPL-3.0-only)", required: "MIT AND GPL-3.0-only", unsupported: "MIT OR LicenseRef-private", precedence: "MIT OR Apache-2.0 AND GPL-3.0-only", excepted: "GPL-2.0-only WITH Classpath-exception-2.0", bare: "GPL-2.0-only", otherexception: "GPL-2.0-only WITH Bison-exception-2.2", exceptionchoice: "MIT OR GPL-2.0-only WITH Bison-exception-2.2" };
  Object.assign(declarations, { unknownchoice: "MIT OR Unknown-2099", unknownexception: "MIT WITH Unknown-2099", swapped: "Classpath-exception-2.0", deprecated: "GPL-2.0+" });
  return scannerFixture({ action, allowedLicenses: ["MIT", "Apache-2.0", "GPL-2.0-only WITH Classpath-exception-2.0", "MIT WITH Unknown-2099", "Classpath-exception-2.0", "GPL-2.0+"], files: { "app.js": "const ordinary = 1;", "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: Object.fromEntries(Object.entries(declarations).map(([name, license]) => ["node_modules/" + name, { version: "1.0.0", license }])) }) }, advisory: Object.keys(declarations).map(name => ({ ecosystem: "npm", name, version: "1.0.0", advisories: [] })) });
}
export function cargoLockFixture({ action, clean = false, cargoVersion = "1.2.3" } = {}) {
  const source="registry+https://github.com/rust-lang/crates.io-index";
  const template='version = 4\n[[package]]\nname = "synthetic-app"\nversion = "0.1.0"\ndependencies = ["example"]\n[[package]]\nname = "example"\nversion = "1.2.3"\nsource = "'+source+'"\nchecksum = "'+'a'.repeat(64)+'"\n[[package]]\nname = "example"\nversion = "1.2.3"\nsource = "git+ssh://private.invalid/repository#'+'b'.repeat(40)+'"\n';
  const lock=template.replaceAll("1.2.3",cargoVersion);
  return scannerFixture({action,files:{"app.js":"const ordinary = 1;","Cargo.lock":lock},advisory:[
    {ecosystem:"npm",name:"example",version:cargoVersion,advisories:[{id:"NPM-wrong-ecosystem",severity:"critical"}]},
    {ecosystem:"crates.io",name:"example",version:cargoVersion,advisories:clean?[]:[{id:"RUSTSEC-synthetic-only",severity:"unknown"}]}
  ]});
}
export function pinnedRequirementsFixture({ action, clean = false, requirementsVersion = "1.2.0", advisoryVersion = requirementsVersion, extras = "", marker = "" } = {}) {
  return scannerFixture({ action, files: { "app.js": "const ordinary = 1;", "requirements.txt": "# declared metadata only\nMixed_Name"+extras+"=="+requirementsVersion+(marker ? "; " + marker : "")+" \\\n  --hash=sha256:" + "a".repeat(64) + "\n" }, advisory: [
    { ecosystem: "npm", name: "mixed-name", version: "1.2.0", advisories: [{ id: "GHSA-other-ecosystem", severity: "high" }] },
    { ecosystem: "PyPI", name: "mixed-name", version: advisoryVersion, advisories: clean ? [] : [{ id: "PYSEC-synthetic-only", severity: "unknown" }] }
  ] });
}
export function pypiArtifactFixture({ action = "shield_supply_chain", artifactStatus = "matched", alternative = 0, marker = "" } = {}) {
  // Synthetic raw bytes only; neither payload is a valid wheel/archive.
  const variants = [Buffer.from([0x50, 0x4b, 0, 0, 0x50, 0x59, 0x30]), Buffer.from([0x50, 0x4b, 0, 0, 0x50, 0x59, 0x31])], selected = Buffer.from(variants[alternative]);
  if (artifactStatus === "mismatched") selected[6] ^= 4;
  const version = "1!02.0rc1.post2.dev3+LOCAL.4", hashes = artifactStatus === "unsupported-integrity" ? "" : variants.map(bytes => " --hash=sha256:" + sha(bytes)).join("");
  const f = scannerFixture({ action, files: { "app.js": "const ordinary = 1;", "requirements.txt": "Mixed_Name==" + version + (marker ? "; " + marker : "") + hashes + "\n", "reviewed-package.whl": selected }, advisory: [{ ecosystem: "PyPI", name: "mixed-name", version, advisories: [] }] });
  f.request.packageArtifacts = [{ ecosystem: "PyPI", requirementsPath: "requirements.txt", name: "mixed-name", version, path: "reviewed-package.whl" }];
  return f;
}
export function cargoArtifactFixture({ action = "shield_supply_chain", artifactStatus = "matched", source = "registry+https://github.com/rust-lang/crates.io-index", cargoVersion = "1.2.3-rc.1+build.7" } = {}) {
  // Deliberately synthetic raw bytes, not a valid archive or publisher assertion.
  const original = Buffer.from([0x1f, 0x8b, 0, 0, 0x43, 0x41, 0x52, 0x47]), selected = Buffer.from(original);
  if (artifactStatus === "mismatched") selected[7] ^= 1;
  const lock = 'version = 4\n[[package]]\nname = "example"\nversion = ' + JSON.stringify(cargoVersion) + '\nsource = ' + JSON.stringify(source) + '\n' + (source.startsWith("registry+") ? 'checksum = "' + sha(original) + '"\n' : "");
  const f = scannerFixture({ action, files: { "app.js": "const ordinary = 1;", "Cargo.lock": lock, "reviewed-package.crate": selected }, advisory: [{ ecosystem: "crates.io", name: "example", version: cargoVersion, advisories: [] }] });
  f.request.packageArtifacts = [{ ecosystem: "Cargo", lockPath: "Cargo.lock", name: "example", version: cargoVersion, sourceSha256: sha(source), path: "reviewed-package.crate" }];
  return f;
}
export function npmArtifactFixture({ action = "shield_supply_chain", artifactStatus = "matched", archiveStatus } = {}) {
  const original = archiveStatus ? npmArchiveFixture({ name: archiveStatus === "mismatched" ? "different" : "synthetic", malformed: archiveStatus === "unsupported" }) : Buffer.from([0x1f, 0x8b, 0, 0, 0x53, 0x58, 0x53, 0x59]);
  const selected = Buffer.from(original); if (artifactStatus === "mismatched") selected[7] ^= 1;
  const integrity = artifactStatus === "unsupported-integrity" ? "sha256-" + createHash("sha256").update(original).digest("base64") : "sha512-" + createHash("sha512").update(original).digest("base64");
  const f = scannerFixture({ action, files: { "app.js": "const ordinary = 1;", "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/synthetic": { version: "1.0.0", license: "MIT", resolved: "https://registry.npmjs.org/synthetic/-/synthetic-1.0.0.tgz", integrity } } }), "reviewed-package.tgz": selected }, advisory: [{ ecosystem: "npm", name: "synthetic", version: "1.0.0", advisories: [] }] });
  f.request.packageArtifacts = [{ lockPath: "package-lock.json", location: "node_modules/synthetic", path: "reviewed-package.tgz" }];
  return f;
}
export function scannerFixture({ action = "shield_change_scan", files = { "app.js": "const ordinary = 1;" }, rules, advisory, allowedLicenses = ["MIT", "Apache-2.0"] } = {}) {
  const content = new Map(Object.entries(files).map(([p, b]) => [p, Buffer.isBuffer(b) ? b : Buffer.from(b)]));
  const policy = { schema: "switchyard-shield-rules/v1", version: 1, engine: shieldEngineVersion, rules: rules ?? ["secret.private-key", "secret.github-token", "secret.aws-access-key", "pii.email", "javascript.dynamic-code", "config.tls-verification-disabled", "docker.privileged", "path.request-traversal"], allowedLicenses };
  const policyBytes = Buffer.from(JSON.stringify(policy)); content.set("rules.json", policyBytes);
  const request = { schema: "switchyard-shield-scan/v1", version: 1, action, scope: "reviewed-inputs", files: Object.keys(files).map(path => ({ path, sha256: sha(content.get(path)), size: content.get(path).length })), scanner: { id: "synthetic-scanner", path: "rules.json", sha256: sha(policyBytes) }, advisory: null };
  if (advisory) { const b = Buffer.from(JSON.stringify({ schema: "switchyard-shield-advisories/v1", version: 1, engine: shieldEngineVersion, packages: advisory })); content.set("advisory.json", b); request.advisory = { id: "synthetic-advisory", path: "advisory.json", sha256: sha(b) }; }
  const readInput = async (path, maximum) => { const b = content.get(path); if (!b || b.length > maximum) throw Error("Unreviewed or oversized read"); return b; };
  return { content, request, policy, readInput, scan: () => scanShieldInputs(request, { readInput }) };
}
