import { api } from "./connection.mjs";

const providerNames = { codex: "Codex", "claude-code": "Claude Code", "claude-desktop": "Claude", "custom-agent": "Custom agent", "microsoft-365-copilot": "Microsoft 365 Copilot", "github-copilot": "GitHub Copilot" };
const targetNames = { "coding-task": "saved task", conversation: "design conversation", "custom-agent": "connected agent", "client-surface": "app homepage" };
const option = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; return o; };

/** Named, digest-bound choices. A choice never doubles as permission to run it. */
export function mountRoles({ notify, refresh, request = api }) {
  const $ = id => document.getElementById(id);
  let state = null, choices = [], generation = 0, busy = false, pending = null;
  const selected = () => $("role-target").value === "" ? null : choices[Number($("role-target").value)];
  const matchingBinding = () => {
    const choice = selected();
    return choice && state?.roleBindings?.find(b => b.roleId === $("role-picker").value && b.intent === $("role-intent").value && b.provider === choice.provider && b.targetKind === choice.targetKind && b.targetId === choice.targetId);
  };
  function controls() {
    $("bind-agent-role").disabled = busy || !selected();
    $("try-agent-role").disabled = busy || !matchingBinding();
    $("confirm-role-connection").disabled = busy || !pending;
    $("role-target-detail").textContent = selected() ? `${providerNames[selected().provider] ?? selected().provider} · ${targetNames[selected().targetKind] ?? "saved connection"}${matchingBinding() ? " · connected to this control" : " · not connected to this control"}` : "";
    $("role-handoff-wrap").hidden = $("role-intent").value !== "handoff";
  }
  function invalidate() {
    generation++; choices = []; pending = null;
    $("role-connection-dialog").close();
    $("role-target").replaceChildren(option("", "Choose a saved connection"));
    controls();
  }
  async function choicesForRole() {
    invalidate();
    if (!state) return;
    if (state.mode === "keyboard-only") { $("role-choice-status").textContent = "Keyboard-only mode is on. Enable the companion in Settings when you want to connect your tools."; return; }
    if (!$("role-picker").value) { $("role-choice-status").textContent = "Choose a starting layout on Home, or save a workflow with a role first."; return; }
    const version = generation, compartment = state.id, roleId = $("role-picker").value, intent = $("role-intent").value;
    $("role-choice-status").textContent = "Finding compatible saved connections…";
    try {
      const result = await request("/api/suite/roles/choices", { roleId, intent }, { selectedWorkspace: true });
      if (version !== generation) return;
      if (result.compartment !== compartment || result.role.id !== roleId || result.intent !== intent || result.complete !== true) throw Error("The workspace changed. Refresh its connections before continuing.");
      choices = result.choices;
      $("role-target").replaceChildren(option("", choices.length ? "Choose a saved connection" : "No compatible saved connections"), ...choices.map((c, i) => option(String(i), `${c.label} · ${providerNames[c.provider] ?? c.provider} · ${targetNames[c.targetKind]}`)));
      const bound = state.roleBindings?.find(b => b.roleId === roleId && b.intent === intent);
      const index = choices.findIndex(c => c.targetId === bound?.targetId && c.targetKind === bound?.targetKind && c.provider === bound?.provider);
      if (index >= 0) $("role-target").value = String(index);
      $("role-choice-status").textContent = choices.length ? `${choices.length} compatible ${choices.length === 1 ? "connection" : "connections"}. Review your choice before saving. Nothing runs when you connect a control.` : "No saved connection supports this control yet. Choose another control, start a design conversation, or connect a supported agent. An app homepage is available only for Open app.";
    } catch (error) { if (version === generation) $("role-choice-status").textContent = error.message; }
    if (version === generation) controls();
  }
  function openReview(dispatch) {
    const choice = selected(); if (!choice || busy || dispatch && !matchingBinding()) return;
    const intent = $("role-intent").value, roleId = $("role-picker").value;
    const { label, ...selection } = choice;
    pending = { generation, compartment: state.id, dispatch, roleId, intent, selection, content: intent === "handoff" ? $("role-handoff").value : "", requestId: crypto.randomUUID() };
    $("role-connection-title").textContent = dispatch ? "Try this connected control" : "Connect this control";
    $("role-connection-summary").textContent = `${$("role-picker").selectedOptions[0].textContent} · ${$("role-intent").selectedOptions[0].textContent} → ${label} (${providerNames[choice.provider] ?? choice.provider}, ${targetNames[choice.targetKind]}).`;
    $("role-connection-effect").textContent = dispatch ? intent === "cancel" ? "This asks the connected tool to cancel its owned active turn." : intent === "handoff" ? "This sends only the context below to the connected target." : "This runs the selected control on its saved target. The tool checks whether the target is still available." : "Saves this connection in the current workspace. No task starts, no message is sent, and no shortcut is installed.";
    $("role-connection-content").textContent = pending.content;
    $("role-connection-content").hidden = !pending.content;
    $("confirm-role-connection").textContent = dispatch ? intent === "handoff" ? "Send this handoff" : intent === "cancel" ? "Request cancellation" : "Try this control" : "Save connection";
    controls(); $("role-connection-dialog").showModal();
  }
  $("role-picker").addEventListener("change", choicesForRole);
  $("role-intent").addEventListener("change", choicesForRole);
  $("role-target").addEventListener("change", () => { pending = null; controls(); });
  document.addEventListener("switchyard-open-role-control", async event => {
    const target = event.detail;
    if (busy || !state || state.mode === "keyboard-only" || !target || Object.keys(target).sort().join() !== "compartment,intent,roleId" || target.compartment !== state.id
      || !state.workflow.roles.some(role => role.id === target.roleId) || !state.roleBindings?.some(binding => binding.roleId === target.roleId && binding.intent === target.intent)
      || ![...$("role-intent").options].some(option => option.value === target.intent)) return;
    $("role-picker").value = target.roleId; $("role-intent").value = target.intent;
    const loading = choicesForRole(), version = generation;
    await loading;
    if (version !== generation || state?.id !== target.compartment) return;
    const destination = matchingBinding() ? $("try-agent-role") : $("role-target");
    destination.scrollIntoView({ block: "center" }); destination.focus();
  });
  $("bind-agent-role").addEventListener("click", () => openReview(false));
  $("try-agent-role").addEventListener("click", () => openReview(true));
  $("cancel-role-connection").addEventListener("click", () => $("role-connection-dialog").close());
  $("role-connection-dialog").addEventListener("close", () => { pending = null; controls(); });
  $("confirm-role-connection").addEventListener("click", async () => {
    const review = pending; if (busy || !review || review.generation !== generation) return;
    pending = null; busy = true; controls();
    try {
      const result = review.dispatch
        ? await request("/api/suite/roles/dispatch-choice", { compartment: review.compartment, roleId: review.roleId, intent: review.intent, ...review.selection, ...(review.intent === "handoff" ? { content: review.content } : {}), requestId: review.requestId })
        : await request("/api/suite/roles/bind-choice", { roleId: review.roleId, intent: review.intent, ...review.selection }, { selectedWorkspace: true });
      if (review.generation !== generation) return;
      $("role-result").textContent = review.dispatch ? `${result.reply ?? result.status ?? "Control completed"}${result.provenance ? `. ${result.provenance}` : ""}` : "Connection saved. You can now review and try this control.";
      notify($("role-result").textContent);
      document.dispatchEvent(new CustomEvent("switchyard-role-result", { detail: result }));
      await refresh();
    } catch (error) { if (review.generation === generation) { $("role-result").textContent = error.message; notify(error.message); await choicesForRole(); } }
    finally { busy = false; $("role-connection-dialog").close(); controls(); }
  });
  $("compartment-picker").addEventListener("change", () => { state = null; invalidate(); });
  document.addEventListener("switchyard-workspace-changing", () => { state = null; invalidate(); });
  document.addEventListener("switchyard-compartment-state", event => {
    state = event.detail;
    const previous = $("role-picker").value;
    $("role-picker").replaceChildren(...state.workflow.roles.map(r => option(r.id, r.label)));
    if (state.workflow.roles.some(r => r.id === previous)) $("role-picker").value = previous;
    const count = state.roleBindings?.length ?? 0;
    $("role-summary").textContent = count ? `${count} saved ${count === 1 ? "control connection" : "control connections"} in this workspace. Choose a role and control to inspect or replace one.` : "Your roles stay the same when you change tools. Connect each control to the tool that should handle it.";
    void choicesForRole();
  });
  controls();
}

/** Retire custom-agent authorization without inventing external task completion. */
export function mountAgentMaintenance({ notify, refresh, request = api }) {
  const $ = id => document.getElementById(id), date = at => Number.isFinite(at) ? new Date(at).toISOString() : "not observed";
  let state = null, generation = 0, busy = false, review = null;
  const agent = () => state?.agents.find(row => row.id === $("managed-agent-picker").value);
  const command = () => agent()?.commands.find(row => row.id === $("managed-agent-command").value);
  const permitted = () => state?.policy === "personal" && state?.mode === "personal-companion";
  const example = () => ({ "custom-example": "custom", "langchain-example": "langchain" })[agent()?.id];
  function invalidate() { generation++; review = null; $("agent-maintenance-dialog").close(); $("agent-maintenance-summary").textContent = ""; controls(); }
  function controls() {
    $("managed-agent-picker").disabled = busy || !state?.agents.length;
    $("managed-agent-command").disabled = busy || !agent()?.commands.length;
    $("refresh-managed-agents").disabled = busy || !state;
    $("review-agent-revoke").disabled = busy || !permitted() || !agent() || agent().enrollmentStatus === "revoked";
    $("review-agent-outcome").disabled = busy || !permitted() || command()?.status !== "uncertain-session-ended";
    $("review-example-stop").hidden = !example();
    $("review-example-stop").disabled = busy || state?.policy !== "personal" || !example();
    $("confirm-agent-maintenance").disabled = busy || !review;
  }
  function renderCommand() {
    const row = command(); $("managed-agent-command-detail").textContent = row ? `${row.intent} · ${row.status}\nCommand: ${row.id}\nOriginal session: ${row.sessionId}\nQueued: ${date(row.createdAt)}\nClaimed: ${date(row.claimedAt)}\n${row.provenance ?? "Saved local command state; external outcome unverified."}${row.content ? "\n\nRetained handoff:\n" + row.content : ""}\n\nAn adapter acknowledgement is a self-report; Switchyard has not independently verified the external task outcome.` : "No saved command selected."; controls();
  }
  function renderAgent() {
    const row = agent(), previous = $("managed-agent-command").value;
    $("managed-agent-detail").textContent = !row ? "No custom-agent connection is saved in this workspace." : `${row.name} · ${row.enrollmentStatus ?? "active"}\nAgent: ${row.id}\nSession: ${row.sessionId ?? "not observed"}\nSupported controls: ${row.capabilities.join(", ")}\nLast report: ${row.reportedStatus ?? "unknown"} at ${date(row.lastSeen)}\n${row.provenance ?? "Saved enrollment; a live session has not been verified."}\n${permitted() ? "Reports and permissions are checked again before dispatch." : "Agent changes require a Personal workspace in companion mode. Owned example retirement remains available in keyboard-only mode."}`;
    $("managed-agent-command").replaceChildren(...[...(row?.commands ?? [])].reverse().map(c => option(c.id, `${c.intent} · ${c.status} · ${c.id}`)));
    if (row?.commands.some(c => c.id === previous)) $("managed-agent-command").value = previous;
    renderCommand();
  }
  async function run(fn) {
    if (busy) return; busy = true; controls(); const version = generation, compartment = state?.id;
    const valid = () => generation === version && state?.id === compartment;
    try { await fn({ compartment, valid }); }
    catch (error) { if (valid()) { $("managed-agent-status").textContent = error.message; notify(error.message); } }
    finally { busy = false; controls(); }
  }
  function show(kind, input, summary) {
    review = { kind, ...input }; $("agent-maintenance-summary").textContent = summary;
    $("confirm-agent-maintenance").textContent = kind === "revoke" ? "Revoke this agent's access" : kind === "outcome" ? "Record this uncertainty review" : "Stop the owned example";
    $("agent-maintenance-dialog").showModal(); controls();
  }
  $("managed-agent-picker").addEventListener("change", () => { invalidate(); renderAgent(); });
  $("managed-agent-command").addEventListener("change", () => { invalidate(); renderCommand(); });
  $("refresh-managed-agents").addEventListener("click", () => run(async () => { review = null; $("agent-maintenance-dialog").close(); await refresh(); }));
  $("review-agent-revoke").addEventListener("click", () => run(async ({ compartment, valid }) => {
    const row = agent(); if (!permitted() || !row || row.enrollmentStatus === "revoked") return;
    const value = await request("/api/suite/agents/revoke/review", { compartment, agentId: row.id }); if (!valid()) return;
    show("revoke", { agentId: row.id, token: value.confirmation.token }, `Revoke ${row.name} in workspace ${compartment}\n\nAgent: ${value.agentId}\nSession: ${value.sessionId ?? "not observed"}\nSaved role bindings removed: ${value.roleBindings}\nQueued commands cancelled locally: ${value.queued}\nClaimed commands retained as uncertain: ${value.claimed}\nExpires: ${value.confirmation.record.expiresAt}\n\n${value.confirmation.record.reason}\n\nA bundled example is stopped only if this host still owns its exact process. External process exit and task completion remain unverified. Reconnecting later requires a deliberate new enrollment and new role bindings.`);
  }));
  $("review-agent-outcome").addEventListener("click", () => run(async ({ compartment, valid }) => {
    const row = agent(), claim = command(); if (!permitted() || !row || claim?.status !== "uncertain-session-ended") return;
    const value = await request("/api/suite/agents/outcome/review", { compartment, agentId: row.id, commandId: claim.id }); if (!valid()) return;
    show("outcome", { agentId: row.id, commandId: claim.id, token: value.confirmation.token }, `Review an uncertain ${value.command.intent} command for ${row.name}\n\nWorkspace: ${compartment}\nCommand: ${value.command.id}\nOriginal session: ${value.command.sessionId}\nClaimed: ${date(value.command.claimedAt)}\nExpires: ${value.confirmation.record.expiresAt}\n\n${value.confirmation.record.reason}${value.command.content ? "\n\nRetained handoff:\n" + value.command.content : ""}`);
  }));
  $("review-example-stop").addEventListener("click", () => {
    if (busy || state?.policy !== "personal" || !example()) return;
    show("stop", { example: example() }, `Stop the bundled ${example()} example in workspace ${state.id}\n\nOnly the exact child still owned by this Switchyard host can be stopped. A missing owner is reported as not observed; no PID search or unrelated process termination occurs.\n\nThis does not revoke its enrollment or prove any external task completed. Unconfirmed retirement prevents another example from starting.`);
  });
  $("cancel-agent-maintenance").addEventListener("click", () => { review = null; $("agent-maintenance-dialog").close(); controls(); });
  $("agent-maintenance-dialog").addEventListener("close", () => { if (!$("agent-maintenance-dialog").open) { review = null; controls(); } });
  $("confirm-agent-maintenance").addEventListener("click", () => run(async ({ compartment, valid }) => {
    if (!review) return; const { kind, ...input } = review; review = null; $("agent-maintenance-dialog").close();
    try {
      const value = await request(kind === "revoke" ? "/api/suite/agents/revoke" : kind === "outcome" ? "/api/suite/agents/outcome/resolve" : "/api/suite/agents/example/stop", { compartment, ...input }); if (!valid()) return;
      if (kind === "revoke") { if (value.status !== "revoked" || value.agentId !== input.agentId || value.externalProcessStopped !== false) throw Error("The exact agent revocation acknowledgement did not verify."); $("managed-agent-status").textContent = `Agent access revoked; saved history is preserved. External work remains unverified.${value.ownedExample ? " Owned example: " + value.ownedExample.status + ". " + value.ownedExample.evidence : ""}`; }
      else if (kind === "outcome") { if (value.status !== "reviewed-unconfirmed" || value.commandId !== input.commandId || value.externalOutcomeVerified !== false || value.providerCommandSent !== false) throw Error("The exact uncertainty acknowledgement did not verify."); $("managed-agent-status").textContent = "Uncertainty review recorded. No command was sent or retried, and external completion remains unverified. The reviewed record is eligible for normal bounded history retention."; }
      else { if (!["stopped", "not-observed", "stop-unconfirmed"].includes(value.status) || value.taskCompletionVerified !== false) throw Error("The owned example retirement acknowledgement did not verify."); $("managed-agent-status").textContent = `Owned example: ${value.status}. ${value.evidence} Task completion remains unverified.`; }
    } catch (error) { if (valid()) { const message = `${error.message} Saved state will be refreshed; no operation or consumed confirmation is replayed.`; $("managed-agent-status").textContent = message; notify(message); } }
    finally { if (valid()) await refresh(); }
  }));
  document.addEventListener("switchyard-workspace-changing", () => { state = null; invalidate(); $("managed-agent-picker").replaceChildren(); $("managed-agent-status").textContent = "Choose a workspace."; renderAgent(); });
  document.addEventListener("switchyard-compartment-state", event => {
    const previous = $("managed-agent-picker").value, changed = state?.id !== event.detail.id; state = event.detail; invalidate();
    $("managed-agent-picker").replaceChildren(...state.agents.map(a => option(a.id, a.name + (a.enrollmentStatus === "revoked" ? " · access revoked" : ""))));
    if (state.agents.some(a => a.id === previous)) $("managed-agent-picker").value = previous;
    if (changed) $("managed-agent-status").textContent = "Saved connections loaded. No agent was contacted or commanded.";
    renderAgent();
  });
  renderAgent();
}
