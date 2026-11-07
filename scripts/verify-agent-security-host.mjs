#!/usr/bin/env node
/** Verify installed agent authorization using isolated in-memory doubles. No user keys, agents, recordings or provider tasks are modified. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { applicationStatus } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
const flags = process.argv.slice(2);
if (process.platform !== "linux" || flags.length !== 1 || flags[0] !== "--read-only-metadata")
    throw Error("Usage on the pilot: node scripts/verify-agent-security-host.mjs --read-only-metadata");
const app = await applicationStatus();
assert.equal(app.status, "ready");
const { verifySuiteRelease } = await import("../deployment/suite/release.mjs");
const root = join(installationRoot(), "versions", app.build), m = await verifySuiteRelease(root, { expectedId: app.build, platform: "linux", checkRuntime: true }), checks = [], moduleDigests = {};
assert.equal(m.development, false);
const built = { source: m.sourceCommit, id: m.id };
for (const [evidence, names] of [["credential-process-source-summary.json", ["tools/layout-studio/credential-process.mjs"]], ["agent-stop-retirement-source-summary.json", ["tools/layout-studio/custom-agents.mjs"]], ["custom-agent-outcome-source-summary.json", ["tools/layout-studio/agent-observation.mjs"]], ["foreground-owner-source-summary.json", ["tools/layout-studio/foreground.mjs"]], ["hotkey-owner-source-summary.json", ["tools/layout-studio/windows-host.mjs"]], ["scanner-history-review-source-summary.json", ["tools/layout-studio/git-index-inputs.mjs", "tools/layout-studio/git-history-inputs.mjs", "tools/layout-studio/repository-inspection.mjs", "packages/control-plane/src/git-inspector.ts", "packages/control-plane/src/git-index-tree.ts"]], ["codex-0167-contract-summary.json", ["tools/layout-studio/agents.mjs", "tools/layout-studio/codex-requests.mjs", "tools/layout-studio/codex-turn.mjs", "tools/layout-studio/codex-submissions.mjs"]], ["design-observations-source-summary.json", ["tools/layout-studio/design-observations.mjs", "tools/layout-studio/catalog-source.mjs", "tools/layout-studio/haptic-capabilities.mjs"]], ["scanner-recipe-draft-source-summary.json", ["tools/layout-studio/scanner-fixtures.mjs", "apps/windows-companion/src/scanner-fixtures.ts"]], ["scanner-recipe-save-source-summary.json", ["tools/layout-studio/suite.mjs", "tools/layout-studio/scanner-recipe-draft.mjs", "tools/layout-studio/scanner-recipe-files.mjs", "packages/control-plane/src/confirmations.ts", "deployment/suite/release.mjs", "tools/layout-studio/legend-template.mjs", "tools/layout-studio/legend-export.mjs"]], ["windows-scanner-recipe-save-source-summary.json", ["tools/layout-studio/scanner-recipe-save.mjs", "tools/layout-studio/windows-scanner-recipe-files.mjs"]], ["windows-native-focus-source-summary.json", ["tools/layout-studio/suite-store.mjs"]], ["windows-vscode-focus-source-summary.json", ["tools/layout-studio/windows-native-focus.mjs"]], ["sdk-persistence-source-summary.json", ["integrations/agent-sdk.mjs", "integrations/switchyard_agent.py"]], ["scanner-mixed-input-source-summary.json", ["tools/layout-studio/task-authority.mjs", "tools/layout-studio/shield-git-inputs.mjs", "tools/layout-studio/repository-execution.mjs", "tools/layout-studio/repository-windows-execution.mjs", "tools/layout-studio/windows-reviewed-inputs.mjs", "tools/layout-studio/windows-reviewed-runner.mjs", "tools/layout-studio/windows-history-inputs.mjs", "apps/linux-companion/src/linux-repository-inputs.ts"]]]) {
    const e = JSON.parse(await readFile(new URL("../docs/evidence/" + evidence, import.meta.url), "utf8"));
    for (const name of names) {
        const digest = createHash("sha256").update(await readFile(join(root, name))).digest("hex");
        assert.equal(digest, e.sourceFiles[name]);
        moduleDigests[name] = digest;
    }
}
checks.push("exact-tested-installed-module-hashes");
const load = name => import(pathToFileURL(join(root, name)).href), { createCredentialProcessRunner } = await load("tools/layout-studio/credential-process.mjs");
const { isReviewedCodexVersion } = await load("tools/layout-studio/codex-requests.mjs");
const { reviewedCodexVersion, codexDesignConfig, assertCodexDesignConfig, codexRestrictedProcessArguments } = await load("tools/layout-studio/agents.mjs");
for (const version of ["0.166.0", "0.167.0"]) {
    assert.equal(isReviewedCodexVersion(version), true);
    assert.equal(reviewedCodexVersion({ userAgent: `switchyard/${version} (synthetic metadata)` }, "switchyard"), version);
}
for (const version of ["0.166.1", "0.167.1", "0.168.0", "0.167.0-preview", null]) {
    assert.equal(isReviewedCodexVersion(version), false);
    assert.throws(() => reviewedCodexVersion({ userAgent: `switchyard/${version} (synthetic metadata)` }, "switchyard"), /not verified/);
}
for (const userAgent of ["another/0.167.0 (synthetic)", "switchyard/0.167.0 (synthetic)\n", "switchyard/0.167.0"]) {
    assert.throws(() => reviewedCodexVersion({ userAgent }, "switchyard"), /verified/);
}
checks.push("installed-codex-admits-only-exact-reviewed-versions-and-client-identity");
const restricted = codexDesignConfig(["synthetic_mcp"]);
assert.equal(Object.keys(restricted.features).length, 42);
assert.ok(Object.values(restricted.features).every(value => value === false));
assert.doesNotThrow(() => assertCodexDesignConfig(restricted));
const restrictedArgs = codexRestrictedProcessArguments("/synthetic/codex", ["synthetic_mcp"]);
for (const name of Object.keys(restricted.features)) {
    assert.ok(restrictedArgs.includes(`features.${name}=false`));
    for (const value of [true, undefined]) {
        assert.throws(() => assertCodexDesignConfig({ ...restricted, features: { ...restricted.features, [name]: value } }), /No design turn/);
    }
}
checks.push("installed-codex-all-forty-two-restrictions-applied-and-read-back");
for (const changed of [{ model_provider: "alternate" }, { openai_base_url: "https://example.invalid" }, { mcp_servers: { synthetic_mcp: { enabled: true } } }]) {
    assert.throws(() => assertCodexDesignConfig({ ...restricted, ...changed }), /No design turn/);
}
checks.push("installed-codex-restrictions-preserve-first-party-and-disabled-mcp-boundaries");
const children = [], close = (c, code = 0, signal = null) => { c.exitCode = code; c.signalCode = signal; c.emit("close", code, signal); }, spawn = () => { const c = new EventEmitter(); Object.assign(c, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kill() { close(c, 1); return true; } }); children.push(c); return c; };
const run = createCredentialProcessRunner({ spawnProcess: spawn });
let pending = run("synthetic", [], "SYNTHETIC_INPUT");
await new Promise(r => setImmediate(r));
let c = children.at(-1);
assert.equal(c.stdin.read().toString(), "SYNTHETIC_INPUT");
c.stdout.write(" SYNTHETIC_RESULT ");
close(c);
assert.equal((await pending).text, "SYNTHETIC_RESULT");
checks.push("synthetic-credential-result-requires-exact-close");
pending = run("synthetic", [], "");
const rejected = assert.rejects(pending, /verified status/);
await new Promise(r => setImmediate(r));
close(children.at(-1), null, "SIGTERM");
await rejected;
checks.push("signal-exit-cannot-return-partial-credential");
const uncertain = createCredentialProcessRunner({ spawnProcess: spawn, stopChild: async () => ({ stopped: false }) });
pending = uncertain("synthetic", [], "");
const refused = assert.rejects(pending, { code: "CREDENTIAL_PROCESS_EXIT_UNCONFIRMED" });
await new Promise(r => setImmediate(r));
c = children.at(-1);
c.stdout.write("x".repeat(32769));
await refused;
const count = children.length;
await assert.rejects(uncertain("synthetic", [], ""), { code: "CREDENTIAL_PROCESS_EXIT_UNCONFIRMED" });
assert.equal(children.length, count);
close(c);
checks.push("uncertain-exact-worker-prevents-replacement");
const { createCustomAgents } = await load("tools/layout-studio/custom-agents.mjs"), { agentRoutes, agentMessageSchema, requestMac } = await load("integrations/agent-protocol.mjs");
let state = { id: "synthetic", policy: "personal", mode: "personal-companion", agents: [], roleBindings: [], observations: [], confirmationJournal: [] }, chain = Promise.resolve();
const keys = new Map(), store = { async authorize(id) { assert.equal(id, "synthetic"); if (state.mode !== "personal-companion")
        throw Error("Synthetic keyboard-only refusal"); }, async credential(id, p, value) { await this.authorize(id); if (value === undefined)
        return keys.get(p); keys.set(p, value); }, async snapshot() { return structuredClone(state); }, async update(id, op, fn) { const next = chain.catch(() => { }).then(async () => { await this.authorize(id); const draft = structuredClone(state), r = await fn(draft); state = draft; return r; }); chain = next; return next; } };
const agents = createCustomAgents({ store, now: () => 100000 }), enroll = () => agents.enroll("synthetic", { id: "example", name: "Synthetic", capabilities: ["status", "review"] }), send = (token, sequence, path = agentRoutes.event, extra = { event: { status: "ready" } }) => { const body = { schema: agentMessageSchema, compartment: "synthetic", agentId: "example", sessionId: "same-session", sequence, at: 100000, ...extra }, raw = JSON.stringify(body); return agents.message(path, body, requestMac(token, path, raw), raw); };
const old = await enroll();
await send(old.token, 1);
const oldEpoch = state.agents[0].credentialEpoch, claim = await agents.dispatch("synthetic", { agentId: "example", sessionId: "same-session", intent: "review" });
await send(old.token, 2, agentRoutes.poll, {});
state.roleBindings = [{ provider: "custom-agent", targetId: "example", roleId: "old" }];
const review = await agents.reviewRevoke("synthetic", "example");
const revoked = await agents.revoke("synthetic", { agentId: "example", token: review.confirmation.token });
assert.equal(revoked.externalProcessStopped, false);
assert.equal(state.agents[0].commands[0].status, "uncertain-session-ended");
assert.equal(state.roleBindings.length, 0);
await assert.rejects(send(old.token, 3), /not actively enrolled/);
checks.push("synthetic-reviewed-revocation-preserves-uncertain-history");
const next = await enroll();
assert.notEqual(next.token, old.token);
await send(next.token, 1);
await assert.rejects(send(old.token, 99), /authentication/);
await assert.rejects(send(next.token, 2, agentRoutes.ack, { commandId: claim.commandId, outcome: "completed" }), /active claim/);
await assert.rejects(agents.dispatch("synthetic", { agentId: "example", sessionId: "same-session", intent: "status", credentialEpoch: oldEpoch }), /replaced/);
assert.equal(keys.size, 1);
checks.push("replacement-cannot-inherit-old-claims-or-role-authority");
state.observations = [{ id: "synthetic-recording", status: "recording", sources: ["agent-events"], exclusions: [], createdAt: 100000, updatedAt: 100000, events: [] }];
const input = { agentId: "example", commandId: claim.commandId }, outcomeReview = await agents.reviewOutcome("synthetic", input);
assert.equal(outcomeReview.externalOutcomeVerified, false);
assert.equal(outcomeReview.commandWillBeRetried, false);
const outcome = await agents.resolveOutcome("synthetic", { ...input, token: outcomeReview.confirmation.token });
assert.equal(outcome.status, "reviewed-unconfirmed");
assert.equal(outcome.externalOutcomeVerified, false);
assert.equal(outcome.providerCommandSent, false);
assert.equal(state.agents[0].sequence, 1);
assert.equal(state.agents[0].commands[0].status, "reviewed-unconfirmed");
checks.push("synthetic-reviewed-uncertainty-never-resends-or-verifies-work");
await assert.rejects(agents.resolveOutcome("synthetic", { ...input, token: outcomeReview.confirmation.token }), /uncertain claim/);
const observations = state.observations[0].events;
assert.equal(observations.length, 1);
assert.equal(observations[0].phase, "adapter-command-outcome-reviewed");
assert.equal(observations[0].status, "unknown");
assert.equal(observations[0].provenance, "switchyard-local-lifecycle");
assert.equal(observations[0].taskCompletionVerified, false);
for (const secret of [claim.commandId, old.token, next.token, outcomeReview.confirmation.token])
    assert.equal(JSON.stringify(observations).includes(secret), false);
checks.push("review-replay-and-private-local-observation-boundary");
await assert.rejects(agents.revoke("synthetic", { agentId: "example", token: review.confirmation.token }), /consum|scope|match|unavailable/i);
for (const secret of [old.token, next.token, review.confirmation.token])
    assert.equal(JSON.stringify(state).includes(secret), false);
state.mode = "keyboard-only";
await assert.rejects(agents.reviewRevoke("synthetic", "example"), /keyboard-only/);
checks.push("review-replay-privacy-and-policy-fences");
state.mode = "personal-companion";
const stopClaim = await agents.dispatch("synthetic", { agentId: "example", sessionId: "same-session", intent: "review" });
await send(next.token, 2, agentRoutes.poll, {});
const stopQueued = await agents.dispatch("synthetic", { agentId: "example", sessionId: "same-session", intent: "status" });
await send(next.token, 3, agentRoutes.event, { event: { status: "stopped" } });
assert.equal(state.agents[0].commands.find(command => command.id === stopClaim.commandId).status, "uncertain-session-ended");
assert.equal(state.agents[0].commands.find(command => command.id === stopQueued.commandId).status, "cancelled-before-claim");
await assert.rejects(send(next.token, 4), /fresh session identity/);
await assert.rejects(send(next.token, 4, agentRoutes.poll, {}), /no longer owns/);
const stoppedSeen = state.agents[0].lastSeen;
await send(next.token, 4, agentRoutes.ack, { commandId: stopClaim.commandId, outcome: "completed" });
assert.equal(state.agents[0].reportedStatus, "stopped");
assert.equal(state.agents[0].lastSeen, stoppedSeen);
assert.equal(state.agents[0].commands.find(command => command.id === stopClaim.commandId).status, "completed");
checks.push("stopped-session-retires-pending-work-without-restoring-readiness");
const frame = { available: true, category: "vscode", provenance: "Windows foreground process filename; no task identity" };
function syntheticDriver() {
    const child = new EventEmitter(); Object.assign(child, { exitCode: null, signalCode: null, kill: () => false });
    return { child, ready: Promise.resolve(), closed: false, registrations: [], request: async () => frame,
        async register(connection) { this.registrations.push(structuredClone(connection)); return { registered: true }; },
        close() { this.closed = true; }, exit() { close(child); } };
}
const { createWindowsCategoryObserver } = await load("tools/layout-studio/foreground.mjs"), foregroundDrivers = [];
const foreground = createWindowsCategoryObserver({ driverFactory: options => { assert.equal(options.readOnly, true); const d = syntheticDriver(); foregroundDrivers.push(d); return d; }, stopChild: async () => ({ stopped: false }) });
try {
    assert.deepEqual(await foreground.read("synthetic"), frame);
    assert.equal((await foreground.stopCompartment("synthetic")).stopped, false);
    await assert.rejects(foreground.read("synthetic"), { code: "FOREGROUND_HELPER_EXIT_UNCONFIRMED" });
    assert.equal(foregroundDrivers.length, 1);
    foregroundDrivers[0].exit(); assert.deepEqual(await foreground.read("synthetic"), frame);
    assert.equal(foregroundDrivers.length, 2);
    await assert.rejects(foreground.close(), { code: "FOREGROUND_HELPER_EXIT_UNCONFIRMED" });
    foregroundDrivers[1].exit(); await foreground.close();
    await assert.rejects(foreground.read("synthetic"), /was stopped/);
} finally { for (const driver of foregroundDrivers) driver.exit(); await foreground.close(); }
checks.push("synthetic-foreground-ownership-requires-exact-exit-before-replacement");
const { createWindowsHostBridge } = await load("tools/layout-studio/windows-host.mjs"), shortcutDrivers = [];
const shortcutState = { windowsHost: { bindings: [{ nativeId: 1 }, { nativeId: 2 }], transactions: [
    { id: "synthetic-applied", status: "applied", connection: { nativeId: 1 } },
    { id: "synthetic-pending", status: "recovery-pending", connection: { nativeId: 2 } }
] } }, shortcutBefore = structuredClone(shortcutState);
const shortcut = createWindowsHostBridge({ store: { async snapshot(id) { assert.equal(id, "personal"); return structuredClone(shortcutState); }, async update() { throw Error("This synthetic metadata check must preserve its saved state."); } }, driverFactory: () => { const d = syntheticDriver(); shortcutDrivers.push(d); return d; }, stopChild: async () => ({ stopped: false }) });
try {
    assert.equal((await shortcut.transactions()).length, 2);
    assert.deepEqual(shortcutDrivers[0].registrations, [{ nativeId: 1 }]);
    shortcutDrivers[0].close();
    await assert.rejects(shortcut.transactions(), { code: "HOTKEY_HELPER_EXIT_UNCONFIRMED" });
    assert.equal(shortcutDrivers.length, 1);
    shortcutDrivers[0].exit(); await shortcut.transactions();
    assert.equal(shortcutDrivers.length, 2);
    assert.deepEqual(shortcutDrivers[1].registrations, [{ nativeId: 1 }]);
    assert.deepEqual(shortcutState, shortcutBefore);
    await assert.rejects(shortcut.close(), { code: "HOTKEY_HELPER_EXIT_UNCONFIRMED" });
    shortcutDrivers[1].exit(); await shortcut.close();
    await assert.rejects(shortcut.transactions(), /closed/);
} finally { for (const driver of shortcutDrivers) driver.exit(); await shortcut.close(); }
checks.push("synthetic-shortcut-owner-retains-uncertain-exit-and-never-replays-pending-registration");
const provenance = "third_party/model-f-catalog/SOURCES.json", { default: installedProvenance } = await load("tools/layout-studio/catalog-source.mjs"), sourceProvenance = JSON.parse(await readFile(new URL("../" + provenance, import.meta.url), "utf8"));
assert.deepEqual(installedProvenance, sourceProvenance);
checks.push("installed-compressed-catalog-provenance-preserves-every-source-field");
const { switchyardAgent } = await load("integrations/agent-sdk.mjs"), syntheticEnrollment = { baseUrl: "http://127.0.0.1:1/", compartment: "synthetic", agentId: "synthetic", token: "x".repeat(43) };
assert.throws(() => switchyardAgent({ ...syntheticEnrollment, onSequence: "invalid" }), /persistence callback/);
let sequenceSaves = 0;
await assert.rejects(switchyardAgent({ ...syntheticEnrollment, onSequence: () => { sequenceSaves++; } }).poll(), /Publish an exact ready session/);
assert.equal(sequenceSaves, 0);
checks.push("installed-sdk-preflight-refuses-invalid-hook-and-unpublished-session-before-network");
const evidence = { schema: "switchyard-installed-agent-security-metadata/v3", at: new Date().toISOString(), moduleDigests, verifierSourceSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"), sourceCommit: built.source, applicationRelease: built.id, checks, success: true, pureInMemoryOnly: true, liveUserCredentialsUsed: false, liveAgentsRevoked: 0, nativeProcessesStarted: 0, nativeShortcutRegistrations: 0, providerOrModelRequests: 0, hardwareOperations: 0 };
const { privateDirectory } = await import("../tools/layout-studio/private-fs.mjs");
const outputRoot = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/runtime-verification");
await privateDirectory(outputRoot);
const out = join(outputRoot, "installed-agent-security-metadata-" + Date.now() + ".json");
await writeFile(out, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ receipt: out, checks: checks.length, success: true, pureInMemoryOnly: true }));

