import { analyzePlan, attachQmkBaseLayer, consequences, families, modifiers, newPlan, parseBoardProfile, parsePlan, parseQmkInfo, parseStudyReport, planMarkdown, studySuggestions } from "/model.mjs";

const $ = (id) => document.getElementById(id);
let plan = null;
let pendingInfo = null;
let pendingKeymap = null;
let selectedActionId = null;
let nextAction = 1;
let noticeTimer;

function option(value, label = value) { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
function notify(message) {
  const surface = $("notice"); surface.textContent = message; surface.classList.add("visible");
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => surface.classList.remove("visible"), 6000);
}
function shortNumber(value) { return Number.isFinite(value) ? value.toFixed(1) : "0.0"; }
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
  render();
}
function importInfo(info) {
  const layouts = Object.entries(info?.layouts ?? {}).filter(([name, value]) => /^LAYOUT[A-Za-z0-9_]*$/.test(name) && Array.isArray(value?.layout)).map(([name]) => name);
  if (!layouts.length) throw new Error("That file has no supported QMK physical layout. Vial definitions use a different format.");
  pendingInfo = info;
  pendingKeymap = null;
  const picker = $("layout-picker"); picker.replaceChildren(option("", "Choose an exact layout"), ...layouts.map((name) => option(name)));
  $("layout-picker-wrap").hidden = layouts.length === 1;
  if (layouts.length === 1) loadInfo(info, layouts[0]);
  else { plan = null; render(); notify("Choose the exact physical layout listed in your QMK info.json."); }
}
function importKeymap(keymap) {
  if (!plan) throw new Error("Load the exact QMK info.json and select a physical layout first.");
  const profile = attachQmkBaseLayer(plan.profile, keymap);
  pendingKeymap = keymap;
  plan = { ...plan, profile };
  render(); notify("Recorded the exact base layer so ordinary-key impact can be checked.");
}
function importSaved(value) {
  let imported;
  if (value?.schema === "sxsy-agentic-layout-plan/v1") imported = parsePlan(value);
  else imported = newPlan(parseBoardProfile(value));
  plan = imported;
  pendingInfo = null; pendingKeymap = null; selectedActionId = null;
  nextAction = plan.actions.length + 1;
  $("layout-picker-wrap").hidden = true;
  render();
}
function importStudy(value) {
  if (!plan) throw new Error("Load a keyboard profile before importing workflow observations.");
  plan.study = parseStudyReport(value);
  render(); notify("Aggregate observations loaded. Choose a suggestion to prepare an action for review.");
}

function keyboardPreview() {
  const surface = $("keyboard"); surface.replaceChildren();
  if (!plan) { surface.style.height = "36px"; return; }
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
    button.className = `key${assigned.length ? " has-action" : ""}`;
    button.style.left = `${key.x * unit}px`; button.style.top = `${key.y * unit}px`;
    button.style.width = `${key.w * unit - 3}px`; button.style.height = `${key.h * unit - 3}px`;
    const title = document.createElement("span"); title.textContent = key.label;
    const hint = document.createElement("small"); hint.textContent = key.baseKeycode ?? "base ?";
    button.append(title, hint);
    button.title = `${key.label} · matrix ${key.matrix.join(",")} · ${key.baseKeycode ?? "base layer unknown"}${assigned.length ? ` · ${assigned.map((action) => action.label).join(", ")}` : ""}`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => {
      if (!selectedActionId) { notify("Choose Pick on an action row, then click a physical key."); return; }
      const action = plan.actions.find((item) => item.id === selectedActionId);
      if (!action) return;
      action.binding = { keyId: key.id, modifier: action.binding?.modifier ?? "none" };
      selectedActionId = null; render();
    });
    inner.append(button);
  }
  surface.append(inner);
  surface.style.height = `${Math.ceil(height * unit + 32)}px`;
}

function actionRows() {
  const body = $("actions-body"); body.replaceChildren();
  if (!plan) return;
  for (const action of [...plan.actions].sort((a, b) => b.frequencyPerDay * b.secondsSaved - a.frequencyPerDay * a.secondsSaved)) {
    const row = document.createElement("tr");
    const label = document.createElement("td"); label.textContent = action.label;
    const meta = document.createElement("small"); meta.textContent = `${action.family} · ${action.consequence}${action.confirmation ? " · confirmation" : ""}`; label.append(meta);
    const priority = document.createElement("td"); priority.textContent = `${shortNumber(action.frequencyPerDay * action.secondsSaved / 60)} min/day`;
    const physical = document.createElement("td");
    const keySelect = document.createElement("select"); keySelect.setAttribute("aria-label", `Physical key for ${action.label}`);
    keySelect.append(option("", "Unassigned"), ...plan.profile.keys.map((key) => option(key.id, `${key.label} (${key.matrix.join(",")})`)));
    keySelect.value = action.binding?.keyId ?? "";
    keySelect.addEventListener("change", () => { action.binding = keySelect.value ? { keyId: keySelect.value, modifier: action.binding?.modifier ?? "none" } : null; render(); });
    physical.append(keySelect);
    const modifier = document.createElement("td");
    const modSelect = document.createElement("select"); modSelect.setAttribute("aria-label", `Modifier for ${action.label}`);
    modSelect.append(...modifiers.map((name) => option(name, name.replaceAll("_", " + "))));
    modSelect.value = action.binding?.modifier ?? "none";
    modSelect.disabled = !action.binding;
    modSelect.addEventListener("change", () => { if (action.binding) { action.binding = { ...action.binding, modifier: modSelect.value }; render(); } });
    modifier.append(modSelect);
    const actions = document.createElement("td");
    const pick = document.createElement("button"); pick.type = "button"; pick.className = "secondary"; pick.textContent = selectedActionId === action.id ? "Picking…" : "Pick";
    pick.setAttribute("aria-label", `Pick a key on the board for ${action.label}`);
    pick.addEventListener("click", () => { selectedActionId = action.id; render(); notify(`Click a physical key to assign ${action.label}.`); });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove"; remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${action.label}`);
    remove.addEventListener("click", () => { plan.actions = plan.actions.filter((item) => item.id !== action.id); if (selectedActionId === action.id) selectedActionId = null; render(); });
    actions.append(pick, " ", remove);
    row.append(label, priority, physical, modifier, actions); body.append(row);
  }
}

function studyCards() {
  const surface = $("study-suggestions"); surface.replaceChildren();
  $("study-file").disabled = !plan;
  $("sample-study-button").disabled = !plan;
  if (!plan?.study) { $("study-summary").textContent = "Import an aggregate report to see evidence-backed starting points. No raw event log is needed."; return; }
  const report = plan.study;
  $("study-summary").textContent = `${report.events} deliberate events across ${report.sessionsCompleted} completed of ${report.sessionsStarted} started sessions. Suggestions are starter labels, not inferred exact intents or daily rates.`;
  for (const suggestion of studySuggestions(report)) {
    const card = document.createElement("div"); card.className = "suggestion";
    const details = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = suggestion.label;
    const stats = document.createElement("small");
    stats.textContent = `${suggestion.count} ${suggestion.kind} events · ${suggestion.retriesOrBlocked} retry/blocked · friction ${suggestion.averageFriction.toFixed(1)}/5${suggestion.perCompletedSession === null ? "" : ` · ${suggestion.perCompletedSession.toFixed(1)}/completed session`}`;
    details.append(title, stats);
    const use = document.createElement("button"); use.type = "button"; use.className = "secondary"; use.textContent = "Use as draft";
    use.setAttribute("aria-label", `Use ${suggestion.label} as draft`);
    use.addEventListener("click", () => {
      $("action-label").value = suggestion.label;
      $("action-family").value = suggestion.family;
      $("action-consequence").value = "read_only";
      $("action-frequency").value = "0";
      $("action-savings").value = "0";
      $("action-confirmation").checked = false;
      $("action-label").focus();
      notify("Draft prepared. Enter your own daily frequency and time saving, then add the action.");
    });
    card.append(details, use); surface.append(card);
  }
}

function render() {
  const board = $("board-summary");
  if (!plan) board.textContent = "Load a board to begin. The sample is illustrative and is not a Model F matrix.";
  else board.textContent = `${plan.profile.name} · ${plan.profile.layout} · ${plan.profile.keys.length} keys · controller ${plan.profile.controller} · ${plan.profile.keys.every((key) => key.baseKeycode !== null) ? "base typing layer recorded" : "base typing layer incomplete"}`;
  keyboardPreview(); actionRows(); studyCards();
  const list = $("issues"); list.replaceChildren();
  if (!plan) { $("review-summary").textContent = "No plan loaded."; }
  else {
    const review = analyzePlan(plan);
    $("review-summary").textContent = `${review.readyForReview ? "Ready for human review" : "Needs more work"} · ${plan.actions.length} actions · ${shortNumber(review.estimatedMinutesPerDay)} estimated minutes saved per day.`;
    for (const issue of review.issues) { const item = document.createElement("li"); item.className = issue.severity; item.textContent = `${issue.severity.toUpperCase()}: ${issue.message}`; list.append(item); }
    if (!review.issues.length) { const item = document.createElement("li"); item.textContent = "No structural issues found. Ergonomics and physical behavior still need review."; list.append(item); }
  }
  $("export-json").disabled = !plan;
  $("export-markdown").disabled = !plan;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

for (const family of families) $("action-family").append(option(family, family.replaceAll("_", " ")));
for (const consequence of consequences) $("action-consequence").append(option(consequence, consequence.replaceAll("_", " ")));
fileInput("info-file", importInfo);
fileInput("keymap-file", importKeymap);
fileInput("plan-file", importSaved);
fileInput("study-file", importStudy);
$("layout-picker").addEventListener("change", (event) => { if (event.target.value && pendingInfo) { try { loadInfo(pendingInfo, event.target.value); } catch (error) { notify(error.message); } } });
$("sample-button").addEventListener("click", async () => {
  try {
    const [info, keymap] = await Promise.all([fetch("/sample-info.json"), fetch("/sample-keymap.json")]);
    pendingInfo = await info.json(); pendingKeymap = await keymap.json();
    $("layout-picker-wrap").hidden = true; loadInfo(pendingInfo, "LAYOUT_sample");
    notify("Illustrative sample loaded. Import the exact profile for your keyboard before relying on a plan.");
  } catch (error) { notify(error.message); }
});
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
    while (plan.actions.some((item) => item.id === `action-${nextAction}`)) nextAction += 1;
    const action = { id: `action-${nextAction++}`, label, family: $("action-family").value,
      consequence: $("action-consequence").value, confirmation: $("action-confirmation").checked,
      frequencyPerDay, secondsSaved, binding: null };
    const candidate = parsePlan({ ...plan, actions: [...plan.actions, action] });
    plan = candidate; $("action-label").value = ""; render();
  } catch (error) { notify(error.message); }
});
$("export-json").addEventListener("click", () => { if (plan) download("agentic-layout-plan.json", `${JSON.stringify(parsePlan(plan), null, 2)}\n`, "application/json"); });
$("export-markdown").addEventListener("click", () => { if (plan) download("agentic-layout-review.md", planMarkdown(plan), "text/markdown"); });
render();
