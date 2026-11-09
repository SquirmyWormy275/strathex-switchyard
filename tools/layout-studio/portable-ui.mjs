import { api } from "./connection.mjs";
const meanings = { "": "Layout only", summon: "Open app or conversation", resume: "Return to task", status: "Check progress", review: "Review work", handoff: "Leave a handoff", cancel: "Cancel active turn" };
const modeNames = { "keyboard-only": "Keyboard only", "personal-companion": "Personal companion", "managed-companion": "Policy-controlled companion" };
const option = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; return o; };

export function mountPortable({ getProfile, persist, refresh, loadProfile, download, notify, request = api }) {
  const $ = id => document.getElementById(id);
  let state = null, generation = 0, busy = false, pendingImport = null, pendingExport = null, meaningRows = [], printRows = [], printProfile = null;
  function printLabels() {
    const profile = getProfile(), identity = `${state?.id}:${profile?.id}`;
    const previous = identity === printProfile ? printRows : [];
    printProfile = identity;
    printRows = (profile?.plan.actions ?? []).map(action => {
      const label = document.createElement("label"), input = document.createElement("input");
      label.textContent = action.label; input.maxLength = 40; input.placeholder = "Use full action name";
      input.value = previous.find(row => row.actionId === action.id && row.label === action.label)?.input.value ?? "";
      label.append(input); return { actionId: action.id, label: action.label, input, element: label };
    });
    $("legend-labels").replaceChildren(...printRows.map(row => row.element));
  }
  function controls() {
    $("export-json").disabled = busy || !state?.policyRules.export || !getProfile();
    $("export-profile-settings").disabled = $("export-json").disabled;
    $("export-legends").disabled = busy || !state?.policyRules.export || !getProfile();
    $("confirm-profile-import").disabled = busy || !pendingImport;
    $("download-portable-profile").disabled = busy || !pendingExport;
  }
  function invalidate() {
    generation++; pendingImport = null; pendingExport = null;
    $("portable-import-dialog").close(); $("portable-export-dialog").close(); printLabels(); controls();
  }
  async function run(fn) {
    if (busy) return;
    busy = true; controls();
    try { await fn(); }
    catch (error) { $("portability-status").textContent = error.message; notify(error.message); }
    finally { busy = false; controls(); }
  }
  async function prepare() {
    if (!state) throw Error("Connect your local workspace first.");
    const scope = state.id, draft = JSON.stringify(getProfile());
    await persist();
    if (scope !== state?.id || draft !== JSON.stringify(getProfile())) throw Error("The workspace or layout changed while saving. Review the current layout again.");
    return { compartment: scope, version: generation };
  }
  const current = context => context.compartment === state?.id && context.version === generation;
  async function reviewImport(candidate) {
    return run(async () => {
      if (new TextEncoder().encode(JSON.stringify(candidate)).length > 240 * 1024) throw Error("Choose a portable profile smaller than 240 KiB for this local connection. Keep the original file.");
      const context = await prepare();
      const review = await request("/api/suite/profile/package/review", { compartment: context.compartment, document: candidate });
      if (!current(context)) return;
      if (review.status !== "review-required") throw Error(review.reason ?? "This profile version is unavailable. Your saved definitions are preserved.");
      pendingImport = { ...context, document: candidate, reviewId: review.reviewId };
      $("portable-import-title").textContent = `Import ${review.document.name}`;
      $("portable-import-summary").textContent = `${review.document.plan.profile.keys.length} keys · ${review.document.plan.actions.length} controls · ${review.document.workflow.name}${review.migrationRequired ? " · legacy profile will be migrated" : ""}.`;
      const fields = { controller: "Controller declaration", qmkKeyboard: "Firmware keyboard name", layout: "Layout variant", keyCount: "Number of keys", matrix: "Matrix dimensions", geometry: "Key positions and shapes", baseLayer: "Ordinary typing layer" };
      const lines = review.compatibility.differences.map(difference => `${fields[difference.field] ?? difference.field}: ${["keyCount", "controller", "qmkKeyboard", "layout"].includes(difference.field) ? `${difference.current ?? "not saved"} → ${difference.imported ?? "not declared"}` : "differs from the saved layout"}.`);
      lines.push(review.workflow.changed ? `Workflow changes from ${review.workflow.current?.name ?? "none"} to ${review.workflow.imported.name}.` : "The saved workflow stays the same.");
      lines.push(...review.warnings);
      $("portable-import-changes").replaceChildren(...lines.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
      $("portable-import-effects").textContent = `${review.localConnections.disconnectedRoleBindings} local control connections will be cleared. Current mode (${modeNames[state.mode]}) and accounts stay as they are. Keyboard firmware and installed shortcuts are unchanged; reconnect imported roles deliberately.`;
      $("confirm-profile-import").textContent = review.localConnections.disconnectedRoleBindings ? "Import and clear local connections" : "Import definitions";
      $("profile-dialog").close(); $("portable-import-dialog").showModal();
    });
  }
  $("plan-file").addEventListener("change", async event => {
    const file = event.target.files?.[0], version = generation;
    if (!file) return;
    try {
      if (file.size > 240 * 1024) throw Error("Choose a portable profile smaller than 240 KiB. Keep the original file.");
      const document = JSON.parse(await file.text());
      if (version === generation) await reviewImport(document);
    } catch (error) { notify(error.message); $("portability-status").textContent = error.message; }
    finally { event.target.value = ""; }
  });
  $("confirm-profile-import").addEventListener("click", () => run(async () => {
    const review = pendingImport; pendingImport = null;
    if (!review || !current(review)) throw Error("Review this profile again in the current workspace.");
    const result = await request("/api/suite/profile/package/import", { compartment: review.compartment, document: review.document, reviewId: review.reviewId });
    if (!current(review)) return;
    loadProfile(result.profile); $("portable-import-dialog").close(); await refresh();
    $("portability-status").textContent = `Imported ${result.profile.name}. ${result.roleBindingsCleared} local control connections cleared. Choose their targets before using them.`;
    notify($("portability-status").textContent);
  }));
  $("cancel-profile-import").addEventListener("click", () => $("portable-import-dialog").close());
  $("portable-import-dialog").addEventListener("close", () => { pendingImport = null; controls(); });

  $("export-profile-settings").addEventListener("click", () => $("export-json").click());
  $("import-profile-settings").addEventListener("click", () => $("profile-dialog").showModal());
  $("export-json").addEventListener("click", () => run(async () => {
    const context = await prepare();
    const result = await request("/api/suite/profile/package/export", { compartment: context.compartment });
    if (!current(context)) return;
    pendingExport = { ...context, document: result.document };
    $("portable-export-name").textContent = result.document.name;
    $("portable-mode").value = result.document.assumptions.modePreference;
    meaningRows = result.document.plan.actions.map(action => {
      const meaning = result.document.intentAssignments.find(row => row.actionId === action.id), row = document.createElement("div"), label = document.createElement("strong"), roleLabel = document.createElement("label"), intentLabel = document.createElement("label"), role = document.createElement("select"), intent = document.createElement("select");
      row.className = "portable-meaning"; label.textContent = action.label; roleLabel.textContent = "Role"; intentLabel.textContent = "Meaning";
      role.append(option("", "No portable role"), ...result.document.workflow.roles.map(r => option(r.id, r.label)));
      intent.append(...Object.entries(meanings).map(([value, text]) => option(value, text)));
      role.value = meaning?.roleId ?? ""; intent.value = meaning?.intent ?? "";
      roleLabel.append(role); intentLabel.append(intent); row.append(label, roleLabel, intentLabel);
      return { actionId: action.id, row, role, intent };
    });
    $("portable-meanings").replaceChildren(...meaningRows.map(row => row.row));
    $("portable-export-status").textContent = result.metadataStatus === "preserved" ? "Previously reviewed portable meanings are preserved. Check them before downloading." : "Review the meaning of each control. Layout-only controls retain their key assignments without claiming a connected tool.";
    $("portable-export-dialog").showModal();
  }));
  $("portable-recommended-meanings").addEventListener("click", () => {
    if (!pendingExport) return;
    const roles = pendingExport.document.workflow.roles;
    for (const row of meaningRows) {
      const intent = row.actionId.replace(/^task-/, ""), role = intent === "review" ? "reviewer" : "builder";
      if (["resume", "status", "review", "handoff"].includes(intent) && roles.some(r => r.id === role)) { row.role.value = role; row.intent.value = intent; }
    }
    $("portable-export-status").textContent = "The four standard controls have their recommended meanings. Review the rows before downloading.";
  });
  $("download-portable-profile").addEventListener("click", () => run(async () => {
    const review = pendingExport;
    if (!review || !current(review)) throw Error("Review this export again in the current workspace.");
    const intentAssignments = meaningRows.flatMap(row => {
      if (!row.role.value && !row.intent.value) return [];
      if (!row.role.value || !row.intent.value) throw Error("Choose both a role and a meaning, or leave both empty for a layout-only control.");
      return [{ actionId: row.actionId, roleId: row.role.value, intent: row.intent.value }];
    });
    const result = await request("/api/suite/profile/package/export", { compartment: review.compartment, preferences: { modePreference: $("portable-mode").value, intentAssignments } });
    if (!current(review)) return;
    if (JSON.stringify(result.document.plan) !== JSON.stringify(review.document.plan) || JSON.stringify(result.document.workflow) !== JSON.stringify(review.document.workflow) || result.document.id !== review.document.id || result.document.name !== review.document.name) throw Error("The saved layout changed after review. Open a fresh export before downloading.");
    download("switchyard-profile.json", JSON.stringify(result.document, null, 2) + "\n", "application/json");
    $("portable-export-dialog").close(); notify("Portable profile download requested. It excludes local accounts and connections.");
  }));
  $("cancel-profile-export").addEventListener("click", () => $("portable-export-dialog").close());
  $("portable-export-dialog").addEventListener("close", () => { pendingExport = null; controls(); });

  $("export-legends").addEventListener("click", () => run(async () => {
    const context = await prepare(), format = $("legend-format").value;
    const labels = Object.fromEntries(printRows.filter(row => row.input.value.trim()).map(row => [row.actionId, row.input.value.trim()]));
    const result = await request("/api/suite/profile/legends/export", { compartment: context.compartment, options: { format, page: format === "template-svg" ? Number($("legend-page").value) - 1 : 0, labels } });
    if (!current(context)) return;
    const bytes = new TextEncoder().encode(result.content), hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (!current(context)) return;
    if (hash !== result.sha256) throw Error("The print export did not verify. No file was downloaded.");
    download(result.filename, result.content, result.mimeType);
    $("legend-status").textContent = `${result.manifest.name}: ${result.manifest.assignments.length} controls, ${result.manifest.unassigned.length} unassigned. Download requested. Print A4 at actual size and measure the 15 mm reference before cutting.`;
  }));
  $("legend-format").addEventListener("change", () => { $("legend-page-wrap").hidden = $("legend-format").value !== "template-svg"; });
  document.addEventListener("switchyard-workspace-changing", () => { state = null; invalidate(); });
  document.addEventListener("switchyard-plan-change", invalidate);
  document.addEventListener("switchyard-compartment-state", event => { state = event.detail; invalidate(); });
  document.addEventListener("switchyard-profile-loaded", () => { printLabels(); controls(); });
  controls();
  return { reviewImport };
}
