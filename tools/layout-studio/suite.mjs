/** Shared product state and bounded operations behind the authenticated origin. */
import { createScannerRecipeSave } from "./scanner-recipe-save.mjs";
import { createCodingEditorConnections } from "./coding-editor-connections.mjs";
import { createWindowsCodingEditorConnections } from "./windows-coding-editor-connections.mjs";
import { createCodingEditorAuthorizations } from "./coding-editor-authorizations.mjs";
import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createSuiteStore } from "./suite-store.mjs";
import { createWindowsNativeFocus } from "./windows-native-focus.mjs";
import { createAgentService } from "./agents.mjs";
import { localVoice } from "./voice.mjs";
import { parseWorkflow, observationSummary } from "./workflow.mjs";
import { reviewDesignObservations } from "./design-observations.mjs";
import { surfaceForClass } from "../../scripts/workflow-monitor.mjs";
import { runHypr, nativeFocusImplementations } from "./host.mjs";
import { createDeviceService } from "./devices.mjs";
import { createCopilot } from "./copilot.mjs";
import { createCustomAgents, agentIntents } from "./custom-agents.mjs";
import { runtimeEnvironment } from "./runtime-setup.mjs";
import { resolveRuntimePaths } from "./runtime-storage.mjs";
import { createCodingSessions } from "./coding-sessions.mjs";
import { createCodingTaskOwners } from "./coding-task-owners.mjs";
import { roleChoices, roleChoiceDigest } from "./role-choices.mjs";
import { createCodexSubmissions } from "./codex-submissions.mjs";
import { createClaudeSubmissions } from "./claude-submissions.mjs";
import { stopOwnedChild } from "./owned-process.mjs";
import { createClaudeCoding } from "./claude-coding.mjs";
import { createVoiceQueue, reviewTranscript } from "./voice-queue.mjs";
import { exportAssignmentLegends } from "./legend-export.mjs";
import { identifyCatalogSnapshot } from "./catalog-identity.mjs";
import { inspectSourceHaptics } from "./haptic-capabilities.mjs";
import sourceCatalog from "./model-f-source.mjs";
import { createReadoutProfiles } from "./readout-profiles.mjs";
import { createKeyboardIndicators } from "./keyboard-indicators.mjs";
import { createMatrixDiagnostics } from "./matrix-diagnostics.mjs";
import { createTaskAuthority } from "./task-authority.mjs";
import { createRepositoryEffectRecovery } from "./repository-effect-recovery.mjs";
import { createRepositoryCommits } from "./repository-commits.mjs";
import { createRepositoryExecution } from "./repository-execution.mjs";
import { createScannerFixtures } from "./scanner-fixtures.mjs";
import { createShieldExceptions } from "./shield-exceptions.mjs";
import { createWindowsStorageSetup } from "./windows-storage-setup.mjs";
import { connectedExecutionActions } from "./repository-execution-actions.mjs";
import { createClientLaunch } from "./client-launch.mjs";
import { createClientIntegrations } from "./client-integrations.mjs";
import { clientRecipe } from "../../integrations/client-recipes.mjs";
import { linuxProcess } from "./native-process.mjs";

const kinds = ["interruption", "resume", "switch", "handoff", "status", "review", "approval", "failure", "recovery", "other"];
export function createSuite({ store = createSuiteStore(), platform = process.platform, agents, voice = localVoice(), hypr = runHypr, nativeProcess = linuxProcess, windowsNativeFocus, windowsNativeFocusFactory = createWindowsNativeFocus, devices, copilot, copilotFactory = createCopilot, coding, codingTaskOwners, codingTaskOwnersFactory = createCodingTaskOwners, codingEditorConnections, codingEditorConnectionsFactory, editorRuntimeRoot = process.env.XDG_RUNTIME_DIR, codexSubmissions, claudeCoding, claudeSubmissions, keyboardIndicators = createKeyboardIndicators(), taskAuthority, taskAuthorityFactory = createTaskAuthority, repositoryRecovery, repositoryCommits, repositoryExecution, storageSetup, fixtureAdministration, scannerRecipeSave, shieldExceptions, clientLaunch, spawnExample = spawn, stopExampleChild = stopOwnedChild, foreground, scheduleForeground = setInterval, clearForeground = clearInterval } = {}) {
  agents ??= createAgentService({ store, runtimeRoot: join(process.env.XDG_RUNTIME_DIR || process.env.LOCALAPPDATA || join(homedir(), ".local/state"), "switchyard-design") });
  devices ??= createDeviceService({ store });
  coding ??= createCodingSessions({ store });
  codexSubmissions ??= createCodexSubmissions({ store });
  claudeSubmissions ??= createClaudeSubmissions({ store });
  claudeCoding ??= createClaudeCoding({ store });
  const custom = createCustomAgents({ store });
  const clients = createClientIntegrations({ store, platform, hostLaunchPlatforms: ["linux", "win32"] });
  const voiceQueue = createVoiceQueue({ store, voice });
  const readoutProfiles = createReadoutProfiles({ store, catalog: sourceCatalog });
  foreground ??= process.platform === "linux" ? { implemented: true, read: async (c, beforeStart) => { await beforeStart(); return { available: true, category: surfaceForClass(JSON.parse(await hypr("activewindow", "-j")).class), provenance: "Hyprland application class; no task identity" }; }, stopCompartment: async () => ({ stopped: true }), close: async () => {} } : { implemented: false };
  const examples = new Map(), exampleGenerations = new Map(), exampleStarts = new Map(), exampleStops = new Map();
  const uncertainExamples = new Set(), exampleRetirements = new WeakMap();
  const started = new Set(), initializing = new Map(), monitors = new Map();
  let activeCompartment = "personal";
  let selectionGeneration = 0;
  let selectionLoaded = false;
  let selectionLoading;
  let closed = false;
  const copilotTransitions = new Map();
  windowsNativeFocus ??= windowsNativeFocusFactory({ store, platform, isActive: async c => { await loadSelection(); return !closed && !copilotTransitions.has(c) && c === activeCompartment && await store.selection() === c; } });
  codingTaskOwners ??= codingTaskOwnersFactory({ store, platform, isActive: async c => { await loadSelection(); return !closed && !copilotTransitions.has(c) && c === activeCompartment && await store.selection() === c; } });
  const codingEditorAuthorizations = createCodingEditorAuthorizations({ store, owners: codingTaskOwners, isActive: async c => { await loadSelection(); return !closed && !copilotTransitions.has(c) && c === activeCompartment && await store.selection() === c; } });
  const editorConnections = () => {
    if (!["linux", "win32"].includes(platform)) throw Error("The reviewed editor connection requires Linux or Windows.");
    return codingEditorConnections ??= (codingEditorConnectionsFactory ?? (platform === "win32" ? createWindowsCodingEditorConnections : createCodingEditorConnections))({ store, authorizations: codingEditorAuthorizations, owners: codingTaskOwners, root: editorRuntimeRoot, platform });
  };
  const stopEditorConnections = async c => {
    const result = await codingEditorConnections?.stopCompartment(c);
    if (result && result.stopped !== true) throw Error("The original editor connection has not verified retirement.");
    return { stopped: true };
  };
  copilot ??= copilotFactory({ store, isActive: async c => { await loadSelection(); return !closed && !copilotTransitions.has(c) && c === activeCompartment && await store.selection() === c; } });
  const matrixDiagnostics = createMatrixDiagnostics({ store, devices, isActive: async (c) => { await loadSelection(); return c === activeCompartment; } });
  taskAuthority ??= taskAuthorityFactory({ store, localCommitExecutionImplemented: true, executionActions: connectedExecutionActions(platform), isActive: async c => { await loadSelection(); return c === activeCompartment; }, checkNative: (c, task) => task.provider === "codex" ? coding.status(c, task.id) : claudeCoding.status(c, task.id), readScannerSources: (c, input) => fixtureAdministration.readSources(c, input), resolveScannerFixtures: (c, input) => fixtureAdministration.resolve(c, input) });
  const repositoryDirectory = join(process.env.XDG_STATE_HOME || process.env.LOCALAPPDATA || join(homedir(), ".local/state"), "strathex-switchyard/repository-effects");
  repositoryCommits ??= createRepositoryCommits({ store, authority: taskAuthority, stateDirectory: repositoryDirectory });
  fixtureAdministration ??= createScannerFixtures({ store, stateDirectory: join(repositoryDirectory, "fixtures"), isActive: async c => { await loadSelection(); return c === activeCompartment; } });
  scannerRecipeSave ??= createScannerRecipeSave({ store, authority: taskAuthority, platform, isActive: async c => { await loadSelection(); return !closed && !copilotTransitions.has(c) && c === activeCompartment && await store.selection() === c; } });
  shieldExceptions ??= createShieldExceptions({ store, authority: taskAuthority, isActive: async c => { await loadSelection(); return c === activeCompartment; } });
  repositoryExecution ??= createRepositoryExecution({ store, authority: taskAuthority, platform, resolveScannerFixtures: (c, input) => fixtureAdministration.resolve(c, input), resolveShieldExceptions: (c,input) => shieldExceptions.evaluate(c,input), stateDirectory: join(repositoryDirectory, "execution"), isActive: async c => { await loadSelection(); return c === activeCompartment; } });
  repositoryRecovery ??= createRepositoryEffectRecovery({ store, stateDirectory: repositoryDirectory, isActive: async c => { await loadSelection(); return c === activeCompartment; } });
  storageSetup ??= createWindowsStorageSetup({store,platform,isActive:async c=>{await loadSelection();return c===activeCompartment;}});
  clientLaunch ??= createClientLaunch({ store, stateDirectory: join(repositoryDirectory, "client-launches"), isActive: async c => { await loadSelection(); return c === activeCompartment; } });
  async function retireExample(key, child) {
    if (!child) return { stopped: true, evidence: "no owned example process observed in this runtime" };
    if (exampleRetirements.has(child)) return exampleRetirements.get(child);
    uncertainExamples.add(key);
    const retiring = (async () => {
      let stopped = false;
      try { stopped = (await stopExampleChild(child))?.stopped === true; } catch { /* Retain the exact child; no replacement or successful-stop claim. */ }
      if (stopped && examples.get(key) === child) { examples.delete(key); uncertainExamples.delete(key); }
      return { stopped, evidence: stopped ? "owned direct child exited" : "owned child stop was not confirmed" };
    })();
    exampleRetirements.set(child, retiring);
    try { return await retiring; } finally { if (exampleRetirements.get(child) === retiring) exampleRetirements.delete(child); }
  }
  async function stopExample(compartment, example) {
    const key = `${compartment}:${example}`;
    if (exampleStops.has(key)) return exampleStops.get(key);
    exampleGenerations.set(key, (exampleGenerations.get(key) ?? 0) + 1);
    const stopping = (async () => {
      await exampleStarts.get(key)?.catch(() => {});
      const child = examples.get(key), result = await retireExample(key, child);
      await store.update(compartment, "example-stopped", (s) => {
        const a = s.agents.find((a) => a.id === `${example}-example`);
        if (a) { a.reportedStatus = child && result.stopped ? "stopped" : "unknown"; a.lastSeen = null; a.provenance = child ? result.stopped ? "owned bundled example process exited; external task outcome unverified" : "owned bundled example exit unconfirmed; external task outcome unverified" : "no owned example process observed in this runtime"; }
      });
      return { status: result.stopped ? (child ? "stopped" : "not-observed") : "stop-unconfirmed", evidence: result.evidence, taskCompletionVerified: false };
    })();
    exampleStops.set(key, stopping);
    try { return await stopping; } finally { if (exampleStops.get(key) === stopping) exampleStops.delete(key); }
  }
  async function initialize(id, policy) {
    if (started.has(id)) { if (policy !== undefined) await store.initialize(id, policy); return; }
    if (initializing.has(id)) { await initializing.get(id); if (policy !== undefined) await store.initialize(id, policy); return; }
    const pending = (async () => {
      await store.initialize(id, policy);
      await store.update(id, "restart-recovery", (s) => { for (const o of s.observations) if (["recording", "paused"].includes(o.status)) o.status = "interrupted"; for (const v of s.voice) if (v.status === "recording") v.status = "paused"; for (const c of s.conversations) if (c.status === "pending") c.status = "interrupted"; for (const t of s.deviceTransactions ?? []) if (t.status === "applying") t.status = "recovery-pending"; for (const t of s.codingSessions ?? []) if (t.status === "creating") t.status = "creation-uncertain"; for (const launch of s.clientLaunches ?? []) if (["reserved", "launching"].includes(launch.status)) launch.status = "outcome-unconfirmed"; for (const effect of s.repositoryEffects ?? []) if (["reserved", "executing"].includes(effect.status)) effect.status = "recovery-required"; for (const review of s.repositoryCommitReviews ?? []) if (review.status === "executing") review.status = "recovery-required"; for (const review of s.repositoryExecutionReviews ?? []) if (["executing", "running"].includes(review.status)) review.status = "outcome-unconfirmed"; for (const t of s.codingTurns ?? []) if (["reserved", "submitting", "submitted", "cancellation-requested"].includes(t.status)) t.status = "outcome-unconfirmed"; });
      await store.update(id, "claude-creation-recovery", (s) => { for (const task of s.codingSessions ?? []) if (task.provider === "claude-code" && task.nativeTransport === "owned-print" && task.nativeIdentityVerified === false && (s.codingTurns ?? []).some((turn) => turn.taskId === task.id && !["failed-before-turn"].includes(turn.status))) task.status = "creation-uncertain"; });
      await fixtureAdministration.recover?.(id);
      await scannerRecipeSave.recover(id);
      await repositoryExecution.recoverCompartment?.(id);
      if(id==="personal")await storageSetup.recover?.();
      started.add(id);
    })();
    initializing.set(id, pending);
    try { await pending; } finally { if (initializing.get(id) === pending) initializing.delete(id); }
  }
  async function loadSelection() {
    if (selectionLoaded) return;
    selectionLoading ??= (async () => { await initialize("personal"); activeCompartment = await store.selection(); await initialize(activeCompartment); selectionLoaded = true; })().finally(() => { selectionLoading = null; });
    await selectionLoading;
  }
  async function selectedIntentContext(selected) {
    const generation = selectionGeneration;
    const changed = () => new Error("The selected shortcut workspace changed; no alternate target or automatic retry was selected.");
    const assertCurrentState = () => {
      if (closed || generation !== selectionGeneration || copilotTransitions.has(selected) || selected !== activeCompartment) throw changed();
    };
    const original = await store.selectionWitness();
    assertCurrentState();
    if (original.id !== selected) throw changed();
    const assertCurrent = async () => {
      assertCurrentState();
      const saved = await store.selectionWitness();
      assertCurrentState();
      if (saved.id !== selected || saved.digest !== original.digest) throw changed();
    };
    return { assertCurrent, assertCurrentState, selectionDigest: original.digest };
  }
  function roleTarget(state, roleId, intent) {
    if (!agentIntents.includes(intent) || !state.workflow.roles.some((r) => r.id === roleId)) throw new Error("Choose an existing workflow role and supported intent.");
    const binding = state.roleBindings?.find((b) => b.roleId === roleId && b.intent === intent);
    if (!binding) throw new Error("Bind this role and intent to an exact permitted session first.");
    if (binding.targetKind === "client-surface") {
      const recipe = clientRecipe(binding.targetId);
      if (intent !== "summon" || recipe.target.kind !== "https" || recipe.provider !== binding.provider || recipe.digest !== binding.recipeDigest || typeof binding.bindingId !== "string" || binding.sessionId !== undefined) throw new Error("This exact client role supports a fixed homepage launch only. Rebind changed recipes deliberately; focus, resume and session control are unavailable.");
    } else if (binding.provider === "microsoft-365-copilot" && intent === "cancel") throw new Error("The selected Graph contract does not provide cancellation. Choose a supported role intent.");
    else if (binding.targetKind === "coding-task") {
      const task = state.codingSessions?.find((t) => t.id === binding.targetId && t.provider === binding.provider && t.sessionId === binding.sessionId && t.schema === "switchyard-coding-session/v1");
      if (!task || !(intent === "status" && ["codex", "claude-code"].includes(binding.provider) || binding.provider === "claude-code" && intent === "summon" && task.backgroundId === null && task.status === "registered" || binding.provider === "codex" && intent === "resume" && task.launchPolicy === "read-only/on-request" && task.nativeTransport !== "owned-stdio" && task.status === "registered")) throw new Error("This exact coding-task binding supports runtime status only, plus verified live Claude focus or legacy owned read-only Codex daemon resume. Dedicated tasks continue through explicit text review. No alternate session action was selected.");
    } else if (binding.provider === "custom-agent") {
      const a = state.agents.find((a) => a.id === binding.targetId && a.sessionId === binding.sessionId);
      if (!a || a.enrollmentStatus === "revoked" || (a.credentialEpoch ?? "legacy") !== (binding.credentialEpoch ?? "legacy") || !a.capabilities.includes(intent) || !a.lastSeen || Date.now() - a.lastSeen > 30000 || a.reportedStatus === "stopped") throw new Error("This exact custom-agent target is missing, stale or does not support that intent.");
    } else if (!state.conversations.some((c) => c.id === binding.targetId && c.provider === binding.provider && c.sessionId === binding.sessionId)) throw new Error("This exact role target changed or disappeared. Rebind it deliberately.");
    return binding;
  }
  function saveRoleBinding(s, body) {
    if (!agentIntents.includes(body.intent)) throw new Error("Choose a stable supported intent.");
    const role = s.workflow.roles.find((r) => r.id === body.roleId); if (!role) throw new Error("Save an agent role in your workflow first.");
    const provider = body.provider;
    if (body.targetKind === "client-surface") {
      if (Object.keys(body).some(k => !["compartment", "roleId", "intent", "provider", "targetKind", "targetId", "workspaceBaseUrl"].includes(k))) throw new Error("Client role binding accepts only an exact documented surface and summon intent; commands, content, session IDs and imported approvals are not accepted.");
      const recipe = clientRecipe(body.targetId);
      if (body.intent !== "summon" || recipe.provider !== provider || recipe.target.kind !== "https") throw new Error("This client surface supports a fixed homepage launch only; choose its exact provider and summon intent.");
      const binding = { bindingId: randomUUID(), roleId: role.id, provider, targetKind: "client-surface", targetId: recipe.id, recipeDigest: recipe.digest, intent: "summon" };
      s.roleBindings = [...(s.roleBindings ?? []).filter(b => b.roleId !== role.id || b.intent !== body.intent), binding]; roleTarget(s, role.id, body.intent); return binding;
    }
    if (!s.policy || !["codex", "claude-code", "microsoft-365-copilot", "custom-agent"].includes(provider)) throw new Error("Unknown role provider.");
    const targetKind = body.targetKind ?? (provider === "custom-agent" ? "custom-agent" : "conversation");
    if (!["coding-task", "custom-agent", "conversation"].includes(targetKind) || (targetKind === "custom-agent") !== (provider === "custom-agent")) throw new Error("Choose the exact target kind supported by this provider.");
    const target = targetKind === "coding-task" ? s.codingSessions?.find((t) => t.id === body.targetId && t.provider === provider) : provider === "custom-agent" ? s.agents.find((a) => a.id === body.targetId) : s.conversations.find((c) => c.id === body.targetId && c.provider === provider);
    if (!target?.sessionId) throw new Error("The role needs an exact connected session, not a window title or missing tool.");
    s.roleBindings ??= []; const binding = { bindingId: randomUUID(), roleId: role.id, provider, targetKind, targetId: body.targetId, sessionId: target.sessionId, intent: body.intent };
    if (provider === "custom-agent") binding.credentialEpoch = target.credentialEpoch ?? "legacy";
    s.roleBindings = [...s.roleBindings.filter((b) => b.roleId !== role.id || b.intent !== body.intent), binding]; roleTarget(s, role.id, body.intent); return binding;
  }
  function roleBindingDigest(state, binding) { return createHash("sha256").update(JSON.stringify([binding, state.workflow.roles.find(r => r.id === binding?.roleId)])).digest("hex"); }
  const session = (s, id) => { const found = s.observations.find((o) => o.id === id); if (!found) throw new Error("That observation session is unavailable in this compartment."); return found; };
  const voiceSession = (s, id) => { const found = s.voice.find((o) => o.id === id); if (!found) throw new Error("That voice session is unavailable in this compartment."); return found; };
  function pauseMonitor(compartment) { if (monitors.has(compartment)) clearForeground(monitors.get(compartment)); monitors.delete(compartment); }
  function monitor(compartment, id, recordingGeneration) {
    pauseMonitor(compartment);
    let pending = false, last = Date.now(), unavailable = 0;
    const current = () => !closed && monitors.get(compartment) === timer;
    const sameConsent = o => o?.status === "recording" && o.sources.includes("foreground-category") && o.recordingGeneration === recordingGeneration;
    const authorize = async () => {
      if (!current()) throw new Error("Observation stopped.");
      const state = await store.snapshot(compartment, { operation: "record" });
      if (!current() || !sameConsent(state.observations.find(o => o.id === id))) throw new Error("Observation stopped or its consent changed.");
    };
    const timer = scheduleForeground(async () => {
      if (pending) return; pending = true;
      try {
        await authorize(); const result = await foreground.read(compartment, authorize), at = Date.now(); await authorize();
        if (!result.available) { last = at; if (++unavailable < 3) return; throw new Error("Foreground unavailable."); }
        if (!["terminal", "vscode", "chatgpt", "claude", "codex", "browser", "other"].includes(result.category)) throw new Error("Unsupported foreground category.");
        unavailable = 0;
        await store.update(compartment, "focus-category", (s) => { const o = session(s, id); if (!current() || !sameConsent(o)) return; o.sourceStates ??= {}; o.sourceStates["foreground-category"] = { status: "sampling", provenance: result.provenance, at, timing: "two-second sampled category estimate; no task or content inference" }; if (!o.exclusions.includes(result.category)) o.focusCategories[result.category] = (o.focusCategories[result.category] ?? 0) + Math.max(0, Math.min(60000, at - last)); o.updatedAt = at; }, { operation: "record" }); last = at;
      } catch {
        if (current()) {
          pauseMonitor(compartment);
          // Capture/retire this instance's original source before an awaited
          // state write lets a deliberate resume create a replacement.
          try { await foreground.stopCompartment?.(compartment); } catch { /* Keep unavailable; no automatic restart. */ }
          try { await store.update(compartment, "focus-unavailable", (s) => { const o = session(s, id); if (!sameConsent(o)) return; o.sourceStates ??= {}; o.sourceStates["foreground-category"] = { status: "unavailable", reason: "Foreground categories are unavailable. Pause and deliberately resume to retry.", at: Date.now() }; if (o.sources.length === 1) o.status = "paused"; }, { operation: "record" }); } catch { /* A policy change or deletion wins over a late sample. */ }
        }
      }
      finally { pending = false; }
    }, 2000);
    timer.unref?.(); monitors.set(compartment, timer);
  }
  return {
    store, agents,
    agentMessage: (path, body, signature, raw) => custom.message(path, body, signature, raw),
    async handle(path, body = {}) {
      if (closed) throw new Error("This local suite is closed.");
      const compartment = body.compartment ?? "personal";
      if (path === "/api/suite/coding/codex/editor-choices" || path === "/api/suite/coding/codex/editor-projects") {
        const projects = path.endsWith("/editor-projects");
        if (Object.keys(body).some(key => !(projects ? ["workspaceBaseUrl"] : ["repositoryRoot", "workspaceBaseUrl"]).includes(key))) throw Error("Project task choices accept only the exact local project directory; project inventory accepts no selection.");
        await loadSelection();
        const selected = activeCompartment, context = await selectedIntentContext(selected);
        await context.assertCurrent();
        const choices = projects ? await codingTaskOwners.editorProjects(selected) : await codingTaskOwners.editorChoices(selected, body.repositoryRoot);
        await context.assertCurrent();
        return choices;
      }
      if (path === "/api/suite/roles/choices" || path === "/api/suite/roles/bind-choice") {
        const binding = path.endsWith("/bind-choice");
        const keys = ["roleId", "intent", "workspaceBaseUrl", ...(binding ? ["provider", "targetKind", "targetId", "choiceDigest"] : [])];
        if (Object.keys(body).some(key => !keys.includes(key))) throw Error("Guided role setup accepts only the saved role, intent and exact connection choice.");
        if (binding && (typeof body.choiceDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.choiceDigest))) throw Error("Refresh and choose an exact saved role connection.");
        await loadSelection();
        const selected = activeCompartment, context = await selectedIntentContext(selected);
        await context.assertCurrent();
        if (!binding) {
          const choices = roleChoices(await store.snapshot(selected), body, roleTarget, platform, context.selectionDigest);
          await context.assertCurrent(); return choices;
        }
        return store.update(selected, "role-bind", async state => {
          await context.assertCurrent();
          if (roleChoiceDigest(state, body, context.selectionDigest) !== body.choiceDigest) throw Error("The saved role connection changed. Refresh the choices before binding; no alternate target was selected.");
          const { choiceDigest, ...input } = body, saved = saveRoleBinding(state, input);
          await context.assertCurrent();
          return { schema: "switchyard-role-choice-binding/v1", bindingId: saved.bindingId, roleId: saved.roleId, intent: saved.intent, provider: saved.provider, targetKind: saved.targetKind, targetId: saved.targetId, bound: true, nativeObserved: false, authorityGranted: false };
        }, { provider: body.provider });
      }
      if(path==="/api/suite/compartment/status"){
        if(Object.keys(body).some(key=>key!=="workspaceBaseUrl"))throw Error("Read only the selected workspace; selection arguments are refused.");
        await loadSelection();if(await store.selection()!==activeCompartment)throw Error("The saved workspace changed outside this active instance; select it through the application before inspecting.");
        return{schema:"switchyard-active-compartment/v1",activeCompartment,authorityGranted:false};
      }
      if (path === "/api/suite/compartment/inventory") {
        if (Object.keys(body).some(key => key !== "workspaceBaseUrl")) throw new Error("Workspace inventory accepts no selection, provider or replay fields.");
        await loadSelection();
        if (await store.selection() !== activeCompartment) throw new Error("The saved workspace changed outside this active instance; select it through the application before inspecting.");
        const compartments = await store.list();
        if (!compartments.some(row => row.id === activeCompartment)) throw new Error("The selected workspace is missing from its private inventory. Preserve the original state.");
        return { schema: "switchyard-compartment-inventory/v1", compartments, activeCompartment, complete: true, authorityGranted: false, providerObserved: false };
      }
      if (path === "/api/suite/bootstrap") {
        await loadSelection();
        return { compartments: await store.list(), activeCompartment, agents: await agents.discovery(), voice: await voice.discovery() };
      }
      if (path === "/api/suite/compartment/create") { await initialize(compartment, body.policy); return { id: compartment }; }
      if (!started.has(compartment)) { const list = await store.list(); if (!list.some((c) => c.id === compartment)) throw new Error("Choose or create this compartment first."); await initialize(compartment); }
      if (path === "/api/suite/compartment/select") {
        await loadSelection();
        const previous = activeCompartment, switching = previous !== compartment;
        if (switching) { selectionGeneration++; copilotTransitions.set(previous, (copilotTransitions.get(previous) ?? 0) + 1); }
        try {
        if (activeCompartment !== compartment) {
          await copilot.stopCompartment?.(activeCompartment);
          await matrixDiagnostics.stopCompartment(activeCompartment);
          if ((await windowsNativeFocus.stopCompartment(activeCompartment)).stopped !== true) throw Error("The original native focus helper has not verified retirement; workspace selection was preserved.");
          await stopEditorConnections(activeCompartment);
          const codingOwnerStop = await codingTaskOwners.stopCompartment(activeCompartment);
          if (codingOwnerStop?.stopped !== true) throw new Error("The original coding task owner has not verified exit; workspace selection was preserved.");
          const executionStop = await repositoryExecution.stopCompartment(activeCompartment), commitStop = await repositoryCommits.stopCompartment(activeCompartment), recoveryStop = await repositoryRecovery.stopCompartment(activeCompartment), clientStop = await clientLaunch.stopCompartment(activeCompartment), scannerSaveStop = await scannerRecipeSave.stopCompartment(activeCompartment), authorityStop = await taskAuthority.stopCompartment(activeCompartment), storageStop=await storageSetup.stopCompartment(activeCompartment), fixturesStop=await fixtureAdministration.stopCompartment(activeCompartment), exceptionsStop=await shieldExceptions.stopCompartment(activeCompartment);
          if (executionStop?.stopped === false || commitStop?.stopped === false || recoveryStop?.stopped === false || clientStop?.stopped === false || authorityStop?.stopped === false || scannerSaveStop?.stopped === false || storageStop?.stopped===false || fixturesStop?.stopped===false || exceptionsStop?.stopped===false) throw new Error("An owned repository, client or host-setup guardian has not verified exit; workspace selection was preserved.");
          pauseMonitor(activeCompartment); await foreground.stopCompartment?.(activeCompartment);
          await store.update(activeCompartment, "compartment-suspend-sources", (s) => { for (const o of s.observations) if (o.status === "recording") o.status = "paused"; for (const v of s.voice) if (v.status === "recording") v.status = "paused"; });
        }
        await store.selection(compartment); activeCompartment = compartment; return { id: compartment };
        } finally { if (switching) { const remaining = (copilotTransitions.get(previous) ?? 1) - 1; if (remaining) copilotTransitions.set(previous, remaining); else copilotTransitions.delete(previous); } }
      }
      if (path === "/api/suite/mode") {
        const result = await store.update(compartment, "mode-select", (s) => {
          if (!["keyboard-only", s.policy === "work" ? "managed-companion" : "personal-companion"].includes(body.mode)) throw new Error("Choose keyboard-only or the companion mode matching this workspace's policy.");
          // Fence pending starts at the durable mode decision, before any slow
          // source/provider shutdown. A later resume must not revive an older request.
          for (const kind of ["custom", "langchain"]) { const key = `${compartment}:${kind}`; exampleGenerations.set(key, (exampleGenerations.get(key) ?? 0) + 1); }
          s.mode = body.mode; s.modeSelectedAt = Date.now();
          if (body.mode === "keyboard-only") { for (const o of s.observations) if (o.status === "recording") o.status = "paused"; for (const v of s.voice) if (v.status === "recording") v.status = "paused"; }
          return { mode: s.mode, policyStillEnforced: true };
        });
        if (body.mode === "keyboard-only") {
          await copilot.stopCompartment?.(compartment);
          await matrixDiagnostics.stopCompartment(compartment);
          const executionStop = await repositoryExecution.stopCompartment(compartment), commitStop = await repositoryCommits.stopCompartment(compartment), recoveryStop = await repositoryRecovery.stopCompartment(compartment), clientStop = await clientLaunch.stopCompartment(compartment), scannerSaveStop = await scannerRecipeSave.stopCompartment(compartment), authorityStop = await taskAuthority.stopCompartment(compartment), storageStop=await storageSetup.stopCompartment(compartment), fixturesStop=await fixtureAdministration.stopCompartment(compartment), exceptionsStop=await shieldExceptions.stopCompartment(compartment);
          pauseMonitor(compartment);
          // Stop the exact print continuation before reconciling the original
          // background inventory, which can briefly report the same session.
          const claudeTextStop = await claudeSubmissions.stopCompartment(compartment).catch(() => ({ stopped: false }));
          const editorStop = await stopEditorConnections(compartment).catch(() => ({ stopped: false }));
          const stopped = await Promise.all([windowsNativeFocus.stopCompartment(compartment), editorStop, executionStop, commitStop, recoveryStop, clientStop, scannerSaveStop, authorityStop, storageStop, fixturesStop, exceptionsStop, codingTaskOwners.stopCompartment(compartment), foreground.stopCompartment?.(compartment), agents.stopCompartment?.(compartment), coding.stopCompartment?.(compartment), codexSubmissions.stopCompartment(compartment), claudeTextStop, voiceQueue.stopCompartment(compartment), claudeCoding.stopCompartment?.(compartment), ...["custom", "langchain"].map((kind) => stopExample(compartment, kind))]);
          result.ownedProcessesStopped = stopped.every((r) => !r || r.stopped !== false && r.status !== "stop-unconfirmed");
          if (!result.ownedProcessesStopped) throw new Error("Keyboard-only mode was saved, but an owned process stop is unconfirmed. No new provider or recording operation is permitted.");
        }
        return result;
      }
      if (["/api/suite/host/scanner-fixtures/list", "/api/suite/host/scanner-fixtures/review", "/api/suite/host/scanner-fixtures/apply", "/api/suite/host/scanner-fixtures/recover"].includes(path)) {
        const { workspaceBaseUrl, ...proposal } = body;
        if (path.endsWith("/review")) return fixtureAdministration.review(compartment, proposal);
        if (path.endsWith("/apply")) return fixtureAdministration.apply(compartment, proposal);
        if (Object.keys(proposal).some(k => k !== "compartment")) throw Error("Inspect only this exact compartment's signed fixture maintenance.");
        if (path.endsWith("/recover")) { await fixtureAdministration.list(compartment); return fixtureAdministration.recover(compartment); }
        return fixtureAdministration.list(compartment);
      }
      if (["/api/suite/host/shield-exceptions/list", "/api/suite/host/shield-exceptions/review", "/api/suite/host/shield-exceptions/apply"].includes(path)) {
        const { workspaceBaseUrl, ...proposal } = body;
        if (path.endsWith("/review")) return shieldExceptions.review(compartment, proposal);
        if (path.endsWith("/apply")) return shieldExceptions.apply(compartment, proposal);
        if (Object.keys(proposal).some(key => key !== "compartment")) throw Error("Inspect only this exact compartment's reviewed finding exceptions.");
        return shieldExceptions.list(compartment);
      }
      if (path === "/api/suite/coding/authority/review") return taskAuthority.review(compartment, body);
      if (path === "/api/suite/coding/authority/scanner-review") {
        const { workspaceBaseUrl, ...input } = body;
        return taskAuthority.reviewScanner(compartment, input);
      }
      if (path === "/api/suite/coding/authority/scanner-draft") {
        const { workspaceBaseUrl, ...input } = body;
        return taskAuthority.prepareScannerDraft(compartment, input);
      }
      if (["/api/suite/coding/scanner-save/review", "/api/suite/coding/scanner-save/apply", "/api/suite/coding/scanner-save/list", "/api/suite/coding/scanner-save/recover"].includes(path)) {
        const { workspaceBaseUrl, ...input } = body;
        if (path.endsWith("/review")) return scannerRecipeSave.review(compartment, input);
        if (path.endsWith("/apply")) return scannerRecipeSave.apply(compartment, input);
        if (Object.keys(input).some(key => key !== "compartment")) throw Error("Inspect only this workspace's original scanner save records.");
        return path.endsWith("/recover") ? scannerRecipeSave.recover(compartment) : scannerRecipeSave.list(compartment);
      }
      if (path === "/api/suite/coding/authority/scanner-inputs") {
        const { workspaceBaseUrl, ...input } = body;
        return taskAuthority.scannerInputs(compartment, input);
      }
      if (path === "/api/suite/coding/authority/index-inputs") {
        const { workspaceBaseUrl, ...input } = body;
        return taskAuthority.indexInputs(compartment, input);
      }
      if(path==="/api/suite/coding/authority/history-inputs"){
        const {workspaceBaseUrl,...input}=body;return taskAuthority.historyInputs(compartment,input);
      }
      if(["/api/suite/host/windows-storage/inspect","/api/suite/host/windows-storage/list","/api/suite/host/windows-storage/review","/api/suite/host/windows-storage/apply"].includes(path)){
        const {workspaceBaseUrl,...proposal}=body;
        if(path.endsWith("/review"))return storageSetup.review(compartment,proposal);
        if(path.endsWith("/apply"))return storageSetup.apply(compartment,proposal);
        if(Object.keys(proposal).some(key=>key!=="compartment"))throw Error("Inspect only the current exact Windows host setup; arbitrary selectors are not accepted.");
        return path.endsWith("/inspect")?storageSetup.inspect(compartment):storageSetup.list(compartment);
      }
      if (path === "/api/suite/coding/authority/issue") return taskAuthority.issue(compartment, body);
      if (path === "/api/suite/coding/commits/review" || path === "/api/suite/coding/commits/execute") {
        // The HTTP host adds its trusted workspace origin to every request.
        // It is transport metadata, not part of an exact commit proposal.
        const { workspaceBaseUrl, ...proposal } = body;
        return path.endsWith("/review") ? repositoryCommits.review(compartment, proposal) : repositoryCommits.execute(compartment, proposal);
      }
      if (path === "/api/suite/coding/execution/review" || path === "/api/suite/coding/execution/apply") {
        const { workspaceBaseUrl, ...proposal } = body;
        return path.endsWith("/review") ? repositoryExecution.review(compartment, proposal) : repositoryExecution.apply(compartment, proposal);
      }
      if (path === "/api/suite/coding/execution/list") return repositoryExecution.list(compartment);
      if (path === "/api/suite/coding/execution/stop/review" || path === "/api/suite/coding/execution/stop/apply") {
        const { workspaceBaseUrl, ...proposal } = body;
        return path.endsWith("/review") ? repositoryExecution.reviewStop(compartment, proposal) : repositoryExecution.applyStop(compartment, proposal);
      }
      if (path === "/api/suite/coding/execution/stop/list") return repositoryExecution.listStops(compartment);
      if (path === "/api/suite/coding/execution/status") {
        if (Object.keys(body).some(k => !["compartment", "requestId", "workspaceBaseUrl"].includes(k))) throw new Error("Inspect only one exact execution request identity.");
        return repositoryExecution.status(compartment, body.requestId);
      }
      if (path === "/api/suite/coding/commits/list") return repositoryCommits.list(compartment);
      if (path === "/api/suite/coding/repository-effects/list") return repositoryRecovery.list(compartment);
      if (path === "/api/suite/coding/repository-effects/inspect") return repositoryRecovery.inspect(compartment, body.id);
      if (path === "/api/suite/coding/repository-effects/review" || path === "/api/suite/coding/repository-effects/apply") {
        const { workspaceBaseUrl, ...proposal } = body;
        return path.endsWith("/review") ? repositoryRecovery.review(compartment, proposal) : repositoryRecovery.apply(compartment, proposal);
      }
      if (path === "/api/suite/coding/authority/list") return taskAuthority.list(compartment);
      if (path === "/api/suite/coding/authority/revalidate") return taskAuthority.revalidate(compartment, body.id);
      if (path === "/api/suite/coding/authority/revoke") return taskAuthority.revoke(compartment, body.id);
      if (path.startsWith("/api/suite/coding/codex/editor-connections/")) {
        const action = path.slice("/api/suite/coding/codex/editor-connections/".length), ids = ["requestId", "editorId", "ownerRequestId", "loadRequestId"];
        if (!["open", "pin-peer", "observe", "stop", "recover"].includes(action) || Object.keys(body).some(key => !["compartment", "workspaceBaseUrl", ...ids, ...(action === "pin-peer" ? ["peer"] : [])].includes(key)) || !ids.every(key => typeof body[key] === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body[key]))) throw Error("Choose one exact editor connection without unrelated fields.");
        const selection = Object.freeze(Object.fromEntries(ids.map(key => [key, body[key]])));
        // Retirement needs only protected state access. Admission also requires
        // the original workspace; the lifecycle rechecks its consumed review.
        if (!["stop", "recover"].includes(action)) {
          await loadSelection();
          if (closed || copilotTransitions.has(compartment) || activeCompartment !== compartment || await store.selection() !== compartment) throw Error("Select the original editor workspace before using its connection.");
        }
        const connections = editorConnections();
        const result = action === "pin-peer" ? await connections.pinPeer(compartment, selection, body.peer) : await connections[action](compartment, selection);
        return { schema: "switchyard-editor-connection-result/v1", action, selection, result };
      }
      if (path.startsWith("/api/suite/coding/codex/editor/")) {
        const action = path.slice("/api/suite/coding/codex/editor/".length);
        const fields = { review: [], issue: ["token"], consume: ["permit"], "return-target": [] };
        if (!Object.hasOwn(fields, action) || Object.keys(body).some(key => !["compartment", "workspaceBaseUrl", "ownerRequestId", "loadRequestId", "requestId", "editorId", ...fields[action]].includes(key))) throw new Error("Choose one exact editor authorization without unrelated fields.");
        const { compartment: _compartment, workspaceBaseUrl: _workspaceBaseUrl, ...input } = body;
        return codingEditorAuthorizations[action === "return-target" ? "returnTarget" : action](compartment, input);
      }
      if (path.startsWith("/api/suite/coding/codex/owners/")) {
        await loadSelection();
        if (closed || copilotTransitions.has(compartment) || activeCompartment !== compartment || await store.selection() !== compartment) throw new Error("Select the original task workspace before using its owned connection.");
        const action = path.slice("/api/suite/coding/codex/owners/".length);
        const fields = { list: [], open: ["requestId", "taskId"], read: ["ownerRequestId"], "review-load": ["ownerRequestId"], load: ["ownerRequestId", "requestId", "token"], "editor-target": ["ownerRequestId", "loadRequestId"], loads: [], stop: ["ownerRequestId"], recover: ["ownerRequestId"] };
        if (!Object.hasOwn(fields, action) || Object.keys(body).some(key => !["compartment", "workspaceBaseUrl", ...fields[action]].includes(key))) throw new Error("Choose one exact task-owner operation without unrelated fields.");
        if (action === "list") return codingTaskOwners.list(compartment);
        if (action === "open") return codingTaskOwners.open(compartment, { requestId: body.requestId, taskId: body.taskId });
        if (action === "read") return codingTaskOwners.read(compartment, body.ownerRequestId);
        if (action === "review-load") return codingTaskOwners.reviewLoad(compartment, body.ownerRequestId);
        if (action === "load") return codingTaskOwners.load(compartment, { ownerRequestId: body.ownerRequestId, requestId: body.requestId, token: body.token });
        if (action === "editor-target") return codingTaskOwners.editorTarget(compartment, { ownerRequestId: body.ownerRequestId, loadRequestId: body.loadRequestId });
        if (action === "loads") return codingTaskOwners.listLoads(compartment);
        if (action === "stop") return codingTaskOwners.stop(compartment, body.ownerRequestId);
        if (action === "recover") return codingTaskOwners.recover(compartment, body.ownerRequestId);
      }
      if (path === "/api/suite/coding/codex/discovery") return coding.discovery(compartment);
      if (path === "/api/suite/coding/codex/list") return coding.list(compartment);
      if (path === "/api/suite/coding/codex/bind") return coding.bind(compartment, body);
      if (path === "/api/suite/coding/codex/create") return coding.create(compartment, body);
      if (path === "/api/suite/coding/codex/status") return coding.status(compartment, body.id);
      if (path === "/api/suite/coding/codex/resume") return coding.resume(compartment, body.id);
      if (path === "/api/suite/coding/codex/turns/list") return codexSubmissions.list(compartment);
      if (path === "/api/suite/coding/codex/turns/review") return codexSubmissions.review(compartment, body);
      if (path === "/api/suite/coding/codex/turns/submit") return codexSubmissions.submit(compartment, body);
      if (path === "/api/suite/coding/codex/turns/cancel") return codexSubmissions.cancel(compartment, body.requestId);
      if (path === "/api/suite/coding/codex/turns/outcome/review") return codexSubmissions.reviewOutcome(compartment, body.id);
      if (path === "/api/suite/coding/codex/turns/outcome/resolve") return codexSubmissions.resolveOutcome(compartment, body);
      if (path === "/api/suite/coding/codex/turns/delete") return codexSubmissions.remove(compartment, body.id);
      if (path === "/api/suite/coding/claude/discovery") return claudeCoding.discovery(compartment);
      if (path === "/api/suite/coding/claude/inventory") return claudeCoding.inventory(compartment, body);
      if (path === "/api/suite/coding/claude/list") return claudeCoding.list(compartment);
      if (path === "/api/suite/coding/claude/bind") return claudeCoding.bind(compartment, body);
      if (path === "/api/suite/coding/claude/create") return claudeCoding.create(compartment, body);
      if (path === "/api/suite/coding/claude/text/create") return claudeCoding.createText(compartment, body);
      if (path === "/api/suite/coding/claude/status") return claudeCoding.status(compartment, body.id);
      if (path === "/api/suite/coding/claude/focus") return claudeCoding.focus(compartment, body.id);
      if (path === "/api/suite/coding/claude/stop/review") return claudeCoding.reviewStop(compartment, body.id);
      if (path === "/api/suite/coding/claude/stop") return claudeCoding.stop(compartment, body);
      if (path === "/api/suite/coding/claude/turns/list") return claudeSubmissions.list(compartment);
      if (path === "/api/suite/coding/claude/turns/review") return claudeSubmissions.review(compartment, body);
      if (path === "/api/suite/coding/claude/turns/submit") return claudeSubmissions.submit(compartment, body);
      if (path === "/api/suite/coding/claude/turns/recovery/review") return claudeSubmissions.reviewRecovery(compartment, body);
      if (path === "/api/suite/coding/claude/turns/recovery/submit") return claudeSubmissions.submitRecovery(compartment, body);
      if (path === "/api/suite/coding/claude/turns/cancel") return claudeSubmissions.cancel(compartment, body.requestId);
      if (path === "/api/suite/coding/claude/turns/outcome/review") return claudeSubmissions.reviewOutcome(compartment, body.id);
      if (path === "/api/suite/coding/claude/turns/outcome/resolve") return claudeSubmissions.resolveOutcome(compartment, body);
      if (path === "/api/suite/coding/claude/turns/delete") return claudeSubmissions.remove(compartment, body.id);
      if (path === "/api/suite/agents/enroll") return custom.enroll(compartment, body);
      if (path === "/api/suite/agents/outcome/review" || path === "/api/suite/agents/outcome/resolve") {
        if (Object.keys(body).some(k => !["compartment", "agentId", "commandId", "token", "workspaceBaseUrl"].includes(k))) throw Error("Agent outcome review accepts only its exact agent, command and review token.");
        return path.endsWith("/review") ? custom.reviewOutcome(compartment, body) : custom.resolveOutcome(compartment, body);
      }
      if (path === "/api/suite/agents/revoke/review" || path === "/api/suite/agents/revoke") {
        if (Object.keys(body).some(k => !["compartment", "agentId", "token", "workspaceBaseUrl"].includes(k))) throw Error("Agent revocation accepts only its exact identity and review token.");
        if (path.endsWith("/review")) return custom.reviewRevoke(compartment, body.agentId);
        const result = await custom.revoke(compartment, body);
        const example = ["custom", "langchain"].find(name => `${name}-example` === body.agentId);
        if (!example) return result;
        try { return { ...result, ownedExample: await stopExample(compartment, example) }; }
        catch { return { ...result, ownedExample: { status: "stop-unconfirmed", evidence: "Authorization is revoked; owned process retirement could not be recorded.", taskCompletionVerified: false } }; }
      }
      if (path === "/api/suite/agents/dispatch") return custom.dispatch(compartment, body);
      if (path === "/api/suite/agents/example/stop") {
        if (!["custom", "langchain"].includes(body.example)) throw new Error("Choose a bundled owned example.");
        return stopExample(compartment, body.example);
      }
      if (path === "/api/suite/agents/example") {
        if (!["custom", "langchain"].includes(body.example)) throw new Error("Choose the bundled custom or LangChain example.");
        const key = `${compartment}:${body.example}`, fence = exampleGenerations.get(key) ?? 0;
        await store.authorize(compartment, { provider: "custom-agent" });
        if (closed || fence !== (exampleGenerations.get(key) ?? 0)) throw new Error("This example request was invalidated before startup.");
        if (exampleStops.has(key)) throw new Error("The exact bundled example is stopping. Wait for its retirement before starting again.");
        if (uncertainExamples.has(key)) throw new Error("The previous bundled example has not verified exit. No replacement was launched.");
        if (exampleStarts.has(key)) { await exampleStarts.get(key); return { status: "already-starting", duplicatePrevented: true }; }
        const existing = examples.get(key);
        if (existing && existing.exitCode === null && existing.signalCode == null) return { status: "already-running", duplicatePrevented: true };
        const generation = fence;
        const starting = (async () => {
        const id = `${body.example}-example`, state = await store.snapshot(compartment);
        if (closed || generation !== (exampleGenerations.get(key) ?? 0)) throw new Error("This example launch was stopped before startup.");
        let enrollment;
        if (state.agents.find(a => a.id === id)?.enrollmentStatus === "revoked") throw Error("This example authorization was revoked. Enroll it deliberately with a new credential before starting it.");
        if (state.agents.some((a) => a.id === id)) enrollment = { compartment, agentId: id, token: await store.credential(compartment, `agent-${id}`, undefined, { provider: "custom-agent" }), initialSequence: state.agents.find((a) => a.id === id).sequence };
        else enrollment = await custom.enroll(compartment, { id, name: body.example === "custom" ? "Synthetic custom agent" : "Synthetic LangChain Runnable", capabilities: agentIntents });
        const base = new URL(body.workspaceBaseUrl);
        if (base.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(base.hostname) || base.pathname !== "/" || base.username || base.password || base.search || base.hash) throw new Error("The example requires this workspace's loopback origin.");
        const file = fileURLToPath(new URL(body.example === "custom" ? "../../examples/custom-agent/agent.mjs" : "../../examples/langchain-agent/agent.py", import.meta.url));
        const executable = body.example === "custom" ? process.execPath : (await resolveRuntimePaths()).python;
        await store.authorize(compartment, { provider: "custom-agent" });
        if (closed || generation !== (exampleGenerations.get(key) ?? 0)) throw new Error("This example launch was stopped before startup.");
        const child = spawnExample(executable, [...(body.example === "langchain" ? ["-I", "-B"] : []), file], { shell: false, windowsHide: true, stdio: ["pipe", "ignore", "ignore"], env: runtimeEnvironment() });
        examples.set(key, child); child.stdin.on("error", () => {});
        child.on("close", () => { if (examples.get(key) === child) { examples.delete(key); uncertainExamples.delete(key); } });
        try {
          await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
          if (closed || generation !== (exampleGenerations.get(key) ?? 0)) throw new Error("This example launch was stopped during startup.");
          child.stdin.write(JSON.stringify({ ...enrollment, baseUrl: base.href, supervised: true }) + "\n");
        } catch (error) { await retireExample(key, child); throw error; }
        return { status: "starting", agentId: id, provenance: "Wait for authenticated ready event before claiming availability" };
        })();
        exampleStarts.set(key, starting);
        try { return await starting; } finally { if (exampleStarts.get(key) === starting) exampleStarts.delete(key); }
      }
      if (path === "/api/suite/roles/bind") {
        if (!agentIntents.includes(body.intent)) throw new Error("Choose a stable supported intent.");
        return store.update(compartment, "role-bind", state => saveRoleBinding(state, body), { provider: body.provider });
      }
      if (path === "/api/suite/roles/dispatch") {
        if (Object.keys(body).some(k => !["compartment", "roleId", "intent", "content", "requestId", "workspaceBaseUrl"].includes(k))) throw new Error("Role dispatch accepts only a bound role, intent, request identity and supported content.");
        return this.dispatchRole(compartment, body.roleId, body.intent, body.content, body.requestId);
      }
      if (path === "/api/suite/native-focus/recover") {
        if (Object.keys(body).some(key => !["compartment", "workspaceBaseUrl"].includes(key))) throw Error("Native focus recovery observes only original helper retirement.");
        return windowsNativeFocus.recover(compartment);
      }
      if (path === "/api/suite/native-focus/catalog") {
        if (Object.keys(body).some(key => !["compartment", "workspaceBaseUrl"].includes(key))) throw Error("Read only this workspace's saved native app configuration.");
        return clients.focusCatalog(compartment);
      }
      if (path === "/api/suite/native-focus/review" || path === "/api/suite/native-focus/configure") {
        const { compartment: _compartment, workspaceBaseUrl: _baseUrl, ...input } = body;
        return path.endsWith("/review") ? windowsNativeFocus.review(compartment, input) : windowsNativeFocus.configure(compartment, input);
      }
      if (path === "/api/suite/intent" || path === "/api/suite/native-focus/focus") {
        if (Object.keys(body).some(k => !["compartment", "implementation", "roleId", "intent", "requestId", "workspaceBaseUrl"].includes(k))) throw new Error("Physical dispatch is outside the closed intent contract.");
        const reviewedNative = path === "/api/suite/native-focus/focus";
        if (reviewedNative && (!Object.hasOwn(body, "compartment") || Object.keys(body).some(k => !["compartment", "implementation", "requestId", "workspaceBaseUrl"].includes(k)) || !Object.hasOwn(nativeFocusImplementations, body.implementation))) throw Error("Return only to an exact native app in its reviewed workspace.");
        await loadSelection();
        const selected = activeCompartment, context = await selectedIntentContext(selected);
        if (Object.hasOwn(nativeFocusImplementations, body.implementation)) {
          const native = nativeFocusImplementations[body.implementation];
          const assertCurrent = async () => {
            if (reviewedNative && compartment !== selected) throw Error("The selected workspace changed after this native app review.");
            await context.assertCurrent();
            await store.authorize(selected, { provider: native.provider });
            context.assertCurrentState();
          };
          await assertCurrent();
          if (platform === "win32") return windowsNativeFocus.focus(selected, body.implementation, { requestId: body.requestId, assertCurrent });
          await this.authorizeConnection(selected, { implementation: body.implementation });
          return native.focus(hypr, { readProcess: nativeProcess, assertCurrent });
        }
        if (body.implementation === "switchyard.role/v1") return this.dispatchRole(selected, body.roleId, body.intent, undefined, body.requestId, context);
        throw new Error("The physical intent is outside the closed implementation map.");
      }
      if (path === "/api/suite/snapshot") {
        const s = await store.snapshot(compartment);
        // Recovery packets include original index bytes and private ownership
        // records. Explicit recovery routes expose observations, never backups.
        const { repositoryEffectJournal, repositoryRecoveryJournal, repositoryEffectCheckpoints, repositoryEffects, repositoryCommitReviews, clientLaunches, repositoryExecutions, repositoryExecutionJournal, repositoryExecutionReviews, repositoryExecutionStaging, repositoryExecutionStops, repositoryExecutionStopJournal, repositoryWindowsInputs, repositoryWindowsGuests, repositoryWindowsGuestCommands, repositoryWindowsTools, repositoryWindowsImages, repositoryWindowsBrokerExchanges, repositoryWindowsRuns, windowsStorageNative,windowsStorageReviews,windowsStorageJournal,scannerFixtureReviews,scannerFixtureJournal,shieldExceptionJournal,shieldExceptionReviews,copilotRequests,copilotRequestTombstones,codingTaskOwners,codingTaskLoads,codingEditorAuthorizations,codingEditorConnections,nativeFocusOperations,...snapshot } = s;
        return { ...snapshot, voice: s.voice.map((v) => ({ ...v, chunks: v.chunks.map(({ audio, ...c }) => ({ ...c, pendingAudio: Boolean(audio) })) })), observationSummaries: s.observations.map(observationSummary) };
      }
      if (path === "/api/suite/profile/save") return store.saveProfile(compartment, body.profile);
      if (path === "/api/suite/profile/select") return store.selectProfile(compartment, body.profileId, body.revision ?? null);
      if (path === "/api/suite/devices/list") return devices.list();
      if (path === "/api/suite/host/keyboard-indicators") return keyboardIndicators.read();
      if (path === "/api/suite/devices/identify") {
        if (typeof body.deviceId !== "string" || !/^[a-f0-9]{64}$/.test(body.deviceId)) throw new Error("Choose an exact previously read configuration interface.");
        const snapshots = ((await store.snapshot(compartment)).deviceSnapshots ?? []).filter((s) => s.identity.deviceId === body.deviceId);
        if (snapshots.length !== 1) throw new Error("Read this exact device in this workspace before reconciling source identity.");
        const result = identifyCatalogSnapshot(sourceCatalog, snapshots[0]), observed = Date.parse(result.capturedAt), ageMs = Date.now() - observed;
        return { ...result, haptics:inspectSourceHaptics(sourceCatalog,snapshots[0]), snapshotStatus: Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 120000 ? "recent-readout" : "historical-readout", applied: false, note: "This compares the protected readout to source references. It performs no HID operation, changes no profile and grants no host/device authority." };
      }
      if (path === "/api/suite/devices/read") return devices.read(compartment, body.deviceId);
      if (path === "/api/suite/devices/profile/review") return readoutProfiles.review(compartment, body);
      if (path === "/api/suite/devices/profile/adopt") return readoutProfiles.adopt(compartment, body);
      if (path === "/api/suite/devices/review") return devices.review(compartment, body.deviceId, body.configuration ?? body.changes);
      if (path === "/api/suite/devices/apply") return devices.apply(compartment, body.reviewId);
      if (path === "/api/suite/devices/restore") return devices.restore(compartment, body.id);
      if (path === "/api/suite/devices/unlock") return devices.unlock(body.deviceId, body.operation);
      if (path === "/api/suite/devices/lock") { await matrixDiagnostics.stopCompartment(compartment);
          await repositoryExecution.stopCompartment(compartment); await repositoryCommits.stopCompartment(compartment); await repositoryRecovery.stopCompartment(compartment); await clientLaunch.stopCompartment(compartment);
          await taskAuthority.stopCompartment(compartment); return devices.relock(compartment, body.deviceId); }
      if (path === "/api/suite/devices/matrix/review") return matrixDiagnostics.review(compartment, body);
      if (path === "/api/suite/devices/matrix/start") return matrixDiagnostics.start(compartment, body);
      if (path === "/api/suite/devices/matrix/sample") return matrixDiagnostics.sample(compartment, body);
      if (path === "/api/suite/devices/matrix/stop") return matrixDiagnostics.stop(compartment, body);
      if (path === "/api/suite/profile/export") return store.exportProfile(compartment);
      if (path === "/api/suite/profile/legends/export") return exportAssignmentLegends((await store.exportProfilePackage(compartment)).document, body.options);
      if (path === "/api/suite/profile/package/export") return store.exportProfilePackage(compartment, body.preferences ?? null);
      if (path === "/api/suite/profile/package/review") return store.reviewProfilePackage(compartment, body.document);
      if (path === "/api/suite/profile/package/import") return store.importProfilePackage(compartment, body.document, body.reviewId);
      if (path === "/api/suite/workflow/save") return store.saveWorkflow(compartment, body.workflow);
      if (path === "/api/suite/copilot/discovery") return copilot.discovery(compartment);
      if (["/api/suite/copilot/requests", "/api/suite/copilot/requests/review", "/api/suite/copilot/requests/resolve"].includes(path)) {
        const { workspaceBaseUrl, ...input } = body;
        const allowed = path.endsWith("/resolve") ? ["compartment", "id", "token"] : path.endsWith("/review") ? ["compartment", "id"] : ["compartment"];
        if (Object.keys(input).some(key => !allowed.includes(key))) throw Error("Inspect or review only one original Microsoft request; prompt, credential and replay fields are refused.");
        return path.endsWith("/resolve") ? copilot.resolveRequest(compartment, input) : path.endsWith("/review") ? copilot.reviewRequest(compartment, input.id) : copilot.listRequests(compartment);
      }
      if (path === "/api/suite/integrations/catalog") return clients.catalog(compartment);
      if (path === "/api/suite/integrations/launches") return clientLaunch.list(compartment);
      if (path === "/api/suite/integrations/launch") { const { workspaceBaseUrl, ...proposal } = body; return clientLaunch.launch(compartment, proposal); }
      if (path === "/api/suite/integrations/recipe") { const { workspaceBaseUrl, ...proposal } = body; return clients.recipe(compartment, proposal); }
      if (path === "/api/suite/copilot/login") return copilot.beginLogin(compartment, body);
      if (path === "/api/suite/copilot/poll") return copilot.pollLogin(compartment, body.loginId);
      if (path === "/api/suite/copilot/login/cancel") {
        if (Object.keys(body).some(key => !["compartment", "loginId", "workspaceBaseUrl"].includes(key))) throw Error("Stop only the exact pending Microsoft sign-in; account and replay fields are refused.");
        return copilot.cancelLogin(compartment, body.loginId);
      }
      if (path === "/api/suite/design/observations/review") {
        if (Object.keys(body).some(key => !["compartment", "workspaceBaseUrl", "provider", "sessionIds"].includes(key))) throw new Error("Review only the selected observation sessions and intended designer.");
        return reviewDesignObservations(await store.snapshot(compartment, { provider: body.provider }), body.provider, body.sessionIds);
      }
      if (path === "/api/suite/design") { await store.authorize(compartment, { provider: body.provider }); if (body.provider === "microsoft-365-copilot" && body.observationReview !== undefined) throw new Error("Work Copilot observation export is not enabled by this workspace's policy. No fallback provider was selected."); return (body.provider === "microsoft-365-copilot" ? copilot : agents).design({ compartment, provider: body.provider, message: body.message, plan: body.plan, conversationId: body.conversationId, ...(body.provider === "microsoft-365-copilot" ? { requestId: body.requestId } : { observationReview: body.observationReview }) }); }
      if (path === "/api/suite/design/cancel") return agents.cancel(compartment, body.conversationId);
      if (path === "/api/suite/design/status") return agents.status(compartment, body.conversationId);
      if (path === "/api/suite/conversation/binding/review") return agents.reviewLegacyBinding(compartment, body.conversationId);
      if (path === "/api/suite/conversation/binding/bind") return agents.bindLegacy(compartment, body);
      if (path === "/api/suite/conversation/delete") return store.update(compartment, "conversation-delete", (s) => { s.conversations = s.conversations.filter((c) => c.id !== body.id); return { deleted: true }; });
      if (path === "/api/suite/observation/start") {
        const sources = body.sources;
        if (body.consent !== true || !Array.isArray(sources) || !sources.length || sources.some((s) => !["deliberate", "foreground-category", "agent-events", "host-action-events", "editor-events"].includes(s)) || !Array.isArray(body.exclusions) || body.exclusions.some((s) => !["terminal", "vscode", "chatgpt", "claude", "codex", "browser", "other"].includes(s))) throw new Error("Choose observation sources and exclusions and explicitly start a session.");
        if (!foreground.implemented && sources.includes("foreground-category")) throw new Error("Foreground category sampling requires the supported native platform adapter. Deliberate and agent-event observation remain available.");
        const at = Date.now(), o = { id: randomUUID(), status: "recording", sources, exclusions: body.exclusions, events: [], focusCategories: {}, createdAt: at, recordingSince: at, recordingGeneration: randomUUID(), updatedAt: at };
        await store.update(compartment, "observation-start", (s) => { if (s.observations.some((o) => ["recording", "paused"].includes(o.status))) throw new Error("Stop or resume the existing session first."); s.observations.push(o); }, { operation: "record" });
        if (sources.includes("foreground-category")) monitor(compartment, o.id, o.recordingGeneration);
        return o;
      }
      if (path === "/api/suite/observation/mark") return store.update(compartment, "observation-mark", (s) => { const o = session(s, body.id); if (o.status !== "recording" || !o.sources.includes("deliberate") || !kinds.includes(body.kind)) throw new Error("Start deliberate observation and choose a supported event kind."); if (o.events.length >= 2000) throw new Error("Session event limit reached. Stop and review this session."); o.events.push({ kind: body.kind, provenance: "user-marked", at: Date.now() }); o.updatedAt = Date.now(); return observationSummary(o); }, { operation: "record" });
      if (path === "/api/suite/observation/state") { let shouldMonitor = false, recordingGeneration; const result = await store.update(compartment, "observation-state", (s) => { const o = session(s, body.id); if (!["paused", "recording", "stopped"].includes(body.status) || (o.status === "stopped" && body.status !== "stopped")) throw new Error("That session transition is unavailable."); const at = Date.now(); if (body.status === "recording" && o.status !== "recording") { o.recordingSince = Math.max(at, o.createdAt ?? 0, o.recordingSince ?? 0); o.recordingGeneration = randomUUID(); } o.status = body.status; o.updatedAt = at; shouldMonitor = o.status === "recording" && o.sources.includes("foreground-category"); recordingGeneration = o.recordingGeneration; return observationSummary(o); }, body.status === "recording" ? { operation: "record" } : {}); pauseMonitor(compartment); if (shouldMonitor) monitor(compartment, body.id, recordingGeneration); else await foreground.stopCompartment?.(compartment); return result; }
      if (path === "/api/suite/observation/delete") return store.update(compartment, "observation-delete", (s) => { const o = session(s, body.id); if (o.status === "recording") throw new Error("Stop the session before deleting its data."); s.observations = s.observations.filter((o) => o.id !== body.id); return { deleted: true }; });
      if (path === "/api/suite/voice/start") {
        await store.authorize(compartment, { operation: "record", provider: "local-transcription" });
        if (body.consent !== true) throw new Error("Review the local audio destination before starting voice.");
        const available = await voice.discovery(); if (!available.available) throw new Error(available.reason);
        const v = { id: randomUUID(), status: "recording", destination: "local-transcription", chunks: [], transcript: "", reviewedTranscript: "", updatedAt: Date.now() };
        return store.update(compartment, "voice-start", (s) => { if (s.voice.some((v) => v.status === "recording")) throw new Error("Pause the current voice session first."); s.voice.push(v); return v; }, { operation: "record", provider: "local-transcription" });
      }
      if (path === "/api/suite/voice/segment") return voiceQueue.segment(compartment, body);
      if (path === "/api/suite/voice/retry") { const s = await store.snapshot(compartment), v = voiceSession(s, body.id); for (const chunk of v.chunks.filter((c) => c.audio && c.status === "pending")) await this.handle("/api/suite/voice/segment", { compartment, id: v.id, audio: chunk.audio, chunkId: chunk.id }); return { retried: true }; }
      if (path === "/api/suite/voice/state") return store.update(compartment, "voice-state", (s) => { const v = voiceSession(s, body.id); if (!["recording", "paused", "stopped"].includes(body.status) || v.status === "stopped") throw new Error("That voice transition is unavailable."); v.status = body.status; v.updatedAt = Date.now(); return { id: v.id, status: v.status }; }, body.status === "recording" ? { operation: "record", provider: "local-transcription" } : {});
      if (path === "/api/suite/voice/review") return store.update(compartment, "voice-review", (s) => reviewTranscript(voiceSession(s, body.id), body.transcript));
      if (path === "/api/suite/voice/delete") { const result = await store.update(compartment, "voice-delete", (s) => { const v = voiceSession(s, body.id); if (v.status === "recording") throw new Error("Pause or stop voice before deleting its data."); s.voice = s.voice.filter((v) => v.id !== body.id); return { deleted: true }; }); const stopped = await voiceQueue.stopSession(compartment, body.id); if (stopped.stopped === false) throw new Error("Voice data was deleted, but its owned local worker stop is unconfirmed."); return result; }
      if (path === "/api/suite/route/check") { await store.route(compartment, body.destination, "synthetic-boundary-check", body.provider); return { allowed: true }; }
      throw new Error("That suite operation is unavailable. No alternate action was executed.");
    },
    async dispatchRole(compartment, roleId, intent, content, requestId, { assertCurrent: assertContextCurrent = async () => {}, assertCurrentState: assertContextState = () => {} } = {}) {
      const s = await store.snapshot(compartment), b = roleTarget(s, roleId, intent);
      const digest = roleBindingDigest(s, b);
      const assertCurrentState = state => {
        assertContextState();
        const binding = state.roleBindings?.find(candidate => candidate.roleId === roleId && candidate.intent === intent);
        if (roleBindingDigest(state, binding) !== digest) throw new Error("The exact role binding changed before dispatch settled. Any command already queued remains with its original session; no alternate target or automatic retry was selected.");
      };
      const assertCurrent = async () => {
        await assertContextCurrent();
        const current = await store.snapshot(compartment, { provider: b.provider });
        assertCurrentState(current);
        roleTarget(current, roleId, intent);
      };
      await assertContextCurrent();
      await store.authorize(compartment, { provider: b.provider });
      let result;
      if (b.targetKind === "client-surface") {
        if (content !== undefined) throw new Error("A homepage launch cannot receive workflow content, prompts or handoffs.");
        result = await clientLaunch.launch(compartment, { compartment, id: b.targetId, requestId }, { digest, assertCurrent });
      }
      else if (b.targetKind === "coding-task") result = b.provider === "claude-code" ? await (intent === "summon" ? claudeCoding.focus(compartment, b.targetId, { assertCurrent }) : claudeCoding.status(compartment, b.targetId)) : await (intent === "resume" ? coding.resume(compartment, b.targetId, { assertCurrent, authorizationKey: digest }) : coding.status(compartment, b.targetId));
      else if (b.provider === "custom-agent") result = await custom.dispatch(compartment, { agentId: b.targetId, intent, sessionId: b.sessionId, content, credentialEpoch: b.credentialEpoch ?? "legacy" }, { assertCurrent: assertContextCurrent, assertCurrentState });
      else {
        const c = s.conversations.find((c) => c.id === b.targetId && c.provider === b.provider && c.sessionId === b.sessionId);
        if (!c) throw new Error("This exact role target changed or disappeared. Rebind it deliberately.");
        if (["summon", "resume"].includes(intent)) result = b.provider === "microsoft-365-copilot" ? { status: "selected-for-continuation", sessionId: b.sessionId, provenance: "Owned Graph conversation selected; next message continues it. Desktop focus and runtime completion are not observed." } : await agents.resume(compartment, c.id, { assertCurrent });
        else if (intent === "status") result = b.provider === "microsoft-365-copilot" ? { status: "not-observed", sessionId: b.sessionId, provenance: "Stored Graph conversation identity, not live task status" } : await agents.status(compartment, c.id);
        else if (intent === "cancel") { if (b.provider === "microsoft-365-copilot") throw new Error("The selected Graph contract does not provide task cancellation. No cancellation was claimed."); result = await agents.cancel(compartment, c.id, { assertCurrent }); }
        else {
          if (!s.profile) throw new Error("Save the current profile before reviewing or handing off its workflow.");
          const message = intent === "review" ? "Review this configuration workflow and key arrangement. Propose improvements without applying anything." : `Review this deliberate handoff within the same compartment: ${typeof content === "string" ? content.slice(0, 12000) : "Continue from the saved workflow, roles and key arrangement."}`;
          result = await (b.provider === "microsoft-365-copilot" ? copilot : agents).design({ compartment, provider: b.provider, message, plan: s.profile.plan, conversationId: c.id }, { assertCurrent, assertCurrentState });
        }
      }
      await store.update(compartment, "role-intent-result", async (state) => { await assertContextCurrent(); assertCurrentState(state); if (b.targetKind === "coding-task") state.activeCodingSessionId = b.targetId; else if (b.targetKind !== "client-surface" && b.provider !== "custom-agent") state.activeConversationId = b.targetId; state.intentResults = [...(state.intentResults ?? []).slice(-31), { at: Date.now(), roleId, intent, result }]; }, { provider: b.provider });
      return result;
    },
    async authorizeConnection(compartment, connection = { implementation: "native-chatgpt.focus/v1" }) {
      await loadSelection(); compartment ??= activeCompartment;
      if (compartment !== activeCompartment) throw new Error("Select this workspace before reviewing a physical shortcut. The active workspace policy controls every invocation.");
      if (Object.hasOwn(nativeFocusImplementations, connection.implementation)) { const native = nativeFocusImplementations[connection.implementation]; await store.authorize(compartment, { provider: native.provider }); if (platform === "win32") return windowsNativeFocus.inspect(compartment, connection.implementation); if (platform !== "linux") throw new Error("Verified native client window focus is not implemented on this platform. Bind a supported agent role instead."); return native.inspect(hypr, nativeProcess); }
      if (connection.implementation !== "switchyard.role/v1") throw new Error("This physical connection is outside the closed action map.");
      const state = await store.snapshot(compartment), binding = roleTarget(state, connection.roleId, connection.intent);
      await store.authorize(compartment, { provider: binding.provider });
      if (binding.targetKind === "client-surface") return { available: true, implementation: connection.implementation, provider: binding.provider, roleId: binding.roleId, intent: binding.intent, capability: "launch-only", recipeId: binding.targetId, sessionIdentified: false, evidence: "exact fixed homepage launch request; no account, window focus, resume or conversation identity verified" };
      return { available: true, implementation: connection.implementation, provider: binding.provider, roleId: binding.roleId, intent: binding.intent, evidence: binding.targetKind === "coding-task" ? "exact coding-task identity; runtime status or owned read-only daemon resume, without window focus, completion or mediated-control authority" : "exact owned configuration conversation or authenticated adapter session; not general coding-task control" };
    },
    async close() { closed = true; const boundaryStops = await Promise.allSettled([(async () => {
        let editorError;
        try { const result = await codingEditorConnections?.close(); if (result && result.stopped !== true) throw Error("Original editor connection retirement is unconfirmed."); } catch (error) { editorError = error; }
        await codingEditorAuthorizations.close();
        const results = await codingTaskOwners.close();
        if (!Array.isArray(results) || results.some(r => r?.stopped !== true)) throw new Error("Original coding task owner exit is unconfirmed.");
        if (editorError) throw editorError;
      })(), windowsNativeFocus.close(), copilot.close?.(), matrixDiagnostics.close(), repositoryExecution.close(), repositoryCommits.close(), repositoryRecovery.close(), clientLaunch.close(), scannerRecipeSave.close(), taskAuthority.close(), storageSetup.close(), fixtureAdministration.close(), shieldExceptions.close()]); readoutProfiles.close(); for (const timer of monitors.values()) clearForeground(timer); monitors.clear(); for (const key of new Set([...examples.keys(), ...exampleStarts.keys()])) exampleGenerations.set(key, (exampleGenerations.get(key) ?? 0) + 1); await Promise.allSettled(exampleStarts.values()); let claudeStopError; try { await claudeSubmissions.close(); } catch (error) { claudeStopError = error; } const providerStops = await Promise.allSettled([foreground.close?.(), agents.close(), coding.close?.(), codexSubmissions.close(), voiceQueue.close(), claudeCoding.close?.(), keyboardIndicators.close().then(result => { if (result.stopped !== true) throw new Error("Owned indicator probe exit is unconfirmed."); }), ...exampleStops.values(), ...[...examples].map(async ([key, child]) => { if (!(await retireExample(key, child)).stopped) throw new Error("Owned bundled example exit is unconfirmed."); })]); if (claudeStopError) throw claudeStopError; const failedProvider = providerStops.find(r => r.status === "rejected"); if (failedProvider) throw failedProvider.reason; const failedBoundary = boundaryStops.find(r => r.status === "rejected"); if (failedBoundary) throw failedBoundary.reason; }
  };
}
