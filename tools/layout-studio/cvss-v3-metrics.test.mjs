import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cvssV3Metrics } from "./cvss-v3-metrics.mjs";
import { cvssV3ContextCases } from "../../scripts/test-support/cvss-v3-context-cases.mjs";

const oracle = JSON.parse(readFileSync(new URL("../../scripts/fixtures/cvss-v3-context-oracle.json", import.meta.url)));
for (const proof of oracle.results) test(`CVSS ${proof.version} retains all 449,940 independently verified base, temporal, environmental and inheritance results`, () => {
  const digest = createHash("sha256"), cohorts = {};
  for (const { cohort, vector } of cvssV3ContextCases(proof.version, proof.environmentalRepresentatives)) {
    const result = cvssV3Metrics(vector);
    digest.update(JSON.stringify([cohort, vector, result.baseScore, result.temporalScore, result.environmentalScore]) + "\n");
    cohorts[cohort] = (cohorts[cohort] ?? 0) + 1;
  }
  assert.deepEqual(cohorts, proof.cohorts); assert.equal(digest.digest("hex"), proof.resultSha256);
});

const base = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H";
test("normalization, explicit undefined metrics and version-specific rounding retain context provenance without inferring a local environment", () => {
  const vector = base + "/E:P/RL:O/RC:R/CR:H/MC:L", result = cvssV3Metrics(vector);
  assert.deepEqual([result.baseScore, result.temporalScore, result.environmentalScore], [9.8, 8.5, 8.2]); assert.equal(result.severity, "critical");
  assert.equal(result.temporalSupplied, true); assert.equal(result.environmentalSupplied, true);
  assert.deepEqual(cvssV3Metrics("CVSS:3.1/" + vector.split("/").slice(1).reverse().join("/")), result);
  assert.deepEqual(cvssV3Metrics(base + "/E:X/CR:X/MPR:X"), cvssV3Metrics(base));
  assert.equal(cvssV3Metrics(base).temporalSupplied, false); assert.equal(cvssV3Metrics(base).environmentalSupplied, false);
  const changed = base.replace("S:U", "S:C") + "/RC:U";
  assert.equal(cvssV3Metrics(changed).temporalScore, 9.2); assert.equal(cvssV3Metrics(changed.replace("3.1", "3.0")).temporalScore, 9.3);
});

test("incomplete, duplicate, unsupported or oversized metrics refuse calculation instead of inventing requirements", () => {
  for (const vector of [null, {}, 9.8, base.toLowerCase(), base + "\n", base + "\r", base.replace("/A:H", ""), base.replace("AV:N", "AV:X"), base + "/MC:X/MC:H", base + "/E:Z", base + "/CR:N", base + "/MPR:U", base + "/URL:H", base.replace("3.1", "4.0"), base + "/CR:H".repeat(30)]) assert.throws(() => cvssV3Metrics(vector));
});

test("installed context verification rejects unreviewed or combined selections before account or application access", () => {
  const script = fileURLToPath(new URL("../../scripts/verify-shield-host.mjs", import.meta.url));
  for (const args of [["--cvss-v3-context"], ["--synthetic", "--cvss-v3-context"], ["--synthetic", "--cvss-v3-context", "--action=shield_change_scan"], ["--synthetic", "--cvss-v3-context", "--action=shield_supply_chain", "--osv-advisory"], ["--synthetic", "--cvss-v3-context", "--action=shield_supply_chain", "--pep440-requirements"], ["--synthetic", "--cvss-v3-context", "--action=shield_supply_chain", "--cvss-v3-context"]]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10000 }); assert.equal(r.error, undefined); assert.notEqual(r.status, 0); assert.equal(r.stdout, ""); assert.match(r.stderr, /Usage: node scripts\/verify-shield-host/);
  }
});
