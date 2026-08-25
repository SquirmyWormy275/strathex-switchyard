import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore, type JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import {
  AttestedProviderDesktopRegistry,
  InstalledProviderDesktopLifecycle,
  NodeProviderExecutableIdentityProbe,
  createFixedProviderDesktopCatalog,
  type ProviderDesktopEffectGuard,
  type ProviderDesktopProcessObservation,
  type ProviderDesktopProcessPort,
  type ProviderExecutableIdentity,
  type ProviderLifecycleControl,
  type ProviderProcessEffectRequest
} from "../src/provider-desktop.ts";

const at = "2026-08-24T12:00:00.000Z";

class TestAuthenticator implements JournalAuthenticator {
  readonly provider = "isolated-test-authenticator";
  async seal(hash: string): Promise<string> { return createHash("sha256").update(`test:${hash}`).digest("hex"); }
  async verify(hash: string, tag: string): Promise<boolean> { return tag === await this.seal(hash); }
}

class FakeProcessPort implements ProviderDesktopProcessPort {
  observations: ProviderDesktopProcessObservation[] = [];
  effects: string[] = [];
  beforeFinalEffect?: () => Promise<void>;

  async listRunning(_identity: ProviderExecutableIdentity, _signal: AbortSignal): Promise<readonly ProviderDesktopProcessObservation[]> {
    this.effects.push("list");
    return this.observations;
  }

  async focusExisting(request: ProviderProcessEffectRequest & { readonly process: ProviderDesktopProcessObservation }): Promise<Readonly<{ processId: number }>> {
    this.effects.push("focus-requested");
    await this.beforeFinalEffect?.();
    await request.beforeEffect();
    this.effects.push("focus");
    return { processId: request.process.processId };
  }

  async launch(request: ProviderProcessEffectRequest & { readonly args: readonly string[]; readonly requireDistinctSurface: boolean }): Promise<Readonly<{ processId: number; surfaceId: string; distinctSurface: boolean }>> {
    this.effects.push(`launch-requested:${request.args.join(" ")}`);
    await this.beforeFinalEffect?.();
    await request.beforeEffect();
    this.effects.push(`launch:${request.args.join(" ")}`);
    return { processId: 4242, surfaceId: `window:${request.requireDistinctSurface ? "fresh" : "normal"}:4242`, distinctSurface: request.requireDistinctSurface };
  }
}

class RecordingGuard implements ProviderDesktopEffectGuard {
  readonly checks: string[] = [];
  denyFinal = false;

  async check(input: Parameters<ProviderDesktopEffectGuard["check"]>[0]) {
    this.checks.push(`${input.provider}:${input.effect}:${input.phase}`);
    return this.denyFinal && input.phase === "final"
      ? { allowed: false, reason: "Provider containment changed before the final effect." }
      : { allowed: true, reason: "Current provider effect fence." };
  }
}

async function fixture(context: test.TestContext, presenceApproved = true) {
  const root = await mkdtemp(join(tmpdir(), "b122-provider-desktop-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const executablePaths = {
    claude_desktop: join(root, "Claude.exe"),
    chatgpt_desktop: join(root, "ChatGPT.exe"),
    claude_code: join(root, "claude-code.exe"),
    codex: join(root, "codex.exe")
  } as const;
  for (const [provider, path] of Object.entries(executablePaths)) await writeFile(path, `${provider}-v1`, "utf8");
  const paths = Object.fromEntries(Object.entries(executablePaths).map(([provider, path]) => [provider, { path, signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40) }])) as {
    readonly [K in keyof typeof executablePaths]: { readonly path: string; readonly signerSubject: string; readonly signerThumbprint: string };
  };
  const catalog = createFixedProviderDesktopCatalog(paths);
  const store = new ProtectedJsonStore({ filePath: join(root, "protected.jsonl"), authenticator: new TestAuthenticator() });
  const prompts: string[] = [];
  const registry = new AttestedProviderDesktopRegistry({
    store,
    catalog,
    identityProbe: new NodeProviderExecutableIdentityProbe({ async inspect() { return { signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40) }; } }),
    presence: {
      async verify(prompt) {
        prompts.push(prompt);
        return presenceApproved ? { verified: true, operator: "HOST\\operator" } : { verified: false };
      }
    },
    now: () => new Date(at)
  });
  return { root, paths: executablePaths, catalog, store, prompts, registry };
}

function control(overrides: Partial<ProviderLifecycleControl> = {}): ProviderLifecycleControl {
  return {
    deadline: "2026-08-24T12:01:00.000Z",
    async isCancellationRequested() { return false; },
    ...overrides
  };
}

test("installs only the host catalog path after current-user approval and survives restart", async (context) => {
  const setup = await fixture(context);
  const installed = await setup.registry.install("claude_desktop");

  assert.equal(installed.provider, "claude_desktop");
  assert.equal(installed.status, "active");
  assert.equal(installed.identity.canonicalExecutablePath, await realpath(setup.paths.claude_desktop));
  assert.equal(installed.identity.productIdentity.productId, "anthropic.claude-desktop");
  assert.match(installed.identity.executableSha256, /^[a-f0-9]{64}$/);
  assert.match(setup.prompts[0] ?? "", /Claude Desktop.*SHA-256/i);

  const restarted = new AttestedProviderDesktopRegistry({
    store: setup.store,
    catalog: setup.catalog,
    identityProbe: new NodeProviderExecutableIdentityProbe({ async inspect() { return { signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40) }; } }),
    presence: { async verify() { throw new Error("resolve must not reprompt"); } },
    now: () => new Date(at)
  });
  assert.deepEqual(await restarted.resolve("claude_desktop"), installed);
});

test("installation and revocation require current-user presence and revocation is durable", async (context) => {
  const denied = await fixture(context, false);
  await assert.rejects(() => denied.registry.install("chatgpt_desktop"), /presence/i);
  assert.deepEqual(await denied.registry.list(), []);

  const setup = await fixture(context);
  await setup.registry.install("chatgpt_desktop");
  const revoked = await setup.registry.revoke("chatgpt_desktop");
  assert.equal(revoked.status, "revoked");
  await assert.rejects(() => setup.registry.resolve("chatgpt_desktop"), /not installed|revoked/i);
  assert.equal(setup.prompts.length, 2);
});

test("registry requires authenticated durable storage and rejects executable drift", async (context) => {
  const setup = await fixture(context);
  assert.throws(() => new AttestedProviderDesktopRegistry({
    store: new ProtectedJsonStore({ filePath: join(setup.root, "unprotected.jsonl") }),
    catalog: setup.catalog,
    identityProbe: new NodeProviderExecutableIdentityProbe({ async inspect() { return { signerSubject: "CN=Isolated Provider Test", signerThumbprint: "a".repeat(40) }; } }),
    presence: { async verify() { return { verified: true, operator: "operator" }; } }
  }), /authenticated/i);

  await setup.registry.install("claude_desktop");
  await writeFile(setup.paths.claude_desktop, "tampered", "utf8");
  await assert.rejects(() => setup.registry.resolve("claude_desktop"), /identity changed/i);
  const listed = await setup.registry.list();
  assert.equal(listed.find((item) => item.provider === "claude_desktop")?.status, "stale");
  assert.equal(listed.find((item) => item.provider === "chatgpt_desktop"), undefined);
});

test("normal desktop action focuses one exact running instance and never launches", async (context) => {
  const setup = await fixture(context);
  const installed = await setup.registry.install("claude_desktop");
  const port = new FakeProcessPort();
  port.observations = [{
    processId: 777,
    windowId: "window:777",
    identity: installed.identity
  }];
  const guard = new RecordingGuard();
  const lifecycle = new InstalledProviderDesktopLifecycle({ registry: setup.registry, processes: port, effectGuard: guard, now: () => new Date(at) });

  const result = await lifecycle.open({ provider: "claude_desktop", mode: "normal", operationId: "operation-1", control: control() });

  assert.equal(result.status, "completed");
  assert.equal(result.effect, "focused");
  assert.equal(result.processId, 777);
  assert.deepEqual(port.effects, ["list", "focus-requested", "focus"]);
  assert.deepEqual(guard.checks, ["claude_desktop:normal:admission", "claude_desktop:focus:final"]);
});

test("normal launches fixed profile only when no process exists; fresh always uses distinct fixed profile", async (context) => {
  const setup = await fixture(context);
  await setup.registry.install("chatgpt_desktop");
  const port = new FakeProcessPort();
  const guard = new RecordingGuard();
  const lifecycle = new InstalledProviderDesktopLifecycle({ registry: setup.registry, processes: port, effectGuard: guard, now: () => new Date(at) });

  const normal = await lifecycle.open({ provider: "chatgpt_desktop", mode: "normal", operationId: "normal", control: control() });
  const fresh = await lifecycle.open({ provider: "chatgpt_desktop", mode: "fresh", operationId: "fresh", control: control() });

  assert.equal(normal.effect, "launched");
  assert.equal(fresh.effect, "launched_fresh");
  assert.deepEqual(port.effects, ["list", "launch-requested:", "launch:", "launch-requested:--new-window", "launch:--new-window"]);
});

test("ambiguous or identity-mismatched running processes fail unavailable", async (context) => {
  const setup = await fixture(context);
  const installed = await setup.registry.install("claude_desktop");
  const port = new FakeProcessPort();
  const lifecycle = new InstalledProviderDesktopLifecycle({
    registry: setup.registry,
    processes: port,
    effectGuard: new RecordingGuard(),
    managedTerminalLauncher: { canonicalExecutablePath: "C:\\Program Files\\SXSY\\sxsy-b122-provider-desktop-helper.exe", executableSha256: "c".repeat(64) },
    now: () => new Date(at)
  });
  const exact = { processId: 1, windowId: "one", identity: installed.identity };
  port.observations = [exact, { ...exact, processId: 2, windowId: "two" }];
  assert.equal((await lifecycle.open({ provider: "claude_desktop", mode: "normal", operationId: "ambiguous", control: control() })).status, "unavailable");

  port.observations = [{ ...exact, identity: { ...installed.identity, executableSha256: "0".repeat(64) } }];
  assert.equal((await lifecycle.open({ provider: "claude_desktop", mode: "normal", operationId: "mismatch", control: control() })).status, "unavailable");
  assert.equal(port.effects.filter((event) => event.startsWith("focus")).length, 0);
  assert.equal(port.effects.filter((event) => event.startsWith("launch")).length, 0);
});

test("final guard and final executable recheck happen inside the process side-effect boundary", async (context) => {
  const setup = await fixture(context);
  await setup.registry.install("claude_desktop");
  const port = new FakeProcessPort();
  const guard = new RecordingGuard();
  const lifecycle = new InstalledProviderDesktopLifecycle({ registry: setup.registry, processes: port, effectGuard: guard, now: () => new Date(at) });

  guard.denyFinal = true;
  const denied = await lifecycle.open({ provider: "claude_desktop", mode: "fresh", operationId: "late-fence", control: control() });
  assert.equal(denied.status, "blocked");
  assert.deepEqual(port.effects, ["launch-requested:--new-window"]);

  guard.denyFinal = false;
  port.effects = [];
  port.beforeFinalEffect = async () => { await writeFile(setup.paths.claude_desktop, "changed-after-admission", "utf8"); };
  const changed = await lifecycle.open({ provider: "claude_desktop", mode: "fresh", operationId: "late-identity", control: control() });
  assert.equal(changed.status, "unavailable");
  assert.deepEqual(port.effects, ["launch-requested:--new-window"]);
});

test("deadline and cancellation fail before any desktop side effect", async (context) => {
  const setup = await fixture(context);
  await setup.registry.install("chatgpt_desktop");
  const port = new FakeProcessPort();
  const lifecycle = new InstalledProviderDesktopLifecycle({ registry: setup.registry, processes: port, effectGuard: new RecordingGuard(), now: () => new Date(at) });

  const expired = await lifecycle.open({ provider: "chatgpt_desktop", mode: "fresh", operationId: "expired", control: control({ deadline: "2026-08-24T11:59:59.000Z" }) });
  const cancelled = await lifecycle.open({ provider: "chatgpt_desktop", mode: "fresh", operationId: "cancelled", control: control({ async isCancellationRequested() { return true; } }) });
  assert.equal(expired.status, "timed_out");
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(port.effects, []);
});

test("a stalled native process seam is aborted by the bounded deadline", async (context) => {
  const setup = await fixture(context);
  await setup.registry.install("claude_desktop");
  const port = new FakeProcessPort();
  port.listRunning = async (_identity, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const lifecycle = new InstalledProviderDesktopLifecycle({ registry: setup.registry, processes: port, effectGuard: new RecordingGuard(), now: () => new Date(at) });
  const deadline = new Date(Date.parse(at) + 30).toISOString();
  const result = await lifecycle.open({ provider: "claude_desktop", mode: "normal", operationId: "stalled", control: control({ deadline }) });
  assert.equal(result.status, "timed_out");
});

test("managed terminal returns exact attested metadata without spawning from the companion", async (context) => {
  const setup = await fixture(context);
  const installed = await setup.registry.install("codex");
  const port = new FakeProcessPort();
  const lifecycle = new InstalledProviderDesktopLifecycle({
    registry: setup.registry,
    processes: port,
    effectGuard: new RecordingGuard(),
    managedTerminalLauncher: { canonicalExecutablePath: "C:\\Program Files\\SXSY\\sxsy-b122-provider-desktop-helper.exe", executableSha256: "c".repeat(64) },
    now: () => new Date(at)
  });

  const metadata = await lifecycle.managedTerminal({ provider: "codex", operationId: "terminal", control: control() });
  assert.equal(metadata.status, "completed");
  assert.equal(metadata.profile?.profileName, "SXSY-B122 Codex");
  assert.equal(metadata.profile?.launcherProtocolVersion, 1);
  assert.equal(metadata.profile?.canonicalExecutablePath, installed.identity.canonicalExecutablePath);
  assert.equal(metadata.profile?.executableSha256, installed.identity.executableSha256);
  assert.deepEqual(metadata.profile?.args, []);
  assert.deepEqual(port.effects, []);

  assert.equal((await lifecycle.managedTerminal({ provider: "claude_desktop", operationId: "wrong-kind", control: control() })).status, "unavailable");
  assert.equal((await lifecycle.open({ provider: "codex", mode: "normal", operationId: "wrong-kind", control: control() })).status, "unavailable");
});

test("catalog rejects relative executables and keeps product identity and launch arguments host fixed", async () => {
  assert.throws(() => createFixedProviderDesktopCatalog({
    claude_desktop: { path: "Claude.exe", signerSubject: "CN=Test", signerThumbprint: "a".repeat(40) },
    chatgpt_desktop: { path: "C:\\Apps\\ChatGPT.exe", signerSubject: "CN=Test", signerThumbprint: "a".repeat(40) },
    claude_code: { path: "C:\\Apps\\claude-code.exe", signerSubject: "CN=Test", signerThumbprint: "a".repeat(40) },
    codex: { path: "C:\\Apps\\codex.exe", signerSubject: "CN=Test", signerThumbprint: "a".repeat(40) }
  }), /absolute/i);
});
