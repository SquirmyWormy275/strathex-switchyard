import { createHash } from "node:crypto";
import oracle from "../../../scripts/fixtures/pypi-wheel-oracle.json" with { type: "json" };
import recordOracle from "../../../scripts/fixtures/pypi-wheel-record-oracle.json" with { type: "json" };
import licenseOracle from "../../../scripts/fixtures/pypi-wheel-license-oracle.json" with { type: "json" };
import { scannerFixture } from "./shield-scanner-fixture.mjs";
export const wheelOracle = oracle;
export const wheelRecordOracle = recordOracle;
export const wheelLicenseOracle = licenseOracle;
export function pypiWheelFixture({ action = "shield_supply_chain", archiveCase = "stored", pinVersion = "1.2.0", artifactStatus = "matched", marker = "" } = {}) {
  const row = [...oracle.cases, ...recordOracle.cases, ...licenseOracle.cases].find(row => row.id === archiveCase); if (!row) throw Error("Unknown synthetic wheel");
  const bytes = Buffer.from(row.bytesBase64, "base64"), digest = createHash("sha256").update(bytes).digest("hex");
  const hashes = artifactStatus === "unsupported-integrity" ? "" : " --hash=sha256:" + (artifactStatus === "matched" ? digest : "b".repeat(64));
  const f = scannerFixture({ action, files: { "app.js": "const ordinary=1;", "requirements.txt": "mixed-name==" + pinVersion + (marker ? "; " + marker : "") + hashes + "\n", "reviewed-package.whl": bytes }, advisory: [{ ecosystem: "PyPI", name: "mixed-name", version: pinVersion, advisories: [] }] });
  f.request.packageArtifacts = [{ ecosystem: "PyPI", requirementsPath: "requirements.txt", name: "mixed-name", version: pinVersion, path: "reviewed-package.whl" }];
  return f;
}
