/** Closed semantic key forms; never accept arbitrary firmware-control integers. */
const ordinary = (v) => Number.isInteger(v) && v >= 4 && v <= 231;
const masks = (v) => Number.isInteger(v) && v > 0 && v <= 31 && (v & 15) !== 0;
export function compileDeviceKey(snapshot, value) {
  if (Number.isInteger(value) && value >= 0 && value <= (snapshot.identity.protocol?.startsWith("original") ? 255 : 231)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value) || !snapshot.identity.vialProtocol) throw new Error("Use ordinary HID keys or a supported semantic Vial key. Firmware control codes are prohibited.");
  const protocol = snapshot.identity.vialProtocol;
  if (protocol < 1 || protocol > 6) throw new Error("The Vial keycode version is unsupported.");
  if (value.kind === "macro" && Number.isInteger(value.index) && value.index >= 0 && value.index < snapshot.macroCount) return (protocol === 6 ? 0x7700 : 0x5f12) + value.index;
  if (value.kind === "tap-dance" && protocol >= 4 && snapshot.dynamic?.schema === "switchyard-vial-dynamic/v1" && snapshot.dynamic.availability === "verified" && Number.isInteger(value.index) && value.index >= 0 && value.index < snapshot.dynamic.tapDances.length) return 0x5700 + value.index;
  if (value.kind === "momentary-layer" && Number.isInteger(value.layer) && value.layer > 0 && value.layer < snapshot.layers) return (protocol === 6 ? 0x5220 : 0x5100) + value.layer;
  if (value.kind === "layer-tap" && Number.isInteger(value.layer) && value.layer > 0 && value.layer < Math.min(snapshot.layers, 16) && ordinary(value.keycode)) return 0x4000 | value.layer << 8 | value.keycode;
  if (["modified", "mod-tap"].includes(value.kind) && masks(value.modifiers) && ordinary(value.keycode)) return (value.kind === "modified" ? 0 : protocol === 6 ? 0x2000 : 0x6000) | value.modifiers << 8 | value.keycode;
  throw new Error("This key form exceeds the exact device's supported layers, macros or ordinary keycodes. Firmware control codes are prohibited.");
}

/** Only verified dual-role tap meanings count as ordinary typing fallback. */
export function baseTypingCode(snapshot, code) {
  if (!snapshot.identity.vialProtocol || code < 256) return code;
  if (code >= 0x5700 && code < 0x5740 && snapshot.dynamic?.schema === "switchyard-vial-dynamic/v1" && snapshot.dynamic.availability === "verified") { const tap = snapshot.dynamic.tapDances[code - 0x5700]?.[0]; if (ordinary(tap)) return tap; }
  const modTap = snapshot.identity.vialProtocol === 6 ? code >= 0x2000 && code <= 0x3fff : code >= 0x6000 && code <= 0x7fff;
  const layerTap = code >= 0x4000 && code <= 0x4fff;
  return (modTap || layerTap) && ordinary(code & 255) ? code & 255 : code;
}
