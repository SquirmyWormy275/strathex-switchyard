import { api } from "./connection.mjs";
const sourceNames = { deliberate: "Your event marks", "foreground-category": "App categories", "agent-events": "Agent status events", "host-action-events": "Switchyard shortcut events", "editor-events": "Switchyard editor events", "claude-hook-events": "Selected Claude Code hooks" };
const categoryNames = { terminal: "Terminal", vscode: "Code editor", chatgpt: "ChatGPT", claude: "Claude", codex: "Codex", browser: "Browser", other: "Other apps" };
const providerName = value => value === "codex" ? "Codex" : value === "claude-code" ? "Claude Code" : "the selected assistant";
const option = (value, text) => { const o = document.createElement("option"); o.value = value; o.textContent = text; return o; };

export function mountObservation({ refresh, notify, request = api }) {
  const $ = id => document.getElementById(id);
  let state = null, busy = false, generation = 0, choices = [], reviewed = null, pending = null, deleting = null;
  const selectedIds = () => choices.filter(row => row.input.checked).map(row => row.id);
  const session = () => state?.observations.find(row => row.id === $("observation-session").value);
  const provider = () => $("conversation-provider").value;
  const canDesign = () => state?.policy === "personal" && state?.mode === "personal-companion" && ["codex", "claude-code"].includes(provider());
  const scope = () => JSON.stringify([state?.id, state?.policy, state?.mode, state?.modeSelectedAt, state?.accounts, provider(), selectedIds().map(id => state?.observations.find(o => o.id === id))]);
  function forget(message = "No activity will be sent with your next message.") {
    reviewed = null; pending = null; $("observation-review-dialog").close(); $("design-observation-status").textContent = message;
  }
  function controls() {
    const active = session(), recordingAllowed = Boolean(state?.policyRules.recording) && state?.mode !== "keyboard-only";
    $("start-observation").disabled = busy || !recordingAllowed || state?.observations.some(o => ["recording", "paused"].includes(o.status));
    $("mark-observation").disabled = busy || active?.status !== "recording" || !active?.sources.includes("deliberate");
    $("pause-observation").disabled = busy || !active || !["recording", "paused"].includes(active.status) || active.status === "paused" && !recordingAllowed;
    $("pause-observation").textContent = active?.status === "paused" ? "Resume" : "Pause";
    $("stop-observation").disabled = busy || !active || !["recording", "paused"].includes(active.status);
    $("delete-observation").disabled = busy || !active || active.status === "recording";
    $("observation-session").disabled = busy || !state?.observations.length;
    $("review-design-observations").disabled = busy || !canDesign() || !selectedIds().length || selectedIds().length > 8;
    $("confirm-design-observations").disabled = busy || !pending;
    $("confirm-delete-observation").disabled = busy || !deleting;
    $("prepare-claude-hook").disabled = busy || !recordingAllowed || !active?.sources.includes("claude-hook-events") || active.exclusions.includes("claude") || !["recording", "paused"].includes(active.status);
    for (const row of choices) row.input.disabled = busy || !canDesign() || !["paused", "stopped", "interrupted"].includes(row.status);
    $("observation-consent-detail").textContent = recordingAllowed ? `Only checked sources are recorded in ${state.id}. Data stays encrypted here for up to ${state.policyRules.retentionDays} days or until you delete it. Starting does not send it to an assistant.` : "Observation is unavailable in this mode or workspace policy. Your saved sessions remain reviewable.";
  }
  const paragraph = text => { const p = document.createElement("p"); p.textContent = text; return p; };
  function sessionDetails() {
    const active = session();
    $("observation-status").textContent = active ? `${active.status} · ${active.events.length} events · ${active.sources.map(source => sourceNames[source]).join(", ")}` : "Nothing is being recorded.";
    const counts = new Map();
    for (const event of active?.events ?? []) { const label = `${event.kind} · ${event.provenance}`; counts.set(label, (counts.get(label) ?? 0) + 1); }
    $("observation-summary").replaceChildren(...[
      ...[...counts].map(([label, count]) => paragraph(`${count} × ${label}`)),
      ...Object.entries(active?.focusCategories ?? {}).map(([category, milliseconds]) => paragraph(`${categoryNames[category]}: ${(milliseconds / 60000).toFixed(1)} sampled minutes`)),
      ...Object.entries(active?.sourceStates ?? {}).map(([source, value]) => paragraph(`${sourceNames[source]}: ${value.status}. ${value.reason ?? ""}`))
    ]);
    controls();
  }
  function render() {
    const previous = $("observation-session").value, checked = new Set(selectedIds());
    const list = state?.observations ?? [], label = (o, i) => `Session ${i + 1} · ${new Date(o.createdAt).toLocaleString()} · ${o.status}`;
    $("observation-session").replaceChildren(...list.map((o, i) => option(o.id, label(o, i))));
    $("observation-session").value = list.find(o => o.id === previous)?.id ?? list.find(o => ["recording", "paused"].includes(o.status))?.id ?? list.at(-1)?.id ?? "";
    choices = list.map((o, i) => {
      const row = document.createElement("label"), input = document.createElement("input"); row.className = "checkbox"; input.type = "checkbox"; input.checked = checked.has(o.id) && ["paused", "stopped", "interrupted"].includes(o.status); row.append(input, document.createTextNode(label(o, i)));
      input.addEventListener("change", () => { generation++; forget("Selection changed. Review the summary before including it with your message."); controls(); });
      return { id: o.id, status: o.status, input, element: row };
    });
    $("design-observation-sessions").replaceChildren(...choices.map(row => row.element));
    $("observation-empty").hidden = list.length > 0;
    if (reviewed && reviewed.scope !== scope()) forget("The selected activity or destination changed. Review it again before sending.");
    sessionDetails();
  }
  async function run(fn) {
    if (busy) return; busy = true; controls();
    try { await fn(); } catch (error) { $("observation-status").textContent = error.message; notify(error.message); }
    finally { busy = false; controls(); }
  }
  const mutate = (route, body) => run(async () => { const id = state?.id; if (!id) throw Error("Connect a local workspace first."); await request("/api/suite/observation/" + route, { compartment: id, ...body }); if (state?.id === id) await refresh(); });
  $("start-observation").addEventListener("click", () => mutate("start", { sources: Object.keys(sourceNames).filter(source => $("observe-" + source).checked), exclusions: Object.keys(categoryNames).filter(category => $("exclude-" + category).checked), consent: true }));
  const clearHook = () => { $("claude-hook-settings").textContent = ""; $("claude-hook-detail").textContent = "Nothing has been installed or connected."; };
  $("observation-session").addEventListener("change", () => { generation++; clearHook(); sessionDetails(); });
  $("claude-hook-session").addEventListener("input", () => { generation++; clearHook(); });
  $("prepare-claude-hook").addEventListener("click", () => run(async () => {
    const version = generation, compartment = state.id, observationId = session().id, expectedSessionId = $("claude-hook-session").value.trim();
    clearHook();
    const result = await request("/api/suite/observation/claude-hook/recipe", { compartment, observationId, expectedSessionId });
    if (generation !== version || state?.id !== compartment || session()?.id !== observationId || $("claude-hook-session").value.trim() !== expectedSessionId) return;
    $("claude-hook-settings").textContent = JSON.stringify(result.settings, null, 2);
    $("claude-hook-detail").textContent = result.boundary;
  }));
  $("mark-observation").addEventListener("click", () => mutate("mark", { id: session()?.id, kind: $("observation-kind").value }));
  $("pause-observation").addEventListener("click", () => mutate("state", { id: session()?.id, status: session()?.status === "paused" ? "recording" : "paused" }));
  $("stop-observation").addEventListener("click", () => mutate("state", { id: session()?.id, status: "stopped" }));
  $("refresh-observations").addEventListener("click", () => run(refresh));
  $("delete-observation").addEventListener("click", () => {
    if (!session() || session().status === "recording") return;
    deleting = { id: session().id, compartment: state.id };
    $("delete-observation-detail").textContent = `Delete this ${session().status} session and its ${session().events.length} events from ${state.id}? This cannot recall any summary already sent to an assistant.`;
    controls(); $("delete-observation-dialog").showModal();
  });
  $("confirm-delete-observation").addEventListener("click", () => run(async () => {
    const target = deleting; deleting = null;
    if (!target || target.compartment !== state?.id) throw Error("Choose the session again in the current workspace.");
    await request("/api/suite/observation/delete", target);
    $("delete-observation-dialog").close(); if (state?.id === target.compartment) await refresh();
  }));
  $("cancel-delete-observation").addEventListener("click", () => $("delete-observation-dialog").close());
  $("delete-observation-dialog").addEventListener("close", () => { deleting = null; controls(); });
  $("review-design-observations").addEventListener("click", () => run(async () => {
    const version = generation, identity = scope(), destination = provider();
    const result = await request("/api/suite/design/observations/review", { compartment: state.id, provider: destination, sessionIds: selectedIds() });
    if (version !== generation || identity !== scope()) return;
    pending = { scope: identity, provider: destination, reviewId: result.reviewId, sessionIds: result.sessionIds };
    $("observation-review-title").textContent = `Include activity with your next ${providerName(destination)} message?`;
    $("observation-review-content").textContent = result.context.sessions.map(row => [
      `Session ${row.number}`,
      ...row.eventCounts.map(event => `${event.count} × ${event.kind} · ${event.provenance.replaceAll("-", " ")}`),
      ...Object.entries(row.sampledCategoryMilliseconds).map(([category, ms]) => `${categoryNames[category]}: ${ms} sampled milliseconds`),
      ...(!row.eventCounts.length && !Object.keys(row.sampledCategoryMilliseconds).length ? ["No recorded events or sampled time."] : [])
    ].join("\n")).join("\n\n") + "\n\n" + result.context.boundary;
    $("observation-review-detail").textContent = result.confirmation;
    $("observation-review-dialog").showModal();
  }));
  $("confirm-design-observations").addEventListener("click", () => {
    if (!pending || pending.scope !== scope()) { forget("Activity changed. Review it again."); controls(); return; }
    reviewed = pending; pending = null; $("observation-review-dialog").close();
    $("design-observation-status").textContent = `${reviewed.sessionIds.length} reviewed sessions will accompany your next ${providerName(reviewed.provider)} message. Nothing has been sent yet.`;
    controls();
  });
  $("cancel-design-observations").addEventListener("click", () => $("observation-review-dialog").close());
  $("observation-review-dialog").addEventListener("close", () => { pending = null; controls(); });
  $("clear-design-observations").addEventListener("click", () => { choices.forEach(row => { row.input.checked = false; }); generation++; forget(); controls(); });
  $("conversation-provider").addEventListener("change", () => { generation++; forget("Assistant changed. Review selected activity for the new destination, or clear the selection."); controls(); });
  document.addEventListener("switchyard-workspace-changing", () => { generation++; state = null; choices = []; deleting = null; clearHook(); $("claude-hook-session").value = ""; forget(); $("delete-observation-dialog").close(); render(); });
  document.addEventListener("switchyard-compartment-state", event => { generation++; clearHook(); if (state?.id !== event.detail.id) { choices = []; $("claude-hook-session").value = ""; forget(); } state = event.detail; pending = null; $("observation-review-dialog").close(); render(); });
  controls();
  return { takeReview(destination) {
    if (!selectedIds().length) return undefined;
    if (!reviewed || reviewed.provider !== destination || reviewed.scope !== scope()) throw Error("Review the selected activity for this assistant, or clear the selection before sending.");
    const result = { sessionIds: [...reviewed.sessionIds], reviewId: reviewed.reviewId, confirmed: true };
    choices.forEach(row => { row.input.checked = false; }); forget("The reviewed summary is reserved for this request. Review again before another message."); controls();
    return result;
  } };
}
