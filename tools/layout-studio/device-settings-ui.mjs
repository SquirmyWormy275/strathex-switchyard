import { layoutChoices, unpackChoices } from "./geometry.mjs";
import { qmkSettings } from "./vial-settings.mjs";
import { compileDeviceKey } from "./vial-keycodes.mjs";
import { overrideOptions, repeatOptions } from "./vial-rules.mjs";
const option = (value, text) => { const e = document.createElement("option"); e.value = String(value); e.textContent = text; return e; };
const labels = { 0: "No output", 1: "Transparent", 40: "Enter", 41: "Escape", 42: "Backspace", 43: "Tab", 44: "Space", 45: "Minus", 46: "Equals", 47: "Left bracket", 48: "Right bracket", 49: "Backslash", 51: "Semicolon", 52: "Quote", 53: "Grave", 54: "Comma", 55: "Period", 56: "Slash", 57: "Caps Lock", 70: "Print Screen", 71: "Scroll Lock", 72: "Pause", 73: "Insert", 74: "Home", 75: "Page Up", 76: "Delete", 77: "End", 78: "Page Down", 79: "Right arrow", 80: "Left arrow", 81: "Down arrow", 82: "Up arrow", 83: "Num Lock", 224: "Left Control", 225: "Left Shift", 226: "Left Alt", 227: "Left Super", 228: "Right Control", 229: "Right Shift", 230: "Right Alt", 231: "Right Super" };
for (let i = 0; i < 26; i++) labels[4 + i] = String.fromCharCode(65 + i);
for (let i = 0; i < 10; i++) labels[30 + i] = String((i + 1) % 10);
for (let i = 0; i < 12; i++) { labels[58 + i] = `F${i + 1}`; labels[104 + i] = `F${i + 13}`; }
export const deviceKeyName = code => labels[code] ?? `0x${Number(code).toString(16).padStart(4, "0")}`;
export function describeDynamic(kind, values) {
  const mods = mask => modifierLabels.filter((_, i) => mask & 1 << i).join(" + ") || "none", flags = (bits, spec) => Object.entries(spec).filter(([, bit]) => bits & bit).map(([name]) => flagLabels[name]).join("; ") || "disabled";
  if (kind === "tap-dance") return `tap ${deviceKeyName(values[0])}; hold ${deviceKeyName(values[1])}; double tap ${deviceKeyName(values[2])}; tap then hold ${deviceKeyName(values[3])}; threshold ${values[4]} ms`;
  if (kind === "combo") return `${values.slice(0, 4).filter(Boolean).map(deviceKeyName).join(" + ") || "no triggers"} → ${deviceKeyName(values[4])}`;
  if (kind === "key-override") return `${deviceKeyName(values[0])} → ${deviceKeyName(values[1])}; layers ${Array.from({ length: 16 }, (_, i) => i).filter(i => values[2] & 1 << i).join(", ") || "none"}; required ${mods(values[3])}; excluded ${mods(values[4])}; suppressed ${mods(values[5])}; ${flags(values[6], overrideOptions)}${values[6] & 64 ? "; unknown option 0x40" : ""}`;
  return `${deviceKeyName(values[0])} → ${deviceKeyName(values[1])}; allowed modifiers ${mods(values[2])}; ${flags(values[3], repeatOptions)}${values[3] & 240 ? "; unknown option bits" : ""}`;
}
function field(name, input) { const label = document.createElement("label"); label.textContent = name; label.append(input); return label; }
function select(options, value) { const input = document.createElement("select"); input.append(...options.map(([v, name]) => option(v, name))); input.value = String(value ?? options[0]?.[0] ?? ""); return input; }
function number(value, max, min = 0) { const input = document.createElement("input"); input.type = "number"; input.min = String(min); input.max = String(max); input.step = "1"; input.value = String(value); return input; }
function checked(value) { const input = document.createElement("input"); input.type = "checkbox"; input.checked = value; return input; }
function integer(input, max, min = 0) { const value = Number(input.value); if (input.value === "" || !Number.isInteger(value) || value < min || value > max) throw Error(`Enter a whole number from ${min} to ${max}.`); return value; }
const ordinary = (value, transparent = false) => select([[0, "No output"], ...(transparent ? [[1, "Transparent"]] : []), ...Array.from({ length: 228 }, (_, i) => [i + 4, deviceKeyName(i + 4)])], value);
const modifierNames = ["lctrl", "lshift", "lalt", "lgui", "rctrl", "rshift", "ralt", "rgui"];
const modifierLabels = ["Left Control", "Left Shift", "Left Alt", "Left Super", "Right Control", "Right Shift", "Right Alt", "Right Super"];
const flagLabels = { activateOnTrigger: "When the trigger key is pressed", activateOnRequiredModifier: "When a required modifier is pressed", activateOnNegativeModifierRelease: "When an excluded modifier is released", oneModifier: "Any one required modifier is enough", noReregisterTrigger: "Do not restore the original key on release", keepOnOtherKeyDown: "Keep active when another key is pressed", enabled: "Enable this rule", defaultToAlternate: "Use the alternate when no trigger matches", bidirectional: "Repeat in both directions", ignoreModifierHandedness: "Treat left and right modifiers alike" };
function checkGroup(title, entries, initial, changed) {
  const element = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = title; element.className = "device-checks"; element.append(legend);
  const inputs = entries.map(([name, label, bit]) => { const input = checked(Boolean(initial & bit)); input.addEventListener("change", changed); element.append(field(label, input)); return { name, input }; });
  return { element, names: () => inputs.filter(row => row.input.checked).map(row => row.name), flags: () => Object.fromEntries(inputs.map(row => [row.name, row.input.checked])) };
}
function dynamicEditor(snapshot, kind, index, changed) {
  const before = snapshot.dynamic[kind][index], element = document.createElement("div"), approve = checked(false), clear = checked(false), body = document.createElement("div"); element.className = body.className = "stack";
  const label = document.createElement("p"); label.className = "field-help"; label.textContent = `Recorded slot ${index}: ${describeDynamic(({ tapDances: "tap-dance", combos: "combo", keyOverrides: "key-override", alternateRepeatKeys: "alternate-repeat" })[kind], before)}. Review shows the exact replacement before Apply.`;
  element.append(label, field("Replace this recorded slot", approve)); approve.addEventListener("change", changed);
  if (kind !== "tapDances") { element.append(field("Clear this slot", clear)); clear.addEventListener("change", () => { body.hidden = clear.checked; changed(); }); }
  element.append(body); let replacement;
  const key = (title, initial, options = {}) => { const editor = deviceKeyEditor(snapshot, initial, changed, options); const group = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = title; group.append(legend, editor.element); body.append(group); return editor; };
  if (kind === "tapDances") {
    const keys = ["Tap", "Hold", "Double tap", "Tap then hold"].map((title, i) => key(title, before[i], { allowTapDance: false })), term = number(before[4], 10000, 1); term.addEventListener("input", changed); body.append(field("Tap-dance threshold (ms)", term));
    replacement = () => ({ tap: keys[0].value(), hold: keys[1].value(), doubleTap: keys[2].value(), tapHold: keys[3].value(), termMs: integer(term, 10000, 1) });
  } else if (kind === "combos") {
    const triggers = Array.from({ length: 4 }, (_, i) => ordinary(before[i])); triggers.forEach((input, i) => { input.addEventListener("change", changed); body.append(field(`Trigger ${i + 1}${i > 1 ? " (optional)" : ""}`, input)); });
    const output = key("Combo output", before[4], { allowTapDance: false }); replacement = () => ({ keys: triggers.map(input => Number(input.value)).filter(Boolean), output: output.value() });
  } else {
    const override = kind === "keyOverrides", first = key(override ? "Trigger" : "Repeat trigger", before[0], { rulesOnly: true }), second = key(override ? "Replacement" : "Alternate", before[1], { rulesOnly: true });
    const mods = (title, initial) => { const group = checkGroup(title, modifierNames.map((name, i) => [name, modifierLabels[i], 1 << i]), initial, changed); body.append(group.element); return group; };
    let layers, required, excluded, suppressed, allowed;
    if (override) { layers = checkGroup("Active layers", Array.from({ length: Math.min(snapshot.layers, 16) }, (_, i) => [i, i === 0 ? "Layer 0 · ordinary typing" : `Layer ${i}`, 1 << i]), before[2], changed); body.append(layers.element); required = mods("Required modifiers", before[3]); excluded = mods("Excluded modifiers", before[4]); suppressed = mods("Suppress these modifiers", before[5]); }
    else allowed = mods("Allowed modifiers", before[2]);
    const flags = override ? overrideOptions : repeatOptions, options = checkGroup("Rule behavior", Object.entries(flags).map(([name, bit]) => [name, flagLabels[name], bit]), before[override ? 6 : 3], changed); body.append(options.element);
    if (before[override ? 6 : 3] & (override ? 0x40 : 0xf0)) { const warning = document.createElement("p"); warning.textContent = "This slot contains unknown option bits. It can only be explicitly cleared by this version."; body.append(warning); }
    replacement = () => override ? { trigger: first.value(), replacement: second.value(), layers: layers.names(), triggerMods: required.names(), negativeMods: excluded.names(), suppressedMods: suppressed.names(), options: options.flags() } : { key: first.value(), alternate: second.value(), allowedMods: allowed.names(), options: options.flags() };
  }
  return { element, value() { if (!approve.checked) throw Error("Explicitly choose to replace the recorded dynamic slot."); return { [kind]: [{ index, before: [...before], ...(clear.checked ? { disable: true } : replacement()) }] }; } };
}

/** Closed semantic choices; the device service validates and compiles them again. */
export function deviceKeyEditor(snapshot, initial = 0, onChange = () => {}, { transparent = false, rulesOnly = false, allowTapDance = true } = {}) {
  const kinds = [["ordinary", "Ordinary key"], ...(snapshot.identity.vialProtocol ? [["modified", "Key with modifiers"]] : [])];
  if (!rulesOnly && snapshot.identity.vialProtocol) kinds.push(["mod-tap", "Tap key / hold modifier"], ...(snapshot.layers > 1 ? [["momentary-layer", "Hold for another layer"], ["layer-tap", "Tap key / hold layer"]] : []), ...(snapshot.macroCount > 0 ? [["macro", "Onboard macro"]] : []), ...(allowTapDance && snapshot.dynamic?.availability === "verified" && snapshot.dynamic.tapDances?.length ? [["tap-dance", "Tap dance"]] : []));
  if (!rulesOnly && snapshot.identity.vialProtocol === 6 && snapshot.dynamic?.availability === "verified") {
    if (snapshot.dynamic.alternateRepeatKeys?.length) kinds.push(["repeat", "Repeat key"], ["alternate-repeat", "Alternate repeat"]);
    if (snapshot.dynamic.featureBits & 1) kinds.push(["caps-word", "Caps Word"]);
    if (snapshot.dynamic.featureBits & 2) kinds.push(["layer-lock", "Layer lock"]);
  }
  const candidates = [{ kind: "ordinary", keycode: initial }];
  for (const [kind] of kinds.slice(1)) {
    if (["modified", "mod-tap"].includes(kind)) candidates.push({ kind, keycode: initial & 255, modifiers: initial >> 8 & 31 });
    else if (kind === "layer-tap") candidates.push({ kind, layer: initial >> 8 & 15, keycode: initial & 255 });
    else if (kind === "momentary-layer") for (let layer = 1; layer < snapshot.layers; layer++) candidates.push({ kind, layer });
    else if (["macro", "tap-dance"].includes(kind)) for (let index = 0; index < (kind === "macro" ? snapshot.macroCount : snapshot.dynamic.tapDances.length); index++) candidates.push({ kind, index });
    else candidates.push({ kind });
  }
  const decoded = candidates.find(value => { try { return value.kind === "ordinary" ? [0, ...(transparent ? [1] : [])].includes(initial) || initial >= 4 && initial <= 231 : compileDeviceKey(snapshot, value) === initial; } catch { return false; } });
  if (!decoded) kinds.unshift(["preserve", `Existing ${deviceKeyName(initial)} · choose a supported replacement`]);
  const kind = select(kinds, decoded?.kind ?? "preserve"), key = ordinary(decoded?.keycode ?? 4, transparent), layer = number(decoded?.layer ?? 1, snapshot.layers - 1, 1), slot = number(decoded?.index ?? 0, 127), side = select([[0, "Left-hand modifiers"], [16, "Right-hand modifiers"]], (decoded?.modifiers ?? 1) & 16);
  const modifiers = [1, 2, 4, 8].map(bit => checked(Boolean((decoded?.modifiers ?? 1) & bit))), modifierGroup = document.createElement("div"); modifierGroup.className = "stack"; modifierGroup.append(side, ...modifiers.map((input, i) => field(["Control", "Shift", "Alt", "Super"][i], input)));
  const keyRow = field("Key", key), layerRow = field("Layer", layer), slotRow = field("Slot (starts at 0)", slot), modifierRow = document.createElement("fieldset"), element = document.createElement("div"); element.className = "stack";
  const modifierLegend = document.createElement("legend"); modifierLegend.textContent = "Use these modifiers"; modifierRow.append(modifierLegend, modifierGroup);
  element.append(field("Behavior", kind), keyRow, layerRow, slotRow, modifierRow);
  function render() { keyRow.hidden = !["ordinary", "modified", "mod-tap", "layer-tap"].includes(kind.value); layerRow.hidden = !["momentary-layer", "layer-tap"].includes(kind.value); slotRow.hidden = !["macro", "tap-dance"].includes(kind.value); modifierRow.hidden = !["modified", "mod-tap"].includes(kind.value); slot.max = String(kind.value === "macro" ? (snapshot.macroCount ?? 1) - 1 : (snapshot.dynamic?.tapDances?.length ?? 1) - 1); }
  for (const input of [kind, key, layer, slot, side, ...modifiers]) input.addEventListener("change", () => { render(); onChange(); }); render();
  return { element, kind, key, layer, slot, side, modifiers, value() {
    if (kind.value === "preserve") return initial;
    if (kind.value === "ordinary") return Number(key.value);
    if (["modified", "mod-tap"].includes(kind.value)) return { kind: kind.value, keycode: Number(key.value), modifiers: Number(side.value) | modifiers.reduce((mask, input, index) => mask | (input.checked ? 1 << index : 0), 0) };
    if (kind.value === "layer-tap") return { kind: kind.value, layer: integer(layer, Math.min(snapshot.layers, 16) - 1, 1), keycode: Number(key.value) };
    if (kind.value === "momentary-layer") return { kind: kind.value, layer: integer(layer, snapshot.layers - 1, 1) };
    if (["macro", "tap-dance"].includes(kind.value)) return { kind: kind.value, index: integer(slot, Number(slot.max)) };
    return { kind: kind.value };
  } };
}

export function mountDeviceSettings({ review, changed, notify }) {
  const $ = id => document.getElementById(id);
  let snapshot = null, busy = false, build = null, editor = null;
  function controls() { $("device-settings-form").inert = busy; $("review-device-settings").disabled = busy || !snapshot || !build; $("device-settings-kind").disabled = busy || !snapshot; }
  const changedInput = input => { input.addEventListener("change", changed); input.addEventListener("input", changed); return input; };
  function slotPicker(name, count, render) { const picker = select(Array.from({ length: count }, (_, i) => [i, `${name} ${i}`]), 0); picker.addEventListener("change", () => { changed(); render(Number(picker.value)); }); $("device-settings-form").append(field("Saved slot", picker)); return picker; }
  function content() { const e = document.createElement("div"); e.className = "stack"; $("device-settings-form").append(e); return e; }
  function render() {
    build = null; editor = null; $("device-settings-form").replaceChildren();
    if (!snapshot) { $("device-settings-status").textContent = "Read a configuration or choose a saved readout to plan supported settings."; controls(); return; }
    const kind = $("device-settings-kind").value;
    $("device-settings-status").textContent = "Review reads the connected keyboard again. Apply is a separate step with baseline capture and readback. Saved readouts alone do not verify a live device.";
    if (kind === "layout") {
      const choices = layoutChoices(snapshot.definition), values = unpackChoices(snapshot.definition, snapshot.layoutOptions), rows = choices.map((row, i) => changedInput(select(row.options.map((value, index) => [index, value]), values[i])));
      $("device-settings-form").append(...rows.map((input, i) => field(choices[i].label, input)));
      build = () => ({ layoutOptions: rows.map(input => Number(input.value)) }); editor = { rows };
    } else if (kind === "settings") {
      const ids = Object.keys(snapshot.qmkSettings.values).map(Number).filter(id => qmkSettings[id]), picker = select(ids.map(id => [id, qmkSettings[id].name]), ids[0]); $("device-settings-form").append(field("Advertised setting", picker)); const form = content();
      function setting() { const id = Number(picker.value), spec = qmkSettings[id], before = snapshot.qmkSettings.values[id], value = changedInput(number((before & spec.mask) >>> 0, spec.max)); form.replaceChildren(field(`${spec.name} · current ${(before & spec.mask) >>> 0}`, value)); build = () => ({ qmkSettings: [{ id, before, value: integer(value, spec.max) }] }); editor = { picker, value }; }
      picker.addEventListener("change", () => { changed(); setting(); }); setting();
    } else if (kind === "encoders") {
      const entries = snapshot.encoders.entries.flatMap(row => [0, 1].map(direction => ({ ...row, direction }))), picker = select(entries.map((row, i) => [i, `Layer ${row.layer} · encoder ${row.index} · direction ${row.direction}`]), 0); $("device-settings-form").append(field("Recorded encoder direction", picker)); const form = content();
      function encoder() { const row = entries[Number(picker.value)], key = deviceKeyEditor(snapshot, row.values[row.direction], changed); form.replaceChildren(key.element); build = () => ({ encoders: [{ layer: row.layer, index: row.index, direction: row.direction, before: row.values[row.direction], after: key.value() }] }); editor = { picker, key }; }
      picker.addEventListener("change", () => { changed(); encoder(); }); encoder();
    } else if (["tapDances", "combos", "keyOverrides", "alternateRepeatKeys"].includes(kind)) {
      const names = { tapDances: "Tap dance", combos: "Combo", keyOverrides: "Modifier override", alternateRepeatKeys: "Alternate repeat" }, picker = slotPicker(names[kind], snapshot.dynamic[kind].length, slot), form = content();
      function slot(index = 0) { const row = dynamicEditor(snapshot, kind, index, changed); form.replaceChildren(row.element); build = row.value; editor = { picker }; } slot();
    } else if (kind === "macros") {
      const picker = slotPicker("Macro", snapshot.macroCount, macro); const form = content();
      function macro(index = 0) {
        const approve = checked(false), rows = [], list = document.createElement("div"), add = document.createElement("button"); add.type = "button"; add.className = "secondary"; add.textContent = "Add a macro step";
        form.replaceChildren(field("Replace this slot with the steps below (empty clears it)", approve), list, add);
        approve.addEventListener("change", changed);
        function step() {
          if (rows.length >= 256) { notify("A macro supports at most 256 steps."); return; }
          const type = select([["text", "Type text"], ["tap", "Tap a key"], ["down", "Hold a key"], ["up", "Release a key"], ["delay", "Wait"]], "text"), text = document.createElement("input"), key = ordinary(4), ms = number(100, 5000), remove = document.createElement("button"), row = document.createElement("div"); text.maxLength = 2000; text.placeholder = "Printable ASCII; output follows the host layout"; remove.type = "button"; remove.className = "quiet"; remove.textContent = "Remove step"; row.className = "macro-step stack";
          const t = field("Text", text), k = field("Key", key), m = field("Milliseconds", ms); row.append(field("Step", type), t, k, m, remove);
          function visibility() { t.hidden = type.value !== "text"; k.hidden = !["tap", "down", "up"].includes(type.value); m.hidden = type.value !== "delay"; }
          for (const input of [type, text, key, ms]) changedInput(input); type.addEventListener("change", visibility); visibility();
          const value = { type, text, key, ms, row }; rows.push(value); list.append(row); remove.addEventListener("click", () => { rows.splice(rows.indexOf(value), 1); list.replaceChildren(...rows.map(r => r.row)); changed(); }); changed();
        }
        add.addEventListener("click", step);
        build = () => { if (!approve.checked) throw Error("Explicitly choose to replace or clear the selected macro slot."); return { macros: [{ index, actions: rows.map(row => row.type.value === "text" ? { type: "text", text: row.text.value } : row.type.value === "delay" ? { type: "delay", milliseconds: integer(row.ms, 5000) } : { type: row.type.value, keycode: Number(row.key.value) }) }] }; }; editor = { picker, approve, rows, add };
      }
      macro();
    }
    controls();
  }
  $("device-settings-kind").addEventListener("change", () => { changed(); render(); });
  $("review-device-settings").addEventListener("click", () => { try { if (build && !busy) void review(build()); } catch (error) { notify(error.message); $("device-settings-status").textContent = error.message; } });
  return { update(value) {
    snapshot = value; const types = [];
    if (snapshot?.identity.vialProtocol) {
      if (snapshot.definition && layoutChoices(snapshot.definition).length) types.push(["layout", "Physical layout options"]);
      if (snapshot.macroCount > 0 && snapshot.macroBytes > snapshot.macroCount && typeof snapshot.macro === "string") types.push(["macros", "Onboard macros"]);
      if (snapshot.qmkSettings?.availability === "verified" && Object.keys(snapshot.qmkSettings.values).some(id => qmkSettings[id])) types.push(["settings", "Typing and QMK settings"]);
      if (snapshot.encoders?.availability === "verified" && snapshot.encoders.entries.length) types.push(["encoders", "Encoder directions"]);
      if (snapshot.dynamic?.availability === "verified") for (const [kind, label] of [["tapDances", "Tap dances"], ["combos", "Key combinations"], ["keyOverrides", "Modifier overrides"], ["alternateRepeatKeys", "Alternate repeat keys"]]) if (snapshot.dynamic[kind]?.length && (kind !== "alternateRepeatKeys" || snapshot.identity.vialProtocol === 6)) types.push([kind, label]);
    }
    $("device-settings-kind").replaceChildren(...types.map(([value, label]) => option(value, label))); $("device-settings-kind").value = types[0]?.[0] ?? ""; render();
    if (snapshot && !types.length) $("device-settings-status").textContent = "This readout does not advertise any supported optional settings. Ordinary key editing remains available; firmware reset, calibration and solenoid controls are not exposed.";
  }, busy(value) { busy = value; controls(); }, editor: () => editor };
}
