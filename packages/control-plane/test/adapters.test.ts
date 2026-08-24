import assert from "node:assert/strict";
import test from "node:test";
import { commandForAction } from "../src/command-catalog.ts";
import { AdapterRegistry, InMemoryCommandAdapter, UnavailableDesktopAdapter, UnavailableProviderAdapter } from "../src/adapters.ts";
import { InMemoryContainmentManager } from "../src/containment.ts";
import type { TargetSnapshot } from "../src/contracts.ts";

const target: TargetSnapshot = {
  id: "snapshot-1", repositoryRoot: "C:/work/example", canonicalRemote: "https://github.com/example/repo.git",
  branch: "feature/safe", head: "abc", indexTree: "tree", trackedManifest: "tracked", untrackedManifest: "untracked",
  submodules: {}, policyVersion: "policy-1", environmentFingerprint: "env-1", capturedAt: "2026-08-23T12:00:00.000Z", completeness: "complete", reasons: []
};

test("unavailable desktop and provider adapters report capability degradation without falling back to another surface", async () => {
  const desktop = new UnavailableDesktopAdapter("Claude Desktop is not installed");
  const provider = new UnavailableProviderAdapter("Claude provider handshake is unavailable");

  const desktopResult = await desktop.execute({ definition: commandForAction("open_claude") });
  const providerResult = await provider.execute({ definition: commandForAction("reanchor") });
  assert.equal(desktopResult.status, "unavailable");
  assert.match(desktopResult.summary, /Claude Desktop/i);
  assert.equal(providerResult.status, "unavailable");
  assert.match(providerResult.summary, /handshake/i);
});

test("registry runs only a specifically registered in-memory adapter action", async () => {
  const registry = new AdapterRegistry();
  const adapter = new InMemoryCommandAdapter("test-adapter");
  let calls = 0;
  adapter.register("focus_vscode", () => { calls += 1; return { status: "completed", summary: "simulated focus" }; });
  registry.register("focus_vscode", adapter);

  const complete = await registry.execute({ definition: commandForAction("focus_vscode") });
  assert.equal(complete.status, "completed");
  assert.equal(calls, 1);
  const missing = await registry.execute({ definition: commandForAction("open_chatgpt") });
  assert.equal(missing.status, "unavailable");
  assert.equal(calls, 1);
});

test("active containment blocks a managed agent adapter route before its registered adapter handler", async () => {
  const containment = new InMemoryContainmentManager();
  containment.activate({ repositoryRoot: target.repositoryRoot, operationId: "containment", reason: "test" });
  const registry = new AdapterRegistry(containment);
  const adapter = new InMemoryCommandAdapter("contained-adapter");
  let calls = 0;
  adapter.register("reanchor", () => { calls += 1; return { status: "completed", summary: "must not run" }; });
  registry.register("reanchor", adapter);

  const result = await registry.execute({ definition: commandForAction("reanchor"), target });
  assert.equal(result.status, "blocked");
  assert.equal(calls, 0);
});
