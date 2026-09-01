import { execFile } from "node:child_process";
import { chmod, open, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { provisionLinuxCompanionPaths } from "./linux-paths.ts";
import { loadFixedOmarchySurfaceIdentities, type FixedOmarchySurfaceIdentities } from "./omarchy-identity.ts";

const run = promisify(execFile);
const allowedTerminals: Readonly<Record<string, string>> = Object.freeze({ foot: "/usr/bin/foot", alacritty: "/usr/bin/alacritty", kitty: "/usr/bin/kitty", ghostty: "/usr/bin/ghostty" });

interface Client { readonly pid?: unknown; readonly initialClass?: unknown; readonly mapped?: unknown; }

/** Captures identities only from mapped windows whose /proc executable matches a reviewed installed product. */
export async function commissionOmarchySurfaces(): Promise<FixedOmarchySurfaceIdentities> {
  if (process.platform !== "linux") throw new Error("Omarchy surface commissioning requires Linux.");
  const clients = await liveClients();
  const terminalName = (await run("/usr/bin/omarchy-default-terminal", [], { encoding: "utf8", timeout: 5_000, maxBuffer: 4_096 })).stdout.trim();
  const terminalExecutable = allowedTerminals[terminalName];
  if (!terminalExecutable || await realpath(terminalExecutable) !== terminalExecutable) throw new Error("The Omarchy default terminal is not a reviewed executable.");
  const terminal = await observedIdentity("terminal", clients, terminalExecutable);

  let vscode;
  try {
    if (await realpath("/usr/share/code/code") !== "/usr/share/code/code") throw new Error("VS Code executable changed identity.");
    vscode = await observedIdentity("vscode", clients, "/usr/share/code/code");
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const artifact: FixedOmarchySurfaceIdentities = Object.freeze({ version: 1, ...(vscode ? { vscode } : {}), terminal });
  const { stateDirectory } = await provisionLinuxCompanionPaths();
  const destination = join(stateDirectory, "omarchy-surfaces.json");
  const encoded = `${JSON.stringify(artifact, null, 2)}\n`;
  const existing = await loadFixedOmarchySurfaceIdentities(destination);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(artifact)) throw new Error("A different Omarchy identity artifact already exists; remove it only after reviewing the new live identities.");
    return artifact;
  }
  const temporary = join(stateDirectory, `.omarchy-surfaces.${process.pid}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(encoded, "utf8"); await handle.sync(); } catch (error) { await handle.close(); await rm(temporary, { force: true }); throw error; }
  await handle.close(); await chmod(temporary, 0o600); await rename(temporary, destination);
  return artifact;
}

async function liveClients(): Promise<readonly Client[]> {
  const { stdout, stderr } = await run("/usr/bin/hyprctl", ["clients", "-j"], { encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024 });
  if (stderr.trim()) throw new Error("Hyprland client commissioning returned stderr.");
  const value: unknown = JSON.parse(stdout);
  if (!Array.isArray(value)) throw new Error("Hyprland client commissioning returned an invalid payload.");
  return value as Client[];
}

async function observedIdentity(surface: "vscode" | "terminal", clients: readonly Client[], executable: string) {
  const classes = new Set<string>();
  for (const client of clients) {
    if (client.mapped !== true || !Number.isSafeInteger(client.pid) || (client.pid as number) < 1 || typeof client.initialClass !== "string") continue;
    let observed; try { observed = await realpath(`/proc/${client.pid as number}/exe`); } catch { continue; }
    if (observed === executable && !(surface === "terminal" && client.initialClass.startsWith("org.omarchy."))) classes.add(client.initialClass);
  }
  if (classes.size !== 1) throw new Error(`The live Omarchy ${surface} initialClass is unavailable or ambiguous.`);
  const initialClass = [...classes][0]!;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,127}$/u.test(initialClass)) throw new Error(`The live Omarchy ${surface} initialClass is invalid.`);
  return Object.freeze({ version: 1 as const, surface, initialClass });
}

function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"; }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.stdout.write(`${JSON.stringify(await commissionOmarchySurfaces(), null, 2)}\n`);
