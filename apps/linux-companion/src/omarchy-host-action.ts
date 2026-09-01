import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { OmarchyCapability, OmarchyHostEvidence } from "./omarchy-capabilities.ts";

const execFileAsync = promisify(execFile);

export type OmarchyFocusAction = "focus_vscode" | "focus_external_terminal";
export type OmarchySurface = "vscode" | "terminal";

export interface FixedOmarchySurfaceIdentity {
  readonly version: 1;
  readonly surface: OmarchySurface;
  /** Exact Hyprland initialClass captured during separate host provisioning. */
  readonly initialClass: string;
}

export interface OmarchyFocusPlan {
  readonly action: OmarchyFocusAction;
  readonly surface: OmarchySurface;
  readonly executable: "/usr/bin/hyprctl";
  readonly arguments: readonly ["dispatch", string];
  readonly shell: false;
}

export interface OmarchyFocusExecution {
  readonly action: OmarchyFocusAction;
  readonly surface: OmarchySurface;
  readonly disposition: "committed";
  readonly summary: string;
}

export interface OmarchyHostActionPorts {
  readonly run?: (executable: string, args: readonly string[], options: Readonly<{ signal: AbortSignal; timeoutMs: number; maxBuffer: number }>) => Promise<Readonly<{ stdout: string; stderr: string }>>;
  readonly timeoutMs?: number;
}

export interface OmarchyHostActionExecutionOptions {
  readonly signal: AbortSignal;
  /** Durable single-use barrier supplied by the companion-owned consumer. */
  readonly beforeEffect?: () => Promise<void>;
}

const requiredCapabilities: readonly OmarchyCapability[] = ["omarchy", "hyprland", "wayland"];

/**
 * Produces only a closed focus plan. It cannot launch a process, accept a
 * repository path, route a URL, or interpolate caller-supplied arguments.
 */
export function planOmarchyFocus(
  action: OmarchyFocusAction,
  evidence: OmarchyHostEvidence,
  identities: Readonly<Partial<Record<OmarchySurface, FixedOmarchySurfaceIdentity>>>
): OmarchyFocusPlan {
  if (evidence.platform !== "linux" || evidence.schemaVersion !== 1) throw new Error("Omarchy host actions require Linux capability evidence.");
  const missing = requiredCapabilities.filter((id) => !evidence.capabilities.some((capability) => capability.id === id && capability.available));
  if (missing.length) throw new Error(`Omarchy host action is unavailable; missing capabilities: ${missing.join(", ")}.`);
  const surface = action === "focus_vscode" ? "vscode" : action === "focus_external_terminal" ? "terminal" : undefined;
  if (!surface) throw new Error("The Omarchy host action is outside the closed focus map.");
  const identity = identities[surface];
  if (!identity || identity.version !== 1 || identity.surface !== surface) throw new Error(`The fixed Omarchy ${surface} surface identity is unavailable.`);
  const initialClass = validateInitialClass(identity.initialClass);
  return Object.freeze({
    action,
    surface,
    executable: "/usr/bin/hyprctl" as const,
    arguments: Object.freeze(["dispatch", `hl.dsp.focus({ window = "initialclass:^(${escapeRegex(initialClass)})$" })`] as const),
    shell: false as const
  });
}

function validateInitialClass(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,127}$/u.test(value)) throw new Error("The fixed Omarchy surface class is invalid.");
  return value;
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

/**
 * Native, shell-free effect boundary for the two closed Omarchy focus plans.
 * It cannot launch a missing surface and treats any non-canonical hyprctl
 * response as failure rather than inferring that focus occurred.
 */
export class NativeOmarchyHostActionAdapter {
  private readonly run: NonNullable<OmarchyHostActionPorts["run"]>;
  private readonly timeoutMs: number;

  constructor(ports: OmarchyHostActionPorts = {}) {
    this.run = ports.run ?? runHyprctl;
    this.timeoutMs = ports.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000) {
      throw new Error("The Omarchy host-action timeout is outside safe bounds.");
    }
  }

  async execute(
    action: OmarchyFocusAction,
    evidence: OmarchyHostEvidence,
    identities: Readonly<Partial<Record<OmarchySurface, FixedOmarchySurfaceIdentity>>>,
    options: AbortSignal | OmarchyHostActionExecutionOptions
  ): Promise<OmarchyFocusExecution> {
    const signal = options instanceof AbortSignal ? options : options.signal;
    if (signal.aborted) throw signal.reason ?? new Error("The Omarchy host action was cancelled.");
    const plan = planOmarchyFocus(action, evidence, identities);
    const identity = identities[plan.surface]!;
    const before = await this.run(plan.executable, ["clients", "-j"], { signal, timeoutMs: this.timeoutMs, maxBuffer: 64 * 1024 });
    if (before.stderr.trim() || !mappedSurfaceExists(before.stdout, identity.initialClass)) throw new Error("The exact mapped Omarchy surface is unavailable.");
    if (!(options instanceof AbortSignal) && options.beforeEffect) await options.beforeEffect();
    if (signal.aborted) throw signal.reason ?? new Error("The Omarchy host action was cancelled at its durable boundary.");
    const result = await this.run(plan.executable, plan.arguments, { signal, timeoutMs: this.timeoutMs, maxBuffer: 4 * 1024 });
    if (result.stdout.trim() !== "ok" || result.stderr.trim() !== "") {
      throw new Error("Hyprland did not acknowledge the exact Omarchy focus action.");
    }
    const after = await this.run(plan.executable, ["activewindow", "-j"], { signal, timeoutMs: this.timeoutMs, maxBuffer: 16 * 1024 });
    if (after.stderr.trim() || !activeSurfaceMatches(after.stdout, identity.initialClass)) throw new Error("Hyprland did not verify the exact focused Omarchy surface.");
    return Object.freeze({
      action: plan.action,
      surface: plan.surface,
      disposition: "committed" as const,
      summary: `Hyprland acknowledged the exact ${plan.surface} initialClass focus request.`
    });
  }
}

function mappedSurfaceExists(value: string, initialClass: string): boolean {
  let clients: unknown; try { clients = JSON.parse(value); } catch { return false; }
  return Array.isArray(clients) && clients.some((client) => record(client) && client.mapped === true && client.initialClass === initialClass);
}

function activeSurfaceMatches(value: string, initialClass: string): boolean {
  let client: unknown; try { client = JSON.parse(value); } catch { return false; }
  return record(client) && client.initialClass === initialClass;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

async function runHyprctl(
  executable: string,
  args: readonly string[],
  options: Readonly<{ signal: AbortSignal; timeoutMs: number; maxBuffer: number }>
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  const { stdout, stderr } = await execFileAsync(executable, [...args], {
    encoding: "utf8",
    signal: options.signal,
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer,
    windowsHide: true
  });
  return { stdout, stderr };
}
