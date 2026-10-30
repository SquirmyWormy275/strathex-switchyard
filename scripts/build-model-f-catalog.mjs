#!/usr/bin/env node
/** Offline, deterministic extraction. Never evaluates C or imports firmware code. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { layoutChoices, unpackChoices } from "../tools/layout-studio/geometry.mjs";
const root = new URL("../third_party/model-f-catalog/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("SOURCES.json", root), "utf8"));
const bytes = new Map();
for (const entry of manifest.files) {
  const data = await readFile(new URL(entry.file, root));
  if (createHash("sha256").update(data).digest("hex") !== entry.sha256) throw new Error(`Source integrity failed: ${entry.file}`);
  bytes.set(entry.file, data.toString("utf8"));
}
const json = (p) => JSON.parse(bytes.get(p));
const wc = "ploxiln/keyboards/xwhatsit/brand_new_model_f/", lj = "mymakercorner/keyboards/leyden_jar/";
const definitions = {}, builds = {};
const title = (s) => s.replaceAll("_", " ").replaceAll("-", " · ").replace(/\bansi\b/gi, "ANSI").replace(/\biso\b/gi, "ISO").replace(/\bhhkb\b/gi, "HHKB").replace(/\bhhshift\b/gi, "HHKB Shift + Ctrl/Caps").replace(/\bfn\b/g, "split Shift").replace(/\bnlock\b/g, "Num Lock layer").replace(/\bsimulock\b/g, "simulated Num Lock").replace(/\bopt(\d)\b/g, "right block $1");
for (const [p] of bytes) if (p.startsWith(wc) && p.endsWith("/wcass/vial.json")) {
  const name = p.slice(wc.length).split("/")[0], id = `wcass:${name}`;
  definitions[id] = { definition: json(p), source: p };
  const prefix = `${wc}${name}/wcass/keymaps/`;
  const variants = [...bytes.keys()].filter((p) => p.startsWith(prefix) && p.endsWith(".vil") && !p.includes("allpads")).map((file) => {
    const v = json(file), stem = file.slice(prefix.length, -4), base = v.layout?.[0], def = definitions[id].definition;
    if (!Array.isArray(base) || base.length !== def.matrix.rows || base.some((r) => r.length !== def.matrix.cols)) throw new Error(`Invalid reference matrix: ${file}`);
    return { id: stem, label: title(stem.replace(/^[^-]+-/, "")), parts: [{ definitionId: id, base: base.map((r) => r.map((c) => c === -1 ? null : c)), choices: unpackChoices(def, layoutChoices(def).length ? v.layout_options ?? 0 : 0), source: file }] };
  });
  if (!variants.length) variants.push({ id: `${name}-geometry`, label: "Physical reference · typing layer unavailable", parts: [{ definitionId: id, base: null, choices: layoutChoices(definitions[id].definition).map(() => 0), source: p }] });
  builds[name] = variants;
}
function cArguments(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const start = /\[_BASE\]\s*=\s*LAYOUT\s*\(/.exec(clean); if (!start) throw new Error("No explicit _BASE LAYOUT in source.");
  let depth = 1, pos = start.index + start[0].length, part = ""; const result = [];
  for (; pos < clean.length; pos++) { const c = clean[pos]; if (c === "(") depth++; if (c === ")") depth--; if (depth === 0) { if (part.trim()) result.push(part.trim()); return result; } if (c === "," && depth === 1) { result.push(part.trim()); part = ""; } else part += c; }
  throw new Error("Unclosed reference layout.");
}
for (const model of ["f122", "b104", "b122", "f20", "f4x12", "f5x12", "f50", "f50_rev2", "f62", "f77"]) {
  const keyboardPath = `${lj}${model}/keyboard.json`, keyboard = json(keyboardPath), variants = [];
  for (const p of bytes.keys()) if (p.startsWith(`${lj}${model}/keymaps/`) && p.endsWith("/vial.json")) {
    const name = p.split("/").at(-2), def = json(p), id = `leyden:${model}:${name}`;
    definitions[id] = { definition: def, source: p };
    const cfile = p.replace("vial.json", "keymap.c"), jfile = p.replace("vial.json", "keymap.json");
    let codes = null, layoutName = "LAYOUT", source = p;
    if (bytes.has(cfile)) { codes = cArguments(bytes.get(cfile)); source = cfile; }
    else if (bytes.has(jfile)) { const km = json(jfile); codes = km.layers[0]; layoutName = km.layout; source = jfile; }
    let base = null;
    if (codes) {
      const keys = keyboard.layouts[layoutName].layout;
      if (codes.length !== keys.length || codes.some((c) => typeof c !== "string" || !/^[_A-Z][_A-Z0-9()|, ]{0,63}$/.test(c))) throw new Error(`Reference keys mismatch: ${source}`);
      base = Array.from({ length: def.matrix.rows }, () => Array(def.matrix.cols).fill(null));
      keys.forEach((k, i) => { const [r, c] = k.matrix; if (!base[r] || c >= base[r].length) throw new Error(`Reference matrix mismatch: ${p}`); base[r][c] = codes[i]; });
    }
    variants.push({ id: `${model}-${name}`, label: name === "vial" ? "Standard ANSI" : title(name.replace(/^vial-/, "")), parts: [{ definitionId: id, base, choices: layoutChoices(def).map(() => 0), source, geometrySource: keyboardPath }] });
  }
  builds[`leyden-${model}`] = variants;
}
function paired(left, right) {
  return builds[left].map((v) => {
    const suffix = v.id.replace(/^[^-]+-/, ""), other = builds[right].find((r) => r.id.replace(/^[^-]+-/, "") === suffix);
    if (!other) throw new Error(`Missing matching split half: ${v.id}`);
    return { id: `${left.replace(/_left$/, "")}-${suffix}`, label: v.label, parts: [v.parts[0], other.parts[0]] };
  });
}
const models = [];
function model(id, name, group, form, build, product, note = "", status = "listed-model") {
  const variants = typeof build === "string" ? builds[build] : build;
  if (!variants?.length) throw new Error(`No configurations for ${id}`);
  const preferred = variants.find((v) => /-(ansi|default|alpha)(?:_opt1)?$/.test(v.id)) ?? variants.find((v) => /-vial-ansi$/.test(v.id)) ?? variants[0];
  models.push({ id, name, group, form, status, product: `https://modelfkeyboards.com/product/${product}/`, note, recommended: preferred.id, variants });
}
model("f77-classic", "F77 · Classic", "Model F", "compact", "f77", "f77-model-f-keyboard", "F77 is the pilot. The right-hand block and typing layout remain your choice.");
model("f77-compact", "F77 · Ultra Compact", "Model F", "compact", "f77", "f77-model-f-keyboard-ultra-compact");
model("f62-classic", "F62 Kishsaver · Classic", "Model F", "compact", "f62", "f62-model-f-keyboard-kishsaver");
model("f62-compact", "F62 Kishsaver · Ultra Compact", "Model F", "compact", "f62", "f62-model-f-keyboard-kishsaver-ultra-compact");
model("f104-classic", "F104 · Classic", "Model F", "full", "f104_round2", "classic-f104-model-f-keyboard", "Classic and Ultra Compact use different build identities. Read the device before choosing a controller build.");
model("f104-compact", "F104 · Ultra Compact", "Model F", "full", "f104_round_1_shrunk", "ultra-compact-f104-model-f-keyboard");
model("fssk-classic", "FSSK · Classic", "Model F", "tkl", "fssk_round2", "classic-style-fssk-model-f-keyboard");
model("fssk-compact", "FSSK · Ultra Compact", "Model F", "tkl", "fssk_round_1", "ultra-compact-fssk-model-f-keyboard");
model("f122", "F122 · Classic", "Model F", "extended", "leyden-f122", "classic-style-f122-model-f-keyboard", "Includes the second function row, navigation cluster and keypad choices.");
model("f50-compact", "F50 · Ultra Compact", "Model F", "pad", "f50", "f50-model-f-keyboard-auction-winners", "Reference alpha layout. Task controls use modified R / S / V / H positions.");
model("f50-nos", "F50 · Original IBM / NOS", "Model F", "pad", "f50", "original-ibm-model-f-metal-case-50-key-f50-keyboard-part-6019273", "Physical reference only. Original IBM and replacement controllers need their own live read; no controller compatibility is inferred.");
model("f15", "F15 · Split Ergonomic", "Model F", "split", paired("f15_left", "f15_right"), "split-ergonomic-f15-model-f-keyboard-auction-winners", "Two independent USB interfaces. Both halves are shown; their matrix identities remain separate.");
model("fortho", "Split Ortholinear · Original round", "Model F", "split", paired("fortho_left", "fortho_right"), "ortholinear-split-ergonomic-model-f-keyboard-auction-winners", "Two independent USB interfaces with rotated thumb clusters.");
model("b104-r1", "B104 · Round 1 Compact", "Beam Spring", "full", "beamspring_full", "beam-spring-round-1-keyboard");
model("bssk-r1", "BSSK · Round 1 Compact", "Beam Spring", "tkl", "beamspring_ssk", "beam-spring-round-1-bssk-keyboard");
model("b104-r2", "B104 · Round 2 Classic", "Beam Spring", "full", "leyden-b104", "beam-spring-b104-keyboard");
model("bssk-r2", "BSSK · Round 2 Classic", "Beam Spring", "tkl", "beamspring_ssk_r2", "beam-spring-bssk-keyboard");
model("b122", "B122 · Round 2 Classic", "Beam Spring", "extended", "leyden-b122", "beam-spring-b122-keyboard");
model("b62", "B62 · Round 2 Classic", "Beam Spring", "compact", "beamspring_60pct", "beam-spring-b62-keyboard");
const newDesigns = "ultra-compact-new-model-f-designs-split-ortho-planck-preonic-6x12-f20-kinesis-advantage-unsaver-etc";
for (const [id, name, form, build] of [["f4x12", "4 × 12 ortholinear", "ortho", "leyden-f4x12"], ["f5x12", "5 × 12 ortholinear", "ortho", "leyden-f5x12"], ["f20", "F20 number pad", "pad", "leyden-f20"]]) model(id, name, "Proposed designs", form, build, newDesigns, "Development firmware source exists. Manufacturer production and hardware compatibility are unverified.", "development-reference");
for (const [id, name] of [["f6x12", "6 × 12 ortholinear"], ["kinesis-advantage2", "Kinesis Advantage2 style"], ["kinesis-advantage360", "Kinesis Advantage 360 Pro style"], ["unsaver", "Unsaver"], ["fortho-next", "Split Ortholinear · Leyden Jar proposal"]]) models.push({ id, name, group: "Proposed designs", status: "proposed-no-geometry", form: "proposal", product: `https://modelfkeyboards.com/product/${newDesigns}/`, note: "Manufacturer proposal. No verified final geometry or shipping configuration; a hardware preset is not fabricated.", recommended: null, variants: [] });
const output = { schema: "switchyard-model-f-catalog/v1", checkedAt: manifest.checkedAt, sourceManifest: "third_party/model-f-catalog/SOURCES.json", license: "Upstream GPL version 2; retain file-specific GPL-2.0-or-later notices where stated", definitions, models,
  additionalBuilds: Object.fromEntries(["f104_round_1_nonshrunk", "leyden-f50", "leyden-f50_rev2", "leyden-f62", "leyden-f77"].map((name) => [name, builds[name]])) };
const destination = new URL("../tools/layout-studio/model-f-catalog.json", import.meta.url), encoded = JSON.stringify(output) + "\n";
if (process.argv.includes("--check")) { if (await readFile(destination, "utf8") !== encoded) throw new Error("Catalog is stale. Regenerate it."); }
else await writeFile(destination, encoded);
console.log(`${process.argv.includes("--check") ? "Verified" : "Built"} ${models.length} models, ${models.reduce((n, m) => n + m.variants.length, 0)} named reference configurations (${encoded.length} bytes).`);
