#!/usr/bin/env node
/** Offline comparison against hash-pinned FIRST source; no external I/O in the reference. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import vm from "node:vm";
import { privateDirectory, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { cvssV4Metrics } from "../tools/layout-studio/cvss-v4-metrics.mjs";
import { cvssV4Cases } from "./test-support/cvss-v4-cases.mjs";

const args = process.argv.slice(2), prefix = "--reference-directory=";
if (args.length !== 1 || !args[0].startsWith(prefix) || !args[0].slice(prefix.length)) throw Error("Usage: node scripts/verify-cvss-v4-reference.mjs --reference-directory=PRIVATE_LOCAL_DIRECTORY");
const directory = resolve(args[0].slice(prefix.length));
const hashes = {
  "cvss_score.js": "453ce6767b5c3939b51d1f21315f2649e47b5abeca674be287e94b524472a1bc",
  "cvss_lookup.js": "d533fe625d95e15b7b488a4bf93dab5f7df16b7e38b0c8ee01281d7b31a8165e",
  "max_composed.js": "be707cc82c17993a04a84e47b1a8aaa1d0d212b56852254659ce77fd7d959f63",
  "max_severity.js": "f838ecb41bfd5114456e7fa7df8a8449ca2735c176867886fa34bd011dee0b24",
  "metrics.js": "99ee2643587071bf744cd090c4bb2db58d523ed0276efd809871b00a12985a4c"
};
const evidence = { schema: "switchyard-cvss-v4-reference/v1", success: false, referenceCommit: "c5b0d409ae9f57c44264c6ce5f27d89298e1d32a", referenceSourceSha256: hashes, referenceAlgorithmShipped: false, scoringDataShippedWithAttribution: true, externalIoExposedToReference: false, cohorts: {}, resultSha256: null };
let failure;
try {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  for (const [name, hash] of Object.entries(hashes)) {
    const path = join(directory, name), stat = await lstat(path); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 131072);
    const bytes = await readFile(path); assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
    vm.runInContext(bytes.toString(), context, { timeout: 1000 });
  }
  const defaults = Object.fromEntries(Object.keys(context.expectedMetricOrder).map(key => [key, "X"])), cache = new Map(), digest = createHash("sha256");
  const reference = (metrics) => {
    const key = JSON.stringify(metrics); if (cache.has(key)) return cache.get(key);
    const value = { ...defaults, ...metrics }, result = context.cvss_score(value, context.cvssLookup_global, context.maxSeverity, context.macroVector(value));
    assert.ok(Number.isFinite(result) && result >= 0 && result <= 10);
    if (cache.size >= 2048) cache.clear(); cache.set(key, result); return result;
  };
  const started = Date.now(); let count = 0;
  for (const { cohort, vector } of cvssV4Cases()) {
    assert.ok(Date.now() - started < 900000, "The independent reference comparison exceeded its fifteen-minute bound.");
    const metrics = Object.fromEntries(vector.split("/").slice(1).map(part => part.split(":"))), basic = Object.fromEntries(Object.keys(defaults).slice(0, 11).map(key => [key, metrics[key]]));
    const wanted = [reference(basic), reference({ ...basic, E: metrics.E ?? "X" }), reference({ ...metrics, E: "X" }), reference(metrics)];
    const actual = cvssV4Metrics(vector); assert.deepEqual([actual.baseScore, actual.threatScore, actual.environmentalScore, actual.score], wanted, vector);
    digest.update(JSON.stringify([cohort, vector, ...wanted]) + "\n"); evidence.cohorts[cohort] = (evidence.cohorts[cohort] ?? 0) + 1;
    if (++count % 25000 === 0) console.log(JSON.stringify({ compared: count, elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
  }
  evidence.resultSha256 = digest.digest("hex"); evidence.success = true;
} catch (error) { failure = error; evidence.failure = error.message; }
const root = join(homedir(), ".local/state/strathex-switchyard/runtime-verification"); await privateDirectory(root);
const receipt = join(root, `cvss-v4-reference-${Date.now()}.json`); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ receipt, ...evidence })); if (failure) process.exitCode = 1;
