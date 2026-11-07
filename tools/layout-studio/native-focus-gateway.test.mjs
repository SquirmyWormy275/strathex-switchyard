import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir, userInfo } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createSuite } from "./suite.mjs";
import { createStudioServer } from "./serve.mjs";

// Independent complete gateway file: retain the original 45-second bound.
test("the authenticated native focus gateway rechecks actual selected workspace and mode around exact dispatch", async t => {
  for (const app of ["chatgpt", "vscode"]) for (const mutation of ["none", "selection-before-effect", "workspace-round-trip", "mode-before-effect", "mode-after-effect"]) await t.test(app + " · " + mutation, async () => {
    const root = await mkdtemp(join(tmpdir(), "switchyard-native-focus-policy-")), keys = new Map();
    const store = createSuiteStore({ root, secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } } });
    await store.initialize("personal"); await store.initialize("company", "work"); await store.update("personal", "synthetic-companion", s => { s.mode = "personal-companion"; });
    const window = { pid: 123, address: "0x123", initialClass: app === "chatgpt" ? "chatgpt" : "code", mapped: true, hidden: false, floating: false }; let observations = 0, dispatches = 0;
    const hypr = async command => {
      if (command === "clients") {
        if (++observations === 2 && mutation === "selection-before-effect") await store.selection("company");
        if (observations === 2 && mutation === "workspace-round-trip") {
          await suite.handle("/api/suite/compartment/select", { compartment: "company" });
          await suite.handle("/api/suite/compartment/select", { compartment: "personal" });
        }
        if (observations === 2 && mutation === "mode-before-effect") await store.update("personal", "synthetic-revocation", s => { s.mode = "keyboard-only"; });
        return JSON.stringify([window]);
      }
      if (command === "dispatch") { dispatches++; if (mutation === "mode-after-effect") await store.update("personal", "synthetic-revocation", s => { s.mode = "keyboard-only"; }); return "ok\n"; }
      if (command === "activewindow") return JSON.stringify(window);
      throw Error("Unexpected native focus command");
    };
    const suite = createSuite({ store, platform: "linux", hypr, nativeProcess: async pid => ({ pid, uid: userInfo().uid, executable: app === "chatgpt" ? join(homedir(), ".local/lib/chatgpt-visible-voice/native/ChatGPT") : "/usr/share/code/code", state: "S", startTicks: "12345" }), agents: { discovery: async () => [], close() {} }, voice: { discovery: async () => ({ available: false }) } });
    const server = createStudioServer({ suite, bridge: { close() {} }, token: "b".repeat(43) }); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const invoke = authenticated => fetch(origin + "/api/suite/intent", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(authenticated ? { Authorization: `Bearer ${server.accessToken}` } : {}) }, body: JSON.stringify({ implementation: `native-${app}.focus/v1` }) });
    try {
      const denied = await invoke(false); await denied.arrayBuffer(); assert.equal(denied.status, 401); assert.equal(observations, 0);
      const response = await invoke(true), result = await response.json();
      assert.equal(response.status, mutation === "none" ? 200 : 409, JSON.stringify(result));
      assert.equal(dispatches, mutation === "none" || mutation === "mode-after-effect" ? 1 : 0);
      if (mutation === "none") { assert.equal(result.windowFocusVerified, true); assert.equal(result.modelPromptSubmitted, false); assert.equal(result.accountVerified, false); }
      else assert.equal(result.windowFocusVerified, undefined);
      if (mutation === "selection-before-effect") assert.equal(await store.selection(), "company");
      if (mutation === "workspace-round-trip") { assert.equal(await store.selection(), "personal"); assert.match(result.error, /workspace changed/); }
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.cleanup(); await rm(root, { recursive: true, force: true }); }
  });
});
