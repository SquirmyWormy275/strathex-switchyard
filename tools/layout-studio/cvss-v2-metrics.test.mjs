import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cvssV2Metrics } from "./cvss-v2-metrics.mjs";
import { cvssV2Cases } from "../../scripts/test-support/cvss-v2-cases.mjs";

test("CVSS 2 numeric scores and native rating bands retain an independent decimal-reference digest", () => {
  const oracle = JSON.parse(readFileSync(new URL("../../scripts/fixtures/cvss-v2-oracle.json", import.meta.url))), digest = createHash("sha256"), cohorts = {};
  for (const { cohort, vector } of cvssV2Cases(oracle.environmentalRepresentatives)) {
    const r = cvssV2Metrics(vector);
    digest.update(JSON.stringify([cohort, vector, Math.round(r.baseScore * 10), r.temporalSupplied ? Math.round(r.temporalScore * 10) : null, r.environmentalSupplied ? Math.round(r.environmentalScore * 10) : null, r.severity]) + "\n");
    cohorts[cohort] = (cohorts[cohort] ?? 0) + 1;
  }
  assert.deepEqual(cohorts, oracle.cohorts); assert.equal(digest.digest("hex"), oracle.resultSha256);
});

const base = "AV:N/AC:L/Au:N/C:C/I:C/A:C";
test("published FIRST examples retain base severity despite lower supplied context, defaults and arbitrary metric order", () => {
  const examples = [
    ["AV:N/AC:L/Au:N/C:N/I:N/A:C/E:F/RL:OF/RC:C/CR:M/IR:M/AR:H/CDP:H/TD:H", [7.8, 6.4, 9.2]],
    [base + "/E:F/RL:OF/RC:C", [10, 8.3]],
    ["AV:L/AC:H/Au:N/C:C/I:C/A:C/E:POC/RL:OF/RC:C", [6.2, 4.9]],
  ];
  for (const [vector, expected] of examples) {
    const r = cvssV2Metrics(vector); assert.deepEqual([r.baseScore, r.temporalScore, r.environmentalScore].slice(0, expected.length), expected);
    assert.deepEqual(cvssV2Metrics(vector.split("/").reverse().join("/")), r);
  }
  assert.equal(cvssV2Metrics(base).severity, "high");
  assert.equal(cvssV2Metrics(base).temporalSupplied, false); assert.equal(cvssV2Metrics(base).environmentalSupplied, false);
  assert.deepEqual(cvssV2Metrics(base + "/E:ND/RL:ND/RC:ND/CDP:ND/TD:ND/CR:ND/IR:ND/AR:ND"), cvssV2Metrics(base));
  assert.equal(cvssV2Metrics(base + "/TD:N").environmentalScore, 0); assert.equal(cvssV2Metrics(base + "/TD:N").baseScore, 10);
});

test("V2 refuses incomplete, ambiguous, mis-versioned and oversized source vectors", () => {
  for (const vector of [null, {}, 10, "", base + "\n", base + "\r", "(" + base + ")", "CVSS:2.0/" + base, "10/" + base, base.replace("Au:N", "AU:N"), base.toLowerCase(), base.replace("/A:C", ""), base + "/C:C", base + "/E:X", base + "/E:P", base + "/RL:O", base + "/CR:N", base + "/TD:ND/TD:H", base + "/URL:H", base + "/CR:H".repeat(25)]) assert.throws(() => cvssV2Metrics(vector));
});
