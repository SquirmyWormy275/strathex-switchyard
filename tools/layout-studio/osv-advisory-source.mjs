/** Fixed public OSV transport. Output is unsigned data, never installed trust. */
import { createHash } from "node:crypto";
import { shieldEngineVersion } from "./shield-scanner-engine.mjs";

const endpoint = "https://api.osv.dev/v1/query", sha = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function stableVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || value.length > 32) throw Error("OSV collection currently supports exact stable npm versions only.");
  const parts = value.split(".").map(Number);
  if (parts.some(part => !Number.isSafeInteger(part) || part > 2147483647)) throw Error("OSV version exceeds its supported numeric bound.");
  return parts;
}
function compare(left, right) { for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1; return 0; }
export function osvPackageQueries(input) {
  if (!Array.isArray(input) || !input.length || input.length > 32) throw Error("Collect 1–32 explicitly named exact npm package versions.");
  const seen = new Set();
  return input.map(value => {
    if (!object(value) || Object.keys(value).sort().join() !== "ecosystem,name,version" || value.ecosystem !== "npm" || typeof value.name !== "string" || value.name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value.name)) throw Error("OSV accepts only a literal npm identity; arbitrary URLs, purls, commands and ecosystems are refused.");
    stableVersion(value.version); const key = value.name + "@" + value.version;
    if (seen.has(key)) throw Error("OSV package queries must be distinct."); seen.add(key);
    return { ecosystem: "npm", name: value.name, version: value.version };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : compare(stableVersion(a.version), stableVersion(b.version)));
}
function timestamp(value) {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error("OSV record has no supported modification timestamp.");
  if (new Date(Date.parse(value)).toISOString().slice(0, 19) !== value.slice(0, 19)) throw Error("OSV modification timestamp has an invalid calendar date.");
  return value;
}
function rangeContains(range, version) {
  if (!object(range) || range.type !== "SEMVER" || !Array.isArray(range.events) || !range.events.length || range.events.length > 128) throw Error("OSV affected-version evidence uses an unsupported range.");
  const query = stableVersion(version); let open, lastFixed, matched = false;
  for (const event of range.events) {
    if (!object(event) || Object.keys(event).length !== 1) throw Error("OSV range events are ambiguous.");
    if (Object.hasOwn(event, "introduced")) {
      if (open !== undefined) throw Error("OSV range introduces an overlapping interval.");
      const start = event.introduced === "0" ? null : stableVersion(event.introduced);
      if (lastFixed && (start === null || compare(start, lastFixed) < 0)) throw Error("OSV range intervals are not ordered.");
      open = { start };
    } else if (Object.hasOwn(event, "fixed")) {
      if (!open) throw Error("OSV range closes no introduced interval.");
      const fixed = stableVersion(event.fixed);
      if (open.start && compare(fixed, open.start) <= 0) throw Error("OSV range has an invalid fixed boundary.");
      matched ||= (!open.start || compare(query, open.start) >= 0) && compare(query, fixed) < 0;
      lastFixed = fixed; open = undefined;
    } else throw Error("OSV range boundary is unsupported; no complete feed was produced.");
  }
  if (open) matched ||= !open.start || compare(query, open.start) >= 0;
  return matched;
}
export function normalizeOsvRecord(record, query, observedAt) {
  osvPackageQueries([query]);
  if (!object(record) || typeof record.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record.id) || record.schema_version !== undefined && (typeof record.schema_version !== "string" || !/^1\.\d{1,6}\.\d{1,6}$/.test(record.schema_version)) || record.withdrawn !== undefined || !Array.isArray(record.affected) || !record.affected.length || record.affected.length > 128) throw Error("OSV record identity, version, withdrawal or affected-package contract is unsupported.");
  const modified = timestamp(record.modified);
  if (!Number.isFinite(observedAt) || Date.parse(modified) > observedAt + 300000) throw Error("OSV record modification is ahead of the bounded observation clock.");
  let proof;
  for (const affected of record.affected) {
    if (!object(affected) || affected.package?.ecosystem !== "npm" || affected.package.name !== query.name) continue;
    if (affected.versions !== undefined && (!Array.isArray(affected.versions) || affected.versions.length > 4096 || affected.versions.some(value => typeof value !== "string" || value.length > 128))) throw Error("OSV explicit version evidence exceeds its bound.");
    if (affected.versions?.includes(query.version)) { proof = "literal-version"; break; }
    if (!Array.isArray(affected.ranges) || affected.ranges.length > 32) continue;
    for (const range of affected.ranges) if (rangeContains(range, query.version)) { proof = "stable-semver-range"; break; }
    if (proof) break;
  }
  if (!proof) throw Error("OSV response did not independently establish this exact npm package/version as affected; fuzzy matches are not accepted.");
  // OSV exposes quantitative vectors. GitHub's database_specific annotations
  // are explicitly unstable; neither is silently converted to a made-up score.
  return { advisory: { id: record.id, severity: "unknown" }, evidence: { id: record.id, modified, recordSha256: sha(JSON.stringify(record)), affectedVersionEvidence: proof, severityAssessment: "not-performed" } };
}
async function bounded(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(Error("OSV collection stopped or exceeded its deadline; no complete feed was produced."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function bodyBytes(response, signal) {
  if (!response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw Error("OSV returned no supported JSON response.");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 512 * 1024)) throw Error("OSV response exceeds its byte bound.");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const part = await bounded(reader.read(), signal); if (part.done) break;
      size += part.value.byteLength; if (size > 512 * 1024) throw Error("OSV response exceeds its byte bound."); chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks);
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
export async function collectOsvAdvisories(input, { fetchImpl = globalThis.fetch, now = Date.now, signal, requestTimeoutMs = 15000, totalTimeoutMs = 60000 } = {}) {
  const queries = osvPackageQueries(input);
  if (typeof fetchImpl !== "function" || typeof now !== "function" || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 50 || requestTimeoutMs > 15000 || !Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 50 || totalTimeoutMs > 60000) throw Error("OSV collection requires bounded transport and clock ports.");
  const started = now(), startedAt = new Date(started).toISOString(), deadline = performance.now() + totalTimeoutMs, packages = [], observations = []; let requests = 0, totalBytes = 0;
  for (const query of queries) {
    const advisories = [], records = [], pages = [], ids = new Set(), tokens = new Set(); let next;
    const base = { package: { name: query.name, ecosystem: "npm" }, version: query.version };
    do {
      if (++requests > 64 || pages.length >= 8 || deadline - performance.now() < 1) throw Error("OSV collection exceeds its request/page/time bound.");
      const remaining = Math.max(1, Math.min(requestTimeoutMs, Math.floor(deadline - performance.now()))), stop = AbortSignal.any([AbortSignal.timeout(remaining), ...(signal ? [signal] : [])]);
      stop.throwIfAborted();
      const response = await bounded(fetchImpl(endpoint, { method: "POST", redirect: "error", credentials: "omit", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ ...base, ...(next ? { page_token: next } : {}) }), signal: stop }), stop);
      if (response.status !== 200 || response.redirected) { void response.body?.cancel().catch(() => {}); throw Error("OSV query did not return a direct successful response; no complete feed was produced."); }
      const bytes = await bodyBytes(response, stop); totalBytes += bytes.length;
      if (totalBytes > 4 * 1024 * 1024) throw Error("OSV aggregate response exceeds its byte bound.");
      let document; try { document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw Error("OSV returned invalid UTF-8 JSON."); }
      if (!object(document) || Object.keys(document).some(key => !["vulns", "next_page_token"].includes(key)) || document.vulns !== undefined && (!Array.isArray(document.vulns) || document.vulns.length > 32)) throw Error("OSV response shape or advisory count is unsupported.");
      pages.push({ responseSha256: sha(bytes), bytes: bytes.length });
      for (const record of document.vulns ?? []) {
        const normalized = normalizeOsvRecord(record, query, now());
        if (ids.has(normalized.advisory.id) || advisories.length >= 32) throw Error("OSV returned duplicate or excessive advisories; no partial feed was produced.");
        ids.add(normalized.advisory.id); advisories.push(normalized.advisory); records.push(normalized.evidence);
      }
      next = document.next_page_token;
      if (next !== undefined && (typeof next !== "string" || !next.length || next.length > 2048 || /[\x00-\x20\x7f]/.test(next) || tokens.has(next))) throw Error("OSV pagination is malformed or repeated; no partial feed was produced.");
      if (next) tokens.add(next);
    } while (next);
    const order = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    packages.push({ ...query, advisories: advisories.sort(order) }); observations.push({ ...query, querySha256: sha(JSON.stringify(base)), pages, records: records.sort(order) });
  }
  const finished = now();
  if (performance.now() > deadline || !Number.isFinite(finished) || finished < started || finished - started > totalTimeoutMs + 5000) throw Error("OSV collection clock or total deadline changed; no complete feed was produced.");
  const feed = { schema: "switchyard-shield-advisories/v1", version: 1, engine: shieldEngineVersion, packages };
  return { feed, provenance: { schema: "switchyard-osv-collection/v1", collector: "switchyard-osv-collector/1", normalizedFeedSha256: sha(JSON.stringify(feed)), source: endpoint, startedAt, finishedAt: new Date(finished).toISOString(), unsigned: true, upstreamSignatureVerified: false, authorityGranted: false, completeRepositoryCoverage: false, severityAssessment: "not-performed", packages: observations } };
}
