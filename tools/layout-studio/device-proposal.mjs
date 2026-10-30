import { layoutChoices, unpackChoices } from "./geometry.mjs";
import { editMacroBuffer } from "./vial-macros.mjs";
import { settingChanges, validateSettingsRestore } from "./vial-settings.mjs";

export function editLayoutOptions(snapshot, selections) {
  if (!snapshot.identity.vialProtocol) throw new Error("Layout options require a verified Vial interface.");
  const choices = layoutChoices(snapshot.definition);
  if (!choices.length || !Array.isArray(selections) || selections.length !== choices.length || selections.some((v, i) => !Number.isInteger(v) || v < 0 || v >= choices[i].options.length)) throw new Error("Select every documented physical layout option.");
  const beforeSelections = unpackChoices(snapshot.definition, snapshot.layoutOptions);
  let bits = 0, low = 0;
  for (let i = choices.length - 1; i >= 0; i--) {
    low += selections[i] * 2 ** bits; bits += Math.ceil(Math.log2(choices[i].options.length));
    if (bits > 32) throw new Error("Documented layout options exceed the protocol's 32-bit field.");
  }
  const mask = 2 ** bits - 1, after = Math.floor(snapshot.layoutOptions / 2 ** bits) * 2 ** bits + low;
  if (after === snapshot.layoutOptions) throw new Error("The physical layout choices are unchanged.");
  return { before: snapshot.layoutOptions, after, mask, choices: choices.map((c, i) => ({ label: c.label, before: c.options[beforeSelections[i]], after: c.options[selections[i]] })) };
}

export function additionalDeviceChanges(snapshot, input) {
  const macro = input.macros === undefined ? null : editMacroBuffer(snapshot, input.macros);
  const layout = input.layoutOptions === undefined ? null : editLayoutOptions(snapshot, input.layoutOptions);
  return { macro, layout, qmkSettings: settingChanges(snapshot, input.qmkSettings) };
}

/** Reject unrelated edits before any recovery write; preserve unowned options. */
export function validateAdditionalRestore(current, transaction) {
  validateSettingsRestore(current, transaction.qmkSettings);
  const { macro, layout } = transaction;
  if (macro) {
    const found = Buffer.from(current.macro, "base64"), before = Buffer.from(macro.before, "base64"), after = Buffer.from(macro.after, "base64");
    if (found.length !== before.length || found.some((v, i) => v !== before[i] && v !== after[i] && !(i === found.length - 1 && v === 255))) throw new Error("Macro storage changed outside this transaction. Review before restoring.");
  }
  if (layout) {
    const owned = (v) => (v & layout.mask) >>> 0;
    if (![owned(layout.before), owned(layout.after)].includes(owned(current.layoutOptions))) throw new Error("Physical layout options changed outside this transaction. Review before restoring.");
  }
}
export const restoredLayoutOptions = (current, layout) => (((current & ~layout.mask) | (layout.before & layout.mask)) >>> 0);
