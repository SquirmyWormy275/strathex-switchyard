import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  RepositoryRuntime,
  computeRepositoryRuntimeManifestDigest,
  loadVerifiedRepositoryRuntimeManifest,
  type RepositoryExecutionRootLease,
  type RepositoryExecutionRootProvider,
  type RepositoryRuntimeManifest,
  type RuntimeEffectGuard,
  type RuntimeHealthProbe
} from "../src/repository-runtime.ts";

const allowEffects: RuntimeEffectGuard = {
  async check() { return { allowed: true, reason: "isolated test permit" }; }
};

async function fixture(context: test.TestContext) {
  const base = await mkdtemp(join(tmpdir(), "sxsy-b122-repository-runtime-"));
  const repositoryRoot = join(base, "repository");
  const disposableRoot = join(base, "disposable");
  const hostRoot = join(base, "host-owned");
  await Promise.all([mkdir(repositoryRoot), mkdir(disposableRoot), mkdir(hostRoot)]);
  context.after(async () => { await rm(base, { recursive: true, force: true }); });
  return { base, repositoryRoot, disposableRoot, hostRoot };
}

function processRecipe(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    kind: "process",
    executable: process.execPath,
    args: ["task.mjs"],
    cwd: ".",
    environment: { SXSY_TEST_MODE: "1" },
    lifecycle: "foreground",
    isolation: "repository",
    timeoutMs: 2_000,
    maxOutputBytes: 4_096,
    ...overrides
  };
}

function manifest(repositoryRoot: string, recipes: Readonly<Record<string, unknown>>, allowedHttpsUrls: readonly string[] = []): RepositoryRuntimeManifest {
  return {
    schema: "sxsy-b122.repository-runtime",
    version: 1,
    repositoryRoot,
    allowedHttpsUrls,
    recipes
  } as RepositoryRuntimeManifest;
}

async function writeVerifiedManifest(hostRoot: string, value: unknown, repositoryRoot: string) {
  const path = join(hostRoot, "repository-runtime.json");
  const contents = JSON.stringify(value);
  await writeFile(path, contents, "utf8");
  return loadVerifiedRepositoryRuntimeManifest({
    filePath: path,
    expectedSha256: computeRepositoryRuntimeManifestDigest(contents),
    repositoryRoot
  });
}

test("a digest-pinned host manifest accepts only the exact bounded v1 structured schema", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.repositoryRoot, "task.mjs"), "process.stdout.write('ok')", "utf8");
  const valid = manifest(setup.repositoryRoot, {
    run_target: processRecipe({ lifecycle: "managed", timeoutMs: 10_000 }),
    stop_managed_run: { kind: "stop", managedActions: ["run_target"], gracefulTimeoutMs: 100, forceTimeoutMs: 500 }
  });
  const loaded = await writeVerifiedManifest(setup.hostRoot, valid, setup.repositoryRoot);
  assert.equal(loaded.manifest.schema, "sxsy-b122.repository-runtime");
  assert.match(loaded.digest, /^[a-f0-9]{64}$/);

  const manifestPath = join(setup.hostRoot, "bad-digest.json");
  await writeFile(manifestPath, JSON.stringify(valid), "utf8");
  await assert.rejects(
    loadVerifiedRepositoryRuntimeManifest({ filePath: manifestPath, expectedSha256: "0".repeat(64), repositoryRoot: setup.repositoryRoot }),
    /digest/i
  );

  for (const invalid of [
    { ...valid, unexpected: true },
    { ...valid, version: 2 },
    manifest(setup.repositoryRoot, { run_target: { ...processRecipe(), command: "node task.mjs" } }),
    manifest(setup.repositoryRoot, { run_target: { ...processRecipe(), executable: "node" } }),
    manifest(setup.repositoryRoot, { run_target: { ...processRecipe(), cwd: "../outside" } }),
    manifest(setup.repositoryRoot, { run_target: { ...processRecipe(), environment: { GITHUB_TOKEN: "not-allowed" } } }),
    manifest(setup.repositoryRoot, { run_target: { ...processRecipe(), args: ["token=ghp_1234567890abcdef"] } }),
    manifest(setup.repositoryRoot, { stop_managed_run: processRecipe() })
  ]) {
    await assert.rejects(writeVerifiedManifest(setup.hostRoot, invalid, setup.repositoryRoot), /manifest|schema|version|unknown|executable|cwd|environment|secret|stop/i);
  }
});

test("foreground recipes receive only declared environment and cap redacted output", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.repositoryRoot, "task.mjs"), [
    "const ambient = process.env.SXSY_AMBIENT_SECRET ?? 'absent';",
    "process.stdout.write(`${process.env.SXSY_TEST_MODE}:${ambient}:token=ghp_1234567890abcdef:${'x'.repeat(4096)}`);"
  ].join("\n"), "utf8");
  const loaded = await writeVerifiedManifest(setup.hostRoot, manifest(setup.repositoryRoot, {
    shield_change_scan: processRecipe({ maxOutputBytes: 128 })
  }), setup.repositoryRoot);
  const previous = process.env.SXSY_AMBIENT_SECRET;
  process.env.SXSY_AMBIENT_SECRET = "must-not-cross-boundary";
  try {
    const runtime = new RepositoryRuntime(loaded, { effectGuard: allowEffects });
    const result = await runtime.execute("shield_change_scan");
    assert.equal(result.status, "completed");
    assert.equal(result.output?.includes("must-not-cross-boundary"), false);
    assert.equal(result.output?.includes("ghp_1234567890abcdef"), false);
    assert.equal(result.outputTruncated, true);
    assert.ok(Buffer.byteLength(result.output ?? "", "utf8") <= 128);
  } finally {
    if (previous === undefined) delete process.env.SXSY_AMBIENT_SECRET;
    else process.env.SXSY_AMBIENT_SECRET = previous;
  }
});

test("disposable pipeline recipes require an injected disposable root and never touch production data", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.disposableRoot, "task.mjs"), "process.stdout.write(`${process.cwd()}:${process.env.SXSY_TEST_DB}`)", "utf8");
  const loaded = await writeVerifiedManifest(setup.hostRoot, manifest(setup.repositoryRoot, {
    pipeline_local_gate: processRecipe({ isolation: "disposable", environment: { SXSY_TEST_DB: "isolated.sqlite" } })
  }), setup.repositoryRoot);

  const unavailable = await new RepositoryRuntime(loaded, { effectGuard: allowEffects }).execute("pipeline_local_gate");
  assert.equal(unavailable.status, "unavailable");

  let released = false;
  const roots: RepositoryExecutionRootProvider = {
    async prepare(input): Promise<RepositoryExecutionRootLease> {
      assert.equal(input.action, "pipeline_local_gate");
      assert.equal(input.isolation, "disposable");
      return {
        root: setup.disposableRoot,
        isolation: "disposable",
        protections: { productionData: "denied", ambientCredentials: "denied" },
        release: async () => { released = true; }
      };
    }
  };
  const result = await new RepositoryRuntime(loaded, { effectGuard: allowEffects, executionRoots: roots }).execute("pipeline_local_gate");
  assert.equal(result.status, "completed");
  assert.match(result.output ?? "", /disposable.*isolated\.sqlite/i);
  assert.equal(released, true);
  await assert.rejects(readFile(join(setup.repositoryRoot, "isolated.sqlite")), /ENOENT/);
});

test("managed runs have opaque identities and stop never targets an arbitrary PID", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.repositoryRoot, "task.mjs"), "process.stdout.write('started'); setInterval(() => {}, 1000);", "utf8");
  const loaded = await writeVerifiedManifest(setup.hostRoot, manifest(setup.repositoryRoot, {
    run_target: processRecipe({ lifecycle: "managed", timeoutMs: 20_000 }),
    stop_managed_run: { kind: "stop", managedActions: ["run_target"], gracefulTimeoutMs: 100, forceTimeoutMs: 1_000 }
  }), setup.repositoryRoot);
  const runtime = new RepositoryRuntime(loaded, { effectGuard: allowEffects });
  const started = await runtime.execute("run_target");
  assert.equal(started.status, "running");
  assert.match(started.managedProcessId ?? "", /^managed:[a-f0-9]{64}$/);
  assert.ok((started.pid ?? 0) > 0);
  assert.equal(runtime.listManagedProcesses().filter((item) => item.state === "running").length, 1);

  const arbitrary = await runtime.execute("stop_managed_run", { managedProcessId: `managed:${"0".repeat(64)}` });
  assert.equal(arbitrary.status, "blocked");
  assert.equal(runtime.listManagedProcesses().filter((item) => item.state === "running").length, 1);

  const stopped = await runtime.execute("stop_managed_run", { managedProcessId: started.managedProcessId });
  assert.equal(stopped.status, "completed");
  assert.equal(stopped.managedProcessId, started.managedProcessId);
  assert.equal(runtime.listManagedProcesses().filter((item) => item.state === "running").length, 0);
});

test("timeouts terminate exact children and foreground failures stay bounded", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.repositoryRoot, "task.mjs"), "process.stdout.write('before-timeout'); setInterval(() => {}, 1000);", "utf8");
  const loaded = await writeVerifiedManifest(setup.hostRoot, manifest(setup.repositoryRoot, {
    shield_codebase_audit: processRecipe({ timeoutMs: 100, maxOutputBytes: 32 })
  }), setup.repositoryRoot);
  const result = await new RepositoryRuntime(loaded, { effectGuard: allowEffects }).execute("shield_codebase_audit");
  assert.equal(result.status, "timed_out");
  assert.match(result.output ?? "", /before-timeout/);
});

test("web launch probes and returns only the exact configured safe URL, never stdout", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.repositoryRoot, "task.mjs"), "process.stdout.write('https://evil.example/steal'); setInterval(() => {}, 1000);", "utf8");
  const safeUrl = "http://127.0.0.1:43129/health";
  const probed: string[] = [];
  const healthProbe: RuntimeHealthProbe = {
    async probe(url) { probed.push(url); return { healthy: true, detail: "isolated probe" }; }
  };
  const loaded = await writeVerifiedManifest(setup.hostRoot, manifest(setup.repositoryRoot, {
    launch_web_app: processRecipe({
      lifecycle: "managed",
      timeoutMs: 20_000,
      web: { url: safeUrl, healthUrl: safeUrl, healthTimeoutMs: 1_000, healthIntervalMs: 10 }
    }),
    stop_managed_run: { kind: "stop", managedActions: ["launch_web_app"], gracefulTimeoutMs: 100, forceTimeoutMs: 1_000 }
  }), setup.repositoryRoot);
  const runtime = new RepositoryRuntime(loaded, { effectGuard: allowEffects, healthProbe });
  const result = await runtime.execute("launch_web_app");
  assert.equal(result.status, "running");
  assert.equal(result.url, safeUrl);
  assert.deepEqual(probed, [safeUrl]);
  assert.notEqual(result.url, "https://evil.example/steal");
  await runtime.execute("stop_managed_run", { managedProcessId: result.managedProcessId });
});

test("web URLs are loopback-only unless the exact HTTPS URL is host-allowlisted", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.repositoryRoot, "task.mjs"), "process.exit(0)", "utf8");
  for (const url of [
    "http://example.com/app",
    "https://user:password@example.com/app",
    "file:///C:/Windows/System32/calc.exe",
    "https://allowed.example/app/other"
  ]) {
    const value = manifest(setup.repositoryRoot, {
      launch_web_app: processRecipe({ lifecycle: "managed", web: { url, healthUrl: url, healthTimeoutMs: 500, healthIntervalMs: 10 } })
    }, ["https://allowed.example/app"]);
    await assert.rejects(writeVerifiedManifest(setup.hostRoot, value, setup.repositoryRoot), /URL|HTTPS|loopback|allowlist|credential/i);
  }

  const allowlisted = "https://allowed.example/app";
  await writeVerifiedManifest(setup.hostRoot, manifest(setup.repositoryRoot, {
    launch_web_app: processRecipe({ lifecycle: "managed", web: { url: allowlisted, healthUrl: allowlisted, healthTimeoutMs: 500, healthIntervalMs: 10 } })
  }, [allowlisted]), setup.repositoryRoot);
});

test("the final effect guard and canonical root check run immediately before spawn", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.repositoryRoot, "task.mjs"), "process.stdout.write('must-not-run')", "utf8");
  const loaded = await writeVerifiedManifest(setup.hostRoot, manifest(setup.repositoryRoot, {
    venv: processRecipe()
  }), setup.repositoryRoot);
  let checks = 0;
  const lateFence: RuntimeEffectGuard = {
    async check() {
      checks += 1;
      return checks >= 2 ? { allowed: false, reason: "containment changed" } : { allowed: true, reason: "clear" };
    }
  };
  const result = await new RepositoryRuntime(loaded, { effectGuard: lateFence }).execute("venv");
  assert.equal(result.status, "blocked");
  assert.match(result.summary, /containment changed/i);
  assert.equal(checks, 2);
});

test("each invocation may supply its exact dispatch effect guard without weakening the default", async (context) => {
  const setup = await fixture(context);
  await writeFile(join(setup.repositoryRoot, "task.mjs"), "process.stdout.write('guarded')", "utf8");
  const loaded = await writeVerifiedManifest(setup.hostRoot, manifest(setup.repositoryRoot, {
    venv: processRecipe()
  }), setup.repositoryRoot);
  const runtime = new RepositoryRuntime(loaded);

  const denied = await runtime.execute("venv");
  assert.equal(denied.status, "blocked");

  const allowed = await runtime.execute("venv", { effectGuard: allowEffects });
  assert.equal(allowed.status, "completed");
  assert.equal(allowed.output, "guarded");
});
