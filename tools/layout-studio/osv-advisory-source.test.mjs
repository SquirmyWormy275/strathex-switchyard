import test from "node:test";
import assert from "node:assert/strict";
import { collectOsvAdvisories, normalizeOsvRecord, osvPackageQueries } from "./osv-advisory-source.mjs";
import { scannerFixture } from "./test-support/shield-scanner-fixture.mjs";
import { parseShieldScannerReport } from "./repository-shield.mjs";
const now = () => Date.parse("2026-11-05T12:00:00.000Z"), query = { ecosystem: "npm", name: "example", version: "1.2.3" };
const record = (id = "OSV-synthetic-one") => ({ schema_version: "1.9.2", id, modified: "2026-10-01T12:00:00.123456789Z", affected: [{ package: { ecosystem: "npm", name: "example" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "2.0.0" }] }] }], details: "NEVER_COPY_UNTRUSTED_ADVISORY_TEXT", database_specific: { severity: "CRITICAL", executable: "NEVER_EXECUTE" } });
const response = (document, options = {}) => new Response(JSON.stringify(document), { status: 200, headers: { "Content-Type": "application/json" }, ...options });
test("OSV queries are exact bounded stable npm identities and independently reject fuzzy affected-version matches", () => {
  assert.deepEqual(osvPackageQueries([query]), [query]);
  for (const input of [[], [query, query], [{ ...query, url: "https://untrusted.invalid" }], [{ ...query, ecosystem: "Maven" }], [{ ...query, name: "https://untrusted.invalid" }], [{ ...query, version: "1.2" }], [{ ...query, version: "v1.2.3" }], [{ ...query, version: "01.2.3" }], [{ ...query, version: "1.2.3-beta.1" }], [{ ...query, version: "1.2.3+build" }]]) assert.throws(() => osvPackageQueries(input));
  const actual = normalizeOsvRecord(record(), query, now()); assert.equal(actual.advisory.severity, "unknown"); assert.equal(actual.evidence.affectedVersionEvidence, "stable-semver-range"); assert.equal(JSON.stringify(actual).includes("NEVER_"), false);
  for (const change of [r => r.affected[0].package.name = "another", r => r.affected[0].package.ecosystem = "PyPI", r => r.affected[0].ranges[0].events = [{ introduced: "0" }, { fixed: "1.2.3" }], r => r.affected[0].ranges[0].events = [{ introduced: "2.0.0" }], r => r.affected[0].ranges[0].events = [{ fixed: "2.0.0" }], r => r.affected[0].ranges[0].events = [{ introduced: "1.2.3" }, { fixed: "1.2.3" }], r => r.affected[0].ranges[0].events = [{ introduced: "0" }, { last_affected: "1.2.3" }], r => r.withdrawn = "2026-10-02T00:00:00Z", r => r.schema_version = "2.0.0", r => r.modified = "not-a-time", r => r.modified = "2026-02-30T00:00:00Z", r => r.id = "../bad"]) { const r = record(); change(r); assert.throws(() => normalizeOsvRecord(r, query, now())); }
  const literal = record(); literal.affected[0].versions = ["1.2.3"]; literal.affected[0].ranges = []; assert.equal(normalizeOsvRecord(literal, query, now()).evidence.affectedVersionEvidence, "literal-version");
  const multiple = record(); multiple.affected[0].ranges[0].events = [{ introduced: "1.0.0" }, { fixed: "1.2.0" }, { introduced: "1.2.3" }, { fixed: "1.3.0" }]; assert.equal(normalizeOsvRecord(multiple, query, now()).advisory.id, multiple.id);
});
test("complete pagination uses only the fixed OSV endpoint and binds public response hashes without copying descriptions, unstable severities or authority", async () => {
  const calls = [], result = await collectOsvAdvisories([query], { now, fetchImpl: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return calls.length === 1 ? response({ vulns: [record()], next_page_token: "page-two" }) : response({ vulns: [record("OSV-synthetic-two")] }); } });
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.url === "https://api.osv.dev/v1/query" && call.redirect === "error" && call.credentials === "omit" && !Object.keys(call.headers).some(key => /authorization|cookie/i.test(key)))); assert.deepEqual(calls[0].body, { package: { name: "example", ecosystem: "npm" }, version: "1.2.3" }); assert.equal(calls[1].body.page_token, "page-two");
  assert.equal(result.feed.packages[0].advisories.length, 2); assert.ok(result.feed.packages[0].advisories.every(advisory => advisory.severity === "unknown")); assert.equal(result.provenance.unsigned, true); assert.equal(result.provenance.authorityGranted, false); assert.equal(result.provenance.upstreamSignatureVerified, false); assert.equal(result.provenance.completeRepositoryCoverage, false); assert.equal(result.provenance.packages[0].pages.length, 2); assert.ok(result.provenance.packages[0].pages.every(page => /^[a-f0-9]{64}$/.test(page.responseSha256))); assert.equal(JSON.stringify(result).includes("NEVER_"), false); assert.equal(JSON.stringify(result).includes("page-two"), false);
  const empty = await collectOsvAdvisories([query], { now, fetchImpl: async () => response({}) }); assert.deepEqual(empty.feed.packages[0].advisories, []); assert.equal(empty.provenance.packages[0].pages.length, 1);
});
test("errors, incomplete/repeated pagination, duplicate findings, malformed source and oversized or ambiguous bodies produce no complete feed", async () => {
  for (const source of [() => response({ error: "untrusted" }), () => response({ vulns: [record(), record()] }), () => response({ vulns: Array.from({ length: 33 }, (_, i) => record("OSV-" + i)) }), () => response({ next_page_token: "bad token" }), () => response({ next_page_token: "same" }), () => response({}, { status: 500 }), () => response({}, { headers: { "Content-Type": "text/html" } }), () => response({}, { headers: { "Content-Type": "application/json", "Content-Length": "9999999" } }), () => new Response(Buffer.from([255]), { headers: { "Content-Type": "application/json" } }), () => response({ vulns: [{ ...record(), details: "x".repeat(512 * 1024) }] })]) await assert.rejects(collectOsvAdvisories([query], { now, fetchImpl: async () => source() }));
  let calls = 0; await assert.rejects(collectOsvAdvisories([query], { now, fetchImpl: async () => ++calls === 1 ? response({ vulns: [record()], next_page_token: "next" }) : response({}, { status: 503 }) })); assert.equal(calls, 2);
});
test("parent cancellation and bounded transport deadlines settle without producing a partial feed", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(collectOsvAdvisories([query], { now, signal: controller.signal, fetchImpl: async () => { calls++; return response({}); } }));
  assert.equal(calls, 0);
  // Fake transport has no native socket to keep the event loop alive.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(collectOsvAdvisories([query], { now, requestTimeoutMs: 50, totalTimeoutMs: 60, fetchImpl: () => new Promise(() => {}) }), /deadline|stopped/); }
  finally { clearTimeout(keepAlive); }
  assert.throws(() => normalizeOsvRecord(record(), query, Number.NaN));
  let clocks = 0; await assert.rejects(collectOsvAdvisories([query], { now: () => now() - (clocks++ ? 1 : 0), fetchImpl: async () => response({}) }), /clock|deadline/);
});
test("unassessed OSV severity remains a failing vulnerability with an explicit gap in both the real scanner and shared strict host parser", async () => {
  const collected = await collectOsvAdvisories([query], { now, fetchImpl: async () => response({ vulns: [record()] }) }), lock = JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/example": { version: "1.2.3", license: "MIT" } } }), f = scannerFixture({ action: "shield_supply_chain", files: { "package-lock.json": lock }, advisory: collected.feed.packages }), report = await f.scan();
  assert.equal(report.outcome, "failed"); assert.equal(report.findings[0].severity, "unknown"); assert.equal(report.findings[0].dimension, "vulnerabilities"); assert.ok(report.gaps.includes("advisory_severity_unassessed")); assert.equal(report.completeness, "incomplete");
  const shield = { engine: report.engine, requestSha256: report.requestSha256, request: f.request }; assert.deepEqual(parseShieldScannerReport(JSON.stringify(report), shield, f.request.action), report);
  const bad = structuredClone(report); bad.findings[0].dimension = "licenses"; assert.throws(() => parseShieldScannerReport(JSON.stringify(bad), shield, f.request.action));
});


test("PyPI queries normalize names while retaining literal PEP 440 versions and separating ecosystem identities", () => {
  const python = { ecosystem: "PyPI", name: "Example___Package.name", version: "1.2" };
  assert.deepEqual(osvPackageQueries([python]), [{ ecosystem: "PyPI", name: "example-package-name", version: "1.2" }]);
  assert.equal(osvPackageQueries([query, { ...query, ecosystem: "PyPI" }]).length, 2);
  for (const version of ["1.0rc1", "1!1.2", "2.0.post1", "01.0", "1.2.3.4.5", "1.0+local"]) assert.equal(osvPackageQueries([{ ...python, version }])[0].version, version);
  assert.throws(() => osvPackageQueries([{ ecosystem: "PyPI", name: "Foo_Bar", version: "1" }, { ecosystem: "PyPI", name: "foo-bar", version: "1.0" }]));
});

test("PyPI affected evidence supports only explicit versions or PEP 440 release ranges and never borrows an npm match", () => {
  const python = { ecosystem: "PyPI", name: "Example_Package", version: "1.2.0" }, source = record();
  source.affected = [{ package: { ecosystem: "PyPI", name: "example.package" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "1.2" }, { fixed: "1.3" }] }] }];
  const result = normalizeOsvRecord(source, python, now()); assert.equal(result.evidence.affectedVersionEvidence, "pep440-pypi-version-range"); assert.equal(result.advisory.severity, "unknown");
  for (const change of [r => { r.affected[0].package.ecosystem = "npm"; }, r => { r.affected[0].ranges[0].type = "SEMVER"; }, r => { r.affected[0].ranges[0].events = [{ introduced: "0" }, { fixed: "1.2" }]; }, r => { r.affected[0].ranges[0].events = [{ introduced: "0" }, { fixed: "2.0rcX" }]; }]) { const altered = structuredClone(source); change(altered); assert.throws(() => normalizeOsvRecord(altered, python, now())); }
  const literal = structuredClone(source); literal.affected[0].versions = [python.version]; literal.affected[0].ranges = [{ type: "GIT", repo: "https://NEVER_FETCH.invalid", events: [] }]; assert.equal(normalizeOsvRecord(literal, python, now()).evidence.affectedVersionEvidence, "literal-version");
});

test("PyPI advisory evidence orders non-final epoch boundaries and normalizes only equivalent explicit identities", () => {
  const source = record(), python = { ecosystem: "PyPI", name: "example", version: "1!1.0rc2" };
  source.affected = [{ package: { ecosystem: "PyPI", name: "example" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "1!1.0a1" }, { fixed: "1!1.0.post1" }] }] }];
  for (const version of ["1!1.0a1", "1!1.0rc2", "1!1.0+local", "1!1.0.post1.dev1"]) assert.equal(normalizeOsvRecord(source, { ...python, version }, now()).evidence.affectedVersionEvidence, "pep440-pypi-version-range");
  for (const version of ["1!1.0.dev1", "1!1.0.post1", "1!1.0.post2", "2!0", "9.99"]) assert.throws(() => normalizeOsvRecord(source, { ...python, version }, now()));
  source.affected[0].ranges = [];
  source.affected[0].versions = ["01!01.0C02"];
  assert.equal(normalizeOsvRecord(source, python, now()).evidence.affectedVersionEvidence, "pep440-version-equivalent");
  assert.throws(() => normalizeOsvRecord(source, { ...python, version: "1!1.0rc2+patched" }, now()));
  for (const pair of [["v1.0rc1", "01.0C01"], ["1+ABC-001", "01.0+abc.1"]]) assert.throws(() => osvPackageQueries(pair.map(version => ({ ...python, version }))));
  assert.equal(osvPackageQueries(["1+1", "1+abc"].map(version => ({ ...python, version }))).length, 2);
});

test("mixed public OSV transport binds each exact ecosystem and source hash without installation, credentials or inferred severity", async () => {
  const queries = [query, { ...query, ecosystem: "PyPI" }], calls = [];
  const result = await collectOsvAdvisories(queries, { now, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body }); const source = record("OSV-" + body.package.ecosystem); source.affected[0].package.ecosystem = body.package.ecosystem; source.affected[0].ranges[0].type = body.package.ecosystem === "PyPI" ? "ECOSYSTEM" : "SEMVER"; return response({ vulns: [source] });
  } });
  assert.equal(calls.length, 2); assert.deepEqual(new Set(calls.map(call => call.body.package.ecosystem)), new Set(["npm", "PyPI"])); assert.equal(result.feed.packages.length, 2); assert.equal(new Set(result.provenance.packages.map(p => p.querySha256)).size, 2); assert.ok(result.feed.packages.every(p => p.advisories[0].severity === "unknown")); assert.equal(result.provenance.authorityGranted, false); assert.equal(result.provenance.unsigned, true); assert.equal(JSON.stringify(result).includes("NEVER_"), false);
});

const highVector = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", lowVector = "CVSS:3.0/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N";
const severity = score => [{ type: "CVSS_V3", score }];
test("V2 source scores retain their own rating bands and cannot downgrade a mixed V3 critical finding", async () => {
  const source = record(), vector = "AV:N/AC:L/Au:N/C:C/I:C/A:C";
  source.severity = [{ type: "CVSS_V2", score: vector + "/E:F/RL:OF/RC:C/TD:N", source: "https://NEVER_FETCH.invalid" }];
  let result = normalizeOsvRecord(source, query, now());
  assert.equal(result.advisory.severity, "high"); assert.equal(result.evidence.cvssV2Base.maximumScore, 10); assert.equal(result.evidence.cvssV3Base, undefined);
  assert.equal(result.evidence.severityAssessment, "cvss-v2-base-calculated"); assert.equal(result.evidence.cvssV2Context.localEnvironmentVerified, false); assert.equal(result.evidence.cvssV2Context.baseSeverityReduced, false);
  assert.deepEqual(result.evidence.cvssV2Context.vectors.map(row => [row.temporalScore, row.environmentalScore]), [[8.3, 0]]);
  source.severity.push(...severity(highVector));
  result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "critical"); assert.equal(result.evidence.cvssV3Base.maximumScore, 9.8); assert.equal(result.evidence.cvssV2Base.maximumScore, 10); assert.equal(result.evidence.severityAssessment, "cvss-mixed-base-calculated");
  const collected = await collectOsvAdvisories([query], { now, fetchImpl: async () => response({ vulns: [source] }) });
  const f = scannerFixture({ action: "shield_supply_chain", files: { "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/example": { version: "1.2.3", license: "MIT" } } }) }, advisory: collected.feed.packages }), report = await f.scan();
  assert.equal(report.findings[0].severity, "critical"); assert.equal(report.outcome, "failed"); assert.equal(report.completeness, "incomplete"); assert.equal(JSON.stringify(result).includes("NEVER_FETCH"), false); assert.equal(JSON.stringify(result).includes(vector), false);
  source.severity.reverse(); assert.deepEqual(normalizeOsvRecord(source, query, now()).advisory, result.advisory);
});
test("V2 package scope, source-method mismatch, zero impact and mixed unsupported methods stay explicit", () => {
  const source = record(), row = { type: "CVSS_V2", score: "AV:N/AC:L/Au:N/C:P/I:N/A:N" };
  source.affected[0].severity = [row];
  source.affected.push({ package: { ecosystem: "PyPI", name: query.name }, versions: [query.version], severity: severity(highVector) });
  const r = normalizeOsvRecord(source, query, now()); assert.equal(r.advisory.severity, "medium"); assert.equal(r.evidence.cvssV2Base.scope, "affected-package");
  for (const entries of [[{ ...row, score: highVector }], [{ type: "CVSS_V3", score: row.score }], [row, { type: "CVSS_V4", score: highVector }], [{ ...row, score: row.score.replace("C:P", "C:N") }]]) {
    source.affected[0].severity = entries; const result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "unknown"); assert.equal(result.evidence.cvssV2Base, undefined);
  }
});
test("OSV calculates quantitative base severity only from complete supported vectors and preserves every source/algorithm hash", async () => {
  const source = record(); source.severity = [...severity(lowVector), ...severity(highVector)];
  const result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "critical"); assert.equal(result.evidence.severityAssessment, "cvss-v3-base-calculated"); assert.equal(result.evidence.cvssV3Base.maximumScore, 9.8); assert.equal(result.evidence.cvssV3Base.scope, "record"); assert.equal(result.evidence.cvssV3Base.vectors.length, 2); assert.ok(result.evidence.cvssV3Base.vectors.every(row => /^[a-f0-9]{64}$/.test(row.vectorSha256))); assert.equal(JSON.stringify(result).includes("CVSS:3."), false);
  const collected = await collectOsvAdvisories([query], { now, fetchImpl: async () => response({ vulns: [source] }) }); assert.equal(collected.provenance.collector, "switchyard-osv-collector/7");
  const f = scannerFixture({ action: "shield_supply_chain", files: { "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/example": { version: "1.2.3", license: "MIT" } } }) }, advisory: collected.feed.packages }), report = await f.scan();
  assert.equal(report.outcome, "failed"); assert.equal(report.completeness, "incomplete"); assert.equal(report.findings[0].severity, "critical"); assert.equal(report.gaps.includes("advisory_severity_unassessed"), false); assert.deepEqual(parseShieldScannerReport(JSON.stringify(report), { engine: report.engine, requestSha256: report.requestSha256, request: f.request }, f.request.action), report);
});
test("package severity cannot borrow another identity, an unaffected version or a conflicting record-wide rating", () => {
  const source = record(); source.affected[0].severity = severity(lowVector);
  source.affected.push({ package: { ecosystem: "PyPI", name: query.name }, versions: [query.version], severity: severity(highVector) });
  source.affected.push({ package: { ecosystem: "npm", name: query.name }, versions: ["99.0.0"], severity: severity(highVector) });
  let result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "low"); assert.equal(result.evidence.cvssV3Base.scope, "affected-package");
  source.severity = severity(highVector); result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "unknown"); assert.equal(result.evidence.severityReason, "ambiguous-package-and-record-severity");
  delete source.severity; source.affected.push({ package: { ...query }, versions: [query.version] }); assert.equal(normalizeOsvRecord(source, query, now()).advisory.severity, "unknown");
});
test("advisory temporal/environmental metrics remain separate evidence and cannot reduce the base severity or claim a local environment", () => {
  const source = record(); source.severity = severity(highVector + "/E:P/RL:O/RC:R/CR:H/MC:L");
  const result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "critical"); assert.equal(result.evidence.cvssV3Base.maximumScore, 9.8);
  const context = result.evidence.cvssV3Context; assert.equal(context.algorithm, "switchyard-cvss-v3-metrics/1"); assert.equal(context.localEnvironmentVerified, false); assert.equal(context.baseSeverityReduced, false); assert.equal(context.provenance, "advisory-supplied-metrics");
  assert.deepEqual(context.vectors.map(row => [row.temporalScore, row.environmentalScore]), [[8.5, 8.2]]); assert.match(context.vectors[0].vectorSha256, /^[a-f0-9]{64}$/); assert.equal(context.vectors[0].baseVectorSha256, result.evidence.cvssV3Base.vectors[0].vectorSha256);
  assert.equal(JSON.stringify(result).includes("NEVER_"), false); assert.equal(JSON.stringify(result).includes(highVector), false);
  source.severity.push(...severity(highVector), ...severity(highVector + "/E:X/CR:X")); const duplicate = normalizeOsvRecord(source, query, now()); assert.equal(duplicate.evidence.cvssV3Base.vectors.length, 1); assert.equal(duplicate.evidence.cvssV3Context.vectors.length, 1);
  source.severity = severity(highVector + "/E:X/CR:X"); assert.equal(normalizeOsvRecord(source, query, now()).evidence.cvssV3Context, undefined);
  source.severity = severity(highVector.replace(/C:H\/I:H\/A:H$/, "C:N/I:N/A:N") + "/MC:H/MI:H/MA:H"); assert.equal(normalizeOsvRecord(source, query, now()).advisory.severity, "unknown");
});
test("unsupported, zero, malformed and ambiguous severity retains an explicit unknown finding without trusting labels or arbitrary source fields", () => {
  const vectors = [undefined, [], null, {}, severity("9.8"), severity(highVector + "/E:Z"), severity(highVector.replace("3.1", "4.0")), severity(highVector.replace("A:H", "C:H")), [{ type: "CVSS_V4", score: highVector }], [...severity(highVector), { type: "CVSS_V2", score: "AV:N" }], [{ ...severity(highVector)[0], executable: "NEVER_EXECUTE" }], [{ ...severity(highVector)[0], source: {} }], Array.from({ length: 9 }, () => severity(highVector)[0]), severity("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")];
  for (const value of vectors) { const source = record(); source.severity = value; const result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "unknown"); assert.equal(result.evidence.severityAssessment, "not-performed"); assert.equal(typeof result.evidence.severityReason, "string"); assert.equal(result.evidence.cvssV3Base, undefined); assert.equal(JSON.stringify(result).includes("NEVER_"), false); }
});

const v4 = "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N";
test("V4 source context and supplemental metrics preserve a critical base finding through the real scanner", async () => {
  const source = record(), vector = v4 + "/E:U/MVC:N/MVI:N/MVA:N/S:P/U:Red";
  source.severity = [{ type: "CVSS_V4", score: vector, source: "https://NEVER_FETCH.invalid" }];
  const result = normalizeOsvRecord(source, query, now()), context = result.evidence.cvssV4Context;
  assert.equal(result.advisory.severity, "critical"); assert.equal(result.evidence.severityAssessment, "cvss-v4-base-calculated"); assert.equal(result.evidence.cvssV4Base.maximumScore, 9.3);
  assert.equal(context.localEnvironmentVerified, false); assert.equal(context.baseSeverityReduced, false); assert.equal(context.provenance, "advisory-supplied-metrics");
  assert.deepEqual(context.vectors.map(row => [row.threatScore, row.environmentalScore, row.suppliedContextScore, row.nomenclature, row.supplementalMetricsSupplied]), [[8.1, 0, 0, "CVSS-BTE", true]]);
  assert.equal(JSON.stringify(result).includes("NEVER_"), false); assert.equal(JSON.stringify(result).includes(vector), false);
  const collected = await collectOsvAdvisories([query], { now, fetchImpl: async () => response({ vulns: [source] }) });
  const f = scannerFixture({ action: "release_shield", files: { "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/example": { version: "1.2.3", license: "MIT" } } }) }, advisory: collected.feed.packages }), report = await f.scan();
  assert.equal(report.findings[0].severity, "critical"); assert.equal(report.outcome, "failed"); assert.equal(report.completeness, "incomplete"); assert.equal(report.gaps.includes("advisory_severity_unassessed"), false);
  source.severity.push({ type: "CVSS_V4", score: v4 }, { type: "CVSS_V4", score: v4 + "/E:X" }); assert.equal(normalizeOsvRecord(source, query, now()).evidence.cvssV4Base.vectors.length, 1);
});
test("V4 mixed-version ratings, source scope, zero base, malformed ordering and unsupported methods remain distinct", () => {
  const source = record(); source.affected[0].severity = [{ type: "CVSS_V4", score: v4 + "/E:U" }];
  source.affected.push({ package: { ecosystem: "PyPI", name: query.name }, versions: [query.version], severity: severity(highVector) });
  let result = normalizeOsvRecord(source, query, now()); assert.equal(result.evidence.cvssV4Base.scope, "affected-package"); assert.equal(result.evidence.cvssV3Base, undefined);
  source.affected[0].severity.push({ type: "CVSS_V2", score: "AV:N/AC:L/Au:N/C:C/I:C/A:C" });
  result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "critical"); assert.equal(result.evidence.severityAssessment, "cvss-mixed-base-calculated"); assert.equal(result.evidence.cvssV2Base.maximumScore, 10);
  for (const rows of [[{ type: "CVSS_V4", score: v4.replace("VC:H/VI:H/VA:H", "VC:N/VI:N/VA:N") + "/MVC:H" }], [{ type: "CVSS_V4", score: v4 + "/MSI:S/E:U" }], [{ type: "CVSS_V4", score: v4 }, { type: "unsupported", score: "critical" }], [{ type: "CVSS_V3", score: v4 }]]) {
    source.affected[0].severity = rows; const result = normalizeOsvRecord(source, query, now()); assert.equal(result.advisory.severity, "unknown"); assert.equal(result.evidence.cvssV4Base, undefined);
  }
  source.affected[0].severity = [{ type: "CVSS_V4", score: v4 + "/U:Red" }]; result = normalizeOsvRecord(source, query, now()); assert.equal(result.evidence.cvssV4Context.vectors[0].suppliedContextScore, undefined); assert.equal(result.evidence.cvssV4Context.vectors[0].supplementalMetricsSupplied, true);
});


test("explicit crates.io collection proves exact stable ranges and never borrows npm or private-source identities", async()=>{
 const query={ecosystem:"crates.io",name:"example",version:"1.2.3"},at=Date.parse("2026-11-06T00:00:00Z"),record={id:"RUSTSEC-synthetic-only",modified:"2026-11-05T00:00:00Z",affected:[{package:{ecosystem:"crates.io",name:"example"},ranges:[{type:"SEMVER",events:[{introduced:"1.0.0"},{fixed:"1.2.4"}]}]}]};
 assert.equal(normalizeOsvRecord(record,query,at).advisory.severity,"unknown");
 for(const changed of [{...query,ecosystem:"npm"},{...query,version:"1.2.4"},{...query,name:"Example"},{...query,version:"1.2.3-beta.01"},{...query,source:"git+ssh://private.invalid"}])assert.throws(()=>normalizeOsvRecord(record,changed,at));
 const requests=[];const result=await collectOsvAdvisories([query],{now:()=>at,fetchImpl:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({vulns:[record]}),{status:200,headers:{"Content-Type":"application/json"}});}});
 assert.equal(requests.length,1);assert.equal(requests[0].url,"https://api.osv.dev/v1/query");assert.deepEqual(requests[0].body,{package:{ecosystem:"crates.io",name:"example"},version:"1.2.3"});assert.equal(result.feed.packages[0].ecosystem,"crates.io");assert.equal(result.provenance.upstreamSignatureVerified,false);
});

test("Cargo advisory ranges compare prereleases and u64 versions exactly while build identities stay distinct", async()=>{
 const at=Date.parse("2026-11-06T00:00:00Z"),query={ecosystem:"crates.io",name:"example",version:"1.2.3-rc.2+001"};
 const record={id:"RUSTSEC-semver-synthetic",modified:"2026-11-05T00:00:00Z",affected:[{package:{ecosystem:"crates.io",name:"example"},ranges:[{type:"SEMVER",events:[{introduced:"1.2.3-rc.1"},{fixed:"1.2.3"}]}]}]};
 for(const version of ['1.2.3-rc.1','1.2.3-rc.2+001','1.2.3-rc.2+002','1.2.3-rc.99'])assert.equal(normalizeOsvRecord(record,{...query,version},at).evidence.affectedVersionEvidence,'cargo-semver-range');
 for(const version of ['1.2.3-beta.99','1.2.3','1.2.3+001','1.2.4-rc.1'])assert.throws(()=>normalizeOsvRecord(record,{...query,version},at));
 assert.deepEqual(osvPackageQueries([{...query,version:'1.2.3-rc.2+002'},query]).map(p=>p.version),['1.2.3-rc.2+001','1.2.3-rc.2+002']);
 record.affected[0].ranges[0].events=[{introduced:'18446744073709551614.0.0'},{fixed:'18446744073709551615.0.0'}];
 assert.equal(normalizeOsvRecord(record,{...query,version:'18446744073709551614.0.0'},at).evidence.affectedVersionEvidence,'cargo-semver-range');
 assert.throws(()=>normalizeOsvRecord(record,{...query,version:'18446744073709551615.0.0'},at));
 record.affected[0].ranges=[];record.affected[0].versions=[query.version];
 assert.equal(normalizeOsvRecord(record,query,at).evidence.affectedVersionEvidence,'literal-version');
 assert.throws(()=>normalizeOsvRecord(record,{...query,version:'1.2.3-rc.2+002'},at));
 const collected=await collectOsvAdvisories([query],{now:()=>at,fetchImpl:async(url,options)=>{assert.equal(JSON.parse(options.body).version,query.version);return response({vulns:[record]});}});
 assert.equal(collected.feed.packages[0].version,query.version);assert.equal(collected.provenance.collector,'switchyard-osv-collector/7');
 const fixture=scannerFixture({action:'shield_supply_chain',files:{'Cargo.lock':'version = 4\n[[package]]\nname = "example"\nversion = "'+query.version+'"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "'+'a'.repeat(64)+'"\n'},advisory:collected.feed.packages});
 const report=await fixture.scan();assert.equal(report.outcome,'failed');assert.equal(report.findings[0].ruleId,record.id);
 assert.deepEqual(parseShieldScannerReport(JSON.stringify(report),{engine:report.engine,requestSha256:report.requestSha256,request:fixture.request},fixture.request.action),report);
});
