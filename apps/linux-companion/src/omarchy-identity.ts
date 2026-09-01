import { constants } from "node:fs";
import { open } from "node:fs/promises";

import type { FixedOmarchySurfaceIdentity, OmarchySurface } from "./omarchy-host-action.ts";

export interface FixedOmarchySurfaceIdentities {
  readonly version: 1;
  readonly vscode?: FixedOmarchySurfaceIdentity;
  readonly terminal?: FixedOmarchySurfaceIdentity;
}

/** Loads only an owner-controlled, no-follow commissioning artifact. */
export async function loadFixedOmarchySurfaceIdentities(filePath: string): Promise<FixedOmarchySurfaceIdentities | undefined> {
  let handle;
  try { handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (missing(error)) return undefined; throw error; }
  let raw: string;
  try {
    const before = await handle.stat();
    const uid = process.getuid?.();
    if (!before.isFile() || uid === undefined || before.uid !== uid || before.size < 2 || before.size > 4_096 || (before.mode & 0o077) !== 0) {
      throw new Error("The Omarchy surface identity file is unsafe.");
    }
    raw = await handle.readFile("utf8");
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error("The Omarchy surface identity changed while it was read.");
    }
  } finally { await handle.close(); }
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !exact(value, ["version", ...(value.vscode === undefined ? [] : ["vscode"]), ...(value.terminal === undefined ? [] : ["terminal"])]) || value.version !== 1) {
    throw new Error("The Omarchy surface identity artifact is invalid.");
  }
  const identities = Object.freeze({
    version: 1 as const,
    ...(value.vscode === undefined ? {} : { vscode: validate(value.vscode, "vscode") }),
    ...(value.terminal === undefined ? {} : { terminal: validate(value.terminal, "terminal") })
  });
  if (!identities.vscode && !identities.terminal) throw new Error("The Omarchy surface identity artifact contains no commissioned surface.");
  return identities;
}

function validate(value: unknown, surface: OmarchySurface): FixedOmarchySurfaceIdentity {
  if (!record(value) || !exact(value, ["version", "surface", "initialClass"]) || value.version !== 1 || value.surface !== surface
    || typeof value.initialClass !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,127}$/u.test(value.initialClass)) {
    throw new Error(`The fixed Omarchy ${surface} identity is invalid.`);
  }
  return Object.freeze({ version: 1, surface, initialClass: value.initialClass });
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"; }
