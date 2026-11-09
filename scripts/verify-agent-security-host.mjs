#!/usr/bin/env node
/** Verify installed agent authorization using isolated in-memory doubles. No user keys, agents, recordings or provider tasks are modified. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
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
for (const [evidence, names] of [["repository-inspection-startup-summary.json", ["packages/control-plane/src/git-inspector.ts"]], ["credential-process-source-summary.json", ["tools/layout-studio/credential-process.mjs"]], ["external-agent-consent-source-summary.json", ["tools/layout-studio/custom-agents.mjs", "tools/layout-studio/agent-observation.mjs", "integrations/agent-sdk.mjs", "integrations/switchyard_agent.py"]], ["codex-runtime-observation-source-summary.json", [ "tools/layout-studio/codex-turn.mjs", "tools/layout-studio/agents.mjs", "tools/layout-studio/reviewed-task-text.mjs"]], ["foreground-owner-source-summary.json", ["tools/layout-studio/foreground.mjs"]], ["hotkey-owner-source-summary.json", ["tools/layout-studio/windows-host.mjs"]], ["scanner-history-review-source-summary.json", ["tools/layout-studio/git-index-inputs.mjs", "tools/layout-studio/git-history-inputs.mjs", "tools/layout-studio/repository-inspection.mjs", "packages/control-plane/src/git-index-tree.ts"]], ["codex-0167-contract-summary.json", ["tools/layout-studio/codex-requests.mjs", "tools/layout-studio/codex-submissions.mjs"]], ["design-observations-source-summary.json", ["tools/layout-studio/catalog-source.mjs", "tools/layout-studio/haptic-capabilities.mjs"]], ["scanner-recipe-draft-source-summary.json", ["tools/layout-studio/scanner-fixtures.mjs", "apps/windows-companion/src/scanner-fixtures.ts"]], ["copilot-ui-source-summary.json", ["tools/layout-studio/copilot.mjs"]], ["codex-task-resume-role-boundary-source-summary.json", ["apps/vscode-extension/src/codex-daemon-status.cjs"]], ["codex-status-consent-summary.json", ["tools/layout-studio/coding-sessions.mjs"]], ["claude-319-source-summary.json", ["tools/layout-studio/claude-account.mjs"]], ["claude-status-consent-summary.json", ["tools/layout-studio/claude-coding.mjs"]], ["claude-focus-role-boundary-source-summary.json", ["tools/layout-studio/task-window.mjs", "tools/layout-studio/tmux-task-window.mjs"]], ["copilot-ui-source-summary.json", ["deployment/suite/release.mjs"]], ["scanner-recipe-save-source-summary.json", ["tools/layout-studio/scanner-recipe-draft.mjs", "tools/layout-studio/scanner-recipe-files.mjs", "packages/control-plane/src/confirmations.ts", "tools/layout-studio/legend-template.mjs", "tools/layout-studio/legend-export.mjs"]], ["windows-scanner-recipe-save-source-summary.json", ["tools/layout-studio/scanner-recipe-save.mjs", "tools/layout-studio/windows-scanner-recipe-files.mjs"]], ["persisted-selection-source-summary.json", ["tools/layout-studio/suite-store.mjs"]], ["consent-generation-source-summary.json", ["tools/layout-studio/codex-runtime-observation.mjs"]], ["role-choices-source-summary.json", ["tools/layout-studio/role-choices.mjs"]], ["claude-launch-connected-source-summary.json", ["tools/layout-studio/suite.mjs"]], ["claude-hook-source-summary.json", ["tools/layout-studio/design-observations.mjs", "tools/layout-studio/claude-hook-observation.mjs", "integrations/claude-hook.mjs"]], ["editor-project-choices-source-summary.json", ["tools/layout-studio/coding-task-owners.mjs"]], ["claude-launch-connected-source-summary.json", ["tools/layout-studio/windows-native-focus.mjs"]], ["claude-launch-connected-source-summary.json", ["tools/layout-studio/client-integrations.mjs"]], ["windows-shortcut-discovery-source-summary.json", ["tools/layout-studio/host.mjs"]], ["scanner-mixed-input-source-summary.json", ["tools/layout-studio/task-authority.mjs", "tools/layout-studio/shield-git-inputs.mjs", "tools/layout-studio/repository-execution.mjs", "tools/layout-studio/repository-windows-execution.mjs", "tools/layout-studio/windows-reviewed-inputs.mjs", "tools/layout-studio/windows-reviewed-runner.mjs", "tools/layout-studio/windows-history-inputs.mjs", "apps/linux-companion/src/linux-repository-inputs.ts"]]]) {
    const e = JSON.parse(await readFile(new URL("../docs/evidence/" + evidence, import.meta.url), "utf8"));
    const sourceFiles = e.sourceFiles ?? Object.fromEntries(e.files.map(file => [file.path, file.sha256]));
    for (const name of names) {
        const digest = createHash("sha256").update(await readFile(join(root, name))).digest("hex");
        assert.equal(digest, sourceFiles[name], name + " must match " + evidence);
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

const { reviewedClaudeVersions, readClaudeDesignLogin } = await load("tools/layout-studio/claude-account.mjs");
assert.deepEqual(reviewedClaudeVersions, ["2.1.308", "2.1.317", "2.1.319"]);
const syntheticClaudeAccount = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "synthetic@example.invalid", orgId: "synthetic-org" };
for (const version of [...reviewedClaudeVersions, "2.1.318", "2.1.320", "2.1.319-preview"]) {
    const observed = [];
    const command = async (_exe, args, options) => {
        assert.ok(args.length === 1 && args[0] === "--version" || JSON.stringify(args) === JSON.stringify(["auth", "status", "--json"]));
        observed.push(args[0]);
        await options.onGuardianReady({ schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 1234, birth: "1", containment: "owned-linux-session" });
        return { status: "completed", exitCode: 0, treeExitVerified: true, inputDelivered: true, stderr: "", stdout: args[0] === "--version" ? version + " (Claude Code)" : JSON.stringify(syntheticClaudeAccount) };
    };
    if (reviewedClaudeVersions.includes(version)) assert.equal((await readClaudeDesignLogin("/synthetic/claude", "/synthetic/project", { command })).version, version);
    else { await assert.rejects(readClaudeDesignLogin("/synthetic/claude", "/synthetic/project", { command }), /reviewed native version/); assert.deepEqual(observed, ["--version"]); }
}
checks.push("installed-Claude-exact-version-admission-and-unreviewed-refusal-use-only-in-memory-command-doubles");
const { createClaudeCoding } = await load("tools/layout-studio/claude-coding.mjs");
let attachmentVersion = "2.1.319";
const attachmentCommands = [], attachmentService = createClaudeCoding({
    store: { authorize: async () => {}, snapshot: async () => ({ codingSessions: [] }) },
    resolveCli: async () => "/synthetic/claude", run: async (_exe, args) => {
        assert.ok(args[0] === "--version" || args[0] === "auth"); attachmentCommands.push(args[0]);
        return args[0] === "--version" ? attachmentVersion + " (Claude Code)" : JSON.stringify(syntheticClaudeAccount);
    }
});
try {
    const discovery = await attachmentService.discovery("synthetic");
    assert.equal(discovery.available, true); assert.equal(discovery.terminalAttachment.implemented, false);
    assert.equal(discovery.terminalAttachment.mayRestartStoppedSession, true);
    assert.equal(discovery.terminalAttachment.liveOnlyOptionVerified, false);
    assert.equal(discovery.terminalAttachment.launchAuthorized, false);
    assert.equal(discovery.terminalAttachment.attachmentVerified, false);
    attachmentVersion = "2.1.320"; const before = attachmentCommands.length;
    const refused = await attachmentService.discovery("synthetic");
    assert.equal(refused.available, false); assert.match(refused.reason, /native CLI version/);
    assert.deepEqual(attachmentCommands.slice(before), ["--version"]);
} finally { await attachmentService.close(); }
assert.equal(attachmentCommands.includes("attach"), false);
checks.push("installed-Claude-attachment-discovery-distinguishes-restart-risk-without-launching-a-task-or-terminal");
checks.push("installed-Claude-task-discovery-refuses-unreviewed-versions-before-account-inspection-or-native-effects");

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
const beforeRoleRefusal = structuredClone(state);
let asynchronousRoleChecks = 0, leasedRoleChecks = 0;
await assert.rejects(agents.dispatch("synthetic", { agentId: "example", sessionId: "same-session", intent: "review" }, { assertCurrent: async () => { asynchronousRoleChecks++; throw Error("Synthetic original workspace departed"); } }), /Synthetic original workspace departed/);
assert.equal(asynchronousRoleChecks, 1); assert.deepEqual(state, beforeRoleRefusal);
checks.push("installed-custom-agent-workspace-guard-refuses-without-queue-or-history-write");
await assert.rejects(agents.dispatch("synthetic", { agentId: "example", sessionId: "same-session", intent: "review" }, { assertCurrent: async () => { asynchronousRoleChecks++; }, assertCurrentState: current => { leasedRoleChecks++; assert.deepEqual(current, beforeRoleRefusal); throw Error("Synthetic original role changed"); } }), /Synthetic original role changed/);
assert.equal(asynchronousRoleChecks, 2); assert.equal(leasedRoleChecks, 1); assert.deepEqual(state, beforeRoleRefusal);
checks.push("installed-custom-agent-binding-guard-refuses-under-lease-without-queue-or-history-write");
const stopClaim = await agents.dispatch("synthetic", { agentId: "example", sessionId: "same-session", intent: "review" }, { assertCurrent: async () => { asynchronousRoleChecks++; }, assertCurrentState: () => { leasedRoleChecks++; } });
assert.equal(asynchronousRoleChecks, 3); assert.equal(leasedRoleChecks, 2);
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
const { codexRuntimeStatus, recordCodexRuntimeStatus } = await load("tools/layout-studio/codex-runtime-observation.mjs");
assert.equal(codexRuntimeStatus({ type: "active", activeFlags: ["waitingOnApproval"] }), "waiting-on-approval");
for (const value of [{ type: "toString" }, { type: "active", activeFlags: ["unknown"] }, { type: "idle", content: "NEVER_RETAIN" }]) assert.equal(codexRuntimeStatus(value), null);
checks.push("installed-runtime-status-parser-retains-only-supported-fixed-metadata");
let runtimeBindingValid = true;
const runtimeEvent = { store, compartment: "synthetic", subjectId: "synthetic-runtime", status: "active", at: 100000, assertCurrentState() { if (!runtimeBindingValid) throw Error("Synthetic original runtime binding changed"); } };
assert.equal(await recordCodexRuntimeStatus(runtimeEvent), 1); assert.equal(await recordCodexRuntimeStatus(runtimeEvent), 0);
const runtimeRows = state.observations[0].events.filter(row => row.phase === "runtime-status-observed");
assert.equal(runtimeRows.length, 1); assert.equal(runtimeRows[0].provenance, "native-provider-runtime-notification"); assert.equal(runtimeRows[0].taskCompletionVerified, false); assert.equal(JSON.stringify(runtimeRows).includes("synthetic-runtime"), false);
runtimeBindingValid = false; const beforeRuntimeRefusal = structuredClone(state);
await assert.rejects(recordCodexRuntimeStatus({ ...runtimeEvent, status: "idle" }), /original runtime binding changed/); assert.deepEqual(state, beforeRuntimeRefusal);
checks.push("installed-runtime-observation-deduplicates-and-refuses-a-changed-original-binding");
runtimeBindingValid = true;
for (const generation of [undefined, "synthetic-original-interval"]) {
    state.observations = [{ id: "synthetic-recording", status: "recording", sources: ["agent-events"], exclusions: [], createdAt: 100000, recordingSince: 100000, recordingGeneration: generation, updatedAt: 100000, events: [] }];
    const delayedStore = { ...store, async update(...args) { state.observations[0].recordingGeneration = "synthetic-renewed-interval"; return store.update(...args); } };
    assert.equal(await recordCodexRuntimeStatus({ ...runtimeEvent, store: delayedStore, at: 100001 }), 0);
    assert.deepEqual(state.observations[0].events, []);
}
checks.push("installed-runtime-metadata-cannot-cross-legacy-or-current-consent-generation-replacement");
assert.equal(await recordCodexRuntimeStatus(runtimeEvent), 0);
assert.deepEqual(state.observations[0].events, []);
assert.equal(await recordCodexRuntimeStatus({ ...runtimeEvent, at: 100001 }), 1);
checks.push("installed-runtime-metadata-omits-ambiguous-consent-boundary-and-accepts-a-later-event");
const { captureAgentObservation } = await load("tools/layout-studio/agent-observation.mjs");
const reportState = () => ({ id: "synthetic-report", policy: "personal", mode: "personal-companion", observations: [{ id: "synthetic-recording", status: "recording", sources: ["agent-events"], exclusions: [], createdAt: 90000, recordingSince: 99999, recordingGeneration: "original", events: [] }] });
const report = { subjectId: "synthetic-agent-session", phase: "adapter-status-observed", status: "busy" };
const changedConsent = reportState(), pendingReport = captureAgentObservation(changedConsent, { provider: "custom-agent", at: 100000 });
changedConsent.observations[0].recordingGeneration = "replacement";
assert.equal(pendingReport(changedConsent, report), 0);
assert.deepEqual(changedConsent.observations[0].events, []);
checks.push("installed-external-agent-report-cannot-cross-a-recording-generation");
const laterConsent = reportState(); laterConsent.observations[0].recordingSince = 100001;
assert.equal(captureAgentObservation(laterConsent, { provider: "custom-agent", at: 100000 })(laterConsent, report), 0);
assert.equal(captureAgentObservation(laterConsent, { provider: "custom-agent", at: 100001 })(laterConsent, report), 0);
assert.equal(captureAgentObservation(laterConsent, { provider: "custom-agent", at: 100002 })(laterConsent, { ...report, at: 100099 }), 1);
assert.equal(laterConsent.observations[0].events[0].at, 100002);
checks.push("installed-external-agent-report-preserves-occurrence-time-and-refuses-late-backfill");
const { roleChoices, roleChoiceDigest } = await import(pathToFileURL(join(root, "tools/layout-studio/role-choices.mjs")));
const roleState = { id: "synthetic-work", policy: "work", mode: "keyboard-only", accounts: [], policyRules: { providers: ["microsoft-365-copilot"] }, workflow: { roles: [{ id: "operator", label: "Operator" }] }, agents: [], conversations: [], codingSessions: [], roleBindings: [] };
const selectionDigest = "a".repeat(64);
assert.throws(() => roleChoices(roleState, { roleId: "operator", intent: "summon" }, () => {}, "linux", selectionDigest), /companion mode/);
roleState.mode = "managed-companion";
const roleInventory = roleChoices(roleState, { roleId: "operator", intent: "summon" }, (preview, roleId, intent) => {
    assert.equal(roleId, "operator"); assert.equal(intent, "summon"); assert.equal(preview.roleBindings[0].provider, "microsoft-365-copilot");
}, "linux", selectionDigest);
assert.deepEqual(roleInventory.choices.map(row => row.targetId), ["microsoft-365-copilot-web"]);
assert.equal(roleInventory.nativeObserved, false); assert.equal(roleInventory.authorityGranted, false);
checks.push("installed-role-choice-metadata-refuses-keyboard-only-and-filters-Copilot-only-policy-without-navigation");
const selectedRoleChoice = { roleId: "operator", intent: "summon", ...roleInventory.choices[0] };
const originalChoice = roleChoiceDigest(roleState, selectedRoleChoice, selectionDigest);
for (const change of [
    value => { value.workflow.roles[0].label = "Changed responsibility"; },
    value => { value.accounts = ["changed-enrollment"]; },
    value => { value.roleBindings = [{ roleId: "operator", intent: "summon", bindingId: "replacement" }]; }
]) { const changed = structuredClone(roleState); change(changed); assert.notEqual(roleChoiceDigest(changed, selectedRoleChoice, selectionDigest), originalChoice); }
assert.notEqual(roleChoiceDigest(roleState, selectedRoleChoice, "b".repeat(64)), originalChoice);
checks.push("installed-role-choice-digest-fences-role-account-enrollment-prior-binding-and-workspace-selection-changes");
{
    const { claudeHookMetadata, claudeHookRecipe, recordClaudeHook } = await load("tools/layout-studio/claude-hook-observation.mjs");
    const hookInput = JSON.stringify({ session_id: "synthetic-hook-session", hook_event_name: "Stop", last_assistant_message: "NEVER_RETAIN", transcript_path: "/NEVER_OPEN", background_tasks: [{ command: "NEVER_EXECUTE" }] });
    assert.deepEqual(claudeHookMetadata(hookInput, "synthetic-hook-session"), { event: "Stop", status: "provider-turn-finished" });
    assert.equal(claudeHookMetadata(hookInput, "different-session"), null);
    assert.equal(claudeHookMetadata(JSON.stringify({ ...JSON.parse(hookInput), agent_id: "nested" }), "synthetic-hook-session"), null);
    checks.push("installed-Claude-hook-parser-discards-content-and-refuses-other-or-nested-session-reports");
    const observationId = "ac730133-f745-42b2-9ab0-949c33e3ecf6";
    let value = { id: "synthetic", policy: "personal", mode: "personal-companion", observations: [{ id: observationId, status: "recording", sources: ["agent-events"], exclusions: [], events: [], createdAt: 1, recordingSince: 1, recordingGeneration: "first" }] }, writes = 0, replace = false;
    const hookStore = { selection: async () => "synthetic", snapshot: async () => structuredClone(value), update: async (_id, _op, fn) => { if (replace) value.observations[0].recordingGeneration = "replacement"; const draft = structuredClone(value), result = await fn(draft); value = draft; writes++; return result; } };
    const record = at => recordClaudeHook({ store: hookStore, compartment: "synthetic", observationId, expectedSessionId: "synthetic-hook-session", raw: hookInput, at, now: () => 30 });
    assert.equal((await record(20)).recorded, 0); assert.equal(writes, 0);
    value.observations[0].sources = ["claude-hook-events"]; assert.equal((await record(21)).recorded, 1);
    const event = value.observations[0].events[0]; assert.equal(event.provenance, "unverified-local-claude-hook"); assert.equal(event.taskCompletionVerified, false); assert.equal(event.nativeIdentityVerified, false); assert(!JSON.stringify(event).includes("NEVER"));
    replace = true; assert.equal((await record(22)).recorded, 0); assert.equal(value.observations[0].events.length, 1);
    checks.push("installed-Claude-hook-requires-separate-consent-and-refuses-replacement-generation-without-completion-claims");
    const recipe = claudeHookRecipe(value, { observationId, expectedSessionId: "synthetic-hook-session" });
    assert.equal(recipe.configured, false); assert.equal(recipe.providerCommandSent, false);
    for (const [entry] of Object.values(recipe.settings.hooks)) { assert.equal(entry.hooks[0].command, process.execPath); assert.equal(entry.hooks[0].args[0], join(root, "integrations/claude-hook.mjs")); assert.equal(entry.hooks[0].onFailure, "continue"); }
    checks.push("installed-Claude-hook-recipe-pins-its-installed-command-without-writing-native-settings");
}
{
    const { createClientIntegrations } = await load("tools/layout-studio/client-integrations.mjs");
    const state = { policy: "personal", mode: "personal-companion", nativeWindowsClaude: { identity: { canonicalExecutablePath: "C:\\Synthetic\\Claude.exe", executableSha256: "a".repeat(64), signerSubject: "CN=Synthetic" } } };
    const store = { snapshot: async () => structuredClone(state) };
    const catalog = await createClientIntegrations({ store, platform: "win32" }).focusCatalog("synthetic");
    assert.equal(catalog.entries.find(row => row.implementation === "native-claude-desktop.focus/v1").configured, true);
    assert.equal(catalog.entries.find(row => row.implementation === "native-chatgpt.focus/v1").configured, false);
    const client = (await createClientIntegrations({ store, platform: "win32" }).catalog("synthetic")).entries.find(row => row.id === "claude-desktop");
    assert.deepEqual(client.nativeNavigation, { implementation: "native-claude-desktop.focus/v1", launchImplementation: "native-claude-desktop.launch/v1", configured: true, permitted: true, windowObserved: false });
    assert.equal(catalog.entries.find(row => row.name === "Claude Desktop").launchImplementation, "native-claude-desktop.launch/v1");
    assert(catalog.entries.filter(row => row.name !== "Claude Desktop").every(row => row.launchImplementation === null));
    assert.equal(client.capabilities.hostLaunchConnected, false); assert.equal(client.capabilities.exactFocus, false);
    state.policy = "work"; state.mode = "managed-companion";
    assert.equal((await createClientIntegrations({ store, platform: "win32" }).focusCatalog("synthetic")).permitted, false);
    assert.equal((await createClientIntegrations({ store, platform: "win32" }).catalog("synthetic")).entries.find(row => row.id === "claude-desktop").nativeNavigation.permitted, false);
    assert.equal((await createClientIntegrations({ store, platform: "linux" }).catalog("synthetic")).entries.find(row => row.id === "claude-desktop").nativeNavigation, null);
    checks.push("installed-Claude-catalog-connects-saved-Windows-setup-without-window-observation-launch-or-Work-authority");
    checks.push("installed-Claude-Desktop-catalog-keeps-independent-saved-identity-and-Work-refusal-without-native-probes");
    assert(!(await createClientIntegrations({ store, platform: "linux" }).focusCatalog("synthetic")).entries.some(row => row.implementation === "native-claude-desktop.focus/v1"));
    const { nativeFocusImplementations } = await load("tools/layout-studio/host.mjs");
    await assert.rejects(nativeFocusImplementations["native-claude-desktop.focus/v1"].inspect(), /Linux is unfinished/);
    checks.push("installed-Linux-Claude-Desktop-refuses-without-probing-or-focusing-a-substitute");
}
const evidence = { schema: "switchyard-installed-agent-security-metadata/v3", at: new Date().toISOString(), moduleDigests, verifierSourceSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"), sourceCommit: built.source, applicationRelease: built.id, checks, success: true, pureInMemoryOnly: true, liveUserCredentialsUsed: false, liveAgentsRevoked: 0, nativeProcessesStarted: 0, nativeShortcutRegistrations: 0, providerOrModelRequests: 0, hardwareOperations: 0 };
const { privateDirectory } = await import("../tools/layout-studio/private-fs.mjs");
const outputRoot = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/runtime-verification");
await privateDirectory(outputRoot);
const out = join(outputRoot, "installed-agent-security-metadata-" + Date.now() + ".json");
await writeFile(out, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ receipt: out, checks: checks.length, success: true, pureInMemoryOnly: true }));

