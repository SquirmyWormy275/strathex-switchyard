import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assignments, canonicalManifestJson, controls, manifestSha256, modifierMask } from "../src/b122.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const sourcePath = resolve(root, "packages/protocol/src/b122.ts");
const jsonPath = resolve(root, "packages/protocol/generated/b122-control-map.json");
const headerPath = resolve(root, "firmware/qmk/keymaps/b122/b122_manifest.h");
const actualHash = createHash("sha256").update(canonicalManifestJson).digest("hex");
const write = process.argv.includes("--write");

const masks = controls.map((control) => assignments.filter((entry) => entry.control === control).reduce((mask, entry) => mask | (1 << modifierMask(entry.modifier)), 0));
const fingerprint = actualHash.slice(0, 16).match(/../g).map((value) => `0x${value.toUpperCase()}`);
const enumEntries = controls.map((control, index) => `    B122_CONTROL_${control} = ${index + 1},`).join("\n");
const header = `/* Generated from packages/protocol/src/b122.ts. Do not edit. */
#pragma once

#define B122_CONTROL_COUNT 22
#define B122_ASSIGNMENT_COUNT 65
#define B122_MANIFEST_SHA256 "${actualHash}"
#define B122_MAP_FINGERPRINT_BYTES { ${fingerprint.join(", ")} }

enum b122_control_id {
${enumEntries}
};

static const unsigned char b122_assignment_masks[B122_CONTROL_COUNT + 1] = {
    0x00, ${masks.map((mask) => `0x${mask.toString(16).padStart(2, "0").toUpperCase()}`).join(", ")}
};
`;
const json = `${JSON.stringify(JSON.parse(canonicalManifestJson), null, 2)}\n`;

if (write) {
  const source = await readFile(sourcePath, "utf8");
  const updated = source.replace(/export const manifestSha256 = "[0-9a-f_]+";/, `export const manifestSha256 = "${actualHash}";`);
  if (updated === source && manifestSha256 !== actualHash) throw new Error("Could not update manifestSha256 in b122.ts.");
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(sourcePath, updated, "utf8");
  await writeFile(jsonPath, json, "utf8");
  await writeFile(headerPath, header, "utf8");
  process.stdout.write(`${actualHash}\n`);
} else {
  const failures = [];
  if (manifestSha256 !== actualHash) failures.push(`manifestSha256 is ${manifestSha256}, expected ${actualHash}`);
  for (const [path, expected] of [[jsonPath, json], [headerPath, header]]) {
    const actual = await readFile(path, "utf8").catch(() => "");
    if (actual.replace(/\r\n/g, "\n") !== expected) failures.push(`${path} is missing or stale`);
  }
  if (failures.length) throw new Error(failures.join("\n"));
  process.stdout.write(`B122 manifest verified: ${actualHash}\n`);
}
