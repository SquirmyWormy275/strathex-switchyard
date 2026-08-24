/** Windows Job-Object process-tree supervisor for host-attested repository recipes. */
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import type {
  RepositoryProcessRecoveryScope,
  RepositoryProcessStartRequest,
  RepositoryProcessSupervisor,
  RepositorySupervisedProcess
} from "./repository-runtime.ts";

const requestSchema = "sxsy-b122.repository-supervisor-request" as const;
const stateSchema = "sxsy-b122.repository-supervisor-state" as const;
const maximumStateFiles = 128;
const maximumStateBytes = 256 * 1024;
const safeManagedId = /^managed:[a-f0-9]{64}$/;
const safeDigest = /^[a-f0-9]{64}$/;
const terminalStates = new Set(["completed", "failed", "timed_out", "cancelled"]);

export interface RepositorySupervisorHelperInvocation {
  readonly mode: "supervise" | "observe" | "terminate";
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly requestPath: string;
  readonly statePath: string;
  readonly arguments: readonly string[];
  /** Complete helper environment. Deliberately empty for the self-contained helper. */
  readonly environment: Readonly<Record<string, string>>;
}

export interface RepositorySupervisorHelperProcess {
  readonly stdout: Readable;
  readonly stderr: Readable;
  wait(): Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>;
}

export interface RepositorySupervisorHelperTransport {
  invoke(invocation: RepositorySupervisorHelperInvocation): Promise<RepositorySupervisorHelperProcess>;
}

export interface WindowsJobObjectProcessSupervisorOptions {
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly stateRoot: string;
  readonly transport?: RepositorySupervisorHelperTransport;
  readonly stateReadyTimeoutMs?: number;
}

interface SupervisorRequest {
  readonly schema: typeof requestSchema;
  readonly version: 1;
  readonly supervisorId: string;
  readonly operationId: string;
  readonly action: RepositoryProcessStartRequest["action"];
  readonly repositoryRoot: string;
  readonly manifestSha256: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly executable: string;
  readonly executableSha256: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly lifecycle: RepositoryProcessStartRequest["lifecycle"];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly controlToken: string;
  readonly statePath: string;
}

interface SupervisorState {
  readonly schema: typeof stateSchema;
  readonly version: 1;
  readonly supervisorId: string;
  readonly operationId: string;
  readonly action: RepositoryProcessStartRequest["action"];
  readonly repositoryRoot: string;
  readonly manifestSha256: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly requestSha256: string;
  readonly controlTokenSha256: string;
  readonly jobName: string;
  readonly supervisorPid: number;
  readonly childPid: number;
  readonly startedAt: string;
  readonly state: "running" | "completed" | "failed" | "timed_out" | "cancelled";
  readonly exitCode: number | null;
  readonly outputTruncated: boolean;
}

class NodeRepositorySupervisorHelperTransport implements RepositorySupervisorHelperTransport {
  async invoke(invocation: RepositorySupervisorHelperInvocation): Promise<RepositorySupervisorHelperProcess> {
    const child = spawn(invocation.helperPath, [...invocation.arguments], {
      cwd: dirname(invocation.requestPath),
      env: { ...invocation.environment },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const started = await new Promise<boolean>((resolveStart) => {
      child.once("spawn", () => resolveStart(true));
      child.once("error", () => resolveStart(false));
    });
    if (!started || !child.stdout || !child.stderr) throw new Error("The reviewed repository process-tree helper failed before spawn.");
    let settle!: (value: { readonly code: number; readonly signal: NodeJS.Signals | null }) => void;
    const exit = new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((resolveExit) => { settle = resolveExit; });
    let settled = false;
    child.once("close", (code, signal) => { if (!settled) { settled = true; settle({ code: code ?? -1, signal }); } });
    child.once("error", () => { if (!settled) { settled = true; settle({ code: -1, signal: null }); } });
    return { stdout: child.stdout, stderr: child.stderr, wait: async () => exit };
  }
}

export class WindowsJobObjectProcessSupervisor implements RepositoryProcessSupervisor {
  private helperPath: string;
  private readonly helperSha256: string;
  private stateRoot: string;
  private readonly transport: RepositorySupervisorHelperTransport;
  private readonly stateReadyTimeoutMs: number;

  constructor(options: WindowsJobObjectProcessSupervisorOptions) {
    if (!isAbsolute(options.helperPath) || !safeDigest.test(options.helperSha256)) throw new Error("The repository Job-Object helper requires an exact absolute path and SHA-256 digest.");
    if (!isAbsolute(options.stateRoot)) throw new Error("The repository supervisor state root must be absolute.");
    this.helperPath = resolve(options.helperPath);
    this.helperSha256 = options.helperSha256.toLowerCase();
    this.stateRoot = resolve(options.stateRoot);
    this.transport = options.transport ?? new NodeRepositorySupervisorHelperTransport();
    this.stateReadyTimeoutMs = options.stateReadyTimeoutMs ?? 5_000;
  }

  async start(input: RepositoryProcessStartRequest): Promise<RepositorySupervisedProcess> {
    const helperPath = await this.assertHelperIdentity();
    const repositoryRoot = await realpath(input.repositoryRoot);
    const executable = await realpath(input.executable);
    const workingDirectory = await realpath(input.cwd);
    if (!inside(workingDirectory, repositoryRoot) || !safeDigest.test(input.manifestSha256) || !safeDigest.test(input.executableSha256)) {
      throw new Error("Repository supervisor input escaped its canonical scope or lacked exact digests.");
    }
    if (sha256(await readFile(executable)) !== input.executableSha256.toLowerCase()) throw new Error("The repository executable digest changed before supervisor handoff.");
    const stateRoot = await this.ensureStateRoot();
    const supervisorId = `managed:${sha256(`${randomUUID()}:${randomBytes(32).toString("hex")}:${Date.now()}`)}`;
    const stem = supervisorId.slice("managed:".length);
    const requestPath = join(stateRoot, `${stem}.request.json`);
    const statePath = join(stateRoot, `${stem}.state.json`);
    const request: SupervisorRequest = {
      schema: requestSchema,
      version: 1,
      supervisorId,
      operationId: input.operationId,
      action: input.action,
      repositoryRoot,
      manifestSha256: input.manifestSha256.toLowerCase(),
      helperPath,
      helperSha256: this.helperSha256,
      executable,
      executableSha256: input.executableSha256.toLowerCase(),
      arguments: [...input.args],
      workingDirectory,
      environment: { ...input.environment },
      lifecycle: input.lifecycle,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      controlToken: randomBytes(32).toString("hex"),
      statePath
    };
    await writeJsonNew(requestPath, request);
    const helper = await this.invoke("supervise", requestPath, statePath);
    const state = await this.waitForState(request, this.stateReadyTimeoutMs);
    if (state.state !== "running") throw new Error("The Job-Object helper did not establish a live process tree.");
    return this.handle(request, state, helper, false);
  }

  async recover(scope: RepositoryProcessRecoveryScope): Promise<readonly RepositorySupervisedProcess[]> {
    await this.assertHelperIdentity();
    const repositoryRoot = await realpath(scope.repositoryRoot);
    if (!safeDigest.test(scope.manifestSha256)) throw new Error("Repository supervisor recovery requires an exact manifest digest.");
    const stateRoot = await this.ensureStateRoot();
    const names = (await readdir(stateRoot)).filter((name) => /^[a-f0-9]{64}\.request\.json$/.test(name)).sort();
    if (names.length > maximumStateFiles) throw new Error("Repository supervisor recovery exceeded its bounded record count.");
    const recovered: RepositorySupervisedProcess[] = [];
    for (const name of names) {
      const requestPath = join(stateRoot, name);
      const statePath = join(stateRoot, name.replace(".request.json", ".state.json"));
      const request = await readRequest(requestPath);
      if (!samePath(request.repositoryRoot, repositoryRoot) || request.manifestSha256 !== scope.manifestSha256.toLowerCase()) continue;
      const state = await readState(statePath, request, this.helperPath, this.helperSha256);
      if (state.state !== "running") continue;
      const observation = await this.invoke("observe", requestPath, statePath);
      const observed = await observation.wait();
      if (observed.code !== 0) continue;
      recovered.push(this.handle(request, state, undefined, true));
    }
    return recovered;
  }

  private handle(request: SupervisorRequest, state: SupervisorState, helper: RepositorySupervisorHelperProcess | undefined, recovered: boolean): RepositorySupervisedProcess {
    const requestPath = join(this.stateRoot, `${request.supervisorId.slice("managed:".length)}.request.json`);
    const statePath = request.statePath;
    const wait = helper
      ? async (): Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }> => {
          const helperExit = await helper.wait();
          const terminal = await readState(statePath, request, this.helperPath, this.helperSha256);
          return { code: terminal.exitCode ?? helperExit.code, signal: helperExit.signal };
        }
      : async (): Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }> => this.waitForTerminal(request);
    return {
      supervisorId: request.supervisorId,
      operationId: request.operationId,
      action: request.action,
      pid: state.childPid,
      startedAt: state.startedAt,
      stdout: helper?.stdout ?? Readable.from([]),
      stderr: helper?.stderr ?? Readable.from([]),
      recovered,
      wait,
      isAlive: async () => {
        const current = await readState(statePath, request, this.helperPath, this.helperSha256);
        if (current.state !== "running") return false;
        const observation = await this.invoke("observe", requestPath, statePath);
        return (await observation.wait()).code === 0;
      },
      terminateTree: async (gracefulTimeoutMs, forceTimeoutMs) => {
        if (!Number.isSafeInteger(gracefulTimeoutMs) || gracefulTimeoutMs < 0 || gracefulTimeoutMs > 60_000 || !Number.isSafeInteger(forceTimeoutMs) || forceTimeoutMs < 1 || forceTimeoutMs > 60_000) {
          throw new Error("Repository process-tree termination bounds are invalid.");
        }
        const termination = await this.invoke("terminate", requestPath, statePath, gracefulTimeoutMs, forceTimeoutMs);
        const result = await termination.wait();
        if (result.code !== 0) throw new Error("The exact Job Object could not be terminated within its bounded window.");
        const terminal = await readState(statePath, request, this.helperPath, this.helperSha256);
        if (!terminalStates.has(terminal.state)) throw new Error("The helper did not persist a terminal process-tree state.");
      }
    };
  }

  private async waitForTerminal(request: SupervisorRequest): Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }> {
    while (true) {
      const state = await readState(request.statePath, request, this.helperPath, this.helperSha256);
      if (terminalStates.has(state.state)) return { code: state.exitCode ?? -1, signal: null };
      const requestPath = join(this.stateRoot, `${request.supervisorId.slice("managed:".length)}.request.json`);
      const observation = await this.invoke("observe", requestPath, request.statePath);
      if ((await observation.wait()).code !== 0) return { code: -1, signal: null };
      await delay(250);
    }
  }

  private async waitForState(request: SupervisorRequest, timeoutMs: number): Promise<SupervisorState> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      try { return await readState(request.statePath, request, this.helperPath, this.helperSha256); }
      catch (error) { last = error; await delay(25); }
    }
    throw new Error(`The Job-Object helper did not persist its bounded launch state: ${(last as Error | undefined)?.message ?? "state absent"}`);
  }

  private async invoke(mode: RepositorySupervisorHelperInvocation["mode"], requestPath: string, statePath: string, gracefulTimeoutMs?: number, forceTimeoutMs?: number): Promise<RepositorySupervisorHelperProcess> {
    const helperPath = await this.assertHelperIdentity();
    const arguments_ = mode === "terminate"
      ? ["--terminate", requestPath, statePath, String(gracefulTimeoutMs), String(forceTimeoutMs)]
      : [`--${mode}`, requestPath, statePath];
    return this.transport.invoke({ mode, helperPath, helperSha256: this.helperSha256, requestPath, statePath, arguments: arguments_, environment: {} });
  }

  private async ensureStateRoot(): Promise<string> {
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 });
    const canonical = await realpath(this.stateRoot);
    this.stateRoot = canonical;
    return canonical;
  }

  private async assertHelperIdentity(): Promise<string> {
    const canonical = await realpath(this.helperPath).catch(() => { throw new Error("The packaged repository Job-Object helper is absent."); });
    const metadata = await stat(canonical);
    if (!metadata.isFile()) throw new Error("The packaged repository Job-Object helper path is not exact.");
    if (sha256(await readFile(canonical)) !== this.helperSha256) throw new Error("The packaged repository Job-Object helper digest changed.");
    this.helperPath = canonical;
    return canonical;
  }
}

async function readRequest(path: string): Promise<SupervisorRequest> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumStateBytes) throw new Error("Repository supervisor request is absent or oversized.");
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!record(value) || !exactKeys(value, ["schema", "version", "supervisorId", "operationId", "action", "repositoryRoot", "manifestSha256", "helperPath", "helperSha256", "executable", "executableSha256", "arguments", "workingDirectory", "environment", "lifecycle", "timeoutMs", "maxOutputBytes", "controlToken", "statePath"])) {
    throw new Error("Repository supervisor request has an invalid exact schema.");
  }
  if (value.schema !== requestSchema || value.version !== 1 || typeof value.supervisorId !== "string" || !safeManagedId.test(value.supervisorId)
    || typeof value.operationId !== "string" || !value.operationId.trim() || value.operationId.length > 256 || /[\0\r\n]/.test(value.operationId)
    || typeof value.repositoryRoot !== "string" || typeof value.manifestSha256 !== "string" || !safeDigest.test(value.manifestSha256)
    || typeof value.helperPath !== "string" || typeof value.helperSha256 !== "string" || !safeDigest.test(value.helperSha256)
    || typeof value.executable !== "string" || typeof value.executableSha256 !== "string" || !safeDigest.test(value.executableSha256)
    || !Array.isArray(value.arguments) || !record(value.environment) || typeof value.workingDirectory !== "string"
    || typeof value.controlToken !== "string" || !safeDigest.test(value.controlToken) || typeof value.statePath !== "string") {
    throw new Error("Repository supervisor request contains invalid bindings.");
  }
  return value as unknown as SupervisorRequest;
}

async function readState(path: string, request: SupervisorRequest, helperPath: string, helperSha256: string): Promise<SupervisorState> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumStateBytes) throw new Error("Repository supervisor state is absent or oversized.");
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  const requestPath = path.replace(/\.state\.json$/i, ".request.json");
  const requestSha256 = sha256(await readFile(requestPath));
  if (!record(value) || !exactKeys(value, ["schema", "version", "supervisorId", "operationId", "action", "repositoryRoot", "manifestSha256", "helperPath", "helperSha256", "requestSha256", "controlTokenSha256", "jobName", "supervisorPid", "childPid", "startedAt", "state", "exitCode", "outputTruncated"])) {
    throw new Error("Repository supervisor state has an invalid exact schema.");
  }
  if (value.schema !== stateSchema || value.version !== 1 || value.supervisorId !== request.supervisorId || value.operationId !== request.operationId || value.action !== request.action
    || value.repositoryRoot !== request.repositoryRoot || value.manifestSha256 !== request.manifestSha256 || !samePath(String(value.helperPath), helperPath)
    || value.helperSha256 !== helperSha256 || !Number.isSafeInteger(value.supervisorPid) || (value.supervisorPid as number) <= 0
    || value.requestSha256 !== requestSha256
    || typeof value.controlTokenSha256 !== "string" || value.controlTokenSha256 !== sha256(request.controlToken)
    || typeof value.jobName !== "string" || value.jobName !== `Local\\SxsyB122-${request.supervisorId.slice("managed:".length)}`
    || !Number.isSafeInteger(value.childPid) || (value.childPid as number) <= 0 || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))
    || typeof value.state !== "string" || !new Set(["running", ...terminalStates]).has(value.state)
    || !(value.exitCode === null || Number.isSafeInteger(value.exitCode)) || typeof value.outputTruncated !== "boolean") {
    throw new Error("Repository supervisor state is stale, tampered, or confused.");
  }
  return value as unknown as SupervisorState;
}

async function writeJsonNew(path: string, value: object): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function inside(child: string, root: string): boolean {
  const value = relative(root, child);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

function samePath(left: string, right: string): boolean {
  const normalized = (value: string): string => resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized(left).toLowerCase() === normalized(right).toLowerCase() : normalized(left) === normalized(right);
}

function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

async function delay(milliseconds: number): Promise<void> { await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds)); }
