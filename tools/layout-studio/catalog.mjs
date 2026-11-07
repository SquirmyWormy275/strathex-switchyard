/** Named, offline starting points. Reference layers never become live evidence. */
import { parseBoardProfile, parsePlan, newPlan, analyzePlan } from "./model.mjs";
import { layoutChoices, vialGeometry, boardBounds } from "./geometry.mjs";
import { portableProfile } from "./workspace.mjs";
import { parseWorkflow } from "./workflow.mjs";
export const taskControls = Object.freeze([
  { id: "resume", label: "Return to my task", family: "lifecycle", consequence: "navigation", detail: "Return to the exact conversation you connected." },
  { id: "status", label: "Check progress", family: "review", consequence: "read_only", detail: "See what your connected agent reports." },
  { id: "review", label: "Review the work", family: "review", consequence: "read_only", detail: "Bring the work and its evidence into review." },
  { id: "handoff", label: "Leave a handoff", family: "context", consequence: "navigation", detail: "Prepare context for the next person or agent." }
]);
export function recommendedWorkflow() {
  return parseWorkflow({ name: "Keep my place", roles: [{ id: "builder", label: "Builder" }, { id: "reviewer", label: "Reviewer" }], steps: [
    { id: "define", label: "Define the task and its acceptance evidence", roleId: "builder", after: [] },
    { id: "resume", label: "Return to the same task after an interruption", roleId: "builder", after: ["define"] },
    { id: "status", label: "Check progress and identify what needs attention", roleId: "builder", after: ["resume"] },
    { id: "review", label: "Review the result and its evidence", roleId: "reviewer", after: ["status"] },
    { id: "handoff", label: "Leave the next step and reviewed context", roleId: "builder", after: ["review"] }
  ] });
}
const alias = { ESCAPE: "Esc", BSPACE: "Backspace", BSPC: "Backspace", ENTER: "Enter", SPACE: "Space", LSHIFT: "Shift", LCTRL: "Ctrl", SCOLON: ";", QUOTE: "'", LBRACKET: "[", RBRACKET: "]", MINUS: "−", EQUAL: "=", COMMA: ",", DOT: ".", SLASH: "/", BSLASH: "\\", GRAVE: "`", CAPSLOCK: "Caps", LALT: "Alt", RALT: "Alt", LGUI: "Super", RGUI: "Super", LSFT: "Shift", RSFT: "Shift", RSHIFT: "Shift", LCTL: "Ctrl", RCTL: "Ctrl", RCTRL: "Ctrl", MINS: "−", EQL: "=", SCLN: ";", QUOT: "'", LBRC: "[", RBRC: "]", BSLS: "\\", GRV: "`", CAPS: "Caps" };
export function keyLabel(code, matrix) { if (!code || code === "KC_NO") return `Key ${matrix.join(",")}`; const short = code.replace(/^KC_/, ""); return (alias[short] ?? short).slice(0, 32); }
const dvorak = Object.fromEntries(Object.entries({ Q: "QUOTE", W: "COMMA", E: "DOT", R: "P", T: "Y", Y: "F", U: "G", I: "C", O: "R", P: "L", LBRACKET: "SLASH", LBRC: "SLASH", RBRACKET: "EQUAL", RBRC: "EQUAL", A: "A", S: "O", D: "E", F: "U", G: "I", H: "D", J: "H", K: "T", L: "N", SCOLON: "S", SCLN: "S", QUOTE: "MINUS", QUOT: "MINUS", Z: "SCOLON", X: "Q", C: "J", V: "K", B: "X", N: "B", M: "M", COMMA: "W", DOT: "V", SLASH: "Z", SLSH: "Z", MINUS: "LBRACKET", MINS: "LBRACKET", EQUAL: "RBRACKET", EQL: "RBRACKET" }).map(([a, b]) => [`KC_${a}`, `KC_${b}`]));
export function catalogSelection(catalog, modelId, variantId) {
  if (catalog?.schema !== "switchyard-model-f-catalog/v1") throw new Error("Unsupported keyboard catalog.");
  const model = catalog.models.find((m) => m.id === modelId);
  if (!model) throw new Error("Choose a catalog keyboard.");
  if (!model.variants.length) throw new Error("This proposed model has no verified final geometry. Import a real definition before creating its hardware configuration.");
  const variant = model.variants.find((v) => v.id === (variantId ?? model.recommended));
  if (!variant) throw new Error("Choose a configuration for this exact keyboard model.");
  return { model, variant };
}
export function presetOptions(catalog, modelId, variantId) { const { variant } = catalogSelection(catalog, modelId, variantId); return variant.parts.map((p) => layoutChoices(catalog.definitions[p.definitionId].definition)); }
export function standardPreset(catalog, modelId, { variantId, choices, typing = "reference" } = {}) {
  if (!["reference", "dvorak"].includes(typing)) throw new Error("Choose a supported reference typing arrangement.");
  const { model, variant } = catalogSelection(catalog, modelId, variantId); let offset = 0;
  const referenceCodes = new Map();
  const keys = variant.parts.flatMap((p, part) => {
    const { definition } = catalog.definitions[p.definitionId]; const selected = choices?.[part] ?? p.choices;
    const geometry = vialGeometry(definition, selected), width = boardBounds(geometry).width;
    const result = geometry.map((k) => {
      const original = p.base?.[k.matrix[0]]?.[k.matrix[1]] ?? null, code = typing === "dvorak" ? dvorak[original] ?? original : original;
      const id = variant.parts.length > 1 ? `${part === 0 ? "left" : "right"}:${k.id}` : k.id;
      referenceCodes.set(id, original);
      return { ...k, id, matrix: [k.matrix[0] + part * 128, k.matrix[1]], x: k.x + offset, label: keyLabel(code, k.matrix), baseKeycode: code };
    });
    offset += width + 2;
    return result;
  });
  const profile = parseBoardProfile({ schema: "sxsy-board-profile/v1", name: `${model.name} · ${typing === "dvorak" ? "Dvorak reference" : "reference"}`, layout: variant.id.slice(0, 80), source: "manual", controller: "unknown", evidence: "source-reference", keys });
  // Keep the same number-row positions wherever present; use the corresponding
  // keypad digits only on pads. No plain key or firmware assignment is replaced.
  const actions = taskControls.map((control, i) => {
    const find = (...codes) => profile.keys.find((k) => codes.includes(referenceCodes.get(k.id)));
    const key = find(`KC_${i + 1}`) ?? find(`KC_P${i + 1}`, `KC_KP_${i + 1}`) ?? find(`KC_F${i + 1}`) ?? find(["KC_R", "KC_S", "KC_V", "KC_H"][i]);
    return { id: `task-${control.id}`, label: control.label, family: control.family, consequence: control.consequence, confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: key ? { keyId: key.id, modifier: "gui_ctrl" } : null };
  });
  const plan = parsePlan({ ...newPlan(profile), actions });
  if (analyzePlan(plan).issues.some((i) => i.severity === "error")) throw new Error("The selected physical options conflict. Review their arrangement.");
  const workflow = recommendedWorkflow();
  return { portable: portableProfile(plan, `model-f-${model.id}`, `${model.name} · Keep my place`, workflow), model, variant, choices: variant.parts.map((p, i) => choices?.[i] ?? p.choices), typing,
    evidence: "Factory/development source reference. Import your own readout before host shortcuts can be connected. No firmware or ordinary typing changes.", sources: [...new Set(variant.parts.flatMap((p) => [p.source, catalog.definitions[p.definitionId].source, ...(p.geometrySource ? [p.geometrySource] : [])]))] };
}
