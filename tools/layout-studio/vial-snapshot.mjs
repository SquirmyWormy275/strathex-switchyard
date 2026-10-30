/** Import a saved configuration readout, never confuse a definition with a backup. */
import { parseBoardProfile } from "./model.mjs";
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
  const labels = input.definition.layouts.labels ?? [];
  if (!Array.isArray(labels) || labels.length > 32) throw new Error("The saved physical layout choices are unsupported.");
  const short = (s) => typeof s === "string" && s.length > 0 && s.length <= 80 && !/[\0\r\n]/.test(s);
  return labels.map((label) => {
    if (short(label)) return { label, options: ["No", "Yes"] };
    if (Array.isArray(label) && label.length >= 2 && label.length <= 17 && label.every(short)) return { label: label[0], options: label.slice(1) };
    throw new Error("A saved physical layout choice is invalid.");
  });
}

export function importVialSnapshot(input, selections) {
  const choices = snapshotChoices(input);
  if (!Array.isArray(selections) || selections.length !== choices.length || selections.some((v, i) => !Number.isInteger(v) || v < 0 || v >= choices[i].options.length)) throw new Error("Review every physical layout choice before loading the saved preview.");
  const layer = input.keymap_raw[0];
  if (!Array.isArray(layer) || layer.length !== input.rows || layer.some((r) => !Array.isArray(r) || r.length !== input.cols)) throw new Error("Saved layer zero does not match the matrix dimensions.");
  for (const row of layer) for (const code of row) keycode(code);
  const rows = input.definition.layouts.keymap;
  if (!Array.isArray(rows) || rows.length > 64) throw new Error("The saved geometry is unsupported.");
  const keys = []; let y = -1;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length > 512) throw new Error("The saved geometry row is invalid.");
    let x = 0, w = 1, h = 1, nonRectangular = false; y++;
    for (const item of row) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        if (Object.keys(item).some((k) => !["x", "y", "w", "h", "x2", "y2", "w2", "h2"].includes(k))) throw new Error("This rotated or decorated Vial geometry needs a dedicated importer.");
        if (Object.values(item).some((v) => typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 32)) throw new Error("Saved geometry coordinates are invalid.");
        nonRectangular ||= Boolean(item.x2 || item.y2 || item.w2 || item.h2);
        x += item.x ?? 0; y += item.y ?? 0; w = item.w ?? w; h = item.h ?? h;
        continue;
      }
      if (typeof item !== "string" || item.length > 128) throw new Error("A saved geometry key is invalid.");
      const labels = item.split("\n");
      const matrix = /^(\d+),(\d+)$/.exec(labels[0]);
      if (!matrix) throw new Error("A saved key has no matrix identity.");
      let selected = true;
      if (labels[3]) {
        const choice = /^(\d+),(\d+)$/.exec(labels[3]);
        if (!choice || !choices[Number(choice[1])] || Number(choice[2]) >= choices[Number(choice[1])].options.length) throw new Error("A saved key names an invalid layout option.");
        selected = selections[Number(choice[1])] === Number(choice[2]);
      }
      if (selected) {
        if (nonRectangular) throw new Error("This selected non-rectangular key needs a dedicated geometry importer. Your current plan is preserved.");
        const r = Number(matrix[1]), c = Number(matrix[2]);
        if (r >= input.rows || c >= input.cols) throw new Error("Saved geometry exceeds the keymap matrix.");
        const code = keycode(layer[r][c]);
        keys.push({ id: `m${r}_${c}`, label: code.replace(/^KC_/, ""), matrix: [r, c], x, y, w, h, baseKeycode: code });
      }
      x += w; w = 1; h = 1; nonRectangular = false;
    }
  }
  if (!keys.length) throw new Error("The chosen layout contains no physical keys.");
  const minX = Math.min(...keys.map((k) => k.x)), minY = Math.min(...keys.map((k) => k.y));
  return parseBoardProfile({ schema: "sxsy-board-profile/v1", name: `${String(input.definition.name ?? "Keyboard").slice(0, 85)} · saved snapshot`, layout: `Vial choices ${selections.join("-")}`, controller: "unknown", source: "manual", keys: keys.map((k) => ({ ...k, x: k.x - minX, y: k.y - minY })) });
}
