#!/usr/bin/env node
/** Offline independent-review tooling for SXSY-B122 acceptance evidence. */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maximumDocumentBytes = 1024 * 1024;
const maximumArtifactBytes = 16 * 1024 * 1024;
const maximumPackageBytes = 64 * 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export async function createAuthority({ outputDirectory, authorityId, allowedGates, expiresAt }) {
  const id = identifier(authorityId, "authority id");
  const gates = gateList(allowedGates);
  const expiry = futureTime(expiresAt, "authority expiry");
  const directory = resolveAbsolute(outputDirectory, "authority output directory");
  await mkdir(directory, { recursive: false });
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyId = sha256(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }));
  const policy = { schema: "sxsy-b122.acceptance-trust-policy", version: 1, authorityId: id, keyId, publicKeyPem, allowedGates: gates, expiresAt: expiry };
  await writeNew(resolve(directory, "private-key.pem"), privateKeyPem, 0o600);
  await writeNew(resolve(directory, "trust-policy.json"), `${JSON.stringify(policy, null, 2)}\n`, 0o600);
  return { authorityId: id, keyId, trustPolicyPath: resolve(directory, "trust-policy.json"), privateKeyPath: resolve(directory, "private-key.pem") };
}

export async function signEvidenceBundle({ draftPath, privateKeyPath, trustPolicyPath, outputPath }) {
  const draftFile = await concreteFile(draftPath, maximumDocumentBytes, "evidence draft");
  const trustFile = await concreteFile(trustPolicyPath, maximumDocumentBytes, "trust policy");
  const keyFile = await concreteFile(privateKeyPath, 64 * 1024, "private key");
  const draft = parseDraft(draftFile.bytes);
  const trust = parseTrust(trustFile.bytes, new Date(draft.evaluatedAt));
  if (!trust.allowedGates.includes(draft.gate)) throw new Error("The trust policy does not authorize the draft gate.");
  const privateKey = createPrivateKey(keyFile.bytes);
  const derivedPublic = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  if (sha256(derivedPublic) !== trust.keyId) throw new Error("The private key does not match the exact trust policy key.");
  const artifacts = await artifactManifest(dirname(draftFile.path), draft.artifacts);
  const unsigned = {
    schema: "sxsy-b122.acceptance-evidence-bundle", version: 1, id: draft.id, authorityId: trust.authorityId, keyId: trust.keyId,
    gate: draft.gate, status: draft.status, targetSnapshotId: draft.targetSnapshotId, operationId: draft.operationId,
    evidenceDigest: `sha256:${sha256Canonical(artifacts)}`, policyVersion: draft.policyVersion, evaluatedBy: draft.evaluatedBy,
    evaluatedAt: draft.evaluatedAt, expiresAt: draft.expiresAt, rationale: draft.rationale, artifacts,
    signatureAlgorithm: "ecdsa-p256-sha256"
  };
  const signature = sign("sha256", Buffer.from(canonical(unsigned)), privateKey).toString("base64");
  const bundle = { ...unsigned, signature };
  await writeNew(resolveAbsolute(outputPath, "evidence bundle output"), `${JSON.stringify(bundle, null, 2)}\n`, 0o600);
  return bundle;
}

export async function verifyEvidenceBundle({ bundlePath, trustPolicyPath, now = new Date() }) {
  const bundleFile = await concreteFile(bundlePath, maximumDocumentBytes, "evidence bundle");
  const trustFile = await concreteFile(trustPolicyPath, maximumDocumentBytes, "trust policy");
  const bundle = parseBundle(bundleFile.bytes, now);
  const trust = parseTrust(trustFile.bytes, now);
  if (bundle.authorityId !== trust.authorityId || bundle.keyId !== trust.keyId || !trust.allowedGates.includes(bundle.gate)) throw new Error("The bundle is outside the exact trust policy scope.");
  const { signature, ...unsigned } = bundle;
  const signatureBytes = Buffer.from(signature, "base64");
  if (signatureBytes.toString("base64") !== signature || !verify("sha256", Buffer.from(canonical(unsigned)), trust.publicKeyPem, signatureBytes)) throw new Error("The bundle signature is invalid.");
  const artifacts = await artifactManifest(dirname(bundleFile.path), bundle.artifacts.map(({ path, mediaType }) => ({ path, mediaType })));
  if (canonical(artifacts) !== canonical(bundle.artifacts) || bundle.evidenceDigest !== `sha256:${sha256Canonical(artifacts)}`) throw new Error("The bundle artifact evidence changed after signature.");
  return { valid: true, id: bundle.id, gate: bundle.gate, evidenceDigest: bundle.evidenceDigest };
}

async function artifactManifest(root, inputs) {
  const canonicalRoot = await realpath(root);
  let total = 0;
  const result = [];
  for (const input of inputs) {
    const path = safeRelative(input.path, "artifact path");
    const file = await concreteFile(resolve(canonicalRoot, path), maximumArtifactBytes, "evidence artifact");
    if (!inside(canonicalRoot, file.path)) throw new Error("Evidence artifact escaped the draft directory.");
    total += file.bytes.byteLength;
    if (total > maximumPackageBytes) throw new Error("Evidence artifacts exceed the package size bound.");
    result.push({ path: path.replaceAll("\\", "/"), sha256: sha256(file.bytes), bytes: file.bytes.byteLength, mediaType: bounded(input.mediaType, "artifact media type", 128) });
  }
  if (new Set(result.map((item) => item.path.toLowerCase())).size !== result.length) throw new Error("Evidence artifact paths are ambiguous.");
  return result;
}

function parseDraft(bytes) {
  const value = json(bytes, "evidence draft");
  const keys = ["schema", "version", "id", "gate", "status", "targetSnapshotId", "operationId", "policyVersion", "evaluatedBy", "evaluatedAt", "expiresAt", "rationale", "artifacts"];
  if (!record(value) || !exact(value, keys) || value.schema !== "sxsy-b122.acceptance-evidence-draft" || value.version !== 1 || !["passed", "failed", "unavailable", "incomplete"].includes(value.status) || !Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 64) throw new Error("Evidence draft schema is invalid.");
  const evaluatedAt = timestamp(value.evaluatedAt, "evaluation time");
  const expiresAt = timestamp(value.expiresAt, "evidence expiry");
  if (Date.parse(expiresAt) <= Date.parse(evaluatedAt) || Date.parse(expiresAt) - Date.parse(evaluatedAt) > 366 * 24 * 60 * 60_000) throw new Error("Evidence expiry is invalid.");
  return { schema: value.schema, version: 1, id: identifier(value.id, "evidence id"), gate: gate(value.gate), status: value.status, targetSnapshotId: nullableId(value.targetSnapshotId, "target snapshot"), operationId: nullableId(value.operationId, "operation id"), policyVersion: bounded(value.policyVersion, "policy version", 128), evaluatedBy: bounded(value.evaluatedBy, "evaluator", 160), evaluatedAt, expiresAt, rationale: bounded(value.rationale, "rationale", 2048), artifacts: value.artifacts.map((item) => { if (!record(item) || !exact(item, ["path", "mediaType"])) throw new Error("Draft artifact entry is invalid."); return { path: safeRelative(item.path, "artifact path"), mediaType: bounded(item.mediaType, "artifact media type", 128) }; }) };
}

function parseTrust(bytes, now) {
  const value = json(bytes, "trust policy");
  if (!record(value) || !exact(value, ["schema", "version", "authorityId", "keyId", "publicKeyPem", "allowedGates", "expiresAt"]) || value.schema !== "sxsy-b122.acceptance-trust-policy" || value.version !== 1) throw new Error("Trust policy schema is invalid.");
  const publicKeyPem = bounded(value.publicKeyPem, "public key", 16_384);
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Trust policy key must be ECDSA P-256.");
  const keyId = sha256(key.export({ type: "spki", format: "der" }));
  if (value.keyId !== keyId) throw new Error("Trust policy key ID is invalid.");
  const expiresAt = timestamp(value.expiresAt, "trust expiry");
  if (Date.parse(expiresAt) <= now.getTime()) throw new Error("Trust policy is expired.");
  return { schema: value.schema, version: 1, authorityId: identifier(value.authorityId, "authority id"), keyId, publicKeyPem, allowedGates: gateList(value.allowedGates), expiresAt };
}

function parseBundle(bytes, now) {
  const value = json(bytes, "evidence bundle");
  const keys = ["schema", "version", "id", "authorityId", "keyId", "gate", "status", "targetSnapshotId", "operationId", "evidenceDigest", "policyVersion", "evaluatedBy", "evaluatedAt", "expiresAt", "rationale", "artifacts", "signatureAlgorithm", "signature"];
  if (!record(value) || !exact(value, keys) || value.schema !== "sxsy-b122.acceptance-evidence-bundle" || value.version !== 1 || value.signatureAlgorithm !== "ecdsa-p256-sha256" || !["passed", "failed", "unavailable", "incomplete"].includes(value.status) || !Array.isArray(value.artifacts) || value.artifacts.length < 1 || value.artifacts.length > 64) throw new Error("Evidence bundle schema is invalid.");
  const evaluatedAt = timestamp(value.evaluatedAt, "evaluation time");
  const expiresAt = timestamp(value.expiresAt, "evidence expiry");
  if (Date.parse(expiresAt) <= now.getTime() || Date.parse(expiresAt) <= Date.parse(evaluatedAt)) throw new Error("Evidence bundle is expired.");
  const artifacts = value.artifacts.map((item) => { if (!record(item) || !exact(item, ["path", "sha256", "bytes", "mediaType"]) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > maximumArtifactBytes) throw new Error("Evidence artifact manifest is invalid."); return { path: safeRelative(item.path, "artifact path").replaceAll("\\", "/"), sha256: digest(item.sha256, "artifact digest"), bytes: item.bytes, mediaType: bounded(item.mediaType, "artifact media type", 128) }; });
  return { schema: value.schema, version: 1, id: identifier(value.id, "evidence id"), authorityId: identifier(value.authorityId, "authority id"), keyId: digest(value.keyId, "key id"), gate: gate(value.gate), status: value.status, targetSnapshotId: nullableId(value.targetSnapshotId, "target snapshot"), operationId: nullableId(value.operationId, "operation id"), evidenceDigest: prefixedDigest(value.evidenceDigest), policyVersion: bounded(value.policyVersion, "policy version", 128), evaluatedBy: bounded(value.evaluatedBy, "evaluator", 160), evaluatedAt, expiresAt, rationale: bounded(value.rationale, "rationale", 2048), artifacts, signatureAlgorithm: value.signatureAlgorithm, signature: bounded(value.signature, "signature", 512) };
}

async function concreteFile(path, maximum, label) { const selected = resolveAbsolute(path, `${label} path`); const info = await lstat(selected); if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximum) throw new Error(`${label} is absent, linked, empty, or oversized.`); const canonicalPath = await realpath(selected); const bytes = await readFile(canonicalPath); if (bytes.byteLength !== info.size) throw new Error(`${label} changed while being read.`); return { path: canonicalPath, bytes }; }
async function writeNew(path, value, mode) { const handle = await open(path, "wx", mode); try { await handle.writeFile(value, "utf8"); } finally { await handle.close(); } }
function resolveAbsolute(value, label) { if (typeof value !== "string" || !isAbsolute(value) || /[\0\r\n]/.test(value) || value.length > 4096) throw new Error(`${label} must be an absolute bounded path.`); return resolve(value); }
function safeRelative(value, label) { if (typeof value !== "string" || !value || value.length > 1024 || isAbsolute(value) || /[\0\r\n]/.test(value) || value.replaceAll("\\", "/").split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`${label} must be a safe relative path.`); return value; }
function inside(root, candidate) { const item = relative(resolve(root), resolve(candidate)); return item === "" || !!item && !item.startsWith("..") && !isAbsolute(item); }
function json(bytes, label) { try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error(`${label} is not JSON.`); } }
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value, keys) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function identifier(value, label) { if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function nullableId(value, label) { return value === null ? null : identifier(value, label); }
function bounded(value, label, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum || /\0/.test(value)) throw new Error(`${label} is invalid.`); return value.trim(); }
function gate(value) { if (!Number.isInteger(value) || value < 1 || value > 27) throw new Error("Gate must be 1 through 27."); return value; }
function gateList(value) { if (!Array.isArray(value) || value.length < 1 || value.length > 27) throw new Error("Gate allowlist is invalid."); const result = [...new Set(value.map(gate))].sort((left, right) => left - right); if (result.length !== value.length) throw new Error("Gate allowlist contains duplicates."); return result; }
function timestamp(value, label) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`); return new Date(value).toISOString(); }
function futureTime(value, label) { const parsed = timestamp(value, label); if (Date.parse(parsed) <= Date.now()) throw new Error(`${label} must be in the future.`); return parsed; }
function digest(value, label) { if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function prefixedDigest(value) { if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Evidence digest is invalid."); return value; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function sha256Canonical(value) { return sha256(canonical(value)); }
function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }

async function cli(args) {
  const command = args[0];
  const options = Object.fromEntries(args.slice(1).reduce((items, value, index, source) => value.startsWith("--") ? [...items, [value.slice(2), source[index + 1]]] : items, []));
  if (command === "authority") return createAuthority({ outputDirectory: options.out, authorityId: options.id, allowedGates: String(options.gates ?? "").split(",").map(Number), expiresAt: options.expires });
  if (command === "bundle") return signEvidenceBundle({ draftPath: options.draft, privateKeyPath: options["private-key"], trustPolicyPath: options.trust, outputPath: options.out });
  if (command === "verify") return verifyEvidenceBundle({ bundlePath: options.bundle, trustPolicyPath: options.trust });
  throw new Error("Usage: authority|bundle|verify with explicit --out/--id/--gates/--expires or --draft/--private-key/--trust/--bundle arguments.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
