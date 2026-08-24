#!/usr/bin/env node
/** Offline signer/verifier for host-installed B122 scanner and advisory feeds. */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maximumDocumentBytes = 1024 * 1024;
const maximumContentBytes = 64 * 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export async function createScannerAuthority({ outputDirectory, authorityId, allowedKinds, expiresAt, now = new Date() }) {
  const directory = resolveAbsolute(outputDirectory, "scanner authority output directory");
  const kinds = kindList(allowedKinds);
  const expiry = futureTime(expiresAt, now, "scanner authority expiry");
  await mkdir(directory, { recursive: false });
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyId = sha256(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }));
  const trust = {
    schema: "sxsy-b122.scanner-fixture-trust", version: 1,
    authorityId: identifier(authorityId, "scanner authority id"), keyId, publicKeyPem,
    allowedKinds: kinds, expiresAt: expiry
  };
  await writeNew(resolve(directory, "private-key.pem"), privateKeyPem, 0o600);
  await writeNew(resolve(directory, "trust-policy.json"), `${JSON.stringify(trust, null, 2)}\n`, 0o600);
  return { authorityId: trust.authorityId, keyId, trustPolicyPath: resolve(directory, "trust-policy.json"), privateKeyPath: resolve(directory, "private-key.pem") };
}

export async function signScannerFixture(input) {
  const content = await concreteFile(input.contentPath, maximumContentBytes, "scanner fixture content");
  const trustFile = await concreteFile(input.trustPolicyPath, maximumDocumentBytes, "scanner trust policy");
  const keyFile = await concreteFile(input.privateKeyPath, 64 * 1024, "scanner private key");
  const now = validDate(input.now ?? new Date(), "scanner signing clock");
  const trust = parseTrust(trustFile.bytes, now);
  const kind = fixtureKind(input.kind);
  if (!trust.allowedKinds.includes(kind)) throw new Error("The scanner trust policy does not authorize this fixture kind.");
  const privateKey = createPrivateKey(keyFile.bytes);
  if (sha256(createPublicKey(privateKey).export({ type: "spki", format: "der" })) !== trust.keyId) throw new Error("The scanner private key does not match the exact trust policy key.");
  const generatedAt = timestamp(input.generatedAt ?? now.toISOString(), "scanner fixture generation");
  const expiresAt = timestamp(input.expiresAt, "scanner fixture expiry");
  const maximumAgeSeconds = boundedInteger(input.maximumAgeSeconds, "scanner maximum age", 60, 31 * 24 * 60 * 60);
  validateFreshness(generatedAt, expiresAt, maximumAgeSeconds, now);
  const unsigned = {
    schema: "sxsy-b122.scanner-fixture", version: 1,
    id: identifier(input.id, "scanner fixture id"), kind,
    authorityId: trust.authorityId, keyId: trust.keyId,
    feedVersion: bounded(input.feedVersion, "scanner feed version", 128),
    toolName: bounded(input.toolName, "scanner tool name", 128),
    toolVersion: bounded(input.toolVersion, "scanner tool version", 128),
    contentFile: "content.bin", contentSha256: sha256(content.bytes),
    generatedAt, expiresAt, maximumAgeSeconds,
    signatureAlgorithm: "ecdsa-p256-sha256"
  };
  const signature = sign("sha256", Buffer.from(canonical(unsigned)), privateKey).toString("base64");
  const outputDirectory = resolveAbsolute(input.outputDirectory, "scanner package output directory");
  const staging = resolve(dirname(outputDirectory), `.b122-scanner-package.${randomUUID()}.tmp`);
  await mkdir(staging, { recursive: false });
  try {
    await writeNew(resolve(staging, "content.bin"), content.bytes, 0o600);
    await writeNew(resolve(staging, "manifest.json"), `${JSON.stringify({ ...unsigned, signature }, null, 2)}\n`, 0o600);
    await rename(staging, outputDirectory);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { id: unsigned.id, kind, manifestPath: resolve(outputDirectory, "manifest.json"), contentSha256: unsigned.contentSha256 };
}

export async function verifyScannerFixture({ packageDirectory, trustPolicyPath, now = new Date() }) {
  const root = await concreteDirectory(packageDirectory, "scanner package");
  const manifestFile = await concreteFile(resolve(root, "manifest.json"), maximumDocumentBytes, "scanner manifest");
  const contentFile = await concreteFile(resolve(root, "content.bin"), maximumContentBytes, "scanner content");
  if (!inside(root, manifestFile.path) || !inside(root, contentFile.path)) throw new Error("Scanner package escaped its exact directory.");
  const observedAt = validDate(now, "scanner verification clock");
  const manifest = parseManifest(manifestFile.bytes, observedAt);
  const trust = parseTrust((await concreteFile(trustPolicyPath, maximumDocumentBytes, "scanner trust policy")).bytes, observedAt);
  if (manifest.authorityId !== trust.authorityId || manifest.keyId !== trust.keyId || !trust.allowedKinds.includes(manifest.kind)) throw new Error("The scanner package is outside the exact trust policy scope.");
  if (manifest.contentFile !== "content.bin" || sha256(contentFile.bytes) !== manifest.contentSha256) throw new Error("The scanner package content digest is invalid.");
  const { signature, ...unsigned } = manifest;
  const signatureBytes = Buffer.from(signature, "base64");
  if (signatureBytes.toString("base64") !== signature || !verify("sha256", Buffer.from(canonical(unsigned)), trust.publicKeyPem, signatureBytes)) throw new Error("The scanner package signature is invalid.");
  return { valid: true, id: manifest.id, kind: manifest.kind, feedVersion: manifest.feedVersion, contentSha256: manifest.contentSha256 };
}

function parseTrust(bytes, now) {
  const value = json(bytes, "scanner trust policy");
  if (!record(value) || !exact(value, ["schema", "version", "authorityId", "keyId", "publicKeyPem", "allowedKinds", "expiresAt"])
    || value.schema !== "sxsy-b122.scanner-fixture-trust" || value.version !== 1) throw new Error("Scanner trust policy schema is invalid.");
  const publicKeyPem = pem(value.publicKeyPem, "scanner public key", 16_384);
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Scanner trust policy requires ECDSA P-256.");
  const keyId = sha256(key.export({ type: "spki", format: "der" }));
  if (value.keyId !== keyId) throw new Error("Scanner trust policy key ID is invalid.");
  const expiresAt = timestamp(value.expiresAt, "scanner trust expiry");
  if (Date.parse(expiresAt) <= now.getTime()) throw new Error("Scanner trust policy is expired.");
  return { authorityId: identifier(value.authorityId, "scanner authority id"), keyId, publicKeyPem, allowedKinds: kindList(value.allowedKinds), expiresAt };
}

function parseManifest(bytes, now) {
  const value = json(bytes, "scanner manifest");
  const keys = ["schema", "version", "id", "kind", "authorityId", "keyId", "feedVersion", "toolName", "toolVersion", "contentFile", "contentSha256", "generatedAt", "expiresAt", "maximumAgeSeconds", "signatureAlgorithm", "signature"];
  if (!record(value) || !exact(value, keys) || value.schema !== "sxsy-b122.scanner-fixture" || value.version !== 1 || value.signatureAlgorithm !== "ecdsa-p256-sha256") throw new Error("Scanner manifest schema is invalid.");
  const generatedAt = timestamp(value.generatedAt, "scanner fixture generation");
  const expiresAt = timestamp(value.expiresAt, "scanner fixture expiry");
  const maximumAgeSeconds = boundedInteger(value.maximumAgeSeconds, "scanner maximum age", 60, 31 * 24 * 60 * 60);
  validateFreshness(generatedAt, expiresAt, maximumAgeSeconds, now);
  return {
    schema: value.schema, version: 1, id: identifier(value.id, "scanner fixture id"), kind: fixtureKind(value.kind),
    authorityId: identifier(value.authorityId, "scanner authority id"), keyId: digest(value.keyId, "scanner key id"),
    feedVersion: bounded(value.feedVersion, "scanner feed version", 128), toolName: bounded(value.toolName, "scanner tool name", 128),
    toolVersion: bounded(value.toolVersion, "scanner tool version", 128), contentFile: safeRelative(value.contentFile, "scanner content path"),
    contentSha256: digest(value.contentSha256, "scanner content digest"), generatedAt, expiresAt, maximumAgeSeconds,
    signatureAlgorithm: value.signatureAlgorithm, signature: bounded(value.signature, "scanner signature", 512)
  };
}

function validateFreshness(generatedAt, expiresAt, maximumAgeSeconds, now) {
  const generated = Date.parse(generatedAt); const expires = Date.parse(expiresAt);
  if (generated > now.getTime() + 5 * 60_000 || expires <= now.getTime() || expires <= generated || now.getTime() - generated > maximumAgeSeconds * 1000) throw new Error("Scanner fixture is future-dated, expired, or outside its signed freshness SLA.");
}
async function concreteDirectory(path, label) { const selected = resolveAbsolute(path, `${label} path`); const info = await lstat(selected); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} is absent or linked.`); return realpath(selected); }
async function concreteFile(path, maximum, label) { const selected = resolveAbsolute(path, `${label} path`); const info = await lstat(selected); if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maximum) throw new Error(`${label} is absent, linked, empty, or oversized.`); const canonicalPath = await realpath(selected); const bytes = await readFile(canonicalPath); if (bytes.byteLength !== info.size) throw new Error(`${label} changed while being read.`); return { path: canonicalPath, bytes }; }
async function writeNew(path, value, mode) { const handle = await open(path, "wx", mode); try { await handle.writeFile(value); } finally { await handle.close(); } }
function resolveAbsolute(value, label) { if (typeof value !== "string" || !isAbsolute(value) || /[\0\r\n]/.test(value) || value.length > 4096) throw new Error(`${label} must be an absolute bounded path.`); return resolve(value); }
function safeRelative(value, label) { if (typeof value !== "string" || !value || value.length > 1024 || isAbsolute(value) || /[\0\r\n]/.test(value) || value.replaceAll("\\", "/").split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`${label} must be a safe relative path.`); return value; }
function inside(root, candidate) { const item = relative(resolve(root), resolve(candidate)); return item === "" || !!item && !item.startsWith("..") && !isAbsolute(item); }
function json(bytes, label) { try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error(`${label} is not JSON.`); } }
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value, keys) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function identifier(value, label) { if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function bounded(value, label, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\0\r\n]/.test(value)) throw new Error(`${label} is invalid.`); return value.trim(); }
function pem(value, label, maximum) { if (typeof value !== "string" || !value.trim() || value.length > maximum || /\0/.test(value)) throw new Error(`${label} is invalid.`); return value.trim(); }
function digest(value, label) { if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`${label} is invalid.`); return value; }
function fixtureKind(value) { if (value !== "scanner" && value !== "advisory") throw new Error("Scanner fixture kind is invalid."); return value; }
function kindList(value) { if (!Array.isArray(value) || value.length < 1 || value.length > 2) throw new Error("Scanner fixture kind allowlist is invalid."); const kinds = [...new Set(value.map(fixtureKind))].sort(); if (kinds.length !== value.length) throw new Error("Scanner fixture kind allowlist contains duplicates."); return kinds; }
function boundedInteger(value, label, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is invalid.`); return value; }
function timestamp(value, label) { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`); return new Date(value).toISOString(); }
function futureTime(value, now, label) { const parsed = timestamp(value, label); if (Date.parse(parsed) <= validDate(now, "scanner authority clock").getTime()) throw new Error(`${label} must be in the future.`); return parsed; }
function validDate(value, label) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`${label} is invalid.`); return value; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`; }

async function cli(args) {
  const command = args[0];
  const options = Object.fromEntries(args.slice(1).reduce((items, value, index, source) => value.startsWith("--") ? [...items, [value.slice(2), source[index + 1]]] : items, []));
  if (command === "authority") return createScannerAuthority({ outputDirectory: options.out, authorityId: options.id, allowedKinds: String(options.kinds ?? "").split(","), expiresAt: options.expires });
  if (command === "sign") return signScannerFixture({ outputDirectory: options.out, contentPath: options.content, privateKeyPath: options["private-key"], trustPolicyPath: options.trust, id: options.id, kind: options.kind, feedVersion: options.feed, toolName: options.tool, toolVersion: options["tool-version"], generatedAt: options.generated, expiresAt: options.expires, maximumAgeSeconds: Number(options["maximum-age-seconds"]) });
  if (command === "verify") return verifyScannerFixture({ packageDirectory: options.package, trustPolicyPath: options.trust });
  throw new Error("Usage: authority|sign|verify with explicit scanner authority, package, key, feed, tool, expiry, and maximum-age arguments.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
