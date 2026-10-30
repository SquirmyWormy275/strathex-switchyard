/** Closed semantic inputs for source-verified Vial override/repeat tables. */
import { compileDeviceKey } from "./vial-keycodes.mjs";
export const ruleKinds = {
  "key-override": { get: 5, set: 6, field: "keyOverrides", widths: [2, 2, 2, 1, 1, 1, 1] },
  "alternate-repeat": { get: 7, set: 8, field: "alternateRepeatKeys", widths: [2, 2, 1, 1] }
};
const modifiers = ["lctrl", "lshift", "lalt", "lgui", "rctrl", "rshift", "ralt", "rgui"];
export const overrideOptions = { activateOnTrigger: 1, activateOnRequiredModifier: 2, activateOnNegativeModifierRelease: 4, oneModifier: 8, noReregisterTrigger: 16, keepOnOtherKeyDown: 32, enabled: 128 };
export const repeatOptions = { defaultToAlternate: 1, bidirectional: 2, ignoreModifierHandedness: 4, enabled: 8 };
function mask(names) {
  if (!Array.isArray(names) || names.length > 8 || new Set(names).size !== names.length || names.some(name => !modifiers.includes(name))) throw new Error("Choose distinct named left/right modifiers; unknown modifier bits cannot be invented.");
  return names.reduce((value, name) => value | 1 << modifiers.indexOf(name), 0);
}
function options(value, flags) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== Object.keys(flags).length || Object.keys(value).some(name => !Object.hasOwn(flags, name)) || Object.keys(flags).some(name => typeof value[name] !== "boolean")) throw new Error("Review every named rule option explicitly; unknown or omitted options are unsupported.");
  return Object.entries(flags).reduce((bits, [name, bit]) => bits | (value[name] ? bit : 0), 0);
}
function key(snapshot, value, allowNoOp = false) {
  if (Number.isInteger(value) && (value >= 4 && value <= 231 || allowNoOp && value === 0)) return value;
  if (value?.kind !== "modified" || Object.keys(value).some(name => !["kind", "keycode", "modifiers"].includes(name))) throw new Error("Rules accept ordinary HID keys, an explicit no-op, or a modified ordinary key. Firmware, macro, layer and nested rule controls are prohibited.");
  return compileDeviceKey(snapshot, value);
}
function ordinaryTriggers(snapshot) {
  const found = new Set();
  for (const code of snapshot.keymap_raw.flat(2)) {
    const modTap = snapshot.identity.vialProtocol === 6 ? code >= 0x2000 && code <= 0x3fff : code >= 0x6000 && code <= 0x7fff;
    if (code < 0x2000 || modTap || code >= 0x4000 && code <= 0x4fff) { const basic = code & 255; if (basic >= 4 && basic <= 231) found.add(basic); }
  }
  return found;
}
export function ruleValues(snapshot, kind, edit) {
  if (kind === "alternate-repeat" && snapshot.identity.vialProtocol !== 6) throw new Error("Alternate-repeat editing requires the verified Vial 6 keycode contract. Older keycode migration sentinels are not wire values.");
  if (edit.disable === true) {
    if (Object.keys(edit).some(name => !["index", "before", "disable"].includes(name))) throw new Error("Clearing a recorded rule cannot include replacement fields.");
    return Array(ruleKinds[kind].widths.length).fill(0);
  }
  if (kind === "key-override") {
    if (Object.keys(edit).some(name => !["index", "before", "trigger", "replacement", "layers", "triggerMods", "negativeMods", "suppressedMods", "options"].includes(name)) || edit.before[6] & 0x40) throw new Error("An override with unknown fields/option bits is read-only unless explicitly cleared.");
    const trigger = key(snapshot, edit.trigger), replacement = key(snapshot, edit.replacement, true), bits = options(edit.options, overrideOptions), required = mask(edit.triggerMods), negative = mask(edit.negativeMods), suppressed = mask(edit.suppressedMods);
    if (!snapshot.keymap_raw.flat(2).includes(trigger)) throw new Error("The exact override trigger must exist in the recorded keymap.");
    if (!Array.isArray(edit.layers) || edit.layers.length > 16 || new Set(edit.layers).size !== edit.layers.length || edit.layers.some(layer => !Number.isInteger(layer) || layer < 0 || layer >= Math.min(snapshot.layers, 16)) || edit.options.enabled && !edit.layers.length) throw new Error("Select distinct advertised layers representable by the override's 16-bit mask.");
    const layers = edit.layers.reduce((value, layer) => value | 1 << layer, 0);
    if (edit.options.enabled && !(bits & 7)) throw new Error("An enabled override needs an explicit activation event.");
    if (edit.options.enabled && (edit.options.oneModifier ? required !== 0 && (required & ~negative) === 0 : (required & negative) !== 0)) throw new Error("Required and negative modifiers make this rule impossible.");
    if (edit.options.enabled && layers & 1 && trigger < 256 && required === 0) throw new Error("An override on the typing layer must require a modifier. Preserve ordinary unmodified typing.");
    return [trigger, replacement, layers, required, negative, suppressed, bits];
  }
  if (Object.keys(edit).some(name => !["index", "before", "key", "alternate", "allowedMods", "options"].includes(name)) || edit.before[3] & 0xf0) throw new Error("An alternate-repeat entry with unknown fields/option bits is read-only unless explicitly cleared.");
  const bits = options(edit.options, repeatOptions), trigger = key(snapshot, edit.key, edit.options.defaultToAlternate), alternate = key(snapshot, edit.alternate, true), allowed = mask(edit.allowedMods);
  if (trigger !== 0 && !ordinaryTriggers(snapshot).has(trigger & 255)) throw new Error("The repeat trigger's ordinary meaning must exist in the recorded keymap.");
  return [trigger, alternate, allowed, bits];
}
