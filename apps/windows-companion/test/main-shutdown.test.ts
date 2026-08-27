import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { closeStandaloneResources, createLifecycleAwareHandler, loadCompanionPackageIdentity, runStandaloneCompanion, writeAuthenticatedCompanionProcessIdentity } from "../src/main.ts";
import { acquireCompanionInstance } from "../src/instance-lifecycle.ts";
import { FakeUserSecretProtector } from "../src/windows-secret.ts";

async function runHealthProbe(script: string, configurationPath: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--configuration", configurationPath, "--probe"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("ingress drain failure blocks effect teardown, seals recovery, and retains the instance lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-main-shutdown-"));
  const lease = await acquireCompanionInstance(root, join(process.cwd(), "apps", "windows-companion", "src", "main.ts"));
  const protector = new FakeUserSecretProtector();
  try {
    const events: string[] = [];
    await assert.rejects(() => closeStandaloneResources({
      stateDirectory: root,
      resources: [
        { name: "pipe", close: async () => { events.push("pipe"); throw new Error("pipe close failed"); } },
        { name: "council", close: async () => { events.push("council"); } },
        { name: "voice", close: async () => { events.push("voice"); throw new Error("voice close failed"); } },
        { name: "hid", close: async () => { events.push("hid"); } }
      ],
      protector,
      instance: lease.record,
      releaseLease: async () => { events.push("lease"); await lease.release(); }
    }), /pipe/);
    assert.deepEqual(events, ["pipe"]);
    assert.equal(events.includes("lease"), false);
    const envelope = JSON.parse(await readFile(join(root, "shutdown-recovery.json"), "utf8")) as { schema: string; sealed: string };
    assert.equal(envelope.schema, "sxsy-b122.dpapi-shutdown-recovery");
    const recovery = JSON.parse(Buffer.from(envelope.sealed.slice("fake:".length), "base64").toString("utf8")) as Record<string, unknown>;
    assert.equal(recovery.schema, "sxsy-b122.shutdown-recovery");
    assert.equal(recovery.version, 2);
    assert.equal(recovery.leaseNonce, lease.record.nonce);
    assert.deepEqual(recovery.failedResources, ["pipe"]);
    assert.deepEqual(recovery.blockedResources, ["council", "voice", "hid"]);
    await assert.rejects(() => acquireCompanionInstance(root, join(process.cwd(), "apps", "windows-companion", "src", "main.ts")), /already active/);
  } finally { await lease.release(); await rm(root, { recursive: true, force: true }); }
});

test("a later closer failure still completes independent ordered cleanup but retains the lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-main-late-shutdown-"));
  const lease = await acquireCompanionInstance(root, join(process.cwd(), "apps", "windows-companion", "src", "main.ts"));
  const events: string[] = [];
  try {
    await assert.rejects(() => closeStandaloneResources({
      stateDirectory: root,
      resources: [
        { name: "pipe", close: async () => { events.push("pipe"); } },
        { name: "voice", close: async () => { events.push("voice"); throw new Error("voice close failed"); } },
        { name: "hid", close: async () => { events.push("hid"); } }
      ],
      protector: new FakeUserSecretProtector(),
      instance: lease.record,
      releaseLease: async () => { events.push("lease"); await lease.release(); }
    }), /voice/);
    assert.deepEqual(events, ["pipe", "voice", "hid"]);
  } finally { await lease.release(); await rm(root, { recursive: true, force: true }); }
});

test("a non-ingress closer timeout returns bounded recovery, blocks dependents, and retains the lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-main-close-timeout-"));
  const lease = await acquireCompanionInstance(root, join(process.cwd(), "apps", "windows-companion", "src", "main.ts"));
  const events: string[] = [];
  try {
    const startedAt = Date.now();
    await assert.rejects(() => closeStandaloneResources({
      stateDirectory: root,
      resources: [
        { name: "pipe", close: async () => { events.push("pipe"); } },
        { name: "voice", close: () => { events.push("voice"); return new Promise<void>(() => undefined); } },
        { name: "hid", close: async () => { events.push("hid"); } }
      ],
      protector: new FakeUserSecretProtector(),
      instance: lease.record,
      closeTimeoutMs: 100,
      releaseLease: async () => { events.push("lease"); await lease.release(); }
    }), /voice/);
    assert.ok(Date.now() - startedAt < 1_500, "a hung closer escaped the bounded shutdown interval");
    assert.deepEqual(events, ["pipe", "voice"]);
    const envelope = JSON.parse(await readFile(join(root, "shutdown-recovery.json"), "utf8")) as { sealed: string };
    const recovery = JSON.parse(Buffer.from(envelope.sealed.slice("fake:".length), "base64").toString("utf8")) as { failedResources: string[]; blockedResources: string[] };
    assert.deepEqual(recovery.failedResources, ["voice"]);
    assert.deepEqual(recovery.blockedResources, ["hid"]);
    await assert.rejects(() => acquireCompanionInstance(root, join(process.cwd(), "apps", "windows-companion", "src", "main.ts")), /already active/);
  } finally { await lease.release(); await rm(root, { recursive: true, force: true }); }
});

test("an ingress closer timeout blocks every effect resource within its bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-main-ingress-timeout-"));
  const lease = await acquireCompanionInstance(root, join(process.cwd(), "apps", "windows-companion", "src", "main.ts"));
  const events: string[] = [];
  try {
    await assert.rejects(() => closeStandaloneResources({
      stateDirectory: root,
      resources: [
        { name: "pipe", close: () => { events.push("pipe"); return new Promise<void>(() => undefined); } },
        { name: "effect", close: async () => { events.push("effect"); } }
      ],
      protector: new FakeUserSecretProtector(),
      instance: lease.record,
      closeTimeoutMs: 100,
      releaseLease: async () => { events.push("lease"); await lease.release(); }
    }), /pipe/);
    assert.deepEqual(events, ["pipe"]);
    const envelope = JSON.parse(await readFile(join(root, "shutdown-recovery.json"), "utf8")) as { sealed: string };
    const recovery = JSON.parse(Buffer.from(envelope.sealed.slice("fake:".length), "base64").toString("utf8")) as { failedResources: string[]; blockedResources: string[] };
    assert.deepEqual(recovery.failedResources, ["pipe"]);
    assert.deepEqual(recovery.blockedResources, ["effect"]);
  } finally { await lease.release(); await rm(root, { recursive: true, force: true }); }
});

test("process-identity failure releases the acquired companion lease before startup rejects", async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-main-identity-failure-"));
  try {
    await assert.rejects(() => runStandaloneCompanion({
      stateDirectory: root,
      installedHelperIdentityReader: async () => `sha256:${"a".repeat(64)}`,
      processIdentityWriter: async () => { throw new Error("injected identity write failure"); }
    }), /injected identity write failure/);
    await assert.rejects(readFile(join(root, "companion-instance.json"), "utf8"), (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("authenticated lifecycle request synchronously fences later effects and schedules one graceful stop", async () => {
  let delegated = 0;
  let stopped = 0;
  let delegatedSignal: AbortSignal | undefined;
  const handler = createLifecycleAwareHandler({
    async handle(request, context) { delegated += 1; delegatedSignal = context?.signal; return { version: 1, id: request.id, ok: true, result: { state: "ready" } }; }
  }, async () => { stopped += 1; });
  const controller = new AbortController();
  const ping = await handler.handle({ version: 1, id: "ping", method: "ping" }, { signal: controller.signal });
  assert.equal(ping.ok, true);
  assert.equal(delegated, 1);
  assert.equal(delegatedSignal, controller.signal);
  const shutdown = await handler.handle({ version: 1, id: "shutdown", method: "ping", payload: { lifecycle: "shutdown" } });
  assert.deepEqual(shutdown, { version: 1, id: "shutdown", ok: true, result: { state: "stopping" } });
  const fenced = await handler.handle({ version: 1, id: "effect-after-shutdown", method: "ping" });
  assert.deepEqual(fenced, { version: 1, id: "effect-after-shutdown", ok: false, error: { code: "companion_unavailable", message: "The companion is stopping and refuses new effects." } });
  assert.equal(delegated, 1, "a request crossed the synchronous shutdown admission fence");
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(stopped, 1);
  await handler.handle({ version: 1, id: "shutdown-2", method: "ping", payload: { lifecycle: "shutdown" } });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(stopped, 1);
});

test("companion adapter identity comes from the exact package adjacent to source or release bytes", async () => {
  const identity = await loadCompanionPackageIdentity(join(process.cwd(), "apps", "windows-companion", "src", "main.ts"));
  const packageIdentity = JSON.parse(await readFile(join(process.cwd(), "apps", "windows-companion", "package.json"), "utf8")) as { name: string; version: string };
  assert.deepEqual(identity, { name: packageIdentity.name, version: packageIdentity.version });
});

test("shutdown identity durably seals the exact OS process and immutable entry-point digests", async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-main-process-identity-"));
  try {
    const mainPath = join(process.cwd(), "apps", "windows-companion", "src", "main.ts");
    const path = await writeAuthenticatedCompanionProcessIdentity({
      stateDirectory: root,
      nonce: "11111111-2222-3333-4444-555555555555",
      mainPath,
      processPath: process.execPath,
      protector: new FakeUserSecretProtector(),
      capture: async () => ({
        pid: process.pid,
        creationFileTimeUtc: "134000000000000000",
        executablePath: process.execPath,
        arguments: [mainPath],
        parentProcessId: process.ppid,
        sessionId: 1
      })
    });
    const envelope = JSON.parse(await readFile(path, "utf8")) as { schema: string; protector: string; sealed: string };
    assert.equal(envelope.schema, "sxsy-b122.dpapi-companion-process-identity");
    assert.equal(envelope.protector, "fake-test-protector");
    const payload = JSON.parse(Buffer.from(envelope.sealed.slice("fake:".length), "base64").toString("utf8")) as Record<string, unknown>;
    assert.equal(payload.schema, "sxsy-b122.companion-process-identity");
    assert.equal(payload.pid, process.pid);
    assert.match(String(payload.executableSha256), /^[a-f0-9]{64}$/);
    assert.match(String(payload.mainSha256), /^[a-f0-9]{64}$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("health probe distinguishes retryable absence from fail-closed configuration rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-health-probe-"));
  try {
    const scriptDirectory = join(root, "scripts");
    const extensionDirectory = join(root, "extension", "dist", "apps", "vscode-extension", "src");
    await mkdir(scriptDirectory, { recursive: true });
    await mkdir(extensionDirectory, { recursive: true });
    await writeFile(join(root, "extension", "package.json"), JSON.stringify({ type: "commonjs" }), "utf8");
    const healthScript = join(scriptDirectory, "Test-B122Health.mjs");
    await copyFile(join(process.cwd(), "deployment", "windows", "Test-B122Health.mjs"), healthScript);
    await copyFile(join(process.cwd(), "apps", "vscode-extension", "dist", "apps", "vscode-extension", "src", "named-pipe-transport.js"), join(extensionDirectory, "named-pipe-transport.js"));
    const configuration = join(root, "authenticated-pipe.json");
    const absent = await runHealthProbe(healthScript, configuration);
    assert.equal(absent.code, 2);
    assert.equal(absent.stderr, "");
    assert.deepEqual(JSON.parse(absent.stdout), {
      schema: "sxsy-b122.install-health-probe",
      version: 1,
      status: "unavailable",
      retryable: true,
      reason: "endpoint_unavailable"
    });

    await writeFile(configuration, "{}", "utf8");
    const rejected = await runHealthProbe(healthScript, configuration);
    assert.equal(rejected.code, 3);
    assert.equal(rejected.stderr, "");
    assert.deepEqual(JSON.parse(rejected.stdout), {
      schema: "sxsy-b122.install-health-probe",
      version: 1,
      status: "rejected",
      retryable: false,
      reason: "integrity_or_authentication_failure"
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
