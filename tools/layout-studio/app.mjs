import { analyzePlan, attachQmkBaseLayer, consequences, families, modifiers, newPlan, parseBoardProfile, parsePlan, parseQmkInfo, parseStudyReport, planMarkdown, studySuggestions } from "/model.mjs";

const $ = (id) => document.getElementById(id);
let plan = null;
let pendingInfo = null;
let pendingKeymap = null;
let selectedActionId = null;
let editingActionId = null;
let nextAction = 1;
let noticeTimer;
let dirty = false;

function option(value, label = value) { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function notify(message, undo) {
  const surface = $("notice"); surface.replaceChildren(document.createTextNode(message));
  if (undo) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = "Undo";
    button.addEventListener("click", () => { undo(); surface.classList.remove("visible"); });
    surface.append(button);
  }
  surface.classList.add("visible");
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => surface.classList.remove("visible"), 6000);
}
function shortNumber(value) { return Number.isFinite(value) ? value.toFixed(1) : "0.0"; }
function markDirty() { dirty = true; $("save-status").textContent = "Changes in this tab are unsaved. Download the editable plan to keep them."; }
function mayReplacePlan() { return !dirty || window.confirm("Replace the current unsaved layout? Download its editable plan first if you want to keep it."); }
function updateConsequenceHelp() {
  const help = {
    navigation: "Navigation only changes what you see or focus.",
    read_only: "Read only actions inspect status or evidence without changing a target.",
    mutating: "Mutating actions change state. Plan a visible confirmation step.",
    high_consequence: "High consequence actions require an explicit confirmation before any effect."
  };
  $("consequence-help").textContent = help[$("action-consequence").value] ?? "Choose the action's impact.";
}
function resetEditor() {
  editingActionId = null;
  $("action-form").reset();
  $("action-frequency").value = "5";
  $("action-savings").value = "10";
  $("form-title").textContent = "Add an action";
  $("action-submit").textContent = "Add action";
  $("action-cancel").hidden = true;
  updateConsequenceHelp();
}
function fileInput(id, callback) {
  $(id).addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("Select a JSON file smaller than 1 MiB.");
      await callback(JSON.parse(await file.text()));
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    event.target.value = "";
  });
}
function loadInfo(info, layout) {
  let profile = parseQmkInfo(info, layout);
  if (pendingKeymap) profile = attachQmkBaseLayer(profile, pendingKeymap);
  plan = newPlan(profile);
  nextAction = 1;
  selectedActionId = null;
  resetEditor(); dirty = false;
  render();
}
function importInfo(info) {
  if (!mayReplacePlan()) return;
  const layouts = Object.entries(info?.layouts ?? {}).filter(([name, value]) => /^LAYOUT[A-Za-z0-9_]*$/.test(name) && Array.isArray(value?.layout)).map(([name]) => name);
  if (!layouts.length) throw new Error("That file has no supported QMK physical layout. Vial definitions use a different format.");
  pendingInfo = info;
  pendingKeymap = null;
  const picker = $("layout-picker"); picker.replaceChildren(option("", "Choose an exact layout"), ...layouts.map((name) => option(name)));
  $("layout-picker-wrap").hidden = layouts.length === 1;
  if (layouts.length === 1) loadInfo(info, layouts[0]);
  else { $("keymap-file").disabled = true; notify("Choose the exact physical layout listed in your QMK info.json. Your current plan remains open until you choose."); }
}
function importKeymap(keymap) {
  if (!plan) throw new Error("Load the exact QMK info.json and select a physical layout first.");
  const profile = attachQmkBaseLayer(plan.profile, keymap);
  pendingKeymap = keymap;
  plan = { ...plan, profile };
  markDirty();
  render(); notify("Recorded the exact base layer so ordinary-key impact can be checked.");
}
function importSaved(value) {
  if (!mayReplacePlan()) return;
  let imported;
  if (value?.schema === "sxsy-agentic-layout-plan/v1") imported = parsePlan(value);
  else imported = newPlan(parseBoardProfile(value));
  plan = imported;
  pendingInfo = null; pendingKeymap = null; selectedActionId = null;
  nextAction = plan.actions.length + 1;
  resetEditor(); dirty = false;
  $("layout-picker-wrap").hidden = true;
  render();
}
function importStudy(value) {
  if (!plan) throw new Error("Load a keyboard profile before importing workflow observations.");
  plan.study = parseStudyReport(value);
  markDirty();
  render(); notify("Aggregate observations loaded. Choose a suggestion to prepare an action for review.");
}

function keyboardPreview() {
  const surface = $("keyboard"); surface.replaceChildren();
  if (!plan) { surface.style.height = "120px"; const empty = document.createElement("div"); empty.className = "board-empty"; empty.textContent = "Your keyboard will appear here."; surface.append(empty); $("pick-help").classList.remove("active"); return; }
  const width = Math.max(...plan.profile.keys.map((key) => key.x + key.w));
  const height = Math.max(...plan.profile.keys.map((key) => key.y + key.h));
  const unit = Math.max(30, Math.min(55, 900 / width));
  const inner = document.createElement("div");
  inner.style.position = "relative";
  inner.style.width = `${Math.ceil(width * unit + 8)}px`;
  inner.style.height = `${Math.ceil(height * unit + 8)}px`;
  for (const key of plan.profile.keys) {
    const assigned = plan.actions.filter((action) => action.binding?.keyId === key.id);
    const button = document.createElement("button"); button.type = "button";
    button.className = `key${assigned.length ? " has-action" : ""}${selectedActionId ? " pick-target" : ""}`;
    button.style.left = `${key.x * unit}px`; button.style.top = `${key.y * unit}px`;
    button.style.width = `${key.w * unit - 3}px`; button.style.height = `${key.h * unit - 3}px`;
    const title = document.createElement("span"); title.textContent = key.label;
    const hint = document.createElement("small"); hint.textContent = key.baseKeycode ?? "base ?";
    button.append(title, hint);
    button.title = `${key.label} · matrix ${key.matrix.join(",")} · ${key.baseKeycode ?? "base layer unknown"}${assigned.length ? ` · ${assigned.map((action) => action.label).join(", ")}` : ""}`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => {
      if (!selectedActionId) { notify("Choose Pick on board in an action card, then select a physical key."); return; }
      const action = plan.actions.find((item) => item.id === selectedActionId);
      if (!action) return;
      action.binding = { keyId: key.id, modifier: action.binding?.modifier ?? "none" };
      selectedActionId = null; markDirty(); render();
    });
    inner.append(button);
  }
  surface.append(inner);
  surface.style.height = `${Math.ceil(height * unit + 32)}px`;
  $("pick-help").textContent = selectedActionId ? `Pick a key for ${plan.actions.find((action) => action.id === selectedActionId)?.label ?? "the selected action"}. Press Escape to cancel.` : "Choose “Pick on board” in an action card, then select a key here. You can also use the dropdown in its card.";
  $("pick-help").classList.toggle("active", Boolean(selectedActionId));
}

function actionRows() {
  const body = $("actions-body"); body.replaceChildren();
  if (!plan) return;
  for (const action of [...plan.actions].sort((a, b) => b.frequencyPerDay * b.secondsSaved - a.frequencyPerDay * a.secondsSaved)) {
    const card = document.createElement("article"); card.className = `action-card${selectedActionId === action.id ? " selected" : ""}`;
    const head = document.createElement("div"); head.className = "action-card-head";
    const identity = document.createElement("div");
    const label = document.createElement("h3"); label.textContent = action.label;
    const meta = document.createElement("p"); meta.textContent = `${action.family.replaceAll("_", " ")} · ${action.consequence.replaceAll("_", " ")}${action.confirmation ? " · confirmation planned" : ""}`;
    identity.append(label, meta);
    const priority = document.createElement("span"); priority.className = "priority";
    priority.textContent = `${shortNumber(action.frequencyPerDay * action.secondsSaved / 60)} min/day est.`;
    head.append(identity, priority);
    const binding = document.createElement("div"); binding.className = "binding-grid";
    const physical = document.createElement("label"); physical.textContent = "Physical key";
    const keySelect = document.createElement("select"); keySelect.id = `physical-${action.id}`; keySelect.setAttribute("aria-label", `Physical key for ${action.label}`);
    keySelect.append(option("", "Unassigned"), ...plan.profile.keys.map((key) => option(key.id, `${key.label} (${key.matrix.join(",")})`)));
    keySelect.value = action.binding?.keyId ?? "";
    keySelect.addEventListener("change", () => { action.binding = keySelect.value ? { keyId: keySelect.value, modifier: action.binding?.modifier ?? "none" } : null; markDirty(); render(); document.getElementById(`physical-${action.id}`)?.focus(); });
    physical.append(keySelect);
    const modifier = document.createElement("label"); modifier.textContent = "Modifier";
    const modSelect = document.createElement("select"); modSelect.id = `modifier-${action.id}`; modSelect.setAttribute("aria-label", `Modifier for ${action.label}`);
    modSelect.append(...modifiers.map((name) => option(name, name.replaceAll("_", " + "))));
    modSelect.value = action.binding?.modifier ?? "none";
    modSelect.disabled = !action.binding;
    modSelect.addEventListener("change", () => { if (action.binding) { action.binding = { ...action.binding, modifier: modSelect.value }; markDirty(); render(); document.getElementById(`modifier-${action.id}`)?.focus(); } });
    modifier.append(modSelect);
    const pick = document.createElement("button"); pick.type = "button"; pick.className = "secondary"; pick.textContent = selectedActionId === action.id ? "Cancel pick" : "Pick on board";
    pick.setAttribute("aria-label", `Pick a key on the board for ${action.label}`);
    pick.setAttribute("aria-pressed", String(selectedActionId === action.id));
    pick.addEventListener("click", () => { selectedActionId = selectedActionId === action.id ? null : action.id; render(); if (selectedActionId) { $("board").scrollIntoView({ block: "start" }); $("keyboard").querySelector("button")?.focus(); notify(`Select a physical key for ${action.label}. Press Escape to cancel.`); } });
    binding.append(physical, modifier, pick);
    const actions = document.createElement("div"); actions.className = "card-actions";
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "text-button"; edit.textContent = "Edit action";
    edit.setAttribute("aria-label", `Edit ${action.label}`);
    edit.addEventListener("click", () => {
      editingActionId = action.id;
      $("action-label").value = action.label;
      $("action-family").value = action.family;
      $("action-consequence").value = action.consequence;
      updateConsequenceHelp();
      $("action-frequency").value = String(action.frequencyPerDay);
      $("action-savings").value = String(action.secondsSaved);
      $("action-confirmation").checked = action.confirmation;
      $("form-title").textContent = "Edit action";
      $("action-submit").textContent = "Save changes";
      $("action-cancel").hidden = false;
      $("mapping").scrollIntoView({ block: "start" });
      $("action-label").focus();
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove"; remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${action.label}`);
    remove.addEventListener("click", () => {
      const index = plan.actions.findIndex((item) => item.id === action.id);
      plan.actions = plan.actions.filter((item) => item.id !== action.id);
      if (selectedActionId === action.id) selectedActionId = null;
      if (editingActionId === action.id) resetEditor();
      markDirty(); render();
      notify(`${action.label} removed.`, () => { plan.actions.splice(index, 0, action); markDirty(); render(); notify(`${action.label} restored.`); });
    });
    actions.append(edit, remove);
    card.append(head, binding, actions); body.append(card);
  }
}

function studyCards() {
  const surface = $("study-suggestions"); surface.replaceChildren();
  $("study-file").disabled = !plan;
  $("sample-study-button").disabled = !plan;
  if (!plan?.study) {
    $("study-summary").textContent = plan ? "Import an aggregate report to see starting points, or skip this step and add an action below." : "Load a keyboard first, then import a report or try the sample.";
    const empty = document.createElement("div"); empty.className = "empty-state"; empty.textContent = "Suggestions will appear here after a report is loaded."; surface.append(empty);
    return;
  }
  const report = plan.study;
  $("study-summary").textContent = `${report.events} deliberate events across ${report.sessionsCompleted} completed of ${report.sessionsStarted} started sessions. Suggestions are starter labels, not inferred exact intents or daily rates.`;
  for (const suggestion of studySuggestions(report)) {
    const card = document.createElement("div"); card.className = "suggestion";
    const details = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = suggestion.label;
    const stats = document.createElement("small");
    stats.textContent = `${suggestion.count} ${suggestion.kind} ${suggestion.count === 1 ? "event" : "events"} · ${suggestion.retriesOrBlocked} retry/blocked · friction ${suggestion.averageFriction.toFixed(1)}/5${suggestion.perCompletedSession === null ? "" : ` · ${suggestion.perCompletedSession.toFixed(1)} per completed session`}`;
    details.append(title, stats);
    const use = document.createElement("button"); use.type = "button"; use.className = "secondary"; use.textContent = "Use as draft";
    use.setAttribute("aria-label", `Use ${suggestion.label} as draft`);
    use.addEventListener("click", () => {
      resetEditor();
      $("action-label").value = suggestion.label;
      $("action-family").value = suggestion.family;
      $("action-consequence").value = "read_only";
      updateConsequenceHelp();
      $("action-frequency").value = "0";
      $("action-savings").value = "0";
      $("action-confirmation").checked = false;
      $("mapping").scrollIntoView({ block: "start" });
      $("action-label").focus();
      notify("Draft prepared. Enter your own daily frequency and time saving, then add the action.");
    });
    card.append(details, use); surface.append(card);
  }
}

function render() {
  const board = $("board-summary");
  if (!plan) board.textContent = "Load a board to begin.";
  else board.textContent = `${plan.profile.name} · ${plan.profile.layout} · ${plan.profile.keys.length} keys · ${plan.profile.controller} controller`;
  const baseKnown = Boolean(plan?.profile.keys.every((key) => key.baseKeycode !== null));
  $("board-base-badge").textContent = !plan ? "Awaiting keyboard" : baseKnown ? "Typing layer recorded" : "Typing layer needed";
  $("board-base-badge").className = `status-pill${plan ? baseKnown ? " good" : " warn" : ""}`;
  $("keymap-file").disabled = !plan || plan.profile.source !== "qmk-info";
  $("action-submit").disabled = !plan;
  $("action-count").textContent = `${plan?.actions.length ?? 0} ${plan?.actions.length === 1 ? "action" : "actions"}`;
  $("action-empty").hidden = Boolean(plan?.actions.length);
  $("action-empty").textContent = plan ? "Add your first action here. A workflow report is optional." : "Choose a keyboard, then add your first action or use a workflow suggestion.";
  $("progress-board").className = plan ? "done" : "current";
  $("progress-patterns").className = plan?.study ? "done" : "";
  $("progress-mapping").className = plan?.actions.length ? "done" : plan ? "current" : "";
  keyboardPreview(); actionRows(); studyCards();
  const list = $("issues"); list.replaceChildren();
  if (!plan) { $("review-summary").textContent = "No plan loaded."; const item = document.createElement("li"); item.textContent = "Load a keyboard to start reviewing."; list.append(item); }
  else {
    const review = analyzePlan(plan);
    $("progress-review").className = review.readyForReview ? "done" : "";
    $("review-summary").textContent = `${review.readyForReview ? "Ready for human review" : "Needs more work"} · ${plan.actions.length} ${plan.actions.length === 1 ? "action" : "actions"} · ${shortNumber(review.estimatedMinutesPerDay)} estimated min/day`;
    for (const issue of review.issues) { const item = document.createElement("li"); item.className = issue.severity; item.textContent = `${issue.severity.toUpperCase()}: ${issue.message}`; list.append(item); }
    if (!review.issues.length) { const item = document.createElement("li"); item.textContent = "No structural issues found. Ergonomics and physical behavior still need review."; list.append(item); }
  }
  if (!plan) $("progress-review").className = "";
  $("export-json").disabled = !plan;
  $("export-markdown").disabled = !plan;
  $("copy-json").disabled = !plan;
  if (!dirty) $("save-status").textContent = plan?.actions.length ? "Current plan is loaded. Download a fresh copy after any changes." : "Your work stays in this tab until you download the plan.";
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

for (const family of families) $("action-family").append(option(family, family.replaceAll("_", " ")));
for (const consequence of consequences) $("action-consequence").append(option(consequence, consequence.replaceAll("_", " ")));
$("action-consequence").addEventListener("change", updateConsequenceHelp);
fileInput("info-file", importInfo);
fileInput("keymap-file", importKeymap);
fileInput("plan-file", importSaved);
fileInput("study-file", importStudy);
$("layout-picker").addEventListener("change", (event) => { if (event.target.value && pendingInfo) { try { loadInfo(pendingInfo, event.target.value); } catch (error) { notify(error.message); } } });
async function loadSample() {
  try {
    if (!mayReplacePlan()) return;
    const [info, keymap] = await Promise.all([fetch("/sample-info.json"), fetch("/sample-keymap.json")]);
    pendingInfo = await info.json(); pendingKeymap = await keymap.json();
    $("layout-picker-wrap").hidden = true; loadInfo(pendingInfo, "LAYOUT_sample");
    $("board").scrollIntoView({ block: "start" });
    notify("Illustrative sample loaded. Import the exact profile for your keyboard before relying on a plan.");
  } catch (error) { notify(error.message); }
}
$("sample-button").addEventListener("click", loadSample);
$("hero-sample-button").addEventListener("click", loadSample);
$("sample-study-button").addEventListener("click", async () => {
  try { importStudy(await (await fetch("/sample-study-report.json")).json()); }
  catch (error) { notify(error.message); }
});
$("action-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!plan) { notify("Load a keyboard profile first."); return; }
  try {
    const label = $("action-label").value.trim();
    const frequencyPerDay = Number($("action-frequency").value);
    const secondsSaved = Number($("action-savings").value);
    while (!editingActionId && plan.actions.some((item) => item.id === `action-${nextAction}`)) nextAction += 1;
    const oldAction = editingActionId ? plan.actions.find((item) => item.id === editingActionId) : null;
    if (editingActionId && !oldAction) throw new Error("That action is no longer available to edit.");
    const action = { id: oldAction?.id ?? `action-${nextAction++}`, label, family: $("action-family").value,
      consequence: $("action-consequence").value, confirmation: $("action-confirmation").checked,
      frequencyPerDay, secondsSaved, binding: oldAction?.binding ?? null };
    const candidate = parsePlan({ ...plan, actions: oldAction ? plan.actions.map((item) => item.id === oldAction.id ? action : item) : [...plan.actions, action] });
    plan = candidate; resetEditor(); markDirty(); render();
    notify(oldAction ? "Action updated." : "Action added. Choose a physical key and modifier in its card.");
  } catch (error) { notify(error.message); }
});
$("action-cancel").addEventListener("click", resetEditor);
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && selectedActionId) { selectedActionId = null; render(); notify("Key selection cancelled."); } });
window.addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
$("export-json").addEventListener("click", () => { if (plan) { download("agentic-layout-plan.json", `${JSON.stringify(parsePlan(plan), null, 2)}\n`, "application/json"); $("save-status").textContent = "Download requested. Confirm the file exists before closing this tab."; } });
$("export-markdown").addEventListener("click", () => { if (plan) download("agentic-layout-review.md", planMarkdown(plan), "text/markdown"); });
$("copy-json").addEventListener("click", async () => {
  if (!plan) return;
  try {
    await navigator.clipboard.writeText(`${JSON.stringify(parsePlan(plan), null, 2)}\n`);
    $("save-status").textContent = "Plan JSON copied. Paste it into a local file to keep it.";
    notify("Plan JSON copied to clipboard.");
  } catch { notify("Clipboard access was blocked. Use Download editable plan instead."); }
});
render();
