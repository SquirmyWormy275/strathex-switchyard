import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cvssV4Metrics } from "./cvss-v4-metrics.mjs";
import { cvssV4Data } from "./cvss-v4-data.mjs";
import { cvssV4Cases } from "../../scripts/test-support/cvss-v4-cases.mjs";

test("CVSS 4.0 retains independently verified base, threat, impact, requirement, modified, inheritance and supplemental results", () => {
  const oracle = JSON.parse(readFileSync(new URL("../../scripts/fixtures/cvss-v4-oracle.json", import.meta.url))), digest = createHash("sha256"), cohorts = {};
  for (const { cohort, vector } of cvssV4Cases()) {
    const r = cvssV4Metrics(vector); digest.update(JSON.stringify([cohort, vector, r.baseScore, r.threatScore, r.environmentalScore, r.score]) + "\n");
    cohorts[cohort] = (cohorts[cohort] ?? 0) + 1;
  }
  assert.equal(oracle.success, true); assert.deepEqual(cohorts, oracle.cohorts); assert.equal(digest.digest("hex"), oracle.resultSha256);
});
const baseline = "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N";
test("published examples and separate threat/environment scores preserve their base rating and explicit nomenclature", () => {
  const base = cvssV4Metrics(baseline); assert.deepEqual([base.baseScore, base.score, base.severity, base.nomenclature], [9.3, 9.3, "critical", "CVSS-B"]);
  assert.deepEqual(cvssV4Metrics(baseline + "/E:X/CR:X/MAV:X/MSI:X/U:X"), base);
  assert.equal(cvssV4Metrics(baseline + "/MAV:A").score, 8.7); assert.equal(cvssV4Metrics(baseline + "/MAV:L").score, 8.6);
  const adjusted = cvssV4Metrics(baseline + "/E:U/MVC:N/MVI:N/MVA:N");
  assert.deepEqual([adjusted.baseScore, adjusted.threatScore, adjusted.environmentalScore, adjusted.score, adjusted.nomenclature, adjusted.severity], [9.3, 8.1, 0, 0, "CVSS-BTE", "critical"]);
  assert.equal(cvssV4Metrics(baseline + "/MSI:S").score, 10);
  const supplemental = cvssV4Metrics(baseline + "/S:P/AU:Y/R:I/V:C/RE:H/U:Red"); assert.equal(supplemental.score, base.score); assert.equal(supplemental.supplementalSupplied, true); assert.equal(supplemental.nomenclature, "CVSS-B");
});
test("CVSS 4 rejects invalid ordering, missing/duplicate metrics, invalid Safety/urgency, unsupported versions and unbounded input", () => {
  for (const value of [undefined, null, {}, 10, baseline + "\n", baseline + "\r", baseline + "\0", baseline.toLowerCase(), baseline.replace("4.0", "4.1"), baseline.replace("/AT:N", ""), baseline.replace("AV:N/AC:L", "AC:L/AV:N"), baseline.replace("UI:N", "UI:R"), baseline.replace("SI:N", "SI:S"), baseline + "/E:AA", baseline + "/E:P/E:A", baseline + "/E:P/AV:N", baseline + "/MSC:S", baseline + "/MSI:Safety", baseline + "/U:red", baseline + "/URL:Red", baseline + "/E:X".repeat(40)]) assert.throws(() => cvssV4Metrics(value), undefined, String(value));
});
test("zero impact is explicit and scoring constants cannot be modified by another consumer", () => {
  const zero = cvssV4Metrics(baseline.replace("VC:H/VI:H/VA:H", "VC:N/VI:N/VA:N")); assert.equal(zero.baseScore, 0); assert.equal(zero.severity, "none");
  assert.equal(Object.keys(cvssV4Data.scores).length, 270); assert.throws(() => { cvssV4Data.scores["000000"] = 0; }); assert.throws(() => { cvssV4Data.highest.eq1[0][0] = "invalid"; });
});
