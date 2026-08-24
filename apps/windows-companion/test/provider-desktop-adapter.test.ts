import assert from "node:assert/strict";
import test from "node:test";

import type { AdapterRequest } from "../../../packages/control-plane/src/adapters.ts";
import { commandForAction, type CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import {
  InstalledProviderDesktopCommandAdapter,
  type InstalledProviderDesktopLifecyclePort
} from "../src/provider-desktop-adapter.ts";
import type {
  ManagedTerminalProfileOutcome,
  ProviderLifecycleControl,
  ProviderLifecycleOutcome
} from "../src/provider-desktop.ts";

const deadline = "2099-08-24T12:05:00.000Z";

class RecordingLifecycle implements InstalledProviderDesktopLifecyclePort {
  readonly calls: Array<Readonly<{
    kind: "desktop" | "terminal";
    provider: string;
    mode?: string;
    operationId: string;
    control: ProviderLifecycleControl;
  }>> = [];
  desktopOutcome: ProviderLifecycleOutcome = {
    status: "completed",
    summary: "Provider desktop effect completed.",
    effect: "focused",
    processId: 122
  };
  terminalOutcome: ManagedTerminalProfileOutcome = {
    status: "completed",
    summary: "Issued exact managed-terminal metadata.",
    profile: {
      provider: "codex",
      profileName: "SXSY-B122 Codex",
      canonicalExecutablePath: "C:\\Program Files\\SXSY\\codex.exe",
      executableSha256: "a".repeat(64),
      productIdentity: {
        productId: "openai.codex",
        displayName: "Codex",
        publisher: "OpenAI, L.L.C.",
        role: "managed_terminal"
      },
      args: [],
      shell: false,
      installationId: "provider-install:codex",
      catalogDigest: "b".repeat(64),
      issuedAt: "2099-08-24T12:00:00.000Z",
      validUntil: "2099-08-24T12:00:30.000Z",
      requiresFinalIdentityVerification: true
    }
  };

  async open(input: Parameters<InstalledProviderDesktopLifecyclePort["open"]>[0]): Promise<ProviderLifecycleOutcome> {
    this.calls.push({ kind: "desktop", provider: input.provider, mode: input.mode, operationId: input.operationId, control: input.control });
    return this.desktopOutcome;
  }

  async managedTerminal(input: Parameters<InstalledProviderDesktopLifecyclePort["managedTerminal"]>[0]): Promise<ManagedTerminalProfileOutcome> {
    this.calls.push({ kind: "terminal", provider: input.provider, operationId: input.operationId, control: input.control });
    return this.terminalOutcome;
  }
}

function request(action: CommandAction, overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  const operationId = `operation:${action}`;
  return {
    definition: commandForAction(action),
    operationId,
    executionControl: {
      operationId,
      deadline,
      async isCancellationRequested() { return false; }
    },
    ...(action === "fresh_claude" || action === "fresh_chatgpt" ? {
      confirmation: {
        currentUserConfirmed: true,
        confirmationDigest: "c".repeat(64),
        action
      }
    } : {}),
    ...overrides
  };
}

test("installed provider adapter maps all six B122 commands to one exact provider lifecycle operation", async () => {
  const lifecycle = new RecordingLifecycle();
  const adapter = new InstalledProviderDesktopCommandAdapter(lifecycle);
  const cases = [
    ["open_claude", "desktop", "claude_desktop", "normal"],
    ["fresh_claude", "desktop", "claude_desktop", "fresh"],
    ["open_chatgpt", "desktop", "chatgpt_desktop", "normal"],
    ["fresh_chatgpt", "desktop", "chatgpt_desktop", "fresh"],
    ["open_managed_claude_terminal", "terminal", "claude_code", undefined],
    ["open_managed_codex_terminal", "terminal", "codex", undefined]
  ] as const;

  for (const [action, kind, provider, mode] of cases) {
    lifecycle.terminalOutcome = {
      ...lifecycle.terminalOutcome,
      profile: lifecycle.terminalOutcome.profile ? {
        ...lifecycle.terminalOutcome.profile,
        provider: provider === "claude_code" ? "claude_code" : "codex",
        profileName: provider === "claude_code" ? "SXSY-B122 Claude Code" : "SXSY-B122 Codex",
        canonicalExecutablePath: provider === "claude_code"
          ? "C:\\Program Files\\SXSY\\claude-code.exe"
          : "C:\\Program Files\\SXSY\\codex.exe",
        executableSha256: provider === "claude_code" ? "d".repeat(64) : "a".repeat(64),
        productIdentity: provider === "claude_code"
          ? { productId: "anthropic.claude-code", displayName: "Claude Code", publisher: "Anthropic, PBC", role: "managed_terminal" }
          : { productId: "openai.codex", displayName: "Codex", publisher: "OpenAI, L.L.C.", role: "managed_terminal" }
      } : undefined
    };
    const invocation = request(action);
    const result = await adapter.execute(invocation);
    assert.equal(result.status, "completed");
    const call = lifecycle.calls.at(-1)!;
    assert.equal(call.kind, kind);
    assert.equal(call.provider, provider);
    assert.equal(call.mode, mode);
    assert.equal(call.operationId, `operation:${action}`);
    assert.equal(call.control, invocation.executionControl);
  }
});

test("adapter refuses missing or mismatched durable operation controls and never falls back", async () => {
  const lifecycle = new RecordingLifecycle();
  const adapter = new InstalledProviderDesktopCommandAdapter(lifecycle);

  const absent = await adapter.execute(request("open_claude", { executionControl: undefined }));
  const mismatched = await adapter.execute(request("open_chatgpt", {
    executionControl: {
      operationId: "another-operation",
      deadline,
      async isCancellationRequested() { return false; }
    }
  }));
  lifecycle.desktopOutcome = { status: "unavailable", summary: "Claude Desktop is not installed." };
  const unavailable = await adapter.execute(request("open_claude"));

  assert.equal(absent.status, "unavailable");
  assert.equal(mismatched.status, "blocked");
  assert.equal(unavailable.status, "unavailable");
  assert.deepEqual(lifecycle.calls.map((call) => call.provider), ["claude_desktop"]);
});

test("fresh desktop actions require their exact trusted confirmation", async () => {
  const lifecycle = new RecordingLifecycle();
  const adapter = new InstalledProviderDesktopCommandAdapter(lifecycle);

  const missing = await adapter.execute(request("fresh_claude", { confirmation: undefined }));
  const wrongAction = await adapter.execute(request("fresh_chatgpt", {
    confirmation: {
      currentUserConfirmed: true,
      confirmationDigest: "e".repeat(64),
      action: "fresh_claude"
    }
  }));

  assert.equal(missing.status, "awaiting_confirmation");
  assert.equal(wrongAction.status, "blocked");
  assert.equal(lifecycle.calls.length, 0);
});

test("managed-terminal result exposes only a bounded typed profile and rejects provider substitution", async () => {
  const lifecycle = new RecordingLifecycle();
  const adapter = new InstalledProviderDesktopCommandAdapter(lifecycle);

  const valid = await adapter.execute(request("open_managed_codex_terminal"));
  assert.equal(valid.status, "completed");
  assert.equal(valid.effectDisposition, "not_started");
  assert.deepEqual(valid.data, {
    kind: "managed_terminal_profile",
    version: 1,
    operationId: "operation:open_managed_codex_terminal",
    commandAction: "open_managed_codex_terminal",
    deadline,
    profile: lifecycle.terminalOutcome.profile
  });

  lifecycle.terminalOutcome = {
    ...lifecycle.terminalOutcome,
    profile: lifecycle.terminalOutcome.profile
      ? { ...lifecycle.terminalOutcome.profile, provider: "claude_code" }
      : undefined
  };
  const substituted = await adapter.execute(request("open_managed_codex_terminal"));
  assert.equal(substituted.status, "failed");
  assert.equal(substituted.effectDisposition, "not_started");
  assert.equal(substituted.data, undefined);
});

test("desktop uncertainty remains ambiguous while pre-effect refusals remain replay-safe", async () => {
  const lifecycle = new RecordingLifecycle();
  const adapter = new InstalledProviderDesktopCommandAdapter(lifecycle);

  lifecycle.desktopOutcome = { status: "timed_out", summary: "Native focus did not settle." };
  assert.equal((await adapter.execute(request("open_chatgpt"))).effectDisposition, "ambiguous");
  lifecycle.desktopOutcome = { status: "blocked", summary: "Final effect guard denied the launch." };
  assert.equal((await adapter.execute(request("open_chatgpt"))).effectDisposition, "not_started");
  lifecycle.desktopOutcome = { status: "completed", summary: "Focused.", effect: "focused", processId: 7 };
  assert.equal((await adapter.execute(request("open_chatgpt"))).effectDisposition, "committed");
});
