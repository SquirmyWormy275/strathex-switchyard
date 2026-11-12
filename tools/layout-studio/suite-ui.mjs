import { api, setActiveCompartment } from "./connection.mjs";
import { mountRoles, mountAgentMaintenance } from "./role-ui.mjs";
import { mountPortable } from "./portable-ui.mjs";
import { mountClients, mountNativeFocus } from "./client-ui.mjs";
import { mountExecution } from "./execution-ui.mjs";
import { mountAuthority } from "./authority-ui.mjs";
import { mountScanner } from "./scanner-ui.mjs";
import { mountFeeds } from "./feed-ui.mjs";
import { mountConversations } from "./conversation-ui.mjs";
import { mountTasks } from "./task-ui.mjs";
import { mountCopilot } from "./copilot-ui.mjs";
import { mountVoice } from "./voice-ui.mjs";
import { mountObservation } from "./observation-ui.mjs";
const $ = (id) => document.getElementById(id);

export function mountSuite({ getProfile, loadProfile, previewProposal, notify, saved, onPolicy, onWorkflow, download }) {
  let refreshGeneration = 0;
  let compartment = "personal", state = null, proposedWorkflow = null, saveTimer;
  const lines = (id) => $(id).value.split("\n").map((s) => s.trim()).filter(Boolean);
  async function run(fn) { try { return await fn(); } catch (e) { $("suite-status").textContent = e.message; notify(e.message); return null; } }
  function workflowForm(workflow) { $("workflow-name").value = workflow.name; $("workflow-steps").value = workflow.steps.map((s) => typeof s === "string" ? s : s.label).join("\n"); $("workflow-roles").value = workflow.roles.map((r) => typeof r === "string" ? r : r.label).join("\n"); }
  async function refresh() {
    const target = compartment, version = ++refreshGeneration;
    const snapshot = await api("/api/suite/snapshot", { compartment: target });
    if (version !== refreshGeneration || target !== compartment) return;
    state = snapshot;
    onPolicy(state.policyRules.export);
    onWorkflow(state.workflow);
    $("operating-mode").value = state.mode ?? (state.policy === "work" ? "managed-companion" : "personal-companion");
    $("policy-summary").textContent = `${state.policy === "work" ? "Copilot-only Work" : "Personal"} · ${state.policyRules.providers.join(", ")} · ${state.policyRules.recording ? "recording allowed by policy" : "recording prohibited"} · ${state.policyRules.export ? "portable export allowed" : "exports prohibited"} · ${state.policyRules.retentionDays}-day session retention. This is an application routing boundary, not an OS sandbox.`;
    for (const id of ["export-json", "export-markdown", "copy-json", "copy-assistant-context"]) $(id).disabled = !state.policyRules.export || !getProfile();
    const provider = $("conversation-provider").value;
    $("conversation-provider").replaceChildren(...state.policyRules.providers.filter((p) => ["codex", "claude-code", "microsoft-365-copilot"].includes(p)).map((p) => { const o = document.createElement("option"); o.value = p; o.textContent = ({ codex: "Codex · installed account", "claude-code": "Claude Code · installed account", "microsoft-365-copilot": "Microsoft 365 Copilot · approved account" })[p]; return o; }));
    if ([...$("conversation-provider").options].some((o) => o.value === provider)) $("conversation-provider").value = provider;
    document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: state }));
    $("suite-status").textContent = "Private workspace connected. Saves use an independent OS-protected key for this compartment.";
    const previousProfile = $("saved-profile").value;
    const profiles = state.profiles?.length ? state.profiles.map((p) => p.profile) : state.profile ? [state.profile] : [];
    $("saved-profile").replaceChildren(...profiles.map((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; return o; }));
    if (profiles.some((p) => p.id === previousProfile)) $("saved-profile").value = previousProfile;
    else if (state.profile) $("saved-profile").value = state.profile.id;
    profileRevisions();
    $("profile-library-status").textContent = `${profiles.length} saved layouts · ${state.profileHistory?.length ?? 0} previous revisions. Opening a version changes the plan, not installed shortcuts or devices.`;
  }
  async function persist() {
    const p = getProfile(); if (!p || !state) return;
    const serialized = JSON.stringify(p), target = compartment;
    await api("/api/suite/profile/save", { compartment: target, profile: p });
    if (target === compartment && JSON.stringify(getProfile()) === serialized) {
      saved();
      document.dispatchEvent(new Event("switchyard-profile-loaded"));
      if (p.workflow && JSON.stringify(state.workflow) !== JSON.stringify(p.workflow)) { await refresh(); workflowForm(state.workflow); }
    }
  }
  document.addEventListener("switchyard-plan-change", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { void run(persist); }, 450); });
  $("save-workspace").addEventListener("click", () => run(async () => { await persist(); notify("Profile saved privately. It will reopen after restart."); }));
  function profileRevisions() {
    const id = $("saved-profile").value;
    const items = state?.profileHistory?.filter((r) => r.profile.id === id).toReversed() ?? [];
    $("profile-revision").replaceChildren(...[{ revision: "", label: "Current saved version" }, ...items.map((r) => ({ revision: r.revision, label: `${new Date(r.at).toLocaleString()} · ${r.profile.name}` }))].map((r) => { const o = document.createElement("option"); o.value = r.revision; o.textContent = r.label; return o; }));
  }
  $("saved-profile").addEventListener("change", profileRevisions);
  $("load-saved-profile").addEventListener("click", () => run(async () => {
    const profileId = $("saved-profile").value, revision = $("profile-revision").value || null;
    if (!profileId) throw new Error("Save a layout first.");
    clearTimeout(saveTimer); await persist();
    const p = await api("/api/suite/profile/select", { compartment, profileId, revision });
    loadProfile(p); await refresh(); workflowForm(state.workflow); notify("Saved layout opened. Device programming and installed shortcuts have not changed.");
  }));
  $("save-profile-copy").addEventListener("click", () => run(async () => {
    const p = getProfile(), name = $("profile-copy-name").value.trim();
    if (!p || !name) throw new Error("Open a layout and enter a name for its copy.");
    clearTimeout(saveTimer); await persist();
    const copy = { ...p, id: `profile-${crypto.randomUUID()}`, name };
    await api("/api/suite/profile/save", { compartment, profile: copy });
    loadProfile(copy); await refresh(); workflowForm(state.workflow); $("profile-copy-name").value = ""; notify("Separate layout saved privately. The previous profile remains available.");
  }));
  let switching = false;
  function workspaceBusy(value) {
    switching = value; $("compartment-picker").disabled = value; $("operating-mode").disabled = value;
    $("save-workspace").disabled = value; document.querySelector(".app-main").inert = value;
  }
  $("compartment-picker").addEventListener("change", () => run(async () => {
    if (switching) return;
    const nextCompartment = $("compartment-picker").value;
    workspaceBusy(true);
    try {
      await voice.beforeWorkspaceChange(); document.dispatchEvent(new Event("switchyard-workspace-changing"));
      clearTimeout(saveTimer); await persist();
      await api("/api/suite/compartment/select", { compartment: nextCompartment });
      compartment = nextCompartment; setActiveCompartment(compartment);
    } finally {
      $("compartment-picker").value = compartment;
      try { await refresh(); workflowForm(state.workflow); loadProfile(state.profile ?? null); }
      finally { workspaceBusy(false); }
    }
  }));
  $("operating-mode").addEventListener("change", () => run(async () => {
    if (switching) return;
    const mode = $("operating-mode").value;
    workspaceBusy(true);
    try {
      await voice.beforeWorkspaceChange(); document.dispatchEvent(new Event("switchyard-workspace-changing"));
      await api("/api/suite/mode", { compartment, mode });
    } finally { try { await refresh(); } finally { workspaceBusy(false); } }
  }));
  $("create-work-compartment").addEventListener("click", () => run(async () => { await api("/api/suite/compartment/create", { compartment: "work", policy: "work" }); const bootstrap = await api("/api/suite/bootstrap", {}); fillCompartments(bootstrap.compartments); notify("Copilot-only Work compartment created with its own protected key. No work account or client data was accessed."); }));
  $("copilot-work-setup").addEventListener("click", () => run(async () => { await api("/api/suite/compartment/create", { compartment: "work", policy: "work" }); const bootstrap = await api("/api/suite/bootstrap", {}); fillCompartments(bootstrap.compartments); notify("Copilot-only Work is ready. Select it in the workspace menu; account enrollment remains a separate, deliberate step."); }));
  function fillCompartments(list) { $("compartment-picker").replaceChildren(...list.map((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.id === "work" ? "Work · Copilot only" : c.id === "personal" ? "Personal" : c.id; return o; })); $("compartment-picker").value = compartment; }
  $("save-workflow").addEventListener("click", () => run(async () => { const workflow = { name: $("workflow-name").value, steps: lines("workflow-steps"), roles: lines("workflow-roles") }; await api("/api/suite/workflow/save", { compartment, workflow }); proposedWorkflow = null; await refresh(); notify("Workflow saved. Steps and roles remain editable."); }));
  $("refresh-agent-targets").addEventListener("click", () => run(refresh));
  for (const [button, example] of [["start-custom-example", "custom"], ["start-langchain-example", "langchain"]]) $(button).addEventListener("click", () => run(async () => { const r = await api("/api/suite/agents/example", { compartment, example }); $("role-result").textContent = `${r.status}. Refresh targets after its authenticated ready event.`; }));
  $("design-form").addEventListener("submit", (event) => { event.preventDefault(); void run(async () => {
    if (!getProfile()) throw new Error("Load your keyboard before asking for a key arrangement.");
    const context = conversations.begin();
    let submitted = false;
    const message = $("design-message").value, destination = context.destination, target = context.compartment, profile = JSON.stringify(getProfile());
    $("design-status").textContent = `Connecting to ${$("conversation-provider").value} with this layout and your message. Tools are disabled for configuration design.`;
    try {
      await persist();
      if (!context.current() || profile !== JSON.stringify(getProfile())) throw Error("The workspace, assistant or layout changed. Review your message before sending.");
      const observationReview = observation.takeReview(destination);
      submitted = true;
      const response = await api("/api/suite/design", { compartment: target, provider: destination, message, plan: getProfile().plan, conversationId: context.conversationId, ...(context.requestId ? { requestId: context.requestId } : {}), ...(observationReview ? { observationReview } : {}) });
      if (profile !== JSON.stringify(getProfile())) throw Error("The layout changed while the assistant was replying. Inspect saved context before using its proposal.");
      if (!conversations.accepted(context, response.conversationId)) return;
      proposedWorkflow = response.workflow; workflowForm(proposedWorkflow);
      if (response.proposal) previewProposal(response.proposal);
      $("design-status").textContent = `${response.reply}\nReview the proposed layout above and the proposed process below. Save only what you want to keep.`;
      $("design-message").value = ""; await refresh();
    } catch (error) { conversations.failed(context, error, submitted); notify(error.message); }
    finally { conversations.finish(); }
  }); });
  $("cancel-design").addEventListener("click", () => run(async () => { const context = conversations.cancellation(); const result = await api("/api/suite/design/cancel", { compartment: context.compartment, conversationId: context.conversationId }); if (context.current()) $("design-status").textContent = `${result.status}. Your draft is preserved; this does not verify task completion.`; }));

  const voice = mountVoice({ notify, refresh });
  const observation = mountObservation({ notify, refresh });
  const conversations = mountConversations({ notify, refresh });
  mountRoles({ notify, refresh });
  mountClients({ notify, download });
  mountNativeFocus({ notify });
  mountAgentMaintenance({ notify, refresh });
  mountExecution({ notify });
  mountAuthority({ notify });
  mountScanner({ notify });
  mountFeeds({ notify });
  mountTasks({ notify, refresh });
  mountCopilot({ notify, refresh });
  mountPortable({ getProfile, persist: async () => { clearTimeout(saveTimer); await persist(); }, refresh, loadProfile, download, notify });
  document.addEventListener("switchyard-role-result", event => { if (event.detail.proposal) previewProposal(event.detail.proposal); });
  document.addEventListener("switchyard-refresh-request", () => run(refresh));
  const bootstrapWorkspace = () => run(async () => { const bootstrap = await api("/api/suite/bootstrap", {}); compartment = bootstrap.activeCompartment; setActiveCompartment(compartment); fillCompartments(bootstrap.compartments); voice.setAvailability(bootstrap.voice); await refresh(); workflowForm(state.workflow); if (state.profile && !getProfile()) loadProfile(state.profile); document.dispatchEvent(new Event("switchyard-profile-loaded")); });
  document.addEventListener("switchyard-local-connected", bootstrapWorkspace);
  void bootstrapWorkspace();
  return { persist, refresh: () => run(refresh) };
}
