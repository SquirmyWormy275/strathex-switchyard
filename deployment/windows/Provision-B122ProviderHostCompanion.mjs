#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const parsedArguments = parseArguments(process.argv.slice(2));
const artifactPath = parsedArguments.artifactPath;
const bundleRoot = parsedArguments.bundleRoot;
const replaceExisting = parsedArguments.replaceExisting;
const transportModule = resolve(bundleRoot, "extension", "dist", "named-pipe-transport.js");
const { ProvisionedNamedPipeJsonLineTransport } = await import(pathToFileURL(transportModule).href);
const artifact = parseArtifact(JSON.parse(await readFile(artifactPath, "utf8")));
const transport = new ProvisionedNamedPipeJsonLineTransport(parsedArguments.configurationPath);
for (const sealedReference of artifact.credentials) {
  const credential = await request(transport, "credential.provision", {
    reference: sealedReference.reference,
    scopes: sealedReference.scopes,
    sealedSecret: sealedReference.sealedSecret,
    ...(replaceExisting ? { replaceExisting: true } : {})
  });
  if (!record(credential) || !record(credential.credential) || credential.credential.reference !== sealedReference.reference) fail();
}
const policy = await request(transport, "network-policy.install", {
  sourcePath: artifact.networkPolicyPath,
  repositoryRoot: artifact.profile.repositoryRoot
});
if (!record(policy) || !record(policy.policy) || policy.policy.status !== "active") fail();
const installedProfile = await request(transport, "provider-host.profile.install", {
  profile: artifact.profile,
  networkPolicyPath: artifact.networkPolicyPath
});
if (!record(installedProfile) || !record(installedProfile.profile) || installedProfile.profile.configurationSha256 !== artifact.profile.configurationSha256) fail();
process.stdout.write(`${JSON.stringify({ schema: "sxsy-b122.provider-host-companion-provisioning-receipt", version: 2, status: "provisioned", repositoryRoot: artifact.profile.repositoryRoot, networkPolicyPath: artifact.networkPolicyPath, profileConfigurationSha256: artifact.profile.configurationSha256, sealedSecretCount: artifact.credentials.length, cleartextSecretRead: false, authenticatedPipe: true, currentUserPresenceRequired: true })}\n`);

async function request(transport, method, payload) {
  const id = randomUUID();
  const response = JSON.parse(await transport.request(JSON.stringify({ version: 1, id, method, payload })));
  if (!record(response) || response.version !== 1 || response.id !== id || response.ok !== true || !("result" in response)) throw new Error(`The authenticated companion rejected ${method}.`);
  return response.result;
}
function parseArtifact(value) {
  if (!record(value) || !exact(value, ["schema", "version", "credentials", "networkPolicyPath", "profile"])
    || value.schema !== "sxsy-b122.provider-host-companion-provisioning" || value.version !== 2 || !absolute(value.networkPolicyPath)) fail();
  const profile = parseProfile(value.profile);
  if (!Array.isArray(value.credentials) || value.credentials.length !== 2) fail();
  const credentials = value.credentials.map((credential) => parseCredential(credential, profile));
  const byRole = new Map(credentials.map((credential) => [credential.role, credential]));
  if (byRole.size !== 2 || byRole.get("bearer")?.reference !== profile.bearerCredentialReference
    || byRole.get("dispatch-lease")?.reference !== profile.dispatchLeaseCredentialReference) fail();
  return Object.freeze({ credentials: Object.freeze(credentials), networkPolicyPath: value.networkPolicyPath, profile });
}
function parseCredential(value, profile) {
  if (!record(value) || !exact(value, ["role", "reference", "scopes", "protector", "sealedSecret"])
    || (value.role !== "bearer" && value.role !== "dispatch-lease") || value.protector !== "windows-dpapi-current-user"
    || !canonicalBase64(value.sealedSecret) || !Array.isArray(value.scopes) || value.scopes.length !== 1) fail();
  const scope = value.scopes[0];
  if (!record(scope) || !exact(scope, ["repositoryRoot", "adapterId", "purpose"]) || scope.repositoryRoot !== profile.repositoryRoot) fail();
  const expected = value.role === "bearer"
    ? { reference: profile.bearerCredentialReference, adapterId: "configured-network", purpose: "provider-api" }
    : { reference: profile.dispatchLeaseCredentialReference, adapterId: "provider-dispatch-lease-issuer", purpose: "provider-dispatch-lease" };
  if (value.reference !== expected.reference || scope.adapterId !== expected.adapterId || scope.purpose !== expected.purpose) fail();
  return Object.freeze({ role: value.role, reference: value.reference, scopes: Object.freeze([{ repositoryRoot: profile.repositoryRoot, adapterId: scope.adapterId, purpose: scope.purpose }]), sealedSecret: value.sealedSecret });
}
function parseProfile(value) {
  if (!record(value) || !exact(value, ["schema", "version", "generation", "expectedPriorConfigurationSha256", "expectedPriorProfileDigest", "repositoryRoot", "configurationPath", "configurationSha256", "tlsSpkiSha256", "bearerCredentialReference", "dispatchLeaseCredentialReference", "profileDigest", "providers"])
    || value.schema !== "sxsy-b122.provider-host-dispatch-profile" || value.version !== 1 || !absolute(value.repositoryRoot) || !absolute(value.configurationPath)
    || !Number.isSafeInteger(value.generation) || value.generation < 1 || (value.expectedPriorConfigurationSha256 !== null && !digest(value.expectedPriorConfigurationSha256))
    || (value.expectedPriorProfileDigest !== null && !digest(value.expectedPriorProfileDigest)) || !digest(value.profileDigest)
    || !digest(value.configurationSha256) || !digest(value.tlsSpkiSha256)
    || typeof value.bearerCredentialReference !== "string" || !/^b122-provider-bearer-[a-f0-9]{32,64}$/.test(value.bearerCredentialReference)
    || typeof value.dispatchLeaseCredentialReference !== "string" || !/^b122-provider-dispatch-lease-[a-f0-9]{32,64}$/.test(value.dispatchLeaseCredentialReference)
    || !Array.isArray(value.providers) || value.providers.length < 1 || value.providers.length > 2) fail();
  const seen = new Set();
  for (const provider of value.providers) {
    if (!record(provider) || !exact(provider, ["provider", "adapterId", "moduleSha256"])
      || (provider.provider !== "claude" && provider.provider !== "codex") || seen.has(provider.provider)
      || typeof provider.adapterId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(provider.adapterId) || !digest(provider.moduleSha256)) fail();
    seen.add(provider.provider);
  }
  if (value.generation === 1 ? (value.expectedPriorConfigurationSha256 !== null || value.expectedPriorProfileDigest !== null)
    : (value.expectedPriorConfigurationSha256 === null || value.expectedPriorProfileDigest === null)) fail();
  const providers = value.providers.map((provider) => Object.freeze({ ...provider })).sort((left, right) => left.provider.localeCompare(right.provider));
  const parsed = Object.freeze({ ...value, providers: Object.freeze(providers) });
  if (profileIdentityDigest(parsed) !== parsed.profileDigest) fail();
  return parsed;
}
function parseArguments(values) {
  const parsed = { artifactPath: undefined, bundleRoot: undefined, configurationPath: undefined, replaceExisting: false };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--replace-existing") {
      if (parsed.replaceExisting) throw new Error("--replace-existing may be supplied at most once.");
      parsed.replaceExisting = true;
      continue;
    }
    if (name !== "--artifact" && name !== "--bundle-root" && name !== "--configuration") throw new Error(`Unsupported provider provisioning argument: ${name ?? "<missing>"}.`);
    const value = values[++index];
    if (!value || !isAbsolute(value) || /[\0\r\n"]/u.test(value)) throw new Error(`${name} requires one absolute path.`);
    const property = name === "--artifact" ? "artifactPath" : name === "--bundle-root" ? "bundleRoot" : "configurationPath";
    if (parsed[property] !== undefined) throw new Error(`${name} may be supplied at most once.`);
    parsed[property] = resolve(value);
  }
  if (!parsed.artifactPath) throw new Error("--artifact requires one absolute path.");
  if (!parsed.bundleRoot) throw new Error("--bundle-root requires one absolute path.");
  return parsed;
}
function absolute(value) { return typeof value === "string" && isAbsolute(value) && !/[\0\r\n]/.test(value); }
function digest(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function canonicalBase64(value) { if (typeof value !== "string" || value.length < 4 || value.length > 32 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false; const bytes = Buffer.from(value, "base64"); return bytes.length > 0 && bytes.toString("base64") === value; }
function profileIdentityDigest(profile) { const providers = [...profile.providers].sort((left, right) => left.provider.localeCompare(right.provider)).map((entry) => `${entry.provider}\0${entry.adapterId}\0${entry.moduleSha256}\0`).join(""); const material = `sxsy-b122.provider-host-dispatch-profile\0v1\0${profilePath(profile.repositoryRoot)}\0${profilePath(profile.configurationPath)}\0${profile.configurationSha256}\0${profile.tlsSpkiSha256}\0${profile.bearerCredentialReference}\0${profile.dispatchLeaseCredentialReference}\0${providers}`; return createHash("sha256").update(material, "utf8").digest("hex"); }
function profilePath(value) { return value.replaceAll("/", "\\").replace(/\\+$/u, "").toLowerCase(); }
function exact(value, keys) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail() { throw new Error("The provider-host companion provisioning artifact or receipt is invalid."); }
