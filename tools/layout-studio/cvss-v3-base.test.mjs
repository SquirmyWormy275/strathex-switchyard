import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cvssV3Base } from "./cvss-v3-base.mjs";

// Exhaustively checked against FIRST's separately downloaded calculators.
// Receipt cvss-v3-reference-1793885857563.json binds exact reference source.
const axes = { AV: "NALP", AC: "LH", PR: "NLH", UI: "NR", S: "UC", C: "HLN", I: "HLN", A: "HLN" };
for (const [version, expected] of [["3.0", "6b91d11f9a8ed3ffd9eaec3385018f2f6eaa41182f2e36b5c0ae3df1f789d0c1"], ["3.1", "4fd103d3a3ca0d93d4d612cea1c557034ee53133c59236a9af6dc823f3255d46"]]) test(`all 2,592 CVSS ${version} base combinations retain the independently verified FIRST scores and ratings`, () => {
  const rows = [];
  function visit(parts, index) {
    if (index === 8) { const vector = `CVSS:${version}/` + parts.join("/"), result = cvssV3Base(vector); rows.push([vector, result.score, result.severity]); return; }
    const key = Object.keys(axes)[index]; for (const value of axes[key]) visit([...parts, key + ":" + value], index + 1);
  }
  visit([], 0); assert.equal(rows.length, 2592); assert.equal(createHash("sha256").update(JSON.stringify(rows)).digest("hex"), expected);
});
test("base vectors normalize metric ordering and refuse unsupported groups, duplicates and invalid methods rather than inventing metrics", () => {
  const vector = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H";
  assert.equal(cvssV3Base(vector).score, 9.8);
  assert.deepEqual(cvssV3Base("CVSS:3.1/A:H/I:H/C:H/S:U/UI:N/PR:N/AC:L/AV:N"), cvssV3Base(vector));
  assert.equal(cvssV3Base("CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N").score, 3.1);
  assert.equal(cvssV3Base("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N").score, 6.4);
  for (const value of [null, 9.8, vector.replace("3.1", "4.0"), vector.replace("3.1", "3.2"), vector + "/E:X", vector + "/MAV:N", vector.replace("/A:H", ""), vector.replace("/A:H", "/C:H"), vector.replace("AV:N", "AV:X"), vector.toLowerCase(), vector + "\n", vector + "/NEVER:EXECUTE", "x".repeat(129)]) assert.throws(() => cvssV3Base(value));
});
