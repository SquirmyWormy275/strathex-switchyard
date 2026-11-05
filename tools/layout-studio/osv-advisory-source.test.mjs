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


test("PyPI queries normalize names while retaining exact numeric releases and separating ecosystem identities", () => {
  const python = { ecosystem: "PyPI", name: "Example___Package.name", version: "1.2" };
  assert.deepEqual(osvPackageQueries([python]), [{ ecosystem: "PyPI", name: "example-package-name", version: "1.2" }]);
  assert.equal(osvPackageQueries([query, { ...query, ecosystem: "PyPI" }]).length, 2);
  for (const version of ["1.0rc1", "1!1.2", "2.0.post1", "01.0", "1.2.3.4.5", "1.0+local"]) assert.throws(() => osvPackageQueries([{ ...python, version }]));
  assert.throws(() => osvPackageQueries([{ ecosystem: "PyPI", name: "Foo_Bar", version: "1" }, { ecosystem: "PyPI", name: "foo-bar", version: "1.0" }]));
});

test("PyPI affected evidence supports only explicit versions or numeric release ranges and never borrows an npm match", () => {
  const python = { ecosystem: "PyPI", name: "Example_Package", version: "1.2.0" }, source = record();
  source.affected = [{ package: { ecosystem: "PyPI", name: "example.package" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "1.2" }, { fixed: "1.3" }] }] }];
  const result = normalizeOsvRecord(source, python, now()); assert.equal(result.evidence.affectedVersionEvidence, "stable-pypi-release-range"); assert.equal(result.advisory.severity, "unknown");
  for (const change of [r => { r.affected[0].package.ecosystem = "npm"; }, r => { r.affected[0].ranges[0].type = "SEMVER"; }, r => { r.affected[0].ranges[0].events = [{ introduced: "0" }, { fixed: "1.2" }]; }, r => { r.affected[0].ranges[0].events = [{ introduced: "0" }, { fixed: "2.0rc1" }]; }]) { const altered = structuredClone(source); change(altered); assert.throws(() => normalizeOsvRecord(altered, python, now())); }
  const literal = structuredClone(source); literal.affected[0].versions = [python.version]; literal.affected[0].ranges = [{ type: "GIT", repo: "https://NEVER_FETCH.invalid", events: [] }]; assert.equal(normalizeOsvRecord(literal, python, now()).evidence.affectedVersionEvidence, "literal-version");
});

test("mixed public OSV transport binds each exact ecosystem and source hash without installation, credentials or inferred severity", async () => {
  const queries = [query, { ...query, ecosystem: "PyPI" }], calls = [];
  const result = await collectOsvAdvisories(queries, { now, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body }); const source = record("OSV-" + body.package.ecosystem); source.affected[0].package.ecosystem = body.package.ecosystem; source.affected[0].ranges[0].type = body.package.ecosystem === "PyPI" ? "ECOSYSTEM" : "SEMVER"; return response({ vulns: [source] });
  } });
  assert.equal(calls.length, 2); assert.deepEqual(new Set(calls.map(call => call.body.package.ecosystem)), new Set(["npm", "PyPI"])); assert.equal(result.feed.packages.length, 2); assert.equal(new Set(result.provenance.packages.map(p => p.querySha256)).size, 2); assert.ok(result.feed.packages.every(p => p.advisories[0].severity === "unknown")); assert.equal(result.provenance.authorityGranted, false); assert.equal(result.provenance.unsigned, true); assert.equal(JSON.stringify(result).includes("NEVER_"), false);
});
