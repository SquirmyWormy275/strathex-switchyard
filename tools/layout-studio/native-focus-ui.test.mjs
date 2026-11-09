import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { writeFile } from "node:fs/promises";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";
import { createWindowsNativeFocus } from "./windows-native-focus.mjs";

async function fixture(fn, platform = "linux") {
  const f = { effects: 0, probes: 0, helpers: 0, windows: true, uncertain: false, originalExited: false, notices: [] };
  const window = { pid: 4100, address: "0x1234", initialClass: "chatgpt", mapped: true, hidden: false, floating: false };
  return browserSurfaceFixture(async c => {
    await c.store.initialize("work", "work");
    f.root = c.root; f.path = join(c.root, "ChatGPT.exe"); f.helper = join(c.root, "Switchyard.Hotkeys.exe");
    await writeFile(f.path, "synthetic app bytes"); await writeFile(f.helper, "synthetic native helper");
    const { mountNativeFocus } = await import("./client-ui.mjs"); mountNativeFocus({ notify: message => f.notices.push(message) });
    await c.refresh(); await until(() => c.$("native-app-picker").options.length === (platform === "win32" ? 3 : 2) && !c.$("refresh-native-apps").disabled);
    await fn({ ...c, f, window, platform });
  }, {
    platform,
    hypr: async (command, argument) => {
      f.probes++;
      if (command === "clients") return JSON.stringify(f.windows ? [window] : []);
      if (command === "activewindow") return JSON.stringify(window);
      assert.equal(command, "dispatch"); assert.match(argument, /address:0x1234/); f.effects++; return "ok";
    },
    nativeProcess: async pid => ({ pid, uid: userInfo().uid, executable: window.initialClass === "chatgpt" ? join(homedir(), ".local/lib/chatgpt-visible-voice/native/ChatGPT") : "/usr/share/code/code", state: "S", startTicks: "100" }),
    windowsNativeFocusFactory: options => {
      if (platform !== "win32") return createWindowsNativeFocus(options);
      f.service = createWindowsNativeFocus({ ...options,
        signatureProbe: { inspect: async () => ({ signerSubject: "CN=Isolated UI Fixture", signerThumbprint: "a".repeat(40) }) },
        helper: async () => ({ path: f.helper, sha256: "b".repeat(64) }),
        observeExit: async () => f.originalExited,
        processFactory: async callbacks => {
          let owned;
          const start = async () => { owned = { processId: 7000 + ++f.helpers, processStartTime: String(133000000000000000n + BigInt(f.helpers)) }; await callbacks.onHelperOwned(owned); };
          const stop = async () => { if (owned && !f.uncertain) { await callbacks.onHelperStopped(owned); owned = null; } };
          return {
            async listRunning(identity) { f.probes++; await start(); await stop(); return f.windows ? [{ processId: 4100, processStartTime: "133000000000000001", windowId: "hwnd:1234", identity }] : []; },
            async focusExisting(input) { await start(); await input.beforeEffect(); f.effects++; await stop(); return { processId: 4100 }; },
            async retireOwned() { await stop(); return { stopped: !owned }; }
          };
        }
      }); return f.service;
    }
  });
}
async function openReview(c, id) { c.click(id); await until(() => c.$("native-app-review-dialog").open && !c.$("confirm-native-app-review").disabled); }
async function settled(c) { await until(() => !c.$("refresh-native-apps").disabled && c.$("native-app-picker").options.length === (c.platform === "win32" ? 3 : 2)); }
async function setup(c) {
  c.$("native-app-path").value = c.f.path; c.$("native-app-path").dispatchEvent(new Event("input"));
  await openReview(c, "review-native-app-setup"); c.click("confirm-native-app-review");
  await until(() => c.$("native-app-status").textContent.includes("Exact application saved")); await settled(c);
}

test("saved Linux app choices are passive and a cancelled review never inspects a window", () => fixture(async c => {
  assert.equal(c.f.probes, 0); assert.equal(c.f.effects, 0); assert.equal(c.$("native-app-setup").hidden, true);
  await openReview(c, "review-native-app-focus"); assert.match(c.$("native-app-review-summary").textContent, /No app is started/);
  c.click("cancel-native-app-review"); c.click("refresh-native-apps"); await settled(c); assert.equal(c.f.probes, 0);
  await assert.rejects(c.suite.handle("/api/suite/native-focus/catalog", { compartment: "personal", executablePath: "foreign" }), /Read only/);
}));

test("reviewed Linux navigation uses the exact app and active-workspace gateway without text or account claims", () => fixture(async c => {
  for (const implementation of ["native-chatgpt.focus/v1", "native-vscode.focus/v1"]) {
    c.change("native-app-picker", implementation); c.window.initialClass = implementation.includes("vscode") ? "code" : "chatgpt";
    await openReview(c, "review-native-app-focus"); c.click("confirm-native-app-review"); await until(() => c.$("native-app-status").textContent.includes("focused and read back")); await settled(c);
  }
  assert.equal(c.f.effects, 2); const calls = c.calls.filter(row => row.path === "/api/suite/native-focus/focus");
  assert.equal(calls.length, 2); assert.deepEqual(Object.keys(calls[0].body).sort(), ["compartment", "implementation", "requestId"]);
  assert.notEqual(calls[0].body.requestId, calls[1].body.requestId); assert.match(c.$("native-app-status").textContent, /task resumption are not established/);
}));

test("changed UI selection invalidates review and stale Personal focus cannot redirect the selected Work workspace", () => fixture(async c => {
  await openReview(c, "review-native-app-focus"); c.change("native-app-picker", "native-vscode.focus/v1"); assert.equal(c.$("native-app-review-dialog").open, false);
  await openReview(c, "review-native-app-focus"); await c.suite.handle("/api/suite/compartment/select", { compartment: "work" });
  c.click("confirm-native-app-review"); await until(() => c.f.notices.length > 0); await settled(c); assert.equal(c.f.effects, 0);
  c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") }));
  await until(() => /requires a Personal/.test(c.$("native-app-detail").textContent)); assert.equal(c.$("review-native-app-focus").disabled, true);
}));

test("missing windows and lost focus replies remain explicit; metadata refresh never repeats focus", () => fixture(async c => {
  c.f.windows = false; await openReview(c, "review-native-app-focus"); c.click("confirm-native-app-review"); await until(() => c.f.notices.length > 0); await settled(c); assert.equal(c.f.effects, 0);
  c.f.windows = true; const fetch = globalThis.fetch;
  globalThis.fetch = async (path, options) => { const result = await fetch(path, options); if (path === "/api/suite/native-focus/focus") throw Error("Synthetic lost focus reply"); return result; };
  try { await openReview(c, "review-native-app-focus"); c.click("confirm-native-app-review"); await until(() => c.f.effects === 1 && c.$("native-app-status").textContent.includes("Synthetic lost focus reply")); await settled(c); }
  finally { globalThis.fetch = fetch; }
  assert.match(c.$("native-app-status").textContent, /Focus may have occurred/); c.click("refresh-native-apps"); await settled(c); assert.equal(c.f.effects, 1);
}));

test("a stale app review cannot focus from another Personal workspace even when both policies permit it", () => fixture(async c => {
  await c.store.initialize("personal-second", "personal"); await c.store.update("personal-second", "synthetic-mode", s => { s.mode = "personal-companion"; });
  await openReview(c, "review-native-app-focus"); await c.suite.handle("/api/suite/compartment/select", { compartment: "personal-second" });
  c.click("confirm-native-app-review"); await until(() => c.f.notices.some(n => /selected workspace changed/.test(n))); await settled(c);
  assert.equal(c.f.effects, 0); assert.equal(c.f.probes, 0);
  await assert.rejects(c.suite.handle("/api/suite/native-focus/focus", { compartment: "personal-second", implementation: "switchyard.role/v1", roleId: "operator" }), /exact native app/);
}));

test("Windows executable setup is reviewed before save and actual focus rechecks the protected binding", () => fixture(async c => {
  assert.equal(c.$("native-app-setup").hidden, false); assert.equal(c.$("review-native-app-focus").disabled, true); assert.equal(c.f.probes, 0);
  c.$("native-app-path").value = c.f.path; c.$("native-app-path").dispatchEvent(new Event("input")); await openReview(c, "review-native-app-setup");
  assert.match(c.$("native-app-review-summary").textContent, /CN=Isolated UI Fixture/); assert.equal((await c.store.snapshot("personal")).nativeWindowsChatgpt, undefined);
  c.click("cancel-native-app-review"); await setup(c); assert.equal(c.f.effects, 0); assert.equal(c.f.probes, 0);
  await openReview(c, "review-native-app-focus"); c.click("confirm-native-app-review"); await until(() => c.$("native-app-status").textContent.includes("focused and read back")); await settled(c);
  assert.equal(c.f.effects, 1); assert.match(c.$("native-app-history").children[0].textContent, /completed/);
  await writeFile(c.f.path, "changed app bytes"); await openReview(c, "review-native-app-focus"); c.click("confirm-native-app-review"); await until(() => c.f.notices.some(n => /identity changed/.test(n))); await settled(c); assert.equal(c.f.effects, 1);
}, "win32"));

test("lost Windows configuration reply refreshes exact saved identity without replaying its one-use confirmation", () => fixture(async c => {
  c.$("native-app-path").value = c.f.path; c.$("native-app-path").dispatchEvent(new Event("input")); await openReview(c, "review-native-app-setup");
  const fetch = globalThis.fetch; globalThis.fetch = async (path, options) => { const response = await fetch(path, options); if (path.endsWith("native-focus/configure")) throw Error("Synthetic lost configuration reply"); return response; };
  try { c.click("confirm-native-app-review"); await until(() => c.f.notices.some(n => /Synthetic lost configuration reply/.test(n))); await settled(c); } finally { globalThis.fetch = fetch; }
  assert.match(c.$("native-app-detail").textContent, /Saved ChatGPT executable/); assert.equal(c.$("review-native-app-focus").disabled, false);
  assert.equal(c.calls.filter(row => row.path.endsWith("native-focus/configure")).length, 1); assert.equal(c.f.effects, 0);
}, "win32"));

test("Windows Claude Desktop selection reviews and focuses only its separately saved native application", () => fixture(async c => {
  let sharedRefreshes = 0; c.document.addEventListener("switchyard-refresh-request", () => { sharedRefreshes++; });
  c.change("native-app-picker", "native-claude-desktop.focus/v1");
  assert.equal(c.$("review-native-app-focus").disabled, true); assert.match(c.$("native-app-detail").textContent, /Claude Desktop/);
  await setup(c); await until(() => sharedRefreshes === 1); const saved = await c.store.snapshot("personal");
  assert.equal(saved.nativeWindowsClaude.identity.productIdentity.productId, "anthropic.claude-desktop");
  assert.equal(saved.nativeWindowsChatgpt, undefined); assert.equal(c.f.effects, 0);
  await openReview(c, "review-native-app-focus"); assert.match(c.$("native-app-review-summary").textContent, /open Claude Desktop/);
  c.click("confirm-native-app-review"); await until(() => c.$("native-app-status").textContent.includes("Claude Desktop window was focused")); await settled(c);
  assert.equal(c.f.effects, 1); assert.equal(c.calls.find(row => row.path.endsWith("native-focus/focus")).body.implementation, "native-claude-desktop.focus/v1");
  c.change("native-app-picker", "native-chatgpt.focus/v1"); assert.equal(c.$("review-native-app-focus").disabled, true);
}, "win32"));

test("Linux refuses Claude Desktop focus without probing another application or showing a configured choice", () => fixture(async c => {
  assert(![...c.$("native-app-picker").options].some(row => row.value === "native-claude-desktop.focus/v1"));
  await assert.rejects(c.suite.handle("/api/suite/native-focus/focus", { compartment: "personal", implementation: "native-claude-desktop.focus/v1", requestId: "11111111-1111-4111-8111-111111111111" }), /Linux is unfinished/);
  assert.equal(c.f.probes, 0); assert.equal(c.f.effects, 0);
}));

test("Windows retired-helper review preserves the original uncertain result and cannot refocus the app", () => fixture(async c => {
  await setup(c);
  // Record an existing uncertain original owner without invoking a native process.
  await c.store.update("personal", "synthetic-retained-helper", s => { s.mode = "keyboard-only"; s.nativeFocusOperations = [{ id: "11111111-1111-4111-8111-111111111111", implementation: "native-chatgpt.focus/v1", kind: "focus", status: "outcome-unconfirmed", effectAuthorized: true, helpers: [{ identity: { processId: 7777, processStartTime: "133000000000000001" }, helperSha256: "b".repeat(64), stopped: false }] }]; });
  c.click("refresh-native-apps"); await until(() => !c.$("recover-native-app").disabled);
  await openReview(c, "recover-native-app"); assert.match(c.$("native-app-review-summary").textContent, /does not retry focus/); c.f.originalExited = true; c.click("confirm-native-app-review");
  await until(() => c.$("native-app-status").textContent.includes("Original helpers retired")); await settled(c);
  assert.equal(c.$("recover-native-app").disabled, true); assert.equal(c.$("review-native-app-focus").disabled, true); assert.equal(c.f.effects, 0); assert.match(c.$("native-app-history").children[0].textContent, /outcome-unconfirmed/); assert.equal((await c.store.snapshot("personal")).mode, "keyboard-only");
}, "win32"));

test("late Windows executable review cannot populate a replacement workspace", () => fixture(async c => {
  const fetch = globalThis.fetch; let release, entered = false; const wait = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (path, options) => { const response = await fetch(path, options); if (path.endsWith("native-focus/review")) { entered = true; await wait; } return response; };
  try {
    c.$("native-app-path").value = c.f.path; c.$("native-app-path").dispatchEvent(new Event("input")); c.click("review-native-app-setup"); await until(() => entered);
    c.document.dispatchEvent(new Event("switchyard-workspace-changing")); c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await c.store.snapshot("work") })); release(); await settled(c);
    assert.equal(c.$("native-app-review-dialog").open, false); assert.equal(c.$("native-app-path").value, ""); assert.equal(c.$("review-native-app-focus").disabled, true); assert.equal(c.f.effects, 0);
  } finally { release(); globalThis.fetch = fetch; }
}, "win32"));
