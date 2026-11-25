import { api } from "./connection.mjs";

const actions = { run_target: "Run a program", pipeline_local_gate: "Run a local check", pipeline_clean_reproduction: "Reproduce in a clean workspace", shield_change_scan: "Scan selected changes", shield_codebase_audit: "Audit selected code", shield_supply_chain: "Inspect dependencies", release_shield: "Review release inputs" };
const option = (value, label) => { const e = document.createElement("option"); e.value = value; e.textContent = label; return e; };
const fields = ["authority-task", "authority-plan", "authority-action", "authority-lifetime", "authority-paths", "authority-included-untracked", "authority-excluded-untracked", "authority-included-ignored", "authority-excluded-ignored", "authority-excluded-trees"];
const list = value => value.split(/\r?\n/).filter(line => line.length > 0);
export const historicalPermissionSummary = history => history ? `Read-only historical files:\n${history.paths.join("\n")}\nFirst-parent depth: ${history.depth}\nStarting commit: ${history.head}\nHistory witness: ${history.metadataSha256}\nThese versions grant no current-file ownership, commit permission or general execution access.` : "";
/** Literal paths belong in the human review; JSON fingerprints remain available separately. */
export function permissionScopeSummary(scope) {
  const lines = [`Project: ${scope.repositoryRoot}`, `Tool: ${scope.provider === "codex" ? "Codex" : "Claude Code"}`, `Task: ${scope.taskId}`, `Native session: ${scope.sessionId}`, `Plan: ${scope.planRevision}`, `Permission lifetime: ${scope.lifetimeMinutes} minutes`, `Allowed actions: ${scope.allowedActions.map(action => actions[action] ?? action).join(", ")}`, "", "Included files:", ...scope.paths.map(path => `  ${path}`)];
  for (const [key, label] of [["includedUntracked", "Included untracked files"], ["excludedUntracked", "Excluded untracked files"], ["includedIgnored", "Included ignored files (scanner inputs only)"], ["excludedIgnored", "Excluded ignored files"], ["excludedIgnoredTrees", "Excluded generated folders"]]) {
    const paths = scope.classifications?.[key] ?? [];
    if (paths.length) lines.push("", label + ":", ...paths.map(path => `  ${path}`));
  }
  if (scope.history) lines.push("", historicalPermissionSummary(scope.history));
  return lines.join("\n");
}
/** Saving a grant never runs a recipe or changes provider permissions. */
export function mountAuthority({ notify }) {
  const $ = id => document.getElementById(id);
  let state = null, tasks = [], grants = [], generation = 0, busy = false, reviewed = null, importedHistory = null;
  const permitted = () => state?.policy === "personal" && state.mode === "personal-companion";
  const task = () => tasks.find(t => t.id === $("authority-task").value);
  const selectedGrant = () => grants.find(g => g.id === $("authority-history").value);
  function controls() {
    for (const id of fields) $(id).disabled = busy || !permitted();
    $("review-authority").disabled = busy || !permitted() || !task();
    $("confirm-authority").disabled = busy || !reviewed;
    $("refresh-authorities").disabled = busy || state?.policy !== "personal";
    $("authority-history").disabled = busy || state?.policy !== "personal";
    $("revalidate-authority").disabled = busy || !permitted() || !selectedGrant();
    $("review-authority-revoke").disabled = busy || state?.policy !== "personal" || !selectedGrant() || selectedGrant().status !== "issued";
    $("clear-authority-history").disabled = busy || !permitted() || !importedHistory;
  }
  function displayHistory(history) { importedHistory = history ? structuredClone(history) : null; $("authority-history-selection").hidden = !importedHistory; $("authority-history-scope").textContent = historicalPermissionSummary(importedHistory); }
  function invalidate() { generation++; reviewed = null; $("authority-review-dialog").close(); $("authority-review-summary").textContent = ""; $("authority-review-details").textContent = ""; $("authority-exact-scope").open = false; controls(); }
  function renderHistory() {
    const row = selectedGrant();
    $("authority-record").textContent = row ? `Project: ${row.grant.repositoryRoot}\nPlan: ${row.proposal.planRevision}\nStatus: ${row.status}\nExpires: ${row.grant.expiresAt}\nActions: ${row.grant.allowedActions.map(a => actions[a] ?? a).join(", ")}\nFiles: ${row.proposal.paths.join(", ")}\nCurrent task and repository: require fresh revalidation. Provider permissions and task completion are unchanged.` : "No saved permission selected.";
    controls();
  }
  async function inventory(context, selectedId) {
    const rows = await api("/api/suite/coding/authority/list", { compartment: context.compartment }); if (!context.current()) return;
    grants = rows; $("authority-history").replaceChildren(...[...rows].reverse().map(r => option(r.id, `${r.grant.repositoryRoot} · ${r.proposal.planRevision} · ${r.status}`)));
    if (rows.some(r => r.id === selectedId)) $("authority-history").value = selectedId; renderHistory();
  }
  async function work(fn) {
    if (busy || state?.policy !== "personal") return; busy = true; controls(); const version = generation, compartment = state.id;
    const context = { compartment, current: () => generation === version && state?.id === compartment };
    try { await fn(context); } catch (error) { if (context.current()) { $("authority-status").textContent = error.message; notify(error.message); } }
    finally { busy = false; controls(); }
  }
  function clear() {
    displayHistory(null);
    tasks = []; grants = []; $("authority-task").replaceChildren(); $("authority-history").replaceChildren();
    for (const id of fields.filter(id => !["authority-task", "authority-action"].includes(id))) $(id).value = "";
    $("authority-plan").value = "plan-1"; $("authority-lifetime").value = "15";
    $("authority-action").replaceChildren(...Object.entries(actions).map(([value, label]) => option(value, label))); renderHistory();
  }
  for (const id of fields) $(id).addEventListener("input", () => { invalidate(); });
  for (const id of fields) $(id).addEventListener("change", () => { invalidate(); });
  for (const id of ["authority-task", "authority-action"]) $(id).addEventListener("change", () => { if (importedHistory) { displayHistory(null); $("authority-status").textContent = "The task or action changed. Reload a saved scanner setup to review its historical scope."; controls(); } });
  $("clear-authority-history").addEventListener("click", () => { if (busy || !permitted()) return; displayHistory(null); invalidate(); $("authority-status").textContent = "Historical scope removed. Only the displayed current files will be reviewed."; });
  $("authority-history").addEventListener("change", () => { invalidate(); renderHistory(); });
  $("refresh-authorities").addEventListener("click", () => { invalidate(); void work(async context => { await inventory(context); if (context.current()) $("authority-status").textContent = "Saved permission metadata loaded. No native provider was queried and no program was started."; }); });
  $("review-authority").addEventListener("click", () => work(async context => {
    if (!permitted() || !task()) return;
    const proposal = { taskId: task().id, planRevision: $("authority-plan").value, actions: [$("authority-action").value], lifetimeMinutes: Number($("authority-lifetime").value), paths: list($("authority-paths").value), classifications: { includedUntracked: list($("authority-included-untracked").value), excludedUntracked: list($("authority-excluded-untracked").value), includedIgnored: list($("authority-included-ignored").value), excludedIgnored: list($("authority-excluded-ignored").value), excludedIgnoredTrees: list($("authority-excluded-trees").value) } };
    if (importedHistory) proposal.history = structuredClone(importedHistory);
    $("authority-status").textContent = "Checking the selected native task and read-only Git/file metadata. No permission has been issued and no recipe has run.";
    const result = await api("/api/suite/coding/authority/review", { compartment: context.compartment, ...proposal }); if (!context.current()) return;
    reviewed = { kind: "issue", proposal: structuredClone(proposal), token: result.confirmation.token };
    $("authority-review-title").textContent = "Review task permission";
    $("authority-review-summary").textContent = `${permissionScopeSummary(result.scope)}\n\n${result.confirmation.record.reason}\n\nThis approval only saves a host task permission. Each program, scan or repository effect still requires its own review.`;
    $("authority-review-details").textContent = JSON.stringify(result.scope, null, 2); $("authority-exact-scope").open = false;
    $("confirm-authority").textContent = "Save this task permission"; $("authority-review-dialog").showModal();
  }));
  $("revalidate-authority").addEventListener("click", () => work(async context => {
    if (!permitted() || !selectedGrant()) return;
    const result = await api("/api/suite/coding/authority/revalidate", { compartment: context.compartment, id: selectedGrant().id }); if (!context.current()) return;
    $("authority-status").textContent = `${result.allowed ? "Current scope verified" : "Permission unavailable"}: ${result.reason} No execution permission was consumed and no program was started.`;
  }));
  $("review-authority-revoke").addEventListener("click", () => {
    if (busy || state?.policy !== "personal" || !selectedGrant() || selectedGrant().status !== "issued") return;
    const row = selectedGrant(); reviewed = { kind: "revoke", id: row.id };
    $("authority-review-title").textContent = "Revoke this task permission";
    $("authority-review-summary").textContent = `Project: ${row.grant.repositoryRoot}\nPlan: ${row.proposal.planRevision}\nPermission: ${row.id}\nActions: ${row.grant.allowedActions.join(", ")}\n\nRevoke this saved grant. This does not undo earlier effects or prove an owned process has stopped. Use the execution's separate stop review when needed.`;
    $("authority-review-details").textContent = JSON.stringify(row.grant, null, 2); $("authority-exact-scope").open = false;
    $("confirm-authority").textContent = "Revoke this permission"; $("authority-review-dialog").showModal(); controls();
  });
  $("cancel-authority").addEventListener("click", () => { reviewed = null; $("authority-review-dialog").close(); controls(); });
  $("authority-review-dialog").addEventListener("close", () => { reviewed = null; $("authority-review-summary").textContent = ""; $("authority-review-details").textContent = ""; $("authority-exact-scope").open = false; controls(); });
  $("confirm-authority").addEventListener("click", () => work(async context => {
    if (!reviewed) return; const review = reviewed; reviewed = null; $("authority-review-dialog").close();
    let id = review.id;
    try {
      const result = await api("/api/suite/coding/authority/" + (review.kind === "issue" ? "issue" : "revoke"), { compartment: context.compartment, ...(review.kind === "issue" ? { ...review.proposal, token: review.token } : { id: review.id }) });
      if (!context.current()) return; id = result.id;
      $("authority-status").textContent = review.kind === "issue" ? "Task permission saved. Review the exact recipe in Run a reviewed task; no program has started and provider permissions are unchanged." : "This task permission is revoked. Earlier effects and owned-process status are unchanged.";
      document.dispatchEvent(new CustomEvent("switchyard-execution-grants-changed", { detail: { compartment: context.compartment, authorityId: result.id } }));
    } catch (error) { if (context.current()) { $("authority-status").textContent = `No confirmed permission result was received: ${error.message}. No automatic retry was made; refresh saved permissions before deciding whether to issue another.`; notify("Inspect saved permission history; no automatic retry was made."); } }
    finally { if (context.current()) try { await inventory(context, id); } catch (error) { if (context.current()) $("authority-status").textContent += ` Saved history unavailable: ${error.message}.`; } }
  }));
  document.addEventListener("switchyard-authority-proposal", event => {
    const { compartment, proposal } = event.detail;
    if (busy || !permitted() || compartment !== state.id || !tasks.some(t => t.id === proposal?.taskId) || proposal?.actions?.length !== 1 || !actions[proposal.actions[0]] || !Array.isArray(proposal.paths) || !proposal.paths.every(path => typeof path === "string")) return;
    if (proposal.history && (!Array.isArray(proposal.history.paths) || !proposal.history.paths.every(path => typeof path === "string") || !["shield_codebase_audit", "release_shield"].includes(proposal.actions[0]))) return;
    displayHistory(proposal.history);
    invalidate(); $("authority-task").value = proposal.taskId; $("authority-plan").value = proposal.planRevision; $("authority-action").value = proposal.actions[0]; $("authority-lifetime").value = String(proposal.lifetimeMinutes ?? 15); $("authority-paths").value = proposal.paths.join("\n");
    for (const [id, key] of [["authority-included-untracked", "includedUntracked"], ["authority-excluded-untracked", "excludedUntracked"], ["authority-included-ignored", "includedIgnored"], ["authority-excluded-ignored", "excludedIgnored"], ["authority-excluded-trees", "excludedIgnoredTrees"]]) $(id).value = (proposal.classifications?.[key] ?? []).join("\n");
    $("authority-controls").open = true; $("authority-status").textContent = "Saved scanner scope loaded for your review. Inspect the task and confirm a fresh permission; no approval or execution was imported."; controls();
  });
  document.addEventListener("switchyard-workspace-changing", () => { state = null; invalidate(); clear(); $("authority-status").textContent = "Choose a workspace to review its saved task permissions."; });
  document.addEventListener("switchyard-compartment-state", event => {
    state = event.detail; invalidate(); clear();
    if (permitted()) tasks = (state.codingSessions ?? []).filter(t => t.schema === "switchyard-coding-session/v1" && t.status === "registered" && t.sessionId && ["owned-stdio", "owned-print"].includes(t.nativeTransport) && (t.provider === "codex" || t.provider === "claude-code" && t.nativeIdentityVerified === true));
    $("authority-task").replaceChildren(...tasks.map(t => option(t.id, `${t.provider === "codex" ? "Codex" : "Claude Code"} · ${t.repositoryRoot} · ${t.id.slice(0, 8)}`)));
    $("authority-status").textContent = tasks.length ? "Choose a saved task and an exact file scope. Preparing a review queries its native task and read-only repository metadata." : "Connect a verified native coding task in a Personal companion workspace before reviewing its file permissions."; controls();
  });
  clear(); controls();
}
