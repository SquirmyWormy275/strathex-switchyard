import { api } from "./connection.mjs";

const providers = { codex: "Codex", "claude-code": "Claude Code" };
const unresolved = new Set(["reserved", "submitting", "submitted", "outcome-unconfirmed", "cancellation-requested", "interrupted"]);
const option = (value, text) => { const e = document.createElement("option"); e.value = value; e.textContent = text; return e; };
const fields = ["task-provider", "task-label", "task-root", "task-session", "task-connection-kind", "coding-task", "task-text", "task-text-operation", "task-turn"];
export function mountTasks({ notify, refresh }) {
  const $ = id => document.getElementById(id);
  let state = null, generation = 0, busy = false, reviewed = null, activeTurn = null, cancelling = false, preferredTask = null, preferredTurn = null;
  const provider = () => $("task-provider").value;
  const prefix = (p = provider()) => `/api/suite/coding/${p === "codex" ? "codex" : "claude"}`;
  const personal = () => state?.policy === "personal";
  const permitted = () => personal() && state.mode === "personal-companion";
  const tasks = () => (state?.codingSessions ?? []).filter(t => t.provider === provider());
  const task = () => tasks().find(t => t.id === $("coding-task").value);
  const turns = () => (state?.codingTurns ?? []).filter(t => (t.provider ?? "codex") === provider() && t.taskId === task()?.id);
  const turn = () => turns().find(t => t.id === $("task-turn").value);
  const eligible = () => task()?.schema === "switchyard-coding-session/v1" && task()?.repositoryIdentity && (provider() === "codex" ? task()?.nativeTransport === "owned-stdio" : task()?.nativeTransport === "owned-print") && ["registered", "creation-uncertain"].includes(task()?.status);
  const currentCancellation = () => activeTurn?.compartment === state?.id && activeTurn.provider === provider() ? activeTurn.requestId : unresolved.has(turn()?.status) ? turn().id : null;
  function controls() {
    for (const id of fields) $(id).disabled = busy || !personal();
    $("task-session-wrap").hidden = $("task-connection-kind").value !== "bind";
    $("review-task-connection").disabled = busy || !permitted() || !$("task-label").value.trim() || !$("task-root").value.trim() || $("task-connection-kind").value === "bind" && !$("task-session").value.trim();
    $("refresh-coding-tasks").disabled = busy || !personal();
    $("check-coding-task").disabled = busy || !permitted() || !task()?.sessionId;
    $("review-task-text").disabled = busy || !permitted() || !eligible() || !$("task-text").value.trim() || turns().some(t => unresolved.has(t.status));
    $("review-task-outcome").disabled = busy || !personal() || !unresolved.has(turn()?.status);
    $("review-task-turn-delete").disabled = busy || !personal() || !turn() || unresolved.has(turn()?.status);
    $("cancel-task-turn").disabled = cancelling || !personal() || !currentCancellation();
    $("confirm-task-operation").disabled = busy || !reviewed;
    $("task-text-operation").disabled ||= provider() !== "claude-code";
  }
  function invalidate() { generation++; reviewed = null; $("task-operation-dialog").close(); $("task-operation-summary").textContent = ""; controls(); }
  function renderTurn() {
    const t = turn(); $("task-turn-detail").textContent = t ? `Request: ${t.id}\nStatus: ${t.status}\nNative turn: ${t.turnId ?? "not supplied"}\nNative session verified: ${t.nativeSessionVerified === true ? "yes" : "not verified"}\nOwned runtime exit: ${t.ownedRuntime ? t.ownedRuntimeStoppedVerified === true ? "verified" : "unconfirmed" : "no retained guardian record"}\nTask completion: not verified` : "No text turn selected.";
    $("task-turn-content").textContent = t ? `Reviewed text:\n${t.prompt}\n\nReply:\n${t.reply ?? "No confirmed reply retained."}` : ""; controls();
  }
  function render() {
    const selected = preferredTask ?? $("coding-task").value, selectedTurn = preferredTurn ?? $("task-turn").value; preferredTask = null; preferredTurn = null;
    $("coding-task").replaceChildren(...tasks().map(t => option(t.id, `${t.label} · ${t.status} · ${t.id.slice(0, 8)}`)));
    if (tasks().some(t => t.id === selected)) $("coding-task").value = selected;
    const t = task(); $("coding-task-detail").textContent = t ? `Project: ${t.repositoryRoot}\nNative session: ${t.sessionId ?? "not yet acknowledged"}\nAccount fingerprint: ${t.accountFingerprint}\nStatus: ${t.status}\n${t.nativeIdentityVerified === false ? "Requested Claude identity only; its first reviewed native reply must establish the conversation." : "This saved identity does not prove current activity or task completion."}\nInteractive terminal attachment is separate.` : "Create a dedicated text task, or connect an exact existing native session. Selecting saved metadata starts nothing.";
    $("task-turn").replaceChildren(...turns().toReversed().map(t => option(t.id, `${t.status} · ${t.prompt?.replace(/\s+/g, " ").slice(0, 60) ?? "Saved turn"} · ${t.id.slice(0, 8)}`)));
    if (turns().some(t => t.id === selectedTurn)) $("task-turn").value = selectedTurn;
    renderTurn();
  }
  function context() { const version = generation, compartment = state?.id, destination = provider(); return { compartment, provider: destination, base: prefix(destination), current: () => version === generation && state?.id === compartment && provider() === destination }; }
  async function work(fn) {
    if (busy || !personal()) return; busy = true; controls(); const ctx = context();
    try { await fn(ctx); } catch (error) { if (ctx.current()) { $("task-status").textContent = error.message; notify(error.message); } }
    finally { busy = false; controls(); }
  }
  function show(kind, body, title, summary, label, token) {
    reviewed = { kind, body: structuredClone(body), token }; $("task-operation-title").textContent = title; $("task-operation-summary").textContent = summary; $("confirm-task-operation").textContent = label; $("task-operation-dialog").showModal(); controls();
  }
  for (const id of fields) for (const event of ["change", "input"]) $(id).addEventListener(event, () => {
    invalidate(); if (id === "task-provider") { $("coding-task").value = ""; $("task-text").value = ""; $("task-session").value = ""; $("task-text-operation").value = "continue"; }
    if (id === "coding-task" || id === "task-provider") render(); else if (id === "task-turn") renderTurn();
  });
  $("refresh-coding-tasks").addEventListener("click", () => work(async () => { await refresh(); }));
  $("review-task-connection").addEventListener("click", () => {
    if ($("review-task-connection").disabled) return;
    const bind = $("task-connection-kind").value === "bind", body = { repositoryRoot: $("task-root").value, label: $("task-label").value, ...(bind ? { sessionId: $("task-session").value } : { requestId: crypto.randomUUID() }) };
    show(bind ? "bind" : "create", body, bind ? "Connect this exact native session" : "Create a dedicated text task", `${providers[provider()]}\nProject: ${body.repositoryRoot}\nLabel: ${body.label}\n${bind ? "Native session: " + body.sessionId : "Request: " + body.requestId}\n\n${bind ? "Check this exact native session, repository and current login, then save its local connection. An external session retains its original runtime and may not accept text here." : provider() === "codex" ? "Check the installed account and exact directory, create one empty native thread and verify the creator exited. No model prompt is sent." : "Check the installed account and exact directory, then reserve a requested conversation UUID locally. No native conversation, worker or model prompt is created until its first separately reviewed turn."}\n\nThis does not attach an interactive terminal or grant file/tool execution.`, bind ? "Connect this session" : "Create this text task");
  });
  $("check-coding-task").addEventListener("click", () => work(async ctx => {
    if (!permitted() || !task()) return; const result = await api(ctx.base + "/status", { compartment: ctx.compartment, id: task().id }); if (!ctx.current()) return;
    $("task-status").textContent = `${result.observation?.status ?? result.status} · ${result.observation?.provenance ?? "Exact task metadata"}. Task completion is not verified.`;
  }));
  $("review-task-text").addEventListener("click", () => work(async ctx => {
    if (!permitted() || !eligible()) return;
    const recovery = $("task-text-operation").value === "recovery"; if (recovery && ctx.provider !== "claude-code") throw Error("Exact first-creation recovery is a Claude text operation.");
    const body = { taskId: task().id, text: $("task-text").value };
    if (new TextEncoder().encode(body.text).length > 12000) throw Error("Review at most 12000 UTF-8 bytes. Your draft is preserved.");
    const result = await api(ctx.base + (recovery ? "/turns/recovery/review" : "/turns/review"), { compartment: ctx.compartment, ...body }); if (!ctx.current()) return;
    show(recovery ? "recovery" : "text", { ...body, requestId: crypto.randomUUID() }, "Review exact task text", `${result.confirmation.record.reason}\n\n${JSON.stringify(result.scope, null, 2)}\n\nExpires: ${result.confirmation.record.expiresAt}\nNo message has been sent.`, recovery ? "Send this exact recovery text" : "Send this reviewed text", result.confirmation.token);
  }));
  $("review-task-outcome").addEventListener("click", () => work(async ctx => {
    if (!turn() || !unresolved.has(turn().status)) return; const id = turn().id;
    const result = await api(ctx.base + "/turns/outcome/review", { compartment: ctx.compartment, id }); if (!ctx.current()) return;
    show("outcome", { id }, "Review an uncertain task outcome", `${result.confirmation.record.reason}\n\n${JSON.stringify(result.turn, null, 2)}`, "Record that I reviewed this uncertainty", result.confirmation.token);
  }));
  $("review-task-turn-delete").addEventListener("click", () => {
    if ($("review-task-turn-delete").disabled) return;
    show("delete", { id: turn().id }, "Delete this local text record", `Request: ${turn().id}\nStatus: ${turn().status}\nReviewed text:\n${turn().prompt}\n\nRemove this retained local record. Native provider history and the saved task are unchanged. Pending uncertainty or an unverified owned exit cannot be deleted.`, "Delete this local record");
  });
  $("cancel-task-operation").addEventListener("click", invalidate);
  $("task-operation-dialog").addEventListener("close", () => { reviewed = null; controls(); });
  $("confirm-task-operation").addEventListener("click", () => work(async ctx => {
    if (!reviewed || !permitted() && !["outcome", "delete"].includes(reviewed.kind)) return;
    const review = reviewed; reviewed = null; $("task-operation-dialog").close();
    const route = { bind: "/bind", create: ctx.provider === "codex" ? "/create" : "/text/create", text: "/turns/submit", recovery: "/turns/recovery/submit", outcome: "/turns/outcome/resolve", delete: "/turns/delete" }[review.kind];
    if (["text", "recovery"].includes(review.kind)) { activeTurn = { compartment: ctx.compartment, provider: ctx.provider, requestId: review.body.requestId }; controls(); }
    $("task-status").textContent = `Requested ${review.kind}. Exact request: ${review.body.requestId ?? review.body.id ?? review.body.sessionId}. No automatic retry will be made.`;
    try {
      const result = await api(ctx.base + route, { compartment: ctx.compartment, ...review.body, ...(review.token ? { token: review.token } : {}) }); if (!ctx.current()) return;
      if (["create", "bind"].includes(review.kind)) preferredTask = result.id;
      else preferredTurn = result.id ?? "";
      if (["text", "recovery"].includes(review.kind)) $("task-text").value = "";
      $("task-status").textContent = `${result.status ?? (result.deleted ? "Local record deleted" : "Result recorded")}. ${result.nativeConversationCreated === false ? "Only a local requested identity was reserved. " : ""}Task completion and interactive attachment are not verified.`;
    } catch (error) { if (ctx.current()) { if (review.kind === "create") preferredTask = review.body.requestId; else if (["text", "recovery"].includes(review.kind)) preferredTurn = review.body.requestId; $("task-status").textContent = `Result unconfirmed: ${error.message}. Request: ${review.body.requestId ?? review.body.id ?? review.body.sessionId}. Inspect retained tasks and turns before another operation. Your draft is preserved; no automatic retry was made.`; notify("Inspect saved task history; no automatic retry was made."); } }
    finally { if (activeTurn?.requestId === review.body.requestId) activeTurn = null; if (ctx.current()) await refresh(); }
  }));
  $("cancel-task-turn").addEventListener("click", async () => {
    if ($("cancel-task-turn").disabled) return; const ctx = context(), requestId = currentCancellation(); cancelling = true; controls();
    try { const result = await api(ctx.base + "/turns/cancel", { compartment: ctx.compartment, requestId }); if (ctx.current()) $("task-status").textContent = `${result.status}. Earlier effects are not reversed and task completion remains unverified.`; }
    catch (error) { if (ctx.current()) { $("task-status").textContent = error.message; notify(error.message); } }
    finally { cancelling = false; controls(); }
  });
  function clear() { preferredTask = null; preferredTurn = null; for (const id of ["task-label", "task-root", "task-session", "task-text", "coding-task", "task-turn"]) $(id).value = ""; render(); }
  document.addEventListener("switchyard-workspace-changing", () => { state = null; invalidate(); clear(); $("task-status").textContent = "Select a Personal workspace to inspect coding tasks."; });
  document.addEventListener("switchyard-compartment-state", event => { const changed = state?.id !== event.detail.id; state = event.detail; invalidate(); if (changed) clear(); else render(); });
  $("task-provider").replaceChildren(...Object.entries(providers).map(([id, label]) => option(id, label))); $("task-connection-kind").value = "create"; $("task-text-operation").value = "continue"; clear();
}
