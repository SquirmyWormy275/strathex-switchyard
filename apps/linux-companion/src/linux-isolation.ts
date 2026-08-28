import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";

import type { BrokerOutcome, IsolationRequest, IsolationRuntime } from "../../../packages/control-plane/src/brokers.ts";

const fixedBubblewrapPath = "/usr/bin/bwrap";
const successMarker = "sxsy-b122-linux-sandbox-ok\n";

export interface BubblewrapProbeRequest { readonly executable: string; readonly args: readonly string[]; readonly timeoutMs: number; }
export type BubblewrapProbeRunner = (request: BubblewrapProbeRequest) => Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>>;

export interface LinuxBubblewrapIsolationOptions {
  readonly executable?: string;
  readonly runner?: BubblewrapProbeRunner;
  readonly canonicalize?: (path: string) => Promise<string>;
}

/** Executes an exact one-shot namespace proof; arbitrary client commands never reach bwrap. */
export class LinuxBubblewrapIsolationRuntime implements IsolationRuntime {
  private readonly executable: string;
  private readonly runner: BubblewrapProbeRunner;
  private readonly canonicalize: (path: string) => Promise<string>;

  constructor(options: LinuxBubblewrapIsolationOptions = {}) {
    this.executable = options.executable ?? fixedBubblewrapPath;
    if (this.executable !== fixedBubblewrapPath) throw new Error("Linux isolation requires the fixed /usr/bin/bwrap executable.");
    this.runner = options.runner ?? runBubblewrapProbe;
    this.canonicalize = options.canonicalize ?? realpath;
  }

  async start(request: IsolationRequest): Promise<BrokerOutcome> {
    if (!request.permit || Date.parse(request.permit.expiresAt) <= Date.now()) return blocked("The Linux isolation permit is absent or expired.");
    let first: string;
    try { first = await this.canonicalize(request.target.repositoryRoot); }
    catch { return blocked("The Linux isolation target is not a canonical local repository."); }
    if (first !== request.target.repositoryRoot) return blocked("The Linux isolation target changed during canonicalization.");
    const args = [
      "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup-try", "--unshare-net",
      "--die-with-parent", "--new-session", "--clearenv", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin", "--ro-bind", "/lib", "/lib",
      "--ro-bind", "/etc", "/etc", "--ro-bind", first, "/workspace", "--chdir", "/workspace",
      "/usr/bin/printf", successMarker
    ] as const;
    let second: string;
    try { second = await this.canonicalize(request.target.repositoryRoot); }
    catch { return blocked("The Linux isolation target became unavailable before namespace creation."); }
    if (second !== first) return blocked("The Linux isolation target changed before namespace creation.");
    try {
      const result = await this.runner({ executable: this.executable, args, timeoutMs: 10_000 });
      if (result.exitCode !== 0 || result.stderr || result.stdout !== successMarker) return { status: "unavailable", summary: "Bubblewrap could not prove the exact deny-network namespace; no sandbox was claimed.", effectDisposition: "not_started" };
      return { status: "completed", summary: `Proved an OS-enforced ${request.profile} Bubblewrap namespace with network, PID, IPC, UTS, and user isolation for the exact read-only target.`, effectDisposition: "committed", data: { backend: "bubblewrap", network: "deny", repository: "read-only", profile: request.profile } };
    } catch {
      return { status: "unavailable", summary: "The fixed Bubblewrap runtime is unavailable; no weaker Linux isolation fallback was used.", effectDisposition: "not_started" };
    }
  }
}

export function runBubblewrapProbe(request: BubblewrapProbeRequest): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  if (process.platform !== "linux" || request.executable !== fixedBubblewrapPath || request.timeoutMs !== 10_000) throw new Error("The Linux Bubblewrap probe request is invalid.");
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, request.args, { shell: false, env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let bytes = 0; let overflow = false;
    const collect = (target: "stdout" | "stderr") => (chunk: Buffer): void => { bytes += chunk.length; if (bytes > 4096) { overflow = true; child.kill("SIGKILL"); return; } if (target === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8"); };
    child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr"));
    child.once("error", reject);
    const timer = setTimeout(() => child.kill("SIGKILL"), request.timeoutMs);
    child.once("close", (code) => { clearTimeout(timer); if (overflow) reject(new Error("Bubblewrap probe output exceeded its bound.")); else resolve({ exitCode: code ?? -1, stdout, stderr }); });
  });
}

function blocked(summary: string): BrokerOutcome { return { status: "blocked", summary, effectDisposition: "not_started" }; }
