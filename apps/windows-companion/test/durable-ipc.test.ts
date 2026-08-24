import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthenticatedLocalPipeTransport, JsonLineCompanionBridge, readLocalCompanionConfiguration } from "../../vscode-extension/src/companion-bridge.ts";
import { createCompanionConfiguration } from "../src/local-runtime.ts";
import { DurableLocalIpcServer } from "../src/durable-ipc.ts";
import { CompanionService } from "../src/service.ts";

test("configured extension transport authenticates a real local pipe and fails closed on a bad token", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-durable-ipc-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const configuration = await createCompanionConfiguration(directory);
  const server = new DurableLocalIpcServer(configuration, new CompanionService());
  await server.start();
  context.after(async () => { await server.stop(); });

  const configured = await readLocalCompanionConfiguration(join(directory, "config.json"));
  const bridge = new JsonLineCompanionBridge(new AuthenticatedLocalPipeTransport(configured));
  const registered = await bridge.registerSession({
    id: "extension-window", provider: "generic", surface: "vscode_window", capabilities: ["registered", "mediated"], status: "verified_finished",
    plannedFiles: [], lastHeartbeat: "2026-08-23T00:00:00.000Z", adapterVersion: "test", metadata: {}
  });
  assert.equal(registered.ok, true);
  assert.deepEqual(registered.ok ? registered.value.capabilities : [], ["registered"]);
  const rejected = await new JsonLineCompanionBridge(new AuthenticatedLocalPipeTransport({ ...configured, token: "0".repeat(64) })).dispatch({ control: "VSCODE", modifier: "normal" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok ? undefined : rejected.code, "companion_unavailable");
});
