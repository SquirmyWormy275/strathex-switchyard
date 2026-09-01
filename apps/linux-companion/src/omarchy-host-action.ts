import type { OmarchyCapability, OmarchyHostEvidence } from "./omarchy-capabilities.ts";

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
  readonly arguments: readonly ["dispatch", "focuswindow", string];
  readonly shell: false;
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
    arguments: Object.freeze(["dispatch", "focuswindow", `class:^(${escapeRegex(initialClass)})$`] as const),
    shell: false as const
  });
}

function validateInitialClass(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,127}$/u.test(value)) throw new Error("The fixed Omarchy surface class is invalid.");
  return value;
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
