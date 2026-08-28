import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { userInfo } from "node:os";

import type { ConfirmationAttestationRequest, ConfirmationAttestor } from "../../../packages/control-plane/src/runtime.ts";
import type { WindowsUserPresenceResult, WindowsUserPresenceRunner } from "../../windows-companion/src/windows-user-presence.ts";

const pkcheckPath = "/usr/bin/pkcheck";
const actionId = "org.strathex.switchyard.confirm";

export type LinuxPolkitRunner = (request: Readonly<{ executable: string; args: readonly string[]; timeoutMs: number }>) => Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>>;

/** Current-user reauthentication through a reviewed polkit auth_self action. */
export class LinuxPolkitUserPresenceRunner implements WindowsUserPresenceRunner {
  constructor(private readonly runner: LinuxPolkitRunner = runPkcheck) {}

  async verify(prompt: string): Promise<WindowsUserPresenceResult> {
    const normalized = prompt.replace(/[\0\r\n]+/g, " ").trim();
    if (!normalized || normalized.length > 240) throw new Error("The Linux user-presence prompt is invalid.");
    const startTicks = await currentStartTicks();
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("The Linux current-user identity is unavailable.");
    const result = await this.runner({ executable: pkcheckPath, args: ["--action-id", actionId, "--process", `${process.pid},${startTicks},${uid}`, "--allow-user-interaction"], timeoutMs: 120_000 });
    if (result.stdout || result.stderr) throw new Error("polkit returned unexpected output.");
    if (result.exitCode !== 0) return { verified: false };
    const operator = userInfo().username;
    if (!/^[A-Za-z0-9_.@-]{1,160}$/.test(operator)) throw new Error("The Linux operator identity is invalid.");
    return { verified: true, operator };
  }
}

export class LinuxPolkitConfirmationAttestor implements ConfirmationAttestor {
  constructor(private readonly presence: WindowsUserPresenceRunner = new LinuxPolkitUserPresenceRunner()) {}
  async attest(input: ConfirmationAttestationRequest): Promise<Readonly<{ reauthenticated: boolean; operator: string }> | undefined> {
    const digest = input.reviewedScopeDigest;
    if (digest !== undefined && !/^[a-f0-9]{64}$/.test(digest)) throw new Error("The reviewed Linux confirmation scope digest is invalid.");
    const summary = input.reviewedScopeSummary?.replace(/[\0\r\n]+/g, " ").trim();
    const prefix = `Approve SXSY-B122 ${input.definition.title}.`;
    const prompt = digest && summary ? `${prefix} Reviewed scope ${digest}. ${summary}`.slice(0, 240) : `${prefix} Verify the exact target and scope in VS Code.`;
    const result = await this.presence.verify(prompt);
    return result.verified && result.operator ? { reauthenticated: true, operator: result.operator } : undefined;
  }
}

export async function runPkcheck(request: Readonly<{ executable: string; args: readonly string[]; timeoutMs: number }>): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  if (process.platform !== "linux" || request.executable !== pkcheckPath || await realpath(pkcheckPath) !== pkcheckPath) throw new Error("The fixed Linux polkit verifier is unavailable.");
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, request.args, { shell: false, env: linuxDesktopEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let bytes = 0;
    const collect = (target: "stdout" | "stderr") => (chunk: Buffer): void => { bytes += chunk.length; if (bytes > 4096) { child.kill("SIGKILL"); return; } if (target === "stdout") stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8"); };
    child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr")); child.once("error", reject);
    const timer = setTimeout(() => child.kill("SIGKILL"), request.timeoutMs);
    child.once("close", (code) => { clearTimeout(timer); resolve({ exitCode: bytes > 4096 ? -1 : code ?? -1, stdout, stderr }); });
  });
}

async function currentStartTicks(): Promise<string> {
  const fields = (await readFile(`/proc/${process.pid}/stat`, "utf8")).trim().replace(/^\d+ \([^)]*\) /, "").split(" ");
  const value = fields[19];
  if (!value || !/^[0-9]+$/.test(value)) throw new Error("The Linux process identity is unavailable.");
  return value;
}

function linuxDesktopEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  for (const name of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "DISPLAY", "WAYLAND_DISPLAY", "HOME", "LANG", "LC_ALL"]) if (process.env[name]) result[name] = process.env[name];
  return result;
}
