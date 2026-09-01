import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OmarchyCapability = "omarchy" | "hyprland" | "wayland" | "tmux" | "systemd-user";

export interface OmarchyProbeResult {
  readonly id: OmarchyCapability;
  readonly available: boolean;
  readonly evidence: readonly string[];
  readonly reason?: string;
}

export interface OmarchyHostEvidence {
  readonly schemaVersion: 1;
  readonly collectedAt: string;
  readonly platform: NodeJS.Platform;
  readonly capabilities: readonly OmarchyProbeResult[];
}

export interface OmarchyEvidencePorts {
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly readText?: (path: string) => Promise<string>;
  readonly run?: (executable: string, args: readonly string[]) => Promise<string>;
}

export async function collectOmarchyHostEvidence(ports: OmarchyEvidencePorts = {}): Promise<OmarchyHostEvidence> {
  const platform = ports.platform ?? process.platform;
  const environment = ports.environment ?? process.env;
  const readText = ports.readText ?? ((path) => readFile(path, "utf8"));
  const run = ports.run ?? runCommand;
  const collectedAt = (ports.now ?? (() => new Date()))().toISOString();
  if (platform !== "linux") return { schemaVersion: 1, collectedAt, platform, capabilities: unavailable("Linux is required.") };

  const release = await optional(() => readText("/etc/os-release"));
  const omarchyVersion = await firstCommand(run, [["omarchy-version", []], ["omarchy", ["--version"]]]);
  const hyprlandVersion = await firstCommand(run, [["hyprctl", ["version", "-j"]], ["hyprctl", ["version"]]]);
  const tmuxVersion = await firstCommand(run, [["tmux", ["-V"]]]);
  const systemdVersion = await firstCommand(run, [["systemctl", ["--user", "show-environment"]]]);
  const waylandDisplay = safeEnvironmentValue(environment.WAYLAND_DISPLAY);
  const sessionType = safeEnvironmentValue(environment.XDG_SESSION_TYPE);

  return {
    schemaVersion: 1,
    collectedAt,
    platform,
    capabilities: [
      result("omarchy", [release && osReleaseEvidence(release), omarchyVersion].filter(isText), "No Omarchy marker or version command was found."),
      result("hyprland", [hyprlandVersion].filter(isText), "hyprctl was unavailable."),
      result("wayland", [waylandDisplay && `WAYLAND_DISPLAY=${waylandDisplay}`, sessionType === "wayland" ? "XDG_SESSION_TYPE=wayland" : undefined].filter(isText), "No Wayland session marker was present."),
      result("tmux", [tmuxVersion].filter(isText), "tmux was unavailable."),
      result("systemd-user", [systemdVersion && systemdEnvironment(systemdVersion) ? "systemd user manager responded" : undefined].filter(isText), "The systemd user manager was unavailable.")
    ]
  };
}

function result(id: OmarchyCapability, evidence: readonly string[], reason: string): OmarchyProbeResult {
  return evidence.length ? { id, available: true, evidence } : { id, available: false, evidence: [], reason };
}

function unavailable(reason: string): readonly OmarchyProbeResult[] {
  return (["omarchy", "hyprland", "wayland", "tmux", "systemd-user"] as const).map((id) => ({ id, available: false, evidence: [], reason }));
}

async function firstCommand(run: (executable: string, args: readonly string[]) => Promise<string>, commands: readonly (readonly [string, readonly string[]])[]): Promise<string | undefined> {
  for (const [executable, args] of commands) {
    const output = await optional(() => run(executable, args));
    if (output) return singleLine(output);
  }
  return undefined;
}

async function runCommand(executable: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(executable, [...args], { encoding: "utf8", timeout: 5_000, windowsHide: true, maxBuffer: 64 * 1024 });
  return stdout;
}

async function optional<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try { return await operation(); } catch { return undefined; }
}

function osReleaseEvidence(value: string): string | undefined {
  const fields = new Map(value.split(/\r?\n/u).map((line) => line.split("=", 2) as [string, string]));
  const name = fields.get("NAME")?.replace(/^"|"$/gu, "");
  const version = fields.get("VERSION_ID")?.replace(/^"|"$/gu, "");
  return name?.toLowerCase().includes("omarchy") ? `os-release:${name}${version ? ` ${version}` : ""}` : undefined;
}

function safeEnvironmentValue(value: string | undefined): string | undefined {
  return value && value.length <= 256 && !/[\0\r\n]/u.test(value) ? value : undefined;
}

function singleLine(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/gu, " ").slice(0, 1_024);
  return normalized || undefined;
}

function systemdEnvironment(value: string): boolean {
  const lines = value.trim().split(/\r?\n/u);
  return lines.length > 0 && lines.every((line) => /^[A-Za-z_][A-Za-z0-9_]*=/u.test(line));
}

function isText(value: string | undefined): value is string { return value !== undefined; }
