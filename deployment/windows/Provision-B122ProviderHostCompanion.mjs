#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const artifactPath = argument("--artifact");
const bundleRoot = resolve(argument("--bundle-root"));
const replaceExisting = process.argv.includes("--replace-existing");
const transportModule = resolve(bundleRoot, "extension", "dist", "apps", "vscode-extension", "src", "named-pipe-transport.js");
const { ProvisionedNamedPipeJsonLineTransport } = await import(pathToFileURL(transportModule).href);
const artifact = parseArtifact(JSON.parse(await readFile(artifactPath, "utf8")));
const transport = new ProvisionedNamedPipeJsonLineTransport();
const credential = await request(transport, "credential.provision", {
  reference: artifact.reference,
  repositoryRoot: artifact.repositoryRoot,
  purposes: artifact.purposes,
  sealedSecret: artifact.sealedSecret,
  ...(replaceExisting ? { replaceExisting: true } : {})
});
if (!record(credential) || !record(credential.credential) || credential.credential.reference !== artifact.reference) fail();
const policy = await request(transport, "network-policy.install", { sourcePath: artifact.networkPolicyPath });
if (!record(policy) || !record(policy.policy) || policy.policy.status !== "active") fail();
process.stdout.write(`${JSON.stringify({ schema: "sxsy-b122.provider-host-companion-provisioning-receipt", version: 1, status: "provisioned", reference: artifact.reference, repositoryRoot: artifact.repositoryRoot, networkPolicyPath: artifact.networkPolicyPath, sealedSecretTransferred: true, cleartextSecretRead: false, authenticatedPipe: true, currentUserPresenceRequired: true })}\n`);

async function request(transport, method, payload) {
  const id = randomUUID();
  const response = JSON.parse(await transport.request(JSON.stringify({ version: 1, id, method, payload })));
  if (!record(response) || response.version !== 1 || response.id !== id || response.ok !== true || !("result" in response)) throw new Error(`The authenticated companion rejected ${method}.`);
  return response.result;
}
function parseArtifact(value) {
  const keys = ["schema", "version", "reference", "repositoryRoot", "purposes", "sealedSecret", "protector", "networkPolicyPath", "providerConfigurationPath", "tlsSpkiSha256"];
  if (!record(value) || !exact(value, keys) || value.schema !== "sxsy-b122.provider-host-companion-provisioning" || value.version !== 1 || value.reference !== "b122-provider-token"
    || !absolute(value.repositoryRoot) || !Array.isArray(value.purposes) || value.purposes.length !== 1 || value.purposes[0] !== "provider-api"
    || value.protector !== "windows-dpapi-current-user" || typeof value.sealedSecret !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.sealedSecret) || value.sealedSecret.length > 32 * 1024
    || !absolute(value.networkPolicyPath) || !absolute(value.providerConfigurationPath) || typeof value.tlsSpkiSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.tlsSpkiSha256)) fail();
  return value;
}
function argument(name) { const index = process.argv.indexOf(name); const value = index >= 0 ? process.argv[index + 1] : undefined; if (!value || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error(`${name} requires one absolute path.`); return resolve(value); }
function absolute(value) { return typeof value === "string" && isAbsolute(value) && !/[\0\r\n]/.test(value); }
function exact(value, keys) { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail() { throw new Error("The provider-host companion provisioning artifact or receipt is invalid."); }
