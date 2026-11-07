/** Bounded onboard macros. These type into the foreground, not an agent session. */
export function compileMacro(actions, protocol) {
  if (!Number.isInteger(protocol) || protocol < 1 || protocol > 6 || !Array.isArray(actions) || actions.length > 256) throw new Error("Unsupported macro protocol or action count.");
  const bytes = [], held = new Set(); let delay = 0;
  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("Invalid macro action.");
    if (action.type === "text") {
      if (typeof action.text !== "string" || action.text.length > 2000 || /[^\x20-\x7e]/.test(action.text) || held.size) throw new Error("Macro text requires printable ASCII and released modifiers. Use explicit key actions for controls; output depends on the firmware/host typing layout.");
      bytes.push(...Buffer.from(action.text, "ascii"));
    } else if (action.type === "delay") {
      if (protocol < 2 || !Number.isInteger(action.milliseconds) || action.milliseconds < 0 || action.milliseconds > 5000 || (delay += action.milliseconds) > 30000) throw new Error("Macro delays require Vial 2 or later and at most 30 seconds total.");
      bytes.push(1, 4, action.milliseconds % 255 + 1, Math.floor(action.milliseconds / 255) + 1);
    } else {
      if (!["tap", "down", "up"].includes(action.type) || !Number.isInteger(action.keycode) || action.keycode < 4 || action.keycode > 231) throw new Error("Macros support ordinary 8-bit HID keys only. Firmware control codes are prohibited.");
      if (action.type === "down") { if (held.has(action.keycode) || held.size >= 8) throw new Error("A macro key is already held or exceeds the rollover bound."); held.add(action.keycode); }
      if (action.type === "up") { if (!held.delete(action.keycode)) throw new Error("A macro releases a key it did not hold."); }
      if (action.type === "tap" && held.has(action.keycode)) throw new Error("A macro cannot tap a key it already holds.");
      if (protocol >= 2) bytes.push(1);
      bytes.push({ tap: 1, down: 2, up: 3 }[action.type], action.keycode);
    }
    if (bytes.length > 8191) throw new Error("Macro output exceeds the storage bound.");
  }
  if (held.size) throw new Error("Every macro-held key must be released before the macro ends.");
  return Buffer.from(bytes);
}

export function editMacroBuffer(snapshot, edits) {
  if (!snapshot.identity.vialProtocol || !Number.isInteger(snapshot.macroCount) || snapshot.macroCount < 1 || snapshot.macroCount > 128 || !Number.isInteger(snapshot.macroBytes) || snapshot.macroBytes < snapshot.macroCount + 1 || snapshot.macroBytes > 8192 || typeof snapshot.macro !== "string") throw new Error("This exact firmware does not expose supported macro storage.");
  const before = Buffer.from(snapshot.macro, "base64");
  if (before.length !== snapshot.macroBytes || before.at(-1) !== 0) throw new Error("The macro buffer is incomplete or disabled by an interrupted write. Restore its transaction before editing.");
  if (!Array.isArray(edits) || !edits.length || edits.length > 16) throw new Error("Review 1–16 macro slots per transaction.");
  const slots = []; let offset = 0;
  for (let i = 0; i < snapshot.macroCount; i++) {
    const end = before.indexOf(0, offset);
    if (end < 0 || end >= before.length - 1) throw new Error("The existing macro slot boundaries are unsupported. Preserve the original buffer.");
    slots.push(Buffer.from(before.subarray(offset, end))); offset = end + 1;
  }
  const seen = new Set(), summary = [];
  for (const edit of edits) {
    if (!edit || !Number.isInteger(edit.index) || edit.index < 0 || edit.index >= snapshot.macroCount || seen.has(edit.index)) throw new Error("Macro slot identity is invalid or duplicated.");
    seen.add(edit.index); const compiled = compileMacro(edit.actions, snapshot.identity.vialProtocol);
    summary.push({ index: edit.index, beforeBytes: slots[edit.index].length, afterBytes: compiled.length, actions: structuredClone(edit.actions) }); slots[edit.index] = compiled;
  }
  const prefix = Buffer.concat(slots.flatMap((slot) => [slot, Buffer.from([0])]));
  if (prefix.length >= before.length) throw new Error("The proposed macros exceed the verified storage capacity, including the commit sentinel.");
  const after = Buffer.from(before); prefix.copy(after); after[after.length - 1] = 0;
  if (after.equals(before)) throw new Error("The macro proposal does not change the stored configuration.");
  return { before: before.toString("base64"), after: after.toString("base64"), slots: summary };
}
