import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { FixedWindowsHostApplicationIdentity, WindowsHostActionEffectRequest } from "../src/windows-host-action-consumer.ts";
import {
  NodeWindowsHostActionHelperTransport,
  PinnedWindowsHostActionEffectPort,
  provisionWindowsHostActionApplications,
  windowsHostActionHelperContractSource,
  type WindowsHostActionHelperInvocation,
  type WindowsHostActionHelperSession,
  type WindowsHostActionHelperTransport
} from "../src/windows-host-action-effects.ts";

const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const responseSchema = "sxsy-b122.windows-host-action-response";

function identity(application: "vscode" | "terminal"): FixedWindowsHostApplicationIdentity {
  const vscode = application === "vscode";
  return {
    version: 1,
    application,
    productId: vscode ? "microsoft.visual-studio-code" : "microsoft.windows-terminal",
    canonicalExecutablePath: vscode
      ? "C:\\Program Files\\Microsoft VS Code\\Code.exe"
      : "C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.0.0.0_x64__8wekyb3d8bbwe\\WindowsTerminal.exe",
    executableSha256: digest(`${application}-executable`),
    signerSubject: "CN=Microsoft Corporation, O=Microsoft Corporation, C=US",
    signerThumbprint: application === "vscode" ? "a".repeat(40) : "b".repeat(40),
    size: application === "vscode" ? 123_456 : 234_567,
    modifiedMs: 1_777_000_000_000,
    device: "4294967295",
    inode: application === "vscode" ? "59672695062879660" : "59672695062879661"
  };
}

class FakeSession implements WindowsHostActionHelperSession {
  readonly writes: string[] = [];
  readonly responses: string[] = [];
  terminated = false;
  exited = false;
  terminateError?: Error;
  onWrite?: (value: Record<string, unknown>) => void;
  onRead?: () => Promise<string>;

  async write(line: string): Promise<void> {
    this.writes.push(line);
    this.onWrite?.(JSON.parse(line) as Record<string, unknown>);
  }

  async read(): Promise<string> {
    if (this.onRead) return this.onRead();
    const response = this.responses.shift();
    if (response === undefined) throw new Error("fake helper has no response");
    return response;
  }

  async terminate(): Promise<void> {
    this.terminated = true;
    this.exited = true;
    if (this.terminateError) throw this.terminateError;
  }
  async wait(): Promise<Readonly<{ code: number; signal: NodeJS.Signals | null }>> { this.exited = true; return { code: 0, signal: null }; }
}

class FakeTransport implements WindowsHostActionHelperTransport {
  readonly invocations: WindowsHostActionHelperInvocation[] = [];
  readonly sessions: FakeSession[] = [];
  configure?: (session: FakeSession) => void;

  async start(invocation: WindowsHostActionHelperInvocation): Promise<WindowsHostActionHelperSession> {
    this.invocations.push(invocation);
    const session = new FakeSession();
    this.configure?.(session);
    this.sessions.push(session);
    return session;
  }
}

function envelope(request: Record<string, unknown>, kind: "ready" | "result" | "error", body: Record<string, unknown>): string {
  return JSON.stringify({ schema: responseSchema, version: 1, requestId: request.requestId, kind, ...body });
}

function port(transport: FakeTransport, timeoutMs = 100): PinnedWindowsHostActionEffectPort {
  return new PinnedWindowsHostActionEffectPort({
    applications: { vscode: identity("vscode"), terminal: identity("terminal") },
    transport,
    timeoutMs,
    testPlatform: "win32",
    testSystemDirectory: "C:\\Windows\\System32"
  });
}

function request(action: "focus_vscode" | "focus_external_terminal", signal = new AbortController().signal): WindowsHostActionEffectRequest {
  const vscode = action === "focus_vscode";
  return {
    action,
    application: vscode ? "vscode" : "terminal",
    hostActionId: `host-action:${"c".repeat(64)}`,
    operationId: vscode ? "operation-focus-vscode" : "operation-focus-terminal",
    executable: identity(vscode ? "vscode" : "terminal"),
    fixedArguments: vscode ? ["--reuse-window"] : [],
    processOwner: "current-user",
    processSession: "current-session",
    windowSurface: "visible-top-level",
    shell: false,
    signal,
    async beforeEffect() {}
  };
}

test("provisioning asks the fixed helper for host-derived Code and Terminal identities without accepting paths", async () => {
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (value) => {
      assert.deepEqual(Object.keys(value).sort(), ["action", "application", "requestId", "schema", "version"]);
      assert.equal("path" in value, false);
      assert.equal("repositoryRoot" in value, false);
      const application = value.application as "vscode" | "terminal";
      session.responses.push(envelope(value, "result", { action: "provision", identity: identity(application) }));
    };
  };

  const provisioned = await provisionWindowsHostActionApplications({
    transport,
    timeoutMs: 100,
    testPlatform: "win32",
    testSystemDirectory: "C:\\Windows\\System32"
  });

  assert.deepEqual(provisioned, { vscode: identity("vscode"), terminal: identity("terminal") });
  assert.equal(Object.isFrozen(provisioned), true);
  assert.equal(Object.isFrozen(provisioned.vscode), true);
  assert.equal(Object.isFrozen(provisioned.terminal), true);
  assert.equal(transport.sessions.length, 2);
  for (const invocation of transport.invocations) {
    assert.equal(invocation.executable, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    assert.equal(invocation.arguments.slice(0, 4).join(" "), "-NoLogo -NoProfile -NonInteractive -Command");
    assert.equal(invocation.arguments[4], windowsHostActionHelperContractSource);
    assert.deepEqual(invocation.environment, { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" });
    assert.equal(invocation.workingDirectory, "C:\\Windows\\System32");
  }
});

test("focus crosses the host barrier once after READY and authorizes only the exact fixed helper plan", async () => {
  const transport = new FakeTransport();
  const order: string[] = [];
  transport.configure = (session) => {
    session.onWrite = (value) => {
      if (value.kind === "authorize") {
        order.push("authorize");
        session.responses.push(envelope(value, "result", { action: "effect", effect: "focused", processId: 4012, windowId: "hwnd:10af" }));
      } else {
        order.push("prepare");
        assert.equal(value.action, "effect");
        assert.equal(value.effect, "focus_vscode");
        assert.deepEqual(value.fixedArguments, ["--reuse-window"]);
        assert.deepEqual(value.identity, identity("vscode"));
        assert.equal("repositoryRoot" in value, false);
        assert.equal("command" in value, false);
        session.responses.push(envelope(value, "ready", {
          action: "effect", authorizationNonce: "d".repeat(64), mode: "focus", processId: 4012, windowId: "hwnd:10af"
        }));
      }
    };
  };
  const effectRequest = request("focus_vscode");
  let barriers = 0;
  const result = await port(transport).execute({
    ...effectRequest,
    async beforeEffect() { barriers += 1; order.push("barrier"); }
  });

  assert.deepEqual(result, { disposition: "committed", summary: "Focused the exact current-user VS Code window." });
  assert.equal(barriers, 1);
  assert.deepEqual(order, ["prepare", "barrier", "authorize"]);
  const authorization = JSON.parse(transport.sessions[0]!.writes[1]!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(authorization).sort(), ["action", "authorizationNonce", "kind", "requestId", "schema", "version"]);
  assert.equal(authorization.authorizationNonce, "d".repeat(64));
});

test("no matching window uses only the compiled CreateProcess fallback and never accepts caller arguments", async () => {
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (value) => {
      if (value.kind === "authorize") session.responses.push(envelope(value, "result", { action: "effect", effect: "launched", processId: 5013 }));
      else session.responses.push(envelope(value, "ready", { action: "effect", authorizationNonce: "e".repeat(64), mode: "launch" }));
    };
  };

  const result = await port(transport).execute(request("focus_external_terminal"));
  assert.deepEqual(result, { disposition: "committed", summary: "Launched the exact current-user Windows Terminal executable." });
  const prepare = JSON.parse(transport.sessions[0]!.writes[0]!) as Record<string, unknown>;
  assert.deepEqual(prepare.fixedArguments, []);
  assert.equal(prepare.effect, "focus_external_terminal");
});

test("changed identity, caller arguments, or a malformed helper plan fail before the host barrier", async () => {
  const transport = new FakeTransport();
  let barriers = 0;
  const effectPort = port(transport);
  await assert.rejects(effectPort.execute({
    ...request("focus_vscode"),
    executable: { ...identity("vscode"), executableSha256: "f".repeat(64) },
    async beforeEffect() { barriers += 1; }
  }), /identity|changed/i);
  await assert.rejects(effectPort.execute({
    ...request("focus_vscode"),
    fixedArguments: ["--reuse-window", "C:\\hostile-repository"],
    async beforeEffect() { barriers += 1; }
  }), /arguments|request/i);

  transport.configure = (session) => {
    session.onWrite = (value) => session.responses.push(envelope(value, "ready", {
      action: "effect", authorizationNonce: "f".repeat(64), mode: "focus", processId: 1, windowId: "hwnd:hostile", command: "calc.exe"
    }));
  };
  await assert.rejects(effectPort.execute({ ...request("focus_vscode"), async beforeEffect() { barriers += 1; } }), /malformed|response/i);
  assert.equal(barriers, 0);
});

test("barrier refusal and cancellation never send effect authorization and terminate the exact helper", async () => {
  const transport = new FakeTransport();
  transport.configure = (session) => {
    session.onWrite = (value) => session.responses.push(envelope(value, "ready", {
      action: "effect", authorizationNonce: "1".repeat(64), mode: "launch"
    }));
  };
  await assert.rejects(port(transport).execute({
    ...request("focus_external_terminal"),
    async beforeEffect() { throw new Error("durable barrier refused"); }
  }), /barrier refused/);
  assert.equal(transport.sessions[0]?.writes.length, 1);
  assert.equal(transport.sessions[0]?.terminated, true);

  const stalled = new FakeTransport();
  stalled.configure = (session) => { session.onRead = async () => new Promise<string>(() => undefined); };
  const abort = new AbortController();
  const pending = port(stalled, 500).execute(request("focus_vscode", abort.signal));
  setTimeout(() => abort.abort(new Error("test cancellation")), 20);
  await assert.rejects(pending, /cancel/i);
  assert.equal(stalled.sessions[0]?.terminated, true);
});

test("timeouts and post-authorization response mismatches are bounded and never fake a focus claim", async () => {
  const stalled = new FakeTransport();
  stalled.configure = (session) => { session.onRead = async () => new Promise<string>(() => undefined); };
  await assert.rejects(port(stalled, 50).execute(request("focus_vscode")), /timed out/i);
  assert.equal(stalled.sessions[0]?.terminated, true);

  const forged = new FakeTransport();
  forged.configure = (session) => {
    session.onWrite = (value) => {
      if (value.kind === "authorize") session.responses.push(envelope(value, "result", { action: "effect", effect: "launched", processId: 9999 }));
      else session.responses.push(envelope(value, "ready", {
        action: "effect", authorizationNonce: "2".repeat(64), mode: "focus", processId: 4100, windowId: "hwnd:10"
      }));
    };
  };
  await assert.rejects(port(forged).execute(request("focus_vscode")), /effect|focus|mismatch|ambiguous/i);
});

test("the final barrier and exact helper cleanup are bounded and cleanup uncertainty is never hidden", async () => {
  const barrier = new FakeTransport();
  barrier.configure = (session) => {
    session.onWrite = (value) => session.responses.push(envelope(value, "ready", {
      action: "effect", authorizationNonce: "3".repeat(64), mode: "launch"
    }));
  };
  await assert.rejects(port(barrier, 50).execute({
    ...request("focus_external_terminal"),
    async beforeEffect() { await new Promise<void>(() => undefined); }
  }), /barrier timed out/i);
  assert.equal(barrier.sessions[0]?.writes.length, 1);
  assert.equal(barrier.sessions[0]?.terminated, true);

  const cleanup = new FakeTransport();
  cleanup.configure = (session) => {
    session.terminateError = new Error("exact helper survivor unknown");
    session.onWrite = (value) => {
      if (value.kind === "authorize") session.responses.push(envelope(value, "result", { action: "effect", effect: "launched", processId: 6001 }));
      else session.responses.push(envelope(value, "ready", { action: "effect", authorizationNonce: "4".repeat(64), mode: "launch" }));
    };
  };
  await assert.rejects(port(cleanup).execute(request("focus_external_terminal")), /cleanup|ambiguous/i);
  assert.equal(cleanup.sessions[0]?.terminated, true);
});

test("the production transport and helper contract expose the required Windows-native fail-closed boundaries", () => {
  assert.equal(typeof NodeWindowsHostActionHelperTransport, "function");
  for (const required of [
    "GetFinalPathNameByHandleW", "GetFileInformationByHandle", "OpenProcessToken", "WindowsIdentity",
    "ProcessIdToSessionId", "QueryFullProcessImageNameW", "EnumWindows", "IsWindowVisible", "GetWindowThreadProcessId",
    "DwmGetWindowAttribute", "SetForegroundWindow", "GetForegroundWindow", "CreateProcessW", "CREATE_SUSPENDED", "Get-AuthenticodeSignature",
    "FileShare.Read", "FileAttributes.ReparsePoint"
  ]) assert.match(windowsHostActionHelperContractSource, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(windowsHostActionHelperContractSource, /Get-AppxPackage -Name Microsoft\.WindowsTerminal/);
  assert.match(windowsHostActionHelperContractSource, /Candidate \$app/);
  assert.match(windowsHostActionHelperContractSource, /8f43288ad272f3103b6fb1428485ea3014c0bcfe/);
  assert.ok(windowsHostActionHelperContractSource.indexOf("signature_changed") < windowsHostActionHelperContractSource.indexOf("$prepared.Execute"));
  assert.doesNotMatch(windowsHostActionHelperContractSource, /Invoke-Expression|Start-Process|\$env:|cmd\.exe/i);
});

test("production entry points fail closed on non-Windows before starting any helper", async () => {
  const transport = new FakeTransport();
  await assert.rejects(provisionWindowsHostActionApplications({ transport, testPlatform: "linux" }), /Windows/i);
  const effectPort = new PinnedWindowsHostActionEffectPort({
    applications: { vscode: identity("vscode"), terminal: identity("terminal") }, transport, testPlatform: "linux"
  });
  await assert.rejects(effectPort.execute(request("focus_vscode")), /Windows/i);
  assert.equal(transport.sessions.length, 0);
});
