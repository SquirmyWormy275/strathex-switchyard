#!/usr/bin/env node
/** Build portable source-reference profiles for all catalog configurations. */
import { readFile, mkdir, writeFile, readdir, cp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { standardPreset } from "../tools/layout-studio/catalog.mjs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--dir")) throw new Error("Usage: node scripts/export-model-f-presets.mjs [--dir OUTPUT_DIRECTORY]");
const output = resolve(args[1] ?? new URL("../artifacts/model-f-standard-configurations", import.meta.url).pathname);
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error("Choose an empty output directory. Existing profiles are never overwritten.");
const catalog = JSON.parse(await readFile(new URL("../tools/layout-studio/model-f-catalog.json", import.meta.url), "utf8"));
const files = [];
async function save(model, options) {
  const value = standardPreset(catalog, model.id, options), file = `${model.id}--${value.variant.id}${options.typing === "dvorak" ? "--dvorak" : ""}.json`, data = JSON.stringify(value.portable, null, 2) + "\n";
  await writeFile(join(output, file), data, { flag: "wx" });
  files.push({ modelId: model.id, configuration: value.variant.id, typing: value.typing, file, sha256: createHash("sha256").update(data).digest("hex"), evidence: "source-reference", sources: value.sources });
}
for (const model of catalog.models) if (model.variants.length) {
  for (const variant of model.variants) await save(model, { variantId: variant.id });
  await save(model, { typing: "dvorak" });
}
await writeFile(join(output, "manifest.json"), JSON.stringify({ schema: "switchyard-standard-presets/v1", checkedAt: catalog.checkedAt, boundary: "Reference plans only; not firmware, live-device evidence or configuration backups.", files, pendingModels: catalog.models.filter((m) => !m.variants.length).map((m) => ({ id: m.id, reason: m.note })) }, null, 2) + "\n", { flag: "wx" });
await writeFile(join(output, "README.txt"), "Switchyard · Model F Labs standard configurations\n\nOpen a profile in Switchyard. Each includes four modified task controls and the Keep my place workflow. No host shortcut, keymap, firmware or account is changed by opening it. Read/import the actual typing layer before connecting controls. Dvorak files assume Dvorak in firmware with a US host layout; they do not change either.\n\nmanifest.json records source evidence and file checksums. Manufacturer proposals without verified geometry are listed as pending, not fabricated. GPL source/attribution: third_party/model-f-catalog in the source checkout.\n", { flag: "wx" });
await cp(new URL("../third_party/model-f-catalog/", import.meta.url), join(output, "upstream-source"), { recursive: true, force: false, errorOnExist: true });
console.log(`Exported ${files.length} portable profiles to ${output}`);
