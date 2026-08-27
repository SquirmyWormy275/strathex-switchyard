#!/usr/bin/env node
import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { request } from "node:https";
import { isAbsolute, resolve } from "node:path";
import { checkServerIdentity } from "node:tls";

const maximumConfigurationBytes = 256 * 1024;
const maximumTokenBytes = 8 * 1024;
const maximumResponseBytes = 64 * 1024;

async function main(argv) {
  const arguments_ = parseArguments(argv);
  const configPath = resolve(arguments_.configuration);
  const configBytes = await boundedFile(configPath, maximumConfigurationBytes, "configuration");
  const configurationSha256 = createHash("sha256").update(configBytes).digest("hex");
  let config;
  try { config = JSON.parse(configBytes.toString("utf8")); } finally { configBytes.fill(0); }
  if (!record(config) || config.schema !== "sxsy-b122.provider-host-config" || config.version !== 1 || !record(config.listen) || !record(config.tls)
    || !host(config.listen.host) || !Number.isSafeInteger(config.listen.port) || config.listen.port < 1 || config.listen.port > 65_535
    || !isAbsoluteString(config.tls.certificateFile) || !digest(config.tls.certificateSha256) || !digest(config.tls.tlsSpkiSha256) || !isAbsoluteString(config.authenticationTokenEnvelopeFile)) throw new Error("The provider-host health configuration is invalid.");
  const certificate = await boundedFile(resolve(config.tls.certificateFile), 2 * 1024 * 1024, "TLS certificate");
  if (createHash("sha256").update(certificate).digest("hex") !== config.tls.certificateSha256) throw new Error("The provider-host health certificate does not match its pin.");
  const tokenBytes = await openDpapiEnvelope(resolve(config.authenticationTokenEnvelopeFile));
  const token = tokenBytes.toString("ascii");
  tokenBytes.fill(0);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("The provider-host health token is invalid.");
  const localCertificate = new X509Certificate(certificate);
  const localSpki = createHash("sha256").update(localCertificate.publicKey.export({ type: "spki", format: "der" })).digest("hex");
  if (localSpki !== config.tls.tlsSpkiSha256) throw new Error("The provider-host health certificate does not match its SPKI identity pin.");
  const requestOptions = { host: config.listen.host, port: config.listen.port, certificate, tlsSpkiSha256: config.tls.tlsSpkiSha256, token };
  try {
    const body = await requestJson({ ...requestOptions, path: "/v1/b122/health", method: "GET" });
    if (!record(body) || body.schema !== "sxsy-b122.provider-host-health" || body.version !== 1 || body.status !== "ready" || body.authenticatedState !== true || !Array.isArray(body.providers)) throw new Error("The provider-host health receipt is invalid.");
    if (arguments_.lifecycleNonce) {
      if (body.lifecycleNonceSha256 !== createHash("sha256").update(arguments_.lifecycleNonce, "ascii").digest("hex") || body.processId !== arguments_.processId || body.configurationSha256 !== configurationSha256) throw new Error("The provider-host health lifecycle identity changed.");
    }
    if (arguments_.shutdown) {
      const acknowledgement = await requestJson({ ...requestOptions, path: "/v1/b122/lifecycle/shutdown", method: "POST", body: JSON.stringify({ schema: "sxsy-b122.provider-host-shutdown", version: 1, lifecycleNonce: arguments_.lifecycleNonce, expectedProcessId: arguments_.processId, configurationSha256 }) });
      if (!record(acknowledgement) || acknowledgement.schema !== "sxsy-b122.provider-host-shutdown-ack" || acknowledgement.version !== 1 || acknowledgement.accepted !== true || acknowledgement.processId !== arguments_.processId || acknowledgement.configurationSha256 !== configurationSha256) throw new Error("The provider-host graceful-shutdown acknowledgement is invalid.");
      process.stdout.write(`${JSON.stringify({ schema: "sxsy-b122.provider-host-shutdown-check", version: 1, status: "accepted", processId: arguments_.processId, lifecycleNonceSha256: body.lifecycleNonceSha256, configurationSha256, tlsIdentityPinned: true, authenticated: true })}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ schema: "sxsy-b122.provider-host-health-check", version: 1, status: "passed", processId: body.processId ?? null, lifecycleNonceSha256: body.lifecycleNonceSha256 ?? null, configurationSha256: body.configurationSha256 ?? configurationSha256, tlsIdentityPinned: true, authenticated: true, providers: body.providers })}\n`);
  } finally { certificate.fill(0); }
}

function requestJson(options) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request({
      hostname: options.host, port: options.port, path: options.path, method: options.method,
      headers: { authorization: `Bearer ${options.token}`, accept: "application/json", ...(options.body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(options.body)) } : {}) }, ca: options.certificate,
      rejectUnauthorized: true, agent: false,
      checkServerIdentity(hostname, certificate) {
        const identityError = checkServerIdentity(hostname, certificate);
        if (identityError) return identityError;
        try {
          const observed = createHash("sha256").update(new X509Certificate(certificate.raw).publicKey.export({ type: "spki", format: "der" })).digest();
          const expected = Buffer.from(options.tlsSpkiSha256, "hex");
          return timingSafeEqual(expected, observed) ? undefined : new Error("The provider-host peer SPKI identity changed.");
        } catch { return new Error("The provider-host peer certificate could not be SPKI-verified."); }
      }
    }, (response) => {
      const chunks = []; let length = 0;
      response.on("data", (chunk) => { length += chunk.length; if (length > maximumResponseBytes) req.destroy(new Error("The provider-host health response is oversized.")); else chunks.push(Buffer.from(chunk)); });
      response.once("end", () => {
        if (response.statusCode !== 200) return rejectRequest(new Error(`Provider-host lifecycle request returned HTTP ${response.statusCode ?? 0}.`));
        try { resolveRequest(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { rejectRequest(new Error("The provider-host lifecycle response is malformed.")); }
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error("The provider-host health request timed out.")));
    req.once("error", rejectRequest);
    req.end(options.body);
  });
}

async function openDpapiEnvelope(path) {
  const envelopeBytes = await boundedFile(path, maximumTokenBytes, "authentication-token envelope");
  let envelope;
  try { envelope = JSON.parse(envelopeBytes.toString("utf8")); } finally { envelopeBytes.fill(0); }
  if (!record(envelope) || Object.keys(envelope).length !== 4 || envelope.schema !== "sxsy-b122.provider-host-secret-envelope" || envelope.version !== 1 || envelope.protector !== "windows-dpapi-current-user" || typeof envelope.sealed !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.sealed) || envelope.sealed.length > 32 * 1024) throw new Error("The provider-host authentication-token envelope is invalid.");
  const protectedBytes = Buffer.from(envelope.sealed, "base64");
  try {
    const openedBase64 = await invokeDpapiUnprotect(protectedBytes);
    return Buffer.from(openedBase64, "base64");
  } finally { protectedBytes.fill(0); }
}

function invokeDpapiUnprotect(bytes) {
  const script = "Add-Type -AssemblyName System.Security;$in=[Console]::In.ReadToEnd();$raw=[Convert]::FromBase64String($in);$out=[Security.Cryptography.ProtectedData]::Unprotect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($out))";
  return new Promise((resolveDpapi, rejectDpapi) => {
    const child = spawn("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { shell: false, windowsHide: true, env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" }, stdio: ["pipe", "pipe", "ignore"] });
    const chunks = []; let length = 0;
    child.stdout.on("data", (chunk) => { length += chunk.length; if (length > maximumTokenBytes) child.kill(); else chunks.push(Buffer.from(chunk)); });
    child.once("error", () => rejectDpapi(new Error("Windows DPAPI could not be started.")));
    child.once("close", (code) => { const result = Buffer.concat(chunks).toString("ascii").trim(); if (code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result)) rejectDpapi(new Error("Windows DPAPI rejected the provider-host token.")); else resolveDpapi(result); });
    child.stdin.end(bytes.toString("base64"), "ascii");
  });
}

function parseArguments(argv) {
  if (argv.length !== 2 && argv.length !== 6 && argv.length !== 7) throw new Error("Usage: Test-B122ProviderHostHealth.mjs --configuration <absolute-config.json> [--expect-lifecycle-nonce <64-lowercase-hex> --expect-process-id <positive-integer> [--shutdown]]");
  if (argv[0] !== "--configuration" || !isAbsolute(argv[1]) || /[\0\r\n]/.test(argv[1])) throw new Error("The provider-host configuration path is invalid.");
  if (argv.length === 2) return { configuration: argv[1], lifecycleNonce: undefined, processId: undefined, shutdown: false };
  if (argv[2] !== "--expect-lifecycle-nonce" || !digest(argv[3]) || argv[4] !== "--expect-process-id" || !/^[1-9]\d{0,9}$/.test(argv[5]) || (argv.length === 7 && argv[6] !== "--shutdown")) throw new Error("The provider-host lifecycle expectation is invalid.");
  const processId = Number(argv[5]); if (!Number.isSafeInteger(processId)) throw new Error("The provider-host lifecycle process identity is invalid.");
  return { configuration: argv[1], lifecycleNonce: argv[3], processId, shutdown: argv.length === 7 };
}

async function boundedFile(path, maximum, label) { const metadata = await stat(path); if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximum) throw new Error(`The provider-host ${label} is missing or oversized.`); return readFile(path); }
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function host(value) { return typeof value === "string" && (value === "::1" || /^[A-Za-z0-9.-]{1,253}$/.test(value)); }
function digest(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isAbsoluteString(value) { return typeof value === "string" && isAbsolute(value) && !/[\0\r\n]/.test(value); }

main(process.argv.slice(2)).catch(() => { process.stderr.write("Provider-host authenticated lifecycle check failed closed.\n"); process.exitCode = 1; });
