/** Geometry only. Coordinates are in key units; no device or host operations. */
export function layoutChoices(definition) {
  const labels = definition?.layouts?.labels ?? [];
  if (!Array.isArray(labels) || labels.length > 32) throw new Error("Unsupported physical layout choices.");
  const short = (s) => typeof s === "string" && s.length > 0 && s.length <= 80 && !/[\0\r\n]/.test(s);
  return labels.map((label) => {
    if (short(label)) return { label, options: ["No", "Yes"] };
    if (Array.isArray(label) && label.length >= 2 && label.length <= 17 && label.every(short)) return { label: label[0], options: label.slice(1) };
    throw new Error("Invalid physical layout choice.");
  });
}
export function unpackChoices(definition, packed = 0) {
  if (!Number.isSafeInteger(packed) || packed < 0 || packed > 0xffffffff) throw new Error("Invalid packed physical choices.");
  let shift = 0;
  return layoutChoices(definition).toReversed().map((choice) => { const bits = Math.ceil(Math.log2(choice.options.length)); const value = Math.floor(packed / 2 ** shift) % 2 ** bits; shift += bits; if (shift > 32 || value >= choice.options.length) throw new Error("Packed choice exceeds the documented options."); return value; }).reverse();
}
function rotate(x, y, angle) { const a = angle * Math.PI / 180; return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; }
export function keyBounds(key) {
  const corners = [[0, 0], [key.w, 0], [key.w, key.h], [0, key.h]].map(([x, y]) => { const p = rotate(x, y, key.rotation ?? 0); return [p[0] + key.x, p[1] + key.y]; });
  return { left: Math.min(...corners.map((p) => p[0])), top: Math.min(...corners.map((p) => p[1])), right: Math.max(...corners.map((p) => p[0])), bottom: Math.max(...corners.map((p) => p[1])) };
}
export function boardBounds(keys) { const boxes = keys.map(keyBounds); return { width: Math.max(...boxes.map((b) => b.right)), height: Math.max(...boxes.map((b) => b.bottom)) }; }

/** Decode KLE placement, including displaced alternatives, ISO Enter and rotated thumbs. */
export function vialGeometry(definition, selections) {
  const choices = layoutChoices(definition), rows = definition?.layouts?.keymap;
  if (!Array.isArray(selections) || selections.length !== choices.length || selections.some((v, i) => !Number.isInteger(v) || v < 0 || v >= choices[i].options.length)) throw new Error("Review every physical layout choice before loading the saved preview.");
  if (!Array.isArray(rows) || rows.length > 128) throw new Error("Unsupported Vial geometry.");
  let x = 0, y = 0, rx = 0, ry = 0, rotation = 0, w = 1, h = 1, secondary = {}, decal = false;
  const all = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length > 512) throw new Error("Invalid geometry row.");
    for (const item of row) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const numeric = ["x", "y", "w", "h", "x2", "y2", "w2", "h2", "r", "rx", "ry"];
        if (Object.keys(item).some((k) => ![...numeric, "c", "d"].includes(k))) throw new Error("This Vial decoration needs a dedicated importer.");
        for (const k of numeric) if (item[k] !== undefined && (typeof item[k] !== "number" || !Number.isFinite(item[k]) || Math.abs(item[k]) > (k === "r" ? 180 : 256))) throw new Error("Invalid geometry coordinate.");
        if ("r" in item) rotation = item.r;
        if ("rx" in item) { rx = item.rx; x = rx; y = ry; }
        if ("ry" in item) { ry = item.ry; x = rx; y = ry; }
        x += item.x ?? 0; y += item.y ?? 0; w = item.w ?? w; h = item.h ?? h;
        for (const k of ["x2", "y2", "w2", "h2"]) if (k in item) secondary[k] = item[k];
        if ("d" in item) decal = Boolean(item.d);
        continue;
      }
      if (typeof item !== "string" || item.length > 128 || w < .25 || h < .25 || w > 16 || h > 16) throw new Error("Invalid geometry key.");
      if (!decal) {
        const labels = item.split("\n"), matrix = /^(\d+),(\d+)$/.exec(labels[0]);
        if (!matrix) throw new Error("A physical key has no matrix identity.");
        let group = null, option = null;
        if (labels[3]) { const c = /^(\d+),(\d+)$/.exec(labels[3]); if (!c || !choices[+c[1]] || +c[2] >= choices[+c[1]].options.length) throw new Error("Invalid layout option identity."); group = +c[1]; option = +c[2]; }
        const rects = [{ x: 0, y: 0, w, h }];
        if (Object.keys(secondary).length) rects.push({ x: secondary.x2 ?? 0, y: secondary.y2 ?? 0, w: secondary.w2 ?? w, h: secondary.h2 ?? h });
        const left = Math.min(...rects.map((r) => r.x)), top = Math.min(...rects.map((r) => r.y));
        const width = Math.max(...rects.map((r) => r.x + r.w)) - left, height = Math.max(...rects.map((r) => r.y + r.h)) - top;
        const p = rotate(x + left - rx, y + top - ry, rotation);
        all.push({ id: `m${matrix[1]}_${matrix[2]}`, matrix: [+matrix[1], +matrix[2]], x: p[0] + rx, y: p[1] + ry, w: width, h: height,
          ...(rotation ? { rotation } : {}), ...(rects.length > 1 ? { shape: rects.map((r) => ({ ...r, x: r.x - left, y: r.y - top })) } : {}), group, option });
      }
      x += w; w = h = 1; secondary = {}; decal = false;
    }
    y++; x = rx;
  }
  // Alternative keys are stored outside the main drawing. Align each option's
  // bounding corner with option zero before selecting it.
  const anchors = new Map();
  for (const key of all) if (key.group !== null) { const name = `${key.group}:${key.option}`, b = keyBounds(key), old = anchors.get(name); anchors.set(name, { x: Math.min(old?.x ?? Infinity, b.left), y: Math.min(old?.y ?? Infinity, b.top) }); }
  const selected = all.filter((k) => k.group === null || selections[k.group] === k.option).map(({ group, option, ...key }) => {
    if (group !== null) { const base = anchors.get(`${group}:0`), actual = anchors.get(`${group}:${option}`); if (base) { key.x += base.x - actual.x; key.y += base.y - actual.y; } }
    return key;
  });
  if (!selected.length) throw new Error("The chosen layout contains no physical keys.");
  const boxes = selected.map(keyBounds), minX = Math.min(...boxes.map((b) => b.left)), minY = Math.min(...boxes.map((b) => b.top));
  return selected.map((k) => ({ ...k, x: Math.max(0, k.x - minX), y: Math.max(0, k.y - minY) }));
}

/** Trace the perimeter of a connected union of axis-aligned rectangles. */
export function outlinePoints(key) {
  if (!key.shape) return [[0, 0], [key.w, 0], [key.w, key.h], [0, key.h]];
  const xs = [...new Set(key.shape.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b), ys = [...new Set(key.shape.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const inside = (i, j) => i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 && key.shape.some((r) => (xs[i] + xs[i + 1]) / 2 > r.x && (xs[i] + xs[i + 1]) / 2 < r.x + r.w && (ys[j] + ys[j + 1]) / 2 > r.y && (ys[j] + ys[j + 1]) / 2 < r.y + r.h);
  const edges = new Map(), add = (a, b) => edges.set(a.join(","), b);
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) if (inside(i, j)) {
    if (!inside(i, j - 1)) add([xs[i], ys[j]], [xs[i + 1], ys[j]]);
    if (!inside(i + 1, j)) add([xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]]);
    if (!inside(i, j + 1)) add([xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]);
    if (!inside(i - 1, j)) add([xs[i], ys[j + 1]], [xs[i], ys[j]]);
  }
  const start = [...edges.keys()][0]; if (!start) throw new Error("Empty key shape.");
  const points = []; let cursor = start;
  do { points.push(cursor.split(",").map(Number)); const next = edges.get(cursor); if (!next || points.length > 64) throw new Error("Disconnected key shape."); cursor = next.join(","); } while (cursor !== start);
  if (points.length !== edges.size) throw new Error("Disconnected key shape.");
  return points;
}
