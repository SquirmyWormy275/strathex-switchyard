import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { ustarFixture } from "./npm-archive-fixture.mjs";
import { cargoArtifactFixture } from "./shield-scanner-fixture.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
export const cargoManifest = '[package]\nname = "example"\nversion = "1.2.3-rc.1+build.7"\n';
export const cargoRoot = "example-1.2.3-rc.1+build.7";
export const cargoQuotedMetadata = `[package.metadata.'build.system']
'labels' = ['quoted', "", 'quoted']
[target.'cfg(target_arch = "wasm32")'.dependencies.thing]
version = '1'
`;
export const crate = (text = cargoManifest, entries = [], directory = cargoRoot) => gzipSync(ustarFixture([{ path: directory + "/Cargo.toml", content: text }, ...entries]));
export function cargoArchiveFixture({ action = "shield_supply_chain", text = cargoManifest, entries = [], directory = cargoRoot, artifactStatus = "matched", archiveStatus } = {}) {
  if (archiveStatus === "mismatched") { text = cargoManifest.replace("build.7", "build.8"); directory = cargoRoot.replace("build.7", "build.8"); }
  if (archiveStatus === "unsupported") text = cargoManifest + '[dependencies]\nthing = { version = "1" }\n';
  if (["matched", "mismatched"].includes(archiveStatus)) text += cargoQuotedMetadata;
  const f = cargoArtifactFixture({ action, artifactStatus }), bytes = crate(text, entries, directory), original = f.content.get("Cargo.lock").toString();
  const lock = Buffer.from(original.replace(/checksum = "[a-f0-9]{64}"/, 'checksum = "' + (artifactStatus === "matched" ? sha(bytes) : "b".repeat(64)) + '"'));
  for (const [path, content] of [["Cargo.lock", lock], ["reviewed-package.crate", bytes]]) { f.content.set(path, content); Object.assign(f.request.files.find(r => r.path === path), { size: content.length, sha256: sha(content) }); }
  return f;
}
