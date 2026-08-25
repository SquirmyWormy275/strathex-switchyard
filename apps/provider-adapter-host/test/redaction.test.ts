import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CodexProviderAdapterBackend, FixtureProviderRuntimePort } from "../src/backends.ts";
import { ProviderAdapterHostService } from "../src/service.ts";
import { createProviderHostStore } from "../src/state.ts";
import { createLoopbackTlsFixture } from "./support/tls-fixture.ts";

const hostToken = "a".repeat(64);
const providerSecret = "sk-proj-malicious-provider-secret";
const pii = "operator@example.invalid";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

class MaliciousCouncilPort extends FixtureProviderRuntimePort {
  constructor() { super("codex", { effectfulTestOnly: true }); }
  override async council(..._arguments: Parameters<FixtureProviderRuntimePort["council"]>): Promise<never> {
    throw new Error(`token=${providerSecret} owner=${pii}`);
  }
}

test("a malicious provider runtime cannot reflect credential or PII text into an HTTP response", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-redaction-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const port = new MaliciousCouncilPort();
  const service = new ProviderAdapterHostService({
    authenticationToken: hostToken,
    store: createProviderHostStore(join(root, "state.jsonl"), hostToken),
    backends: [new CodexProviderAdapterBackend(port)]
  });
  const authorization = { authorization: `Bearer ${hostToken}` };
  const targetSnapshotId = "b".repeat(64);
  const handshake = await service.handle({ method: "POST", path: "/v1/b122/handshake/codex", headers: authorization, body: JSON.stringify({
    schema: "sxsy-b122.provider-handshake-request", version: 1, sessionId: "codex-session", provider: "codex",
    targetSnapshotId, repositoryRoot: "C:\\repo", branch: "feature/provider-host", head: "d".repeat(40), requestedAt: "2026-08-25T12:00:00.000Z"
  }) });
  assert.equal(handshake.status, 200);
  const response = await service.handle({ method: "POST", path: "/v1/b122/council/codex", headers: authorization, body: JSON.stringify({
    schema: "sxsy-b122.council-phase", version: 1, epochId: "epoch-malicious", phase: "pause", sessionId: "codex-session", targetSnapshotId, repositoryRoot: "C:\\repo"
  }) });
  assert.equal(response.status, 503);
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes(providerSecret), false);
  assert.equal(serialized.includes(pii), false);
  assert.match(serialized, /unresolved|failed closed|ambiguous|retry/i);
});

test("the executable startup boundary never persists a malicious module exception", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-startup-redaction-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const tls = createLoopbackTlsFixture();
  const paths = {
    config: join(root, "config.json"), token: join(root, "token.txt"), credential: join(root, "credential.txt"),
    certificate: join(root, "certificate.pem"), key: join(root, "private-key.pem"), module: join(root, "malicious.mjs")
  };
  const moduleSource = `export function createB122ProviderRuntimePort(input){throw new Error("token="+new TextDecoder().decode(input.credential)+" owner=${pii}")}`;
  await Promise.all([
    writeFile(paths.token, hostToken), writeFile(paths.credential, providerSecret), writeFile(paths.certificate, tls.certificatePem),
    writeFile(paths.key, tls.privateKeyPem), writeFile(paths.module, moduleSource)
  ]);
  await writeFile(paths.config, JSON.stringify({
    schema: "sxsy-b122.provider-host-config", version: 1, listen: { host: "127.0.0.1", port: 4747 },
    tls: { certificateFile: paths.certificate, privateKeyFile: paths.key, certificateSha256: tls.certificateFileSha256, privateKeySha256: tls.privateKeyFileSha256, tlsSpkiSha256: tls.tlsSpkiSha256 },
    authenticationTokenFile: paths.token, stateFile: join(root, "state.jsonl"), providers: [{ provider: "codex", kind: "module", modulePath: paths.module, moduleSha256: createHash("sha256").update(moduleSource).digest("hex"), credentialFile: paths.credential }]
  }));
  const result = await run(process.execPath, ["--experimental-transform-types", join(repository, "apps/provider-adapter-host/src/main.ts"), "--config", paths.config]);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout.includes(providerSecret) || result.stderr.includes(providerSecret), false);
  assert.equal(result.stdout.includes(pii) || result.stderr.includes(pii), false);
  assert.match(result.stderr, /startup failed closed/i);
});

function run(executable: string, arguments_: readonly string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, arguments_, { cwd: repository, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", rejectRun);
    child.once("close", (exitCode) => resolveRun({ exitCode, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }));
  });
}
