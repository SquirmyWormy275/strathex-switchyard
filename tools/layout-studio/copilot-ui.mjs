import { api } from "./connection.mjs";

const terminal = new Set(["completed", "not-started", "reviewed-unconfirmed"]);
const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const option = (value, text) => { const e = document.createElement("option"); e.value = value; e.textContent = text; return e; };

/** Work account actions are explicit; there is no background sign-in polling. */
export function mountCopilot({ notify, refresh }) {
  const $ = id => document.getElementById(id);
  let state = null, generation = 0, busy = false, cancelling = false, login = null, rows = [], reviewed = null;
  const work = () => state?.policy === "work";
  const permitted = () => work() && state.mode === "managed-companion" && state.policyRules.providers.includes("microsoft-365-copilot");
  const row = () => rows.find(r => r.id === $("copilot-request").value);
  const identity = s => s ? JSON.stringify([s.id, s.policy, s.mode, s.accounts]) : "";
  function controls() {
    for (const id of ["copilot-tenant", "copilot-client", "copilot-approved"]) $(id).disabled = busy || !!login || !permitted();
    $("connect-copilot").disabled = busy || !!login || !permitted() || !$("copilot-approved").checked || !guid.test($("copilot-tenant").value.trim()) || !guid.test($("copilot-client").value.trim());
    $("check-copilot-login").disabled = busy || cancelling || !permitted() || !login;
    $("cancel-copilot-login").disabled = cancelling || !login || !work();
    $("refresh-copilot-requests").disabled = busy || !work();
    $("copilot-request").disabled = busy || !work();
    $("review-copilot-outcome").disabled = busy || !work() || !row() || terminal.has(row().status);
    $("confirm-copilot-outcome").disabled = busy || !reviewed;
  }
  function invalidate() { generation++; reviewed = null; $("copilot-outcome-dialog").close(); $("copilot-outcome-summary").textContent = ""; controls(); }
  function render() {
    const id = $("copilot-request").value;
    $("copilot-request").replaceChildren(...rows.toReversed().map(r => option(r.id, `${r.status} · ${r.phase} · ${r.id.slice(0, 8)}`)));
    if (rows.some(r => r.id === id)) $("copilot-request").value = id;
    $("copilot-request-detail").textContent = row() ? `Request: ${row().id}\nSubmission: ${row().requestId ?? "older client without an explicit ID"}\nAccount: ${row().account}\nConversation: ${row().conversationId ?? "not retained"}\nMicrosoft conversation: ${row().sessionId ?? "not acknowledged"}\nDelivery phase: ${row().phase}\nOutcome: ${row().status}\nOriginal uncertainty: ${row().originalOutcome ?? "none recorded"}\nRemote cancellation: not verified` : "Load saved outcomes to inspect a request. This reads local metadata only.";
    const account = state?.copilotAccount;
    $("copilot-account-detail").textContent = !work() ? "Select Copilot-only Work to connect an approved account or review its requests." : account ? `${account.displayName}\nAccount: ${account.account}\nTenant: ${account.tenantId}\nSaved enrollment only; license and Graph availability are checked on use.` : "No approved work account is enrolled in this workspace.";
    controls();
  }
  function context() { const version = generation, compartment = state?.id; return { compartment, current: () => version === generation && state?.id === compartment }; }
  async function action(fn) {
    if (busy || !work()) return; busy = true; controls(); const ctx = context();
    try { await fn(ctx); } catch (error) { if (ctx.current()) { $("copilot-status").textContent = error.message; notify(error.message); } }
    finally { busy = false; controls(); }
  }
  async function inventory(ctx) { const result = await api("/api/suite/copilot/requests", { compartment: ctx.compartment }); if (ctx.current()) { rows = result; render(); } }
  for (const id of ["copilot-tenant", "copilot-client", "copilot-approved"]) for (const type of ["change", "input"]) $(id).addEventListener(type, () => { invalidate(); });
  $("connect-copilot").addEventListener("click", () => action(async ctx => {
    if (!permitted() || login || !$("copilot-approved").checked) return;
    const input = { compartment: ctx.compartment, tenantId: $("copilot-tenant").value.trim(), clientId: $("copilot-client").value.trim(), approved: true };
    const result = await api("/api/suite/copilot/login", input); if (!ctx.current()) return;
    login = result;
    $("copilot-status").textContent = `Open ${result.verificationUrl} and enter ${result.userCode}. Review Microsoft's requested permissions. The code expires in ${Math.ceil(result.expiresIn / 60)} minutes. After signing in, choose Check sign-in. No automatic polling is running.`;
  }));
  $("check-copilot-login").addEventListener("click", () => action(async ctx => {
    if (!permitted() || !login) return; const current = login;
    try {
      const result = await api("/api/suite/copilot/poll", { compartment: ctx.compartment, loginId: current.loginId });
      if (!ctx.current() || login !== current) return;
      if (result.status === "connected") { login = null; $("copilot-approved").checked = false; $("copilot-status").textContent = "Approved work account enrolled. Graph availability is checked on use; no design message was sent."; await refresh(); }
      else $("copilot-status").textContent = `Sign-in is still pending. Complete Microsoft's permission review, then check again after ${result.interval} seconds. Code: ${current.userCode}`;
    } catch (error) {
      if (!ctx.current() || login !== current) return;
      $("copilot-status").textContent = `Sign-in result unconfirmed: ${error.message}. Inspect the saved account below. No automatic retry or alternate account was used.`;
      await refresh();
    }
  }));
  $("cancel-copilot-login").addEventListener("click", async () => {
    if (cancelling || !login || !work()) return;
    const current = login, ctx = context(); cancelling = true; login = null; invalidate(); const stopped = context(); controls();
    try {
      const result = await api("/api/suite/copilot/login/cancel", { compartment: ctx.compartment, loginId: current.loginId });
      if (stopped.current()) $("copilot-status").textContent = `Local sign-in stopped. Local request settlement: ${result.localRequestsSettled ? "verified" : "unconfirmed"}. Microsoft cancellation is unverified. Previously saved credentials were not removed.`;
    } catch (error) { if (stopped.current()) $("copilot-status").textContent = `Stop result unconfirmed: ${error.message}. Inspect the saved account; no automatic retry or logout was attempted.`; }
    finally {
      try { if (stopped.current()) await refresh(); } catch (error) { if (stopped.current()) notify(error.message); }
      cancelling = false; controls();
    }
  });
  $("refresh-copilot-requests").addEventListener("click", () => action(async ctx => { reviewed = null; $("copilot-outcome-dialog").close(); await inventory(ctx); }));
  $("copilot-request").addEventListener("change", () => { invalidate(); render(); });
  $("review-copilot-outcome").addEventListener("click", () => action(async ctx => {
    if (!row() || terminal.has(row().status)) return; const id = row().id;
    const result = await api("/api/suite/copilot/requests/review", { compartment: ctx.compartment, id }); if (!ctx.current()) return;
    reviewed = { id, token: result.confirmation.token };
    $("copilot-outcome-summary").textContent = `${result.confirmation.record.reason}\n\n${JSON.stringify(result.request, null, 2)}\n\nExpires: ${result.confirmation.record.expiresAt}`;
    $("copilot-outcome-dialog").showModal();
  }));
  $("cancel-copilot-outcome").addEventListener("click", invalidate);
  $("copilot-outcome-dialog").addEventListener("close", () => { reviewed = null; controls(); });
  $("confirm-copilot-outcome").addEventListener("click", () => action(async ctx => {
    if (!reviewed) return; const review = reviewed; reviewed = null; $("copilot-outcome-dialog").close();
    try {
      await api("/api/suite/copilot/requests/resolve", { compartment: ctx.compartment, ...review });
      if (ctx.current()) $("copilot-status").textContent = "Uncertainty acknowledged locally. Microsoft processing and completion remain unverified. No request was replayed; any later message is a separate deliberate submission.";
    } catch (error) { if (ctx.current()) $("copilot-status").textContent = `Acknowledgement unconfirmed: ${error.message}. Inspect the retained outcome before reviewing again. No automatic retry was made.`; }
    finally { if (ctx.current()) await inventory(ctx); }
  }));
  function clear() {
    state = null; login = null; rows = []; invalidate();
    $("copilot-tenant").value = ""; $("copilot-client").value = ""; $("copilot-approved").checked = false;
    $("copilot-status").textContent = "Choose the intended Work workspace. No background sign-in checks are running."; render();
  }
  document.addEventListener("switchyard-workspace-changing", clear);
  document.addEventListener("switchyard-compartment-state", event => {
    const next = event.detail;
    if (state?.id !== next.id || state?.policy !== next.policy || state?.mode !== next.mode) clear();
    if (identity(state) !== identity(next)) invalidate(); state = next; render();
  });
  render();
}
