/** Exact-target, expiring finding exceptions. These never establish scanner coverage. */
import { randomUUID } from "node:crypto";
import { redactText, untrustedSummary } from "../../packages/control-plane/src/redaction.ts";
import { linuxShieldActions } from "./repository-execution-actions.mjs";
import { scopeHash } from "./confirmations.mjs";

const granted = "shield.exception-granted/v1", revoked = "shield.exception-revoked/v1";
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === fields.slice().sort().join();
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const reference = (value, maximum = 160) => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
export function exceptionReason(value) {
  if (!reference(value, 512) || !value.trim()) throw Error("Provide one bounded single-line exception reason.");
  return untrustedSummary(redactText(value.trim()));
}
function read(entries) {
  const records = new Map();
  for (const entry of entries) {
    if (entry.kind === granted) {
      const record = entry.payload.exception;
      if (!record || !uuid(record.id) || records.has(record.id)) throw Error("Preserve a malformed or duplicate protected Shield exception.");
      if (!exact(record, ["id", "action", "targetSnapshotId", "scannerSourceSha256", "sourceReceiptId", "fingerprint", "ruleId", "path", "reason", "expiresAt", "issuedBy", "createdAt"]) || !reference(record.issuedBy) || !Number.isFinite(Date.parse(record.createdAt)) || new Date(record.createdAt).toISOString() !== record.createdAt) throw Error("Preserve malformed original exception scope or attribution.");
      const { id, issuedBy, createdAt, ...scope } = record;
      validateException(scope, Date.parse(createdAt), { minimumLifetimeMs: 1 });
      records.set(record.id, structuredClone(record));
    } else if (entry.kind === revoked) {
      const record = records.get(entry.payload.exceptionId);
      if (!record || record.revokedAt || !exact(entry.payload, ["exceptionId", "reason", "revokedBy"]) || !reference(entry.payload.revokedBy) || !reference(entry.payload.reason, 512)) throw Error("Preserve an unfamiliar or repeated Shield exception withdrawal.");
      record.revokedAt = entry.at; record.revocationReason = entry.payload.reason; record.revokedBy = entry.payload.revokedBy;
    }
  }
  return [...records.values()];
}
export function validateException(input, now = Date.now(), { minimumLifetimeMs = 60000 } = {}) {
  if (!exact(input, ["action", "targetSnapshotId", "scannerSourceSha256", "sourceReceiptId", "fingerprint", "ruleId", "path", "reason", "expiresAt"]) || !linuxShieldActions.includes(input.action) || ![input.targetSnapshotId, input.scannerSourceSha256, input.fingerprint].every(digest) || !reference(input.sourceReceiptId) || !reference(input.ruleId, 128) || !reference(input.path, 512) || input.path.startsWith("/") || /[\\:]/.test(input.path) || input.path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) throw Error("Review one exact protected Shield finding and target; broad, executable and coverage overrides are refused.");
  const expiry = Date.parse(input.expiresAt);
  if (typeof input.expiresAt !== "string" || !Number.isFinite(expiry) || new Date(expiry).toISOString() !== input.expiresAt || expiry < now + minimumLifetimeMs || expiry > now + 24 * 3600000) throw Error("Choose an exact exception expiry from one minute to twenty-four hours after review; it must remain unexpired when applied.");
  return { ...input, reason: exceptionReason(input.reason) };
}

export class ShieldExceptionLedger {
  constructor(store, { now = Date.now } = {}) { this.store = store; this.now = now; }
  async list() { return read(await this.store.readEntries()).map(record => ({ ...record, status: record.revokedAt ? "revoked" : Date.parse(record.expiresAt) <= this.now() ? "expired" : "active" })); }
  async grant(input, issuedBy, id = randomUUID()) {
    input = validateException(input, this.now(), { minimumLifetimeMs: 1 });
    if (!uuid(id) || !reference(issuedBy)) throw Error("Use the protected exception operation and operator identity.");
    return this.store.transaction(async transaction => {
      const records = read(await transaction.readEntries());
      if (records.some(record => record.id === id) || records.length >= 512 || records.filter(record => !record.revokedAt && Date.parse(record.expiresAt) > this.now()).length >= 64) throw Error("The exception identity is retained or its bounded inventory is full.");
      if (records.some(record => !record.revokedAt && Date.parse(record.expiresAt) > this.now() && ["action", "targetSnapshotId", "scannerSourceSha256", "fingerprint"].every(key => record[key] === input[key]))) throw Error("This exact finding already has an active exception; withdraw it before replacement.");
      const exception = { id, ...input, issuedBy, createdAt: new Date(this.now()).toISOString() };
      await transaction.append(granted, { exception }); return exception;
    });
  }
  async revoke(id, reason, revokedBy) {
    if (!uuid(id) || !reference(revokedBy)) throw Error("Choose one exact exception identity and operator.");
    reason = exceptionReason(reason);
    return this.store.transaction(async transaction => {
      const record = read(await transaction.readEntries()).find(record => record.id === id);
      if (!record || record.revokedAt) throw Error("The exact exception is unavailable or already withdrawn.");
      const entry = await transaction.append(revoked, { exceptionId: id, reason, revokedBy });
      return { ...record, revokedAt: entry.at, revocationReason: reason, revokedBy };
    });
  }
  async evaluate({ action, targetSnapshotId, scannerSourceSha256, findings }) {
    if (!linuxShieldActions.includes(action) || !digest(targetSnapshotId) || !digest(scannerSourceSha256) || !Array.isArray(findings) || findings.length > 512 || new Set(findings.map(finding => finding.fingerprint)).size !== findings.length || findings.some(finding => !digest(finding.fingerprint) || !reference(finding.ruleId, 128) || !reference(finding.path, 512))) throw Error("Evaluate only one exact bounded pinned-scanner report.");
    const entries = await this.store.readEntries(), records = read(entries), applied = [], remaining = [];
    for (const finding of findings) {
      const record = records.find(record => !record.revokedAt && Date.parse(record.expiresAt) > this.now() && record.action === action && record.targetSnapshotId === targetSnapshotId && record.scannerSourceSha256 === scannerSourceSha256 && record.fingerprint === finding.fingerprint && record.ruleId === finding.ruleId && record.path === finding.path);
      if (record) applied.push({ exceptionId: record.id, fingerprint: record.fingerprint, reason: record.reason, expiresAt: record.expiresAt });
      else remaining.push(finding.fingerprint);
    }
    return { schema: "switchyard-shield-exception-evaluation/v1", policyDigest: scopeHash(entries), applied, unexceptedFingerprints: remaining, allFindingsExcepted: findings.length > 0 && remaining.length === 0, completeness: "incomplete", gateEligible: false, ...(applied.length ? { expiresAt: new Date(Math.min(...applied.map(record => Date.parse(record.expiresAt)))).toISOString() } : {}) };
  }
}
