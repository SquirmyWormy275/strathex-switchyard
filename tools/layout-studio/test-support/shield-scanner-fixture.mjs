import {createHash} from "node:crypto";
import {scanShieldInputs,shieldEngineVersion} from "../shield-scanner-engine.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
export function pinnedRequirementsFixture({ action, clean = false } = {}) {
  return scannerFixture({ action, files: { "app.js": "const ordinary = 1;", "requirements.txt": "# declared metadata only\nMixed_Name==1.2.0 \\\n  --hash=sha256:" + "a".repeat(64) + "\n" }, advisory: [
    { ecosystem: "npm", name: "mixed-name", version: "1.2.0", advisories: [{ id: "GHSA-other-ecosystem", severity: "high" }] },
    { ecosystem: "PyPI", name: "mixed-name", version: "1.2.0", advisories: clean ? [] : [{ id: "PYSEC-synthetic-only", severity: "unknown" }] }
  ] });
}
export function scannerFixture({ action = "shield_change_scan", files = { "app.js": "const ordinary = 1;" }, rules, advisory } = {}) {
  const content = new Map(Object.entries(files).map(([p, b]) => [p, Buffer.isBuffer(b) ? b : Buffer.from(b)]));
  const policy = { schema: "switchyard-shield-rules/v1", version: 1, engine: shieldEngineVersion, rules: rules ?? ["secret.private-key", "secret.github-token", "secret.aws-access-key", "pii.email", "javascript.dynamic-code", "config.tls-verification-disabled", "docker.privileged", "path.request-traversal"], allowedLicenses: ["MIT", "Apache-2.0"] };
  const policyBytes = Buffer.from(JSON.stringify(policy)); content.set("rules.json", policyBytes);
  const request = { schema: "switchyard-shield-scan/v1", version: 1, action, scope: "reviewed-inputs", files: Object.keys(files).map(path => ({ path, sha256: sha(content.get(path)), size: content.get(path).length })), scanner: { id: "synthetic-scanner", path: "rules.json", sha256: sha(policyBytes) }, advisory: null };
  if (advisory) { const b = Buffer.from(JSON.stringify({ schema: "switchyard-shield-advisories/v1", version: 1, engine: shieldEngineVersion, packages: advisory })); content.set("advisory.json", b); request.advisory = { id: "synthetic-advisory", path: "advisory.json", sha256: sha(b) }; }
  const readInput = async (path, maximum) => { const b = content.get(path); if (!b || b.length > maximum) throw Error("Unreviewed or oversized read"); return b; };
  return { content, request, policy, readInput, scan: () => scanShieldInputs(request, { readInput }) };
}
