/** Import a saved configuration readout, never confuse a definition with a backup. */
import { parseBoardProfile } from "./model.mjs";
import { layoutChoices, vialGeometry } from "./geometry.mjs";
const basic = {
  0: "NO", 1: "TRNS", 40: "ENTER", 41: "ESC", 42: "BSPC", 43: "TAB", 44: "SPACE", 45: "MINUS", 46: "EQUAL",
  47: "LBRC", 48: "RBRC", 49: "BSLS", 50: "NUHS", 51: "SCLN", 52: "QUOT", 53: "GRAVE", 54: "COMMA", 55: "DOT", 56: "SLSH", 57: "CAPS",
  73: "INS", 74: "HOME", 75: "PGUP", 76: "DEL", 77: "END", 78: "PGDN", 79: "RIGHT", 80: "LEFT", 81: "DOWN", 82: "UP", 83: "NUM",
  84: "PSLS", 85: "PAST", 86: "PMNS", 87: "PPLS", 88: "PENT", 98: "P0", 99: "PDOT", 100: "NUBS",
  224: "LCTL", 225: "LSFT", 226: "LALT", 227: "LGUI", 228: "RCTL", 229: "RSFT", 230: "RALT", 231: "RGUI"
};
function keycode(n) {
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error("Saved keycodes must be unsigned 16-bit integers.");
  if (n >= 4 && n <= 29) return `KC_${String.fromCharCode(65 + n - 4)}`;
  if (n >= 30 && n <= 39) return `KC_${(n - 29) % 10}`;
  if (n >= 58 && n <= 69) return `KC_F${n - 57}`;
  if (n >= 89 && n <= 97) return `KC_P${n - 88}`;
  return basic[n] ? `KC_${basic[n]}` : `VIAL_0X${n.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function snapshotChoices(input) {
  if (!input || !Array.isArray(input.keymap_raw) || !input.definition?.layouts?.keymap || !Number.isInteger(input.rows) || !Number.isInteger(input.cols) || input.rows < 1 || input.rows > 32 || input.cols < 1 || input.cols > 32 || input.rows * input.cols > 1024) throw new Error("Choose a saved Vial configuration with definition, matrix dimensions and keymap_raw. A Vial definition alone is geometry, not a configuration backup.");
  return layoutChoices(input.definition);
}

export function importVialSnapshot(input, selections) {
  const choices = snapshotChoices(input);
  if (!Array.isArray(selections) || selections.length !== choices.length || selections.some((v, i) => !Number.isInteger(v) || v < 0 || v >= choices[i].options.length)) throw new Error("Review every physical layout choice before loading the saved preview.");
  const layer = input.keymap_raw[0];
  if (!Array.isArray(layer) || layer.length !== input.rows || layer.some((r) => !Array.isArray(r) || r.length !== input.cols)) throw new Error("Saved layer zero does not match the matrix dimensions.");
  for (const row of layer) for (const code of row) keycode(code);
  const keys = vialGeometry(input.definition, selections).map((key) => {
    const [r, c] = key.matrix;
    if (r >= input.rows || c >= input.cols) throw new Error("Saved geometry exceeds the keymap matrix.");
    const code = keycode(layer[r][c]);
    return { ...key, label: code.replace(/^KC_/, "").slice(0, 32), baseKeycode: code };
  });
  return parseBoardProfile({ schema: "sxsy-board-profile/v1", name: `${String(input.definition.name ?? "Keyboard").slice(0, 85)} · saved snapshot`, layout: `Vial choices ${selections.join("-")}`, controller: "unknown", source: "manual", evidence: "saved-snapshot", keys });
}
