import { api } from "./connection.mjs";
const actions = { shield_change_scan: "Selected changes", shield_codebase_audit: "Selected codebase", shield_supply_chain: "Dependencies", release_shield: "Release inputs" };
const option = (value, label) => { const e = document.createElement("option"); e.value = value; e.textContent = label; return e; };
export function historicalScopeSummary(preparation) {
  if (!preparation.historyDepth) return "";
  const discovery = preparation.historyPathDiscovery;
  if (!discovery) return "\n\nHistorical name discovery is unavailable. History coverage remains incomplete.";
  if (!discovery.count) return "\n\nNo additional removed paths were found in the inspected first-parent commits. Other branches and deeper history remain outside this review.";
  return `\n\nHistorical files outside this scan: ${discovery.count}\nThese names occur in older inspected commits, are absent from the selected HEAD and are not among the selected history inputs. Their contents have not been read or included.\n${discovery.rows.map(row => row.path).join("\n")}${discovery.omittedCount ? `\n${discovery.omittedCount} additional names are not displayed (${discovery.unsupportedCount} unsupported paths or file types).` : ""}\nThis review does not grant permission to scan them. Other branches and deeper history remain uninspected.`;
}
/** Generate and save a setup; authority and scan execution remain separate steps. */
export function mountScanner({ notify }) {
  const $ = id => document.getElementById(id);
  let state = null, tasks = [], feeds = [], saves = [], generation = 0, busy = false, reviewed = null;
  const permitted = () => state?.policy === "personal" && state.mode === "personal-companion";
  const task = () => tasks.find(t => t.id === $("scanner-task").value);
  const saved = () => saves.find(r => r.id === $("scanner-history").value);
  const usable = kind => feeds.filter(f => f.kind === kind && f.status === "active");
  function controls() {
    for (const id of ["scanner-task", "scanner-action", "scanner-plan", "scanner-feed", "scanner-advisory", "scanner-index", "scanner-history", "load-scanner-setup", "recover-scanner-saves"]) $(id).disabled = busy || !permitted();
    $("scanner-depth").disabled = busy || !permitted() || !["shield_codebase_audit", "release_shield"].includes($("scanner-action").value);
    $("review-scanner-save").disabled = busy || !permitted() || !task() || !usable("scanner").some(f => f.id === $("scanner-feed").value);
    $("confirm-scanner-save").disabled = busy || !reviewed;
    for (const id of ["use-scanner-scope", "use-scanner-recipe"]) $(id).disabled = busy || !permitted() || saved()?.status !== "saved" || saved()?.result?.status !== "saved";
  }
  function invalidate() { generation++; reviewed = null; $("scanner-review-dialog").close(); $("scanner-review-files").replaceChildren(); controls(); }
  function render() {
    const row = saved();
    $("scanner-save-result").textContent = row ? `Project: ${row.draft.repositoryRoot}\nDirectory: ${row.draft.directory}\nStatus: ${row.status}\nManifest: ${row.draft.manifestPath}\nSHA-256: ${row.draft.manifestSha256}\nSaved files: ${row.draft.files.length}\n${row.result?.reason ?? row.result?.nextStep ?? "No file-save result has been confirmed."}\nSaving grants no task permission, starts no scan and establishes no complete security coverage.` : "No scanner setup selected. Existing source files are never replaced by this flow.";
    controls();
  }
  async function history(context, id) {
    const rows = await api("/api/suite/coding/scanner-save/list", { compartment: context.compartment }); if (!context.current()) return;
    saves = rows; $("scanner-history").replaceChildren(...[...rows].reverse().map(r => option(r.id, `${actions[r.draft.action] ?? r.draft.action} · ${r.status} · ${r.draft.directory}`)));
    if (rows.some(r => r.id === id)) $("scanner-history").value = id; render();
  }
  async function work(fn) {
    if (busy || !permitted()) return; busy = true; controls(); const version = generation, compartment = state.id;
    const context = { compartment, current: () => generation === version && state?.id === compartment };
    try { await fn(context); } catch (error) { if (context.current()) { $("scanner-status").textContent = error.message; notify(error.message); } }
    finally { busy = false; controls(); }
  }
  function clear() {
    tasks = []; feeds = []; saves = [];
    for (const id of ["scanner-task", "scanner-feed", "scanner-advisory", "scanner-history"]) $(id).replaceChildren();
    $("scanner-action").replaceChildren(...Object.entries(actions).map(([id, name]) => option(id, name)));
    $("scanner-plan").value = "scan-1"; $("scanner-index").checked = false; $("scanner-depth").value = "0"; $("scanner-feed-detail").textContent = "Load already installed feed metadata. Trust and freshness are checked again during review and saving."; render();
  }
  for (const id of ["scanner-task", "scanner-action", "scanner-plan", "scanner-feed", "scanner-advisory", "scanner-index", "scanner-depth"]) {
    const change = () => { invalidate(); if (id === "scanner-action" && !["shield_codebase_audit", "release_shield"].includes($(id).value)) $("scanner-depth").value = "0"; controls(); };
    $(id).addEventListener("change", change); $(id).addEventListener("input", change);
  }
  $("scanner-history").addEventListener("change", () => { invalidate(); render(); });
  $("load-scanner-setup").addEventListener("click", () => { invalidate(); void work(async context => {
    const registry = await api("/api/suite/host/scanner-fixtures/list", { compartment: context.compartment }); if (!context.current()) return;
    feeds = registry.fixtures; $("scanner-feed").replaceChildren(...usable("scanner").map(f => option(f.id, f.id))); $("scanner-advisory").replaceChildren(option("", "No advisory feed"), ...usable("advisory").map(f => option(f.id, f.id)));
    $("scanner-feed-detail").textContent = feeds.length ? feeds.map(f => `${f.id} · ${f.kind} · ${f.status} · manifest ${f.manifestSha256}`).join("\n") : "No signed feed is installed. Install a reviewed scanner feed for this workspace, then return here.";
    await history(context); if (context.current()) $("scanner-status").textContent = "Installed feed and saved-setup metadata loaded. No provider query, feed download or scan was started.";
  }); });
  $("review-scanner-save").addEventListener("click", () => work(async context => {
    if (!task()) return; const depth = Number($("scanner-depth").value), advisory = $("scanner-advisory").value;
    const input = { taskId: task().id, action: $("scanner-action").value, planRevision: $("scanner-plan").value, scannerFixtureId: $("scanner-feed").value, ...(advisory ? { advisoryFixtureId: advisory } : {}), includeIndex: $("scanner-index").checked === true, ...(depth ? { historyDepth: depth } : {}) };
    $("scanner-status").textContent = "Inspecting the selected native task, read-only repository inputs and signed feeds. No repository file has been written and no scan has run.";
    const result = await api("/api/suite/coding/scanner-save/review", { compartment: context.compartment, ...input }); if (!context.current()) return;
    reviewed = { id: result.draft.id, token: result.confirmation.token };
    $("scanner-review-summary").textContent = `${result.confirmation.record.reason}\n\nProject: ${result.draft.repositoryRoot}\nNew directory: ${result.draft.directory}\nAction: ${actions[result.draft.action]}\nManifest: ${result.draft.manifestPath}\nSHA-256: ${result.draft.manifestSha256}\nExpires: ${result.review.expiresAt}${historicalScopeSummary(result.draft.preparation)}\n\nSelected inputs, exclusions and coverage limits:\n${JSON.stringify(result.draft.preparation, null, 2)}\n\nProposed later task permission:\n${JSON.stringify(result.draft.authorityProposal, null, 2)}\n\nVerified feed metadata:\n${JSON.stringify(result.draft.feeds, null, 2)}`;
    $("scanner-review-files").replaceChildren(...result.draft.files.map(file => { const details = document.createElement("details"), summary = document.createElement("summary"), text = document.createElement("pre"); summary.textContent = `${file.path} · ${file.size} bytes · SHA-256 ${file.sha256}`; text.className = "execution-output"; text.textContent = file.content; details.append(summary, text); return details; }));
    $("scanner-review-dialog").showModal();
  }));
  $("cancel-scanner-save").addEventListener("click", () => { reviewed = null; $("scanner-review-dialog").close(); controls(); });
  $("scanner-review-dialog").addEventListener("close", () => { reviewed = null; $("scanner-review-files").replaceChildren(); controls(); });
  $("confirm-scanner-save").addEventListener("click", () => work(async context => {
    if (!reviewed) return; const approval = reviewed; reviewed = null; $("scanner-review-dialog").close();
    try {
      const result = await api("/api/suite/coding/scanner-save/apply", { compartment: context.compartment, ...approval }); if (!context.current()) return;
      $("scanner-status").textContent = result.status === "saved" ? "Scanner files saved and verified. Review their task permission next, then separately review the scan. Nothing has executed." : `Save result: ${result.status}. ${result.reason ?? "Inspect retained history; no automatic retry was made."}`;
    } catch (error) { if (context.current()) { $("scanner-status").textContent = `Save outcome unconfirmed: ${error.message}. No automatic retry was made. Inspect or recover the retained save; preserve uncertain files.`; notify("Scanner save needs review; no automatic retry was made."); } }
    finally { if (context.current()) try { await history(context, approval.id); } catch (error) { if (context.current()) $("scanner-status").textContent += ` Saved history unavailable: ${error.message}.`; } }
  }));
  $("recover-scanner-saves").addEventListener("click", () => { invalidate(); void work(async context => {
    const result = await api("/api/suite/coding/scanner-save/recover", { compartment: context.compartment }); if (!context.current()) return;
    await history(context); if (context.current()) $("scanner-status").textContent = result.stopped ? "Saved-output inspection finished without writing, deleting or replaying files. Check each retained result; this does not refresh task permission or feed trust." : "An original save owner is still active or unconfirmed. Its output is preserved; no replacement or replay was started.";
  }); });
  $("use-scanner-scope").addEventListener("click", () => {
    const row = saved(); if (busy || !permitted() || row?.status !== "saved" || row.result?.status !== "saved") return;
    document.dispatchEvent(new CustomEvent("switchyard-authority-proposal", { detail: { compartment: state.id, proposal: structuredClone(row.result.authorityProposal) } }));
  });
  $("use-scanner-recipe").addEventListener("click", () => {
    const row = saved(); if (busy || !permitted() || row?.status !== "saved" || row.result?.status !== "saved") return;
    document.dispatchEvent(new CustomEvent("switchyard-execution-recipe", { detail: { compartment: state.id, taskId: row.draft.binding.taskId, action: row.draft.action, manifestPath: row.result.manifestPath, manifestSha256: row.result.manifestSha256 } }));
  });
  document.addEventListener("switchyard-workspace-changing", () => { state = null; invalidate(); clear(); $("scanner-status").textContent = "Choose a workspace to inspect scanner setup."; });
  document.addEventListener("switchyard-compartment-state", event => {
    state = event.detail; invalidate(); clear();
    if (permitted()) tasks = (state.codingSessions ?? []).filter(t => t.schema === "switchyard-coding-session/v1" && t.status === "registered" && t.sessionId && ["owned-stdio", "owned-print"].includes(t.nativeTransport) && (t.provider === "codex" || t.provider === "claude-code" && t.nativeIdentityVerified === true));
    $("scanner-task").replaceChildren(...tasks.map(t => option(t.id, `${t.provider === "codex" ? "Codex" : "Claude Code"} · ${t.repositoryRoot} · ${t.id.slice(0, 8)}`)));
    $("scanner-status").textContent = tasks.length ? "Choose a saved coding task, then load installed feed metadata." : "Scanner setup needs a verified saved native task in a Personal companion workspace."; controls();
  });
  clear(); controls();
}
