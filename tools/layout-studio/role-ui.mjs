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
  $("bind-agent-role").addEventListener("click", () => openReview(false));
  $("try-agent-role").addEventListener("click", () => openReview(true));
  $("cancel-role-connection").addEventListener("click", () => $("role-connection-dialog").close());
  $("role-connection-dialog").addEventListener("close", () => { pending = null; controls(); });
  $("confirm-role-connection").addEventListener("click", async () => {
    const review = pending; if (busy || !review || review.generation !== generation) return;
    pending = null; busy = true; controls();
    try {
      const result = review.dispatch
        ? await request("/api/suite/roles/dispatch", { compartment: review.compartment, roleId: review.roleId, intent: review.intent, content: review.content, requestId: review.requestId })
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
