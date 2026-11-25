#!/usr/bin/env node
/** Explicit, offline comparison. Reference calculator source is never shipped. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import vm from "node:vm";
import { privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { cvssV3Metrics } from "../tools/layout-studio/cvss-v3-metrics.mjs";
import { cvssV3ContextCases } from "./test-support/cvss-v3-context-cases.mjs";

const args = process.argv.slice(2);
if (args.length !== 1 || !args[0].startsWith("--reference-directory=") || !args[0].slice(22)) throw Error("Usage: node scripts/verify-cvss-context-reference.mjs --reference-directory=PRIVATE_LOCAL_DIRECTORY");
const directory = resolve(args[0].slice(22)), sha = value => createHash("sha256").update(value).digest("hex");
const reference = [["3.0", "cvsscalc30.js", "CVSS", "b67022a4162c381bd1bb52e840f9a035cca3b1b7a310e4c515474e3552b615e7"], ["3.1", "cvsscalc31.js", "CVSS31", "900a7d9c44872824bbdb0b21bc60db5b732eb09baaa45d32c298fb02a28f8350"]];
// Exact source pins are the same FIRST calculators independently checked by the
// earlier base-only proof. Reading references performs no network request.
const results = [], evidence = { schema: "switchyard-cvss-v3-context-reference/v1", success: false, officialSourceShipped: false, externalIoExposedToReference: false, results };
let failure;
try {
  for (const [version, file, global, expectedSha] of reference) {
    const path = join(directory, file), stat = await lstat(path); assert.equal(stat.isFile(), true); assert.equal(stat.isSymbolicLink(), false); assert.ok(stat.size > 0 && stat.size <= 200000);
    const source = await readFile(path); assert.equal(sha(source), expectedSha);
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(source.toString("utf8"), context, { timeout: 1000 });
    const calculator = context[global], representatives = [], innerScores = new Set(), cohorts = {}, digest = createHash("sha256");
    for (const { cohort, vector } of cvssV3ContextCases(version, representatives)) {
      const expected = calculator.calculateCVSSFromVector(vector); assert.equal(expected.success, true, vector);
      const actual = cvssV3Metrics(vector), numeric = [actual.baseScore, actual.temporalScore, actual.environmentalScore], wanted = [Number(expected.baseMetricScore), Number(expected.temporalMetricScore), Number(expected.environmentalMetricScore)];
      assert.deepEqual(numeric, wanted, vector);
      digest.update(JSON.stringify([cohort, vector, ...wanted]) + "\n"); cohorts[cohort] = (cohorts[cohort] ?? 0) + 1;
      if (cohort === "all-effective-environmental" && !innerScores.has(wanted[2])) { innerScores.add(wanted[2]); representatives.push(vector); }
    }
    const result = { version, source: `https://www.first.org/_/${file}`, sourceSha256: expectedSha, cohorts, resultSha256: digest.digest("hex"), environmentalRepresentatives: representatives };
    results.push(result); console.log(JSON.stringify({ version, cases: Object.values(cohorts).reduce((a,b) => a+b, 0), cohorts, independentlyEqual: true, resultSha256: result.resultSha256 }));
  }
  evidence.success = true;
} catch (error) { failure = error; evidence.failure = error.message; }
const root = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(root);
const receipt = join(root, `cvss-v3-context-reference-${Date.now()}.json`); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt, success: evidence.success, failure: evidence.failure ?? null })); if (failure) process.exitCode = 1;
