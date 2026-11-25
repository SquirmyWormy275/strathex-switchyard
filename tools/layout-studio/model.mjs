/** Offline planning model. It never emits firmware, OS shortcuts, or host actions. */
import { outlinePoints } from "./geometry.mjs";
export const profileSchema = "sxsy-board-profile/v1";
export const planSchema = "sxsy-agentic-layout-plan/v1";
export const modifiers = Object.freeze([
  "none", "shift", "alt", "shift_alt", "ctrl", "ctrl_shift", "ctrl_alt", "ctrl_shift_alt",
  "gui", "gui_shift", "gui_alt", "gui_shift_alt", "gui_ctrl", "gui_ctrl_shift", "gui_ctrl_alt", "gui_ctrl_shift_alt"
]);
export const families = Object.freeze(["routing", "lifecycle", "review", "context", "repository", "authority", "recovery", "other"]);
export const consequences = Object.freeze(["navigation", "read_only", "mutating", "high_consequence"]);
export const controllers = Object.freeze(["unknown", "xwhatsit", "leyden_jar"]);
export const studyKinds = Object.freeze(["resume", "switch", "handoff", "status", "review", "approval", "run", "failure", "recovery", "other"]);
const studyIntents = Object.freeze({
  resume: ["Resume exact task", "lifecycle"], switch: ["Switch agent context", "routing"],
  handoff: ["Prepare agent handoff", "context"], status: ["Inspect agent status", "review"],
  review: ["Review finished work", "review"], approval: ["Inspect pending approval", "authority"],
  run: ["Inspect running work", "review"], failure: ["Inspect failed work", "recovery"],
  recovery: ["Open recovery context", "recovery"], other: ["Review other repeated work", "other"]
});
const idPattern = /^[A-Za-z0-9_.:-]{1,64}$/;
const keycodePattern = /^[_A-Z][_A-Z0-9()|, ]{0,63}$/;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function boundedString(value, label, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\0\r\n]/.test(value)) throw new Error(`${label} must be a short single-line value.`);
  return value.trim();
}
function finite(value, label, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} is outside the supported range.`);
  return value;
}
function keycode(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !keycodePattern.test(value)) throw new Error("Base keycode has an unsupported shape.");
  return value;
}

export function parseBoardProfile(input) {
  const source = object(input, "Board profile");
  if (source.schema !== profileSchema) throw new Error("Board profile schema is unsupported.");
  const name = boundedString(source.name, "Board name");
  const layout = boundedString(source.layout, "Layout name", 80);
  const qmkKeyboard = source.qmkKeyboard == null ? null : boundedString(source.qmkKeyboard, "QMK keyboard ID", 160);
  const controller = source.controller ?? "unknown";
  if (!controllers.includes(controller)) throw new Error("Board controller must be unknown, xwhatsit, or Leyden Jar.");
  if (!Array.isArray(source.keys) || !source.keys.length || source.keys.length > 256) throw new Error("Board profile needs 1–256 keys.");
  const seenIds = new Set();
  const seenMatrix = new Set();
  const keys = source.keys.map((raw, index) => {
    const item = object(raw, `Key ${index + 1}`);
    const id = boundedString(item.id, `Key ${index + 1} ID`, 64);
    if (!idPattern.test(id) || seenIds.has(id)) throw new Error(`Key ID ${id} is invalid or duplicated.`);
    seenIds.add(id);
    const label = boundedString(item.label ?? id, `Key ${id} label`, 32);
    if (!Array.isArray(item.matrix) || item.matrix.length !== 2) throw new Error(`Key ${id} needs a matrix row and column.`);
    const row = finite(item.matrix[0], `Key ${id} row`, 0, 255);
    const column = finite(item.matrix[1], `Key ${id} column`, 0, 255);
    if (!Number.isInteger(row) || !Number.isInteger(column)) throw new Error(`Key ${id} matrix coordinates must be integers.`);
    const matrixId = `${row},${column}`;
    if (seenMatrix.has(matrixId)) throw new Error(`Matrix position ${matrixId} is duplicated.`);
    seenMatrix.add(matrixId);
    const x = finite(item.x, `Key ${id} x`, 0, 256);
    const y = finite(item.y, `Key ${id} y`, 0, 256);
    const w = finite(item.w ?? 1, `Key ${id} width`, 0.25, 16);
    const h = finite(item.h ?? 1, `Key ${id} height`, 0.25, 16);
    const geometry = {};
    if (item.rotation !== undefined) geometry.rotation = finite(item.rotation, `Key ${id} rotation`, -180, 180);
    if (item.shape !== undefined) {
      if (!Array.isArray(item.shape) || item.shape.length < 1 || item.shape.length > 2) throw new Error("A key shape needs one or two connected rectangles.");
      geometry.shape = Object.freeze(item.shape.map((r) => {
        const x = finite(r.x, "Shape x", 0, w), y = finite(r.y, "Shape y", 0, h), rw = finite(r.w, "Shape width", .25, w), rh = finite(r.h, "Shape height", .25, h);
        if (x + rw > w + 1e-6 || y + rh > h + 1e-6) throw new Error("A key shape exceeds its bounding box.");
        return Object.freeze({ x, y, w: rw, h: rh });
      }));
      outlinePoints({ w, h, shape: geometry.shape });
    }
    return Object.freeze({ id, label, matrix: Object.freeze([row, column]), x, y, w, h, ...geometry, baseKeycode: keycode(item.baseKeycode) });
  });
  const evidence = {};
  if (source.evidence !== undefined) { if (!["source-reference", "saved-snapshot", "device-read"].includes(source.evidence)) throw new Error("Unknown typing-layer evidence."); evidence.evidence = source.evidence; }
  return Object.freeze({ schema: profileSchema, name, layout, qmkKeyboard, controller, source: source.source === "qmk-info" ? "qmk-info" : "manual", ...evidence, keys: Object.freeze(keys) });
}

/** QMK info.json provides geometry and matrix identity, not the user's typing layer. */
export function parseQmkInfo(input, layoutName) {
  const info = object(input, "QMK info.json");
  const layouts = object(info.layouts, "QMK layouts");
  const available = Object.keys(layouts).filter((name) => /^LAYOUT[A-Za-z0-9_]*$/.test(name) && Array.isArray(layouts[name]?.layout));
  if (!available.length) throw new Error("QMK info.json has no supported physical layout.");
  const layout = layoutName ?? (available.length === 1 ? available[0] : undefined);
  if (!layout || !available.includes(layout)) throw new Error(`Choose one QMK layout: ${available.join(", ")}.`);
  const rawKeys = layouts[layout].layout;
  const name = boundedString(info.keyboard_name ?? info.keyboard ?? "Imported QMK keyboard", "QMK keyboard name");
  return parseBoardProfile({
    schema: profileSchema, name, layout, qmkKeyboard: typeof info.keyboard === "string" ? info.keyboard : null,
    controller: "unknown", source: "qmk-info",
    keys: rawKeys.map((item, index) => {
      const entry = object(item, `QMK layout key ${index + 1}`);
      return { id: `m${entry.matrix?.[0]}_${entry.matrix?.[1]}`, label: entry.label ?? `Key ${index + 1}`,
        matrix: entry.matrix, x: entry.x, y: entry.y, w: entry.w ?? 1, h: entry.h ?? 1, baseKeycode: null };
    })
  });
}

export function attachQmkBaseLayer(profileInput, keymapInput) {
  const profile = parseBoardProfile(profileInput);
  const keymap = object(keymapInput, "QMK keymap.json");
  if (profile.qmkKeyboard && keymap.keyboard !== profile.qmkKeyboard) throw new Error("The QMK keymap keyboard ID does not match this info.json.");
  if (keymap.layout !== profile.layout || !Array.isArray(keymap.layers) || !Array.isArray(keymap.layers[0])
    || keymap.layers[0].length !== profile.keys.length) throw new Error("The QMK base layer does not match this exact layout and key count.");
  return parseBoardProfile({ ...profile, keys: profile.keys.map((key, index) => ({ ...key, baseKeycode: keymap.layers[0][index] })) });
}

export function newPlan(profileInput) {
  return { schema: planSchema, profile: parseBoardProfile(profileInput), actions: [], study: null };
}

/** Accept only the aggregate report fields. Raw events and task aliases are never retained. */
export function parseStudyReport(input) {
  const source = object(input, "Workflow study report");
  const whole = (value, label, max = 1_000_000) => {
    const result = finite(value, label, 0, max);
    if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a whole number.`);
    return result;
  };
  const sessionsStarted = whole(source.sessionsStarted, "Started sessions");
  const sessionsCompleted = whole(source.sessionsCompleted, "Completed sessions");
  const events = whole(source.events, "Deliberate events");
  if (sessionsCompleted > sessionsStarted) throw new Error("Completed sessions exceed started sessions.");
  const rawKinds = object(source.byKind, "Workflow kinds");
  if (Object.keys(rawKinds).some((kind) => !studyKinds.includes(kind))) throw new Error("Workflow report contains an unknown action kind.");
  const byKind = {};
  let counted = 0;
  for (const kind of studyKinds) {
    if (rawKinds[kind] === undefined) continue;
    const row = object(rawKinds[kind], `${kind} observations`);
    const count = whole(row.count, `${kind} count`);
    const retriesOrBlocked = whole(row.retriesOrBlocked, `${kind} retries`);
    const totalDurationMs = whole(row.totalDurationMs, `${kind} duration`, 3_600_000_000);
    const averageFriction = finite(row.averageFriction, `${kind} friction`, 1, 5);
    if (retriesOrBlocked > count || count === 0) throw new Error(`${kind} observations have inconsistent counts.`);
    counted += count;
    byKind[kind] = { count, retriesOrBlocked, totalDurationMs, averageFriction };
  }
  if (counted !== events) throw new Error("Workflow kind counts do not match the event total.");
  return { sessionsStarted, sessionsCompleted, events, byKind };
}

export function studySuggestions(input) {
  const report = parseStudyReport(input);
  return Object.entries(report.byKind).map(([kind, row]) => ({
    kind, label: studyIntents[kind][0], family: studyIntents[kind][1],
    count: row.count, retriesOrBlocked: row.retriesOrBlocked,
    averageFriction: row.averageFriction,
    perCompletedSession: report.sessionsCompleted ? row.count / report.sessionsCompleted : null,
    opportunity: row.count * row.averageFriction + 2 * row.retriesOrBlocked
  })).sort((a, b) => b.opportunity - a.opportunity);
}

export function parsePlan(input) {
  const source = object(input, "Plan");
  if (source.schema !== planSchema || !Array.isArray(source.actions) || source.actions.length > 256) throw new Error("Plan schema or action count is unsupported.");
  const profile = parseBoardProfile(source.profile);
  const ids = new Set();
  const actions = source.actions.map((raw, index) => {
    const action = object(raw, `Action ${index + 1}`);
    const id = boundedString(action.id, `Action ${index + 1} ID`, 64);
    if (!idPattern.test(id) || ids.has(id)) throw new Error(`Action ID ${id} is invalid or duplicated.`);
    ids.add(id);
    const label = boundedString(action.label, `Action ${id} label`, 80);
    if (!families.includes(action.family)) throw new Error(`Action ${id} has an unsupported family.`);
    if (!consequences.includes(action.consequence)) throw new Error(`Action ${id} has an unsupported consequence.`);
    if (typeof action.confirmation !== "boolean") throw new Error(`Action ${id} confirmation must be explicit.`);
    const frequencyPerDay = finite(action.frequencyPerDay, `Action ${id} frequency`, 0, 1000);
    const secondsSaved = finite(action.secondsSaved, `Action ${id} time saving`, 0, 3600);
    if (!Number.isInteger(frequencyPerDay) || !Number.isInteger(secondsSaved)) throw new Error(`Action ${id} estimates must be whole numbers.`);
    let binding = null;
    if (action.binding !== null && action.binding !== undefined) {
      const value = object(action.binding, `Action ${id} binding`);
      if (typeof value.keyId !== "string" || !profile.keys.some((key) => key.id === value.keyId) || !modifiers.includes(value.modifier)) {
        throw new Error(`Action ${id} binding does not name a key and modifier in this profile.`);
      }
      binding = { keyId: value.keyId, modifier: value.modifier };
    }
    return { id, label, family: action.family, consequence: action.consequence, confirmation: action.confirmation,
      frequencyPerDay, secondsSaved, binding };
  });
  return { schema: planSchema, profile, actions, study: source.study == null ? null : parseStudyReport(source.study) };
}

export function analyzePlan(input) {
  const plan = parsePlan(input);
  const issues = [];
  const occupied = new Map();
  const baseKnown = plan.profile.keys.every((key) => key.baseKeycode !== null);
  if (!plan.actions.length) issues.push({ severity: "warning", message: "Add at least one agent action before reviewing this layout." });
  if (!baseKnown) issues.push({ severity: "warning", message: "The complete ordinary typing layer is not recorded; import the exact QMK keymap.json or enter a reviewed manual profile before judging typing impact." });
  for (const action of plan.actions) {
    if (action.consequence === "high_consequence" && !action.confirmation) issues.push({ severity: "error", message: `${action.label} is high consequence and has no explicit confirmation step.` });
    else if (action.consequence === "mutating" && !action.confirmation) issues.push({ severity: "warning", message: `${action.label} changes state without a planned confirmation step.` });
    if (!action.binding) { issues.push({ severity: "warning", message: `${action.label} has no key assignment.` }); continue; }
    const slot = `${action.binding.keyId}:${action.binding.modifier}`;
    if (occupied.has(slot)) issues.push({ severity: "error", message: `${action.label} and ${occupied.get(slot)} both use ${slot}.` });
    else occupied.set(slot, action.label);
    const key = plan.profile.keys.find((item) => item.id === action.binding.keyId);
    if (action.binding.modifier === "ctrl_alt") issues.push({ severity: "warning", message: `${action.label} uses Ctrl+Alt, which can behave as AltGr on some Windows/Linux typing layouts; verify it on each target system.` });
    if (action.binding.modifier.startsWith("gui")) issues.push({ severity: "warning", message: `${action.label} uses the Super/Windows key; check for operating-system shortcut conflicts on each target system.` });
    if (action.binding.modifier === "none" && key.baseKeycode && !["KC_NO", "KC_TRNS"].includes(key.baseKeycode)) {
      issues.push({ severity: "error", message: `${action.label} would replace ordinary ${key.baseKeycode} on ${key.label}; choose a modified chord or preserve a normal-key fallback.` });
    }
  }
  const estimatedMinutesPerDay = plan.actions.reduce((sum, action) => sum + action.frequencyPerDay * action.secondsSaved, 0) / 60;
  return { plan, issues, estimatedMinutesPerDay, readyForReview: plan.actions.length > 0 && plan.actions.every((action) => action.binding) && !issues.some((issue) => issue.severity === "error") && baseKnown };
}

function cell(value) { return String(value).replaceAll("|", "\\|").replaceAll(/[\r\n]/g, " ").replaceAll("<", "&lt;"); }
export function planMarkdown(input) {
  const { plan, issues, estimatedMinutesPerDay, readyForReview } = analyzePlan(input);
  const lines = [
    `# Agentic layout plan: ${cell(plan.profile.name)}`, "",
    `Profile: ${cell(plan.profile.layout)} (${plan.profile.source}); ${plan.profile.keys.length} physical keys; controller ${plan.profile.controller}.`,
    `Review status: ${readyForReview ? "ready for human review" : "needs more work"}.`,
    `Self-reported time saving: ${estimatedMinutesPerDay.toFixed(1)} minutes/day. This is an estimate, not measured evidence.`, "",
    "This plan does not flash firmware, install host shortcuts, or grant agent authority.", "",
    "| Action | Family | Chord | Normal key | Times/day | Risk | Confirmation |",
    "| --- | --- | --- | --- | ---: | --- | --- |"
  ];
  for (const action of plan.actions) {
    const key = plan.profile.keys.find((item) => item.id === action.binding?.keyId);
    lines.push(`| ${cell(action.label)} | ${action.family} | ${key ? `${cell(key.label)} + ${action.binding.modifier}` : "unassigned"} | ${cell(key?.baseKeycode ?? "unknown")} | ${action.frequencyPerDay} | ${action.consequence} | ${action.confirmation ? "yes" : "no"} |`);
  }
  if (plan.study) {
    lines.push("", "## Workflow evidence", "",
      `${plan.study.sessionsCompleted} of ${plan.study.sessionsStarted} study sessions completed; ${plan.study.events} deliberate events.`,
      "Counts describe observed event kinds, not exact intents or daily frequency. Focus intervals are excluded.", "",
      "| Kind | Events | Retry/blocked | Average friction |",
      "| --- | ---: | ---: | ---: |");
    for (const [kind, row] of Object.entries(plan.study.byKind)) lines.push(`| ${kind} | ${row.count} | ${row.retriesOrBlocked} | ${row.averageFriction.toFixed(1)} |`);
  }
  lines.push("", "## Review findings", "");
  lines.push(...(issues.length ? issues.map((issue) => `- **${issue.severity}:** ${cell(issue.message)}`) : ["- No structural issues found. Physical ergonomics, controller compatibility, and host behavior remain untested."]));
  return `${lines.join("\n")}\n`;
}
