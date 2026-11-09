import { api } from "./connection.mjs";

const actions = { run_target: "Run a program", pipeline_local_gate: "Run a local check", pipeline_clean_reproduction: "Reproduce in a clean workspace", shield_change_scan: "Scan selected changes", shield_codebase_audit: "Audit selected code", shield_supply_chain: "Inspect dependencies", release_shield: "Review release inputs" };
const option = (value, label) => { const e = document.createElement("option"); e.value = value; e.textContent = label; return e; };
const json = value => JSON.stringify(value, null, 2);
/** Review exact saved task grants. Reading history never retries a program. */
export function mountExecution({ notify }) {
  const $ = id => document.getElementById(id);
  let state = null, grants = [], runs = [], stops = [], generation = 0, busy = false, reviewed = null, manifest = null, detail = null;
  const permitted = () => state?.policy === "personal" && state.mode === "personal-companion";
  const grant = () => grants.find(r => r.id === $("execution-grant").value);
  const run = () => runs.find(r => r.requestId === $("execution-history").value);
  const available = row => row?.status === "issued" && Date.parse(row.grant.expiresAt) > Date.now();
  const allowed = row => (row?.proposal.actions ?? []).filter(a => actions[a] && row.connectedExecutionActions.includes(a));
  function invalidate() { generation++; reviewed = null; $("execution-review-dialog").close(); controls(); }
  function controls() {
    const current = grant();
    for (const id of ["execution-grant", "execution-action", "execution-manifest", "execution-manifest-file", "execution-history", "refresh-executions"]) $(id).disabled = busy || !permitted();
    $("review-execution").disabled = busy || !permitted() || !available(current) || !allowed(current).includes($("execution-action").value) || !manifest || !current?.proposal.paths.includes($("execution-manifest").value);
    $("observe-execution").disabled = busy || !permitted() || !run();
    $("review-execution-stop").disabled = busy || !permitted() || !run()?.operationId || detail?.nativeExitVerified === true;
    $("confirm-execution").disabled = busy || !reviewed;
  }
  function renderGrant() {
    manifest = null; $("execution-manifest-file").value = ""; $("execution-file-status").textContent = "Choose the same recipe file from this project. Only its SHA-256 is sent; the backend checks the saved repository bytes.";
    const row = grant();
    $("execution-action").replaceChildren(...allowed(row).map(a => option(a, actions[a])));
    $("execution-manifest").replaceChildren(...(row?.proposal.paths ?? []).map(p => option(p, p)));
    if (row?.proposal.paths.length) $("execution-manifest").value = row.proposal.paths.find(p => p.endsWith(".json")) ?? row.proposal.paths[0];
    $("execution-grant-detail").textContent = row ? `Project: ${row.grant.repositoryRoot}\nPlan: ${row.proposal.planRevision}\nPermission: ${row.status}; expires ${row.grant.expiresAt}\nFiles: ${row.proposal.paths.join(", ")}\nThe backend must recheck the task, account, project snapshot and recipe before execution.` : "No saved task permission is available. First connect a coding task and review its file and action permissions. A recipe file alone cannot authorize a run.";
    controls();
  }
  function renderHistory() {
    const row = detail ?? run();
    $("execution-result").textContent = row ? `Action: ${actions[row.action] ?? row.action}\nProject: ${row.repositoryRoot}\nRequest: ${row.requestId}\nRecorded state: ${row.status}\nOriginal admission: ${row.outcome?.status ?? "not admitted"}\nObserved result: ${row.observedStatus ?? "not observed"}\nNative exit: ${row.nativeExitVerified === undefined ? "not checked here" : row.nativeExitVerified ? "verified" : "unconfirmed"}\nProgram exit code: ${row.programExitCode ?? "unknown"}\nStaging cleanup: ${row.stagingCleanupPending === undefined ? "not checked here" : row.stagingCleanupPending ? "pending" : "no pending cleanup reported"}\nCoding task completion: not verified${row.receipt ? `\nReceipt (historical): ${row.receipt.historicalResult}; ${row.receipt.completeness}; expired ${row.receipt.expired}; invalidated ${row.receipt.invalidatedBy ?? "no"}. Current gate eligibility is not granted by this display.` : ""}${row.outcome?.summary ? "\n" + row.outcome.summary : ""}` : "No execution is selected. Refresh lists saved records without running a program.";
    $("execution-output").textContent = detail ? [detail.output, detail.diagnostic].filter(Boolean).join("\n") : "Observe the selected run to read its bounded, redacted output.";
    $("execution-stop-history").replaceChildren(...stops.filter(s => s.requestId === row?.requestId).map(s => { const e = document.createElement("li"); e.textContent = `Stop ${s.stopId}: ${s.status} · ${s.result?.status ?? "no final result"}. ${s.result?.summary ?? "Original program outcome is unchanged."}`; return e; }));
    controls();
  }
  async function inventory({ compartment, current }, selectedId) {
    const [authorities, history, stopHistory] = await Promise.all([api("/api/suite/coding/authority/list", { compartment }), api("/api/suite/coding/execution/list", { compartment }), api("/api/suite/coding/execution/stop/list", { compartment })]);
    if (!current()) return;
    const previous = grant()?.id; grants = authorities; runs = history; stops = stopHistory; detail = null;
    $("execution-grant").replaceChildren(...grants.map(r => option(r.id, `${r.grant.repositoryRoot} · ${r.proposal.planRevision} · ${r.status}`)));
    $("execution-grant").value = grants.some(r => r.id === previous) ? previous : grants.find(available)?.id ?? grants[0]?.id ?? "";
    $("execution-history").replaceChildren(...[...runs].reverse().map(r => option(r.requestId, `${actions[r.action] ?? r.action} · ${r.status} · ${r.requestId.slice(0, 8)}`)));
    if (runs.some(r => r.requestId === selectedId)) $("execution-history").value = selectedId;
    renderGrant(); renderHistory();
  }
  async function work(fn) {
    if (busy || !permitted()) return; busy = true; controls(); const version = generation, compartment = state.id;
    const context = { compartment, current: () => generation === version && state?.id === compartment };
    try { await fn(context); } catch (error) { if (context.current()) { $("execution-status").textContent = error.message; notify(error.message); } }
    finally { busy = false; controls(); }
  }
  function clear() {
    grants = []; runs = []; stops = []; detail = null; manifest = null;
    for (const id of ["execution-grant", "execution-action", "execution-manifest", "execution-history"]) $(id).replaceChildren();
    renderGrant(); renderHistory();
  }
  $("refresh-executions").addEventListener("click", () => { invalidate(); void work(async context => { await inventory(context); if (context.current()) $("execution-status").textContent = "Saved permissions and results loaded. No provider task was inspected and no program was started."; }); });
  $("execution-grant").addEventListener("change", () => { invalidate(); renderGrant(); });
  for (const id of ["execution-action", "execution-manifest"]) $(id).addEventListener("change", () => { invalidate(); if (id === "execution-manifest") { manifest = null; $("execution-manifest-file").value = ""; $("execution-file-status").textContent = "Choose the recipe file for this selected path."; } controls(); });
  $("execution-history").addEventListener("change", () => { invalidate(); detail = null; renderHistory(); });
  $("execution-manifest-file").addEventListener("change", () => {
    manifest = null; invalidate();
    void work(async context => {
      const file = $("execution-manifest-file").files?.[0]; if (!file) return;
      if (file.size > 128 * 1024) throw Error("Choose a recipe JSON file no larger than 128 KiB.");
      const bytes = await file.arrayBuffer(); if (bytes.byteLength !== file.size) throw Error("The selected file changed while reading.");
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
      if (!context.current()) return; JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      manifest = digest; $("execution-file-status").textContent = `${file.name} · ${file.size} bytes · SHA-256 ${digest}`;
    });
  });
  $("review-execution").addEventListener("click", () => work(async context => {
    const row = grant(); if (!available(row) || !manifest || !allowed(row).includes($("execution-action").value)) return;
    $("execution-status").textContent = "Checking the exact task, project inputs and recipe. No program has started.";
    const value = await api("/api/suite/coding/execution/review", { compartment: context.compartment, requestId: crypto.randomUUID(), authorityId: row.id, manifestPath: $("execution-manifest").value, manifestSha256: manifest, action: $("execution-action").value });
    if (!context.current()) return;
    reviewed = { kind: "run", requestId: value.review.requestId, token: value.confirmation.token };
    $("execution-review-title").textContent = "Review this exact execution";
    $("execution-review-summary").textContent = `${actions[value.review.action]}\nProject: ${value.review.repositoryRoot}\nTask: ${value.review.taskId}\nManifest: ${value.review.manifestPath}\nSHA-256: ${value.review.manifestSha256}\nExpires: ${value.review.expiresAt}\n\n${value.confirmation.record.reason}\n\nProgram and inputs:\n${json(value.review.recipe)}\n\nExecutable identity:\n${json(value.review.executableIdentity)}\n\nIsolation:\n${json(value.review.executionPolicy)}\n\nBudget:\n${json(value.budget)}${value.review.shield ? "\n\nScanner scope and evidence:\n" + json(value.review.shield) : ""}`;
    $("confirm-execution").textContent = "Run this reviewed recipe"; $("execution-review-dialog").showModal();
  }));
  $("observe-execution").addEventListener("click", () => work(async context => {
    const selected = run(); if (!selected) return;
    const value = await api("/api/suite/coding/execution/status", { compartment: context.compartment, requestId: selected.requestId }); if (!context.current()) return;
    detail = value; runs = runs.map(r => r.requestId === value.requestId ? value : r); renderHistory();
    $("execution-status").textContent = "Retained ownership and result observed. No program was retried. A program result does not establish coding-task completion.";
  }));
  $("review-execution-stop").addEventListener("click", () => work(async context => {
    const selected = run(); if (!selected?.operationId) return;
    const value = await api("/api/suite/coding/execution/stop/review", { compartment: context.compartment, requestId: selected.requestId, stopId: crypto.randomUUID() }); if (!context.current()) return;
    reviewed = { kind: "stop", requestId: selected.requestId, stopId: value.review.stopId, token: value.confirmation.token };
    $("execution-review-title").textContent = "Stop this owned execution";
    $("execution-review-summary").textContent = `Project: ${selected.repositoryRoot}\nAction: ${actions[value.review.originalAction] ?? value.review.originalAction}\nRequest: ${value.review.requestId}\nOperation: ${value.review.originalOperationId}\nExpires: ${value.review.expiresAt}\n\n${value.confirmation.record.reason}\n\nBudget:\n${json(value.budget)}`;
    $("confirm-execution").textContent = "Stop this exact execution"; $("execution-review-dialog").showModal();
  }));
  $("cancel-execution").addEventListener("click", () => { reviewed = null; $("execution-review-dialog").close(); controls(); });
  $("execution-review-dialog").addEventListener("close", () => { reviewed = null; controls(); });
  $("confirm-execution").addEventListener("click", () => work(async context => {
    if (!reviewed) return; const request = reviewed; reviewed = null; $("execution-review-dialog").close();
    $("execution-status").textContent = request.kind === "stop" ? "Requesting the separately reviewed stop. Waiting for its retained result…" : "Submitting the reviewed execution once. Waiting for its retained admission result…";
    try {
      const value = await api("/api/suite/coding/execution/" + (request.kind === "stop" ? "stop/apply" : "apply"), { compartment: context.compartment, ...(request.kind === "stop" ? { stopId: request.stopId } : { requestId: request.requestId }), token: request.token });
      if (context.current()) $("execution-status").textContent = `${request.kind === "stop" ? "Stop" : "Admission"}: ${value.status}. ${value.summary ?? "Observe the retained run to check its process result and cleanup."} Coding-task completion is not verified.`;
    } catch (error) {
      if (context.current()) { $("execution-status").textContent = `No confirmed result was received: ${error.message}. The request was not retried. Refresh and observe its retained record before deciding what to do next.`; notify("Execution result needs review; no automatic retry was made."); }
    } finally {
      if (context.current()) try { await inventory(context, request.requestId); } catch (error) { if (context.current()) { $("execution-status").textContent += ` Saved history could not be refreshed: ${error.message}.`; notify("Refresh saved execution history when the local connection is available."); } }
    }
  }));
  document.addEventListener("switchyard-execution-grants-changed", event => {
    if (!permitted() || event.detail.compartment !== state.id) return;
    invalidate(); void work(async context => { await inventory(context); if (context.current() && grants.some(row => row.id === event.detail.authorityId)) { $("execution-grant").value = event.detail.authorityId; renderGrant(); } });
  });
  document.addEventListener("switchyard-workspace-changing", () => { state = null; invalidate(); clear(); $("execution-status").textContent = "Select a workspace to inspect its saved runs."; });
  document.addEventListener("switchyard-compartment-state", event => { state = event.detail; invalidate(); clear(); $("execution-status").textContent = permitted() ? "Load saved task permissions and execution history when you need them." : "Execution requires a Personal workspace in companion mode."; });
  clear(); controls();
}
