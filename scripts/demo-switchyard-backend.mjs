#!/usr/bin/env node
/** A connected product walkthrough with fresh encrypted state and an explicit synthetic agent. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { createSuite } from "../tools/layout-studio/suite.mjs";
import { createStudioServer } from "../tools/layout-studio/serve.mjs";
import { standardPreset } from "../tools/layout-studio/catalog.mjs";
import { compileConnection } from "../tools/layout-studio/workspace.mjs";
import { switchyardAgent } from "../integrations/agent-sdk.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function host(root) {
  const keys = new Map(), secrets = {
    get: async (id, purpose) => keys.get(id + ":" + purpose),
    set: async (id, purpose, value) => { keys.set(id + ":" + purpose, value); }
  };
  const store = createSuiteStore({ root, secrets });
  const suite = createSuite({
    store,
    agents: { discovery: async () => [], close: async () => {}, stopCompartment: async () => {} },
    voice: { discovery: async () => ({ available: false, reason: "Audio is outside this synthetic walkthrough." }) },
    foreground: { implemented: false, close: async () => {}, stopCompartment: async () => {} }
  });
  const token = randomBytes(32).toString("base64url");
  const server = createStudioServer({ suite, token, bridge: { close() {} }, discover: async () => ({}) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const api = async (route, body = {}, expected = 200, authenticated = true) => {
    const response = await fetch(origin + "/api/suite/" + route, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json",
        ...(authenticated ? { Authorization: "Bearer " + token } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
    });
    assert.equal(response.status, expected, "Unexpected API result for " + route);
    return response.json();
  };
  let closed = false;
  return { store, api, origin, secrets, async close() {
    if (closed) return; closed = true;
    const results = await Promise.allSettled([
      suite.close(),
      new Promise((done, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : done()); })
    ]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
  } };
}

export async function demonstrateBackend() {
  const root = await mkdtemp(join(tmpdir(), "switchyard-backend-demo-")), owner = await lstat(root);
  const hosts = [], stages = [];
  const passed = (id, detail) => stages.push({ id, passed: true, ...detail });
  let report, failure;
  try {
    const first = await host(join(root, "first")); hosts.push(first);
    await first.api("bootstrap");
    await first.api("snapshot", {}, 401, false);
    const catalog = JSON.parse(await readFile(new URL("../tools/layout-studio/model-f-catalog.json", import.meta.url), "utf8"));
    const preset = standardPreset(catalog, "f77-classic", { typing: "dvorak" }).portable;
    await first.api("profile/save", { profile: preset });
    await first.api("workflow/save", { workflow: preset.workflow });
    assert.equal((await first.api("snapshot")).mode, "keyboard-only");
    assert.throws(() => compileConnection(preset.plan, "task-resume", "native-chatgpt.focus/v1"), /reference typing layer/);
    passed("start-with-preset", { model: "F77 Classic", typing: "Dvorak reference", controls: preset.plan.actions.length, hardwareVerified: false });

    await first.api("mode", { mode: "personal-companion" });
    const enrollment = await first.api("agents/enroll", { id: "demo-agent", name: "Synthetic demo agent", capabilities: ["status"] });
    const sdk = switchyardAgent({ ...enrollment, baseUrl: first.origin + "/", compartment: "personal", agentId: "demo-agent" });
    const sessionId = randomUUID(); await sdk.publish(sessionId, "ready");
    const roleId = preset.workflow.roles[0].id;
    const choices = await first.api("roles/choices", { roleId, intent: "status" });
    const selected = choices.choices.find(row => row.targetId === "demo-agent"); assert(selected);
    const { label, ...selection } = selected;
    await first.api("roles/bind-choice", { roleId, intent: "status", ...selection });
    await first.api("roles/bind-choice", { roleId, intent: "status", ...selection }, 409);
    passed("connect-a-role", { namedChoice: label, supportedIntent: "status", staleChoiceRefused: true, syntheticAgent: true });

    const recording = await first.api("observation/start", { consent: true, sources: ["deliberate", "agent-events"], exclusions: [] });
    await first.api("observation/mark", { id: recording.id, kind: "resume" });
    await first.api("observation/mark", { id: recording.id, kind: "handoff" });
    const dispatched = await first.api("intent", { implementation: "switchyard.role/v1", roleId, intent: "status" });
    const { command } = await sdk.poll(); assert.equal(command.id, dispatched.commandId); assert.equal(command.intent, "status");
    await sdk.acknowledge(command.id, "completed");
    const observed = await first.api("snapshot"), count = observed.observations[0].events.length;
    assert(observed.observationSummaries[0].suggestions.length >= 2);
    assert(observed.observations[0].events.some(event => event.phase === "adapter-command-acknowledged"));
    passed("observe-and-use-control", { deliberateMarks: 2, commandAcknowledged: true, taskCompletionVerified: false, suggestions: observed.observationSummaries[0].suggestions.length });

    await first.api("observation/state", { id: recording.id, status: "paused" });
    await sdk.publish(sessionId, "busy");
    assert.equal((await first.api("snapshot")).observations[0].events.length, count);
    await first.api("observation/state", { id: recording.id, status: "recording" });
    await sdk.publish(sessionId, "idle");
    const summary = await first.api("observation/state", { id: recording.id, status: "stopped" });
    assert(summary.events > count);
    const revised = { ...preset.workflow, name: "Keep my place with a deliberate handoff" };
    await first.api("workflow/save", { workflow: revised });
    passed("review-and-refine", { pausedReportOmitted: true, recordingStopped: summary.status === "stopped", workflowName: revised.name });

    const exported = await first.api("profile/package/export");
    const document = exported.document; assert.equal(document.schema, "switchyard-profile/v2");
    assert.equal(document.workflow.name, revised.name);
    const text = JSON.stringify(document);
    for (const privateValue of [enrollment.token, sessionId, "demo-agent", "Synthetic demo agent"]) assert(!text.includes(privateValue));
    await first.api("observation/delete", { id: recording.id });
    assert.equal((await first.api("snapshot")).observations.length, 0);
    await sdk.publish(sessionId, "stopped");
    await first.api("mode", { mode: "keyboard-only" });
    await first.close();
    const reopened = createSuiteStore({ root: join(root, "first"), secrets: first.secrets });
    const restored = await reopened.snapshot("personal");
    assert.equal(restored.workflow.name, revised.name); assert.equal(restored.mode, "keyboard-only");
    assert.equal(restored.observations.length, 0);
    passed("save-export-and-reopen", { profileSchema: document.schema, profileSha256: digest(text), localIdentityExported: false, deletionPersisted: true });

    const second = await host(join(root, "second")); hosts.push(second);
    await second.api("bootstrap");
    const review = await second.api("profile/package/review", { document });
    await second.api("profile/package/import", { document, reviewId: review.reviewId });
    const imported = await second.api("snapshot");
    assert.equal(imported.mode, "keyboard-only"); assert.equal(imported.agents.length, 0); assert.equal(imported.roleBindings.length, 0);
    assert.equal(imported.profile.plan.actions.length, 4);
    assert.equal(imported.workflow.name, revised.name);
    const roundtrip = await second.api("profile/package/export"); assert.deepEqual(roundtrip.document, document);
    passed("move-to-a-second-host", { controls: 4, mode: imported.mode, connectionsTransferred: 0, exactPortableRoundtrip: true, secondHostSimulated: true });

    await second.api("compartment/create", { compartment: "work", policy: "work" });
    await second.api("compartment/select", { compartment: "work" });
    await second.api("mode", { compartment: "work", mode: "managed-companion" });
    await second.api("agents/enroll", { compartment: "work", id: "blocked", name: "Blocked", capabilities: ["status"] }, 409);
    await second.api("observation/start", { compartment: "work", consent: true, sources: ["agent-events"], exclusions: [] }, 409);
    await second.api("profile/package/export", { compartment: "work" }, 409);
    passed("respect-work-policy", { personalAgentRefused: true, recordingRefused: true, exportRefused: true });
    report = { schema: "switchyard-backend-demo/v1", success: true, synthetic: true, stages,
      limitations: ["The agent is a deliberate local fixture; no model, account, IDE or external task is exercised.",
        "The F77 preset is a source reference; no keyboard, host shortcut or desktop configuration is read or changed.",
        "This demonstration covers the named connected backend journey, not full-suite or physical acceptance."] };
  } catch (error) { failure = error; }
  const cleanupErrors = [];
  for (const item of hosts.reverse()) { try { await item.close(); } catch (error) { cleanupErrors.push(error); } }
  if (!cleanupErrors.length) {
    const current = await lstat(root);
    assert.equal(current.dev, owner.dev); assert.equal(current.ino, owner.ino); assert(current.isDirectory() && !current.isSymbolicLink());
    await rm(root, { recursive: true, maxRetries: 5, retryDelay: 40 });
    await assert.rejects(lstat(root), { code: "ENOENT" });
  }
  if (failure || cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors].filter(Boolean), "The synthetic backend demonstration did not complete.");
  return { ...report, cleanup: { serversClosed: true, temporaryEncryptedStateRemoved: true, newDependencies: false } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--synthetic"], "Use exactly --synthetic; no installed state, credentials or device arguments are accepted.");
  console.log(JSON.stringify(await demonstrateBackend(), null, 2));
}

