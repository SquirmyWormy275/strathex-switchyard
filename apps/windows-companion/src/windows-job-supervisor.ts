/** Windows Job-Object process-tree supervisor for host-attested repository recipes. */
import { spawn } from "node:child_process";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import type {
  RepositoryProcessRecoveryScope,
  RepositoryProcessObservationRequest,
  RepositoryProcessStartRequest,
  RepositoryProcessSupervisor,
  RepositorySupervisedProcess
} from "./repository-runtime.ts";
import type { OperationControllerObservation } from "../../../packages/control-plane/src/runtime.ts";
import { stableJson, type JsonValue, type ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";

const requestSchema = "sxsy-b122.repository-supervisor-request" as const;
const stateSchema = "sxsy-b122.repository-supervisor-state" as const;
const terminalSchema = "sxsy-b122.repository-supervisor-terminal" as const;
const bindingKind = "b122.repository-supervisor.binding.v1";
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
  /** Authenticated host journal; the repository child cannot replace this launch binding. */
  readonly protectedStore: ProtectedJsonStore;
  readonly transport?: RepositorySupervisorHelperTransport;
  readonly stateReadyTimeoutMs?: number;
}

interface SupervisorRequest {
  readonly schema: typeof requestSchema;
  readonly version: 3;
  readonly supervisorId: string;
  readonly operationId: string;
  readonly action: RepositoryProcessStartRequest["action"];
  readonly targetSnapshotId: string;
  readonly sessionId: string | null;
  readonly authorityId: string | null;
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
  readonly bindingAckPath: string;
  readonly terminalPath: string;
}

interface SupervisorRequestDocument {
  readonly request: SupervisorRequest;
  readonly sha256: string;
}

interface SupervisorState {
  readonly schema: typeof stateSchema;
  readonly version: 3;
  readonly supervisorId: string;
  readonly operationId: string;
  readonly action: RepositoryProcessStartRequest["action"];
  readonly targetSnapshotId: string;
  readonly sessionId: string | null;
  readonly authorityId: string | null;
  readonly repositoryRoot: string;
  readonly manifestSha256: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly requestSha256: string;
  readonly signingPublicKeySpki: string;
  readonly signingPublicKeySha256: string;
  readonly jobName: string;
  readonly supervisorPid: number;
  readonly childPid: number;
  readonly startedAt: string;
  readonly state: "running" | "completed" | "failed" | "timed_out" | "cancelled";
  readonly exitCode: number | null;
  readonly outputTruncated: boolean;
}

interface TrustedTerminalEvidence {
  readonly supervisorId: string;
  readonly helperSha256: string;
  readonly source: "live_helper_exit" | "exact_job_termination" | "signed_helper_receipt";
  readonly state: "completed" | "failed" | "timed_out" | "cancelled";
  readonly exitCode: number;
}

interface SupervisorBinding extends Record<string, JsonValue> {
  readonly supervisorId: string;
  readonly operationId: string;
  readonly action: RepositoryProcessStartRequest["action"];
  readonly targetSnapshotId: string;
  readonly sessionId: string | null;
  readonly authorityId: string | null;
  readonly repositoryRoot: string;
  readonly manifestSha256: string;
  readonly helperSha256: string;
  readonly requestSha256: string;
  readonly signingPublicKeySpki: string;
  readonly signingPublicKeySha256: string;
  readonly startedAt: string;
}

interface SignedTerminalReceipt {
  readonly schema: typeof terminalSchema;
  readonly version: 1;
  readonly supervisorId: string;
  readonly operationId: string;
  readonly action: RepositoryProcessStartRequest["action"];
  readonly targetSnapshotId: string;
  readonly sessionId: string | null;
  readonly authorityId: string | null;
  readonly repositoryRoot: string;
  readonly manifestSha256: string;
  readonly helperSha256: string;
  readonly requestSha256: string;
  readonly signingPublicKeySha256: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly state: "completed" | "failed" | "timed_out";
  readonly exitCode: number;
  readonly outputTruncated: boolean;
  readonly effectDisposition: "committed";
  readonly signature: string;
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
  private readonly protectedStore: ProtectedJsonStore;
  private readonly stateReadyTimeoutMs: number;
  private readonly trustedTerminals = new Map<string, TrustedTerminalEvidence>();
  private readonly liveHelperWaits = new Map<string, Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>>();

  constructor(options: WindowsJobObjectProcessSupervisorOptions) {
    if (!isAbsolute(options.helperPath) || !safeDigest.test(options.helperSha256)) throw new Error("The repository Job-Object helper requires an exact absolute path and SHA-256 digest.");
    if (!isAbsolute(options.stateRoot)) throw new Error("The repository supervisor state root must be absolute.");
    if (!options.protectedStore?.hasAuthenticatedProtection) throw new Error("The repository supervisor requires an authenticated host journal for immutable launch bindings.");
    this.helperPath = resolve(options.helperPath);
    this.helperSha256 = options.helperSha256.toLowerCase();
    this.stateRoot = resolve(options.stateRoot);
    this.transport = options.transport ?? new NodeRepositorySupervisorHelperTransport();
    this.protectedStore = options.protectedStore;
    this.stateReadyTimeoutMs = options.stateReadyTimeoutMs ?? 5_000;
  }

  async start(input: RepositoryProcessStartRequest): Promise<RepositorySupervisedProcess> {
    const helperPath = await this.assertHelperIdentity();
    const repositoryRoot = await realpath(input.repositoryRoot);
    const executable = await realpath(input.executable);
    const workingDirectory = await realpath(input.cwd);
    if (!inside(workingDirectory, repositoryRoot) || !safeDigest.test(input.targetSnapshotId)
      || !safeDigest.test(input.manifestSha256) || !safeDigest.test(input.executableSha256)) {
      throw new Error("Repository supervisor input escaped its canonical scope or lacked exact digests.");
    }
    if (sha256(await readFile(executable)) !== input.executableSha256.toLowerCase()) throw new Error("The repository executable digest changed before supervisor handoff.");
    const stateRoot = await this.ensureStateRoot();
    const supervisorId = `managed:${sha256(`${randomUUID()}:${randomBytes(32).toString("hex")}:${Date.now()}`)}`;
    const stem = supervisorId.slice("managed:".length);
    const requestPath = join(stateRoot, `${stem}.request.json`);
    const statePath = join(stateRoot, `${stem}.state.json`);
    const bindingAckPath = join(stateRoot, `${stem}.binding-ack`);
    const terminalPath = join(stateRoot, `${stem}.terminal.json`);
    const request: SupervisorRequest = {
      schema: requestSchema,
      version: 3,
      supervisorId,
      operationId: input.operationId,
      action: input.action,
      targetSnapshotId: input.targetSnapshotId,
      sessionId: exactOptionalId(input.sessionId, "session ID"),
      authorityId: exactOptionalId(input.authorityId, "authority ID"),
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
      statePath,
      bindingAckPath,
      terminalPath
    };
    const requestBytes = `${JSON.stringify(request)}\n`;
    const requestSha256 = sha256(requestBytes);
    await writeJsonNew(requestPath, requestBytes);
    const helper = await this.invoke("supervise", requestPath, statePath, requestSha256);
    const state = await this.waitForState(request, requestSha256, this.stateReadyTimeoutMs);
    if (state.state !== "running") throw new Error("The Job-Object helper did not establish a live process tree.");
    await this.protectedStore.append<SupervisorBinding>(bindingKind, bindingFrom(request, requestSha256, state));
    await writeJsonNew(bindingAckPath, `${requestSha256}\n`);
    return this.handle(request, requestSha256, state, helper, false);
  }

  async recover(scope: RepositoryProcessRecoveryScope): Promise<readonly RepositorySupervisedProcess[]> {
    await this.assertHelperIdentity();
    const repositoryRoot = await realpath(scope.repositoryRoot);
    if (!safeDigest.test(scope.manifestSha256)) throw new Error("Repository supervisor recovery requires an exact manifest digest.");
    const stateRoot = await this.ensureStateRoot();
    const bindings = (await this.bindings()).filter((binding) => samePath(binding.repositoryRoot, repositoryRoot) && binding.manifestSha256 === scope.manifestSha256.toLowerCase());
    if (bindings.length > maximumStateFiles) throw new Error("Repository supervisor recovery exceeded its bounded record count.");
    const recovered: RepositorySupervisedProcess[] = [];
    for (const binding of bindings) {
      const stem = binding.supervisorId.slice("managed:".length);
      const requestPath = join(stateRoot, `${stem}.request.json`);
      const statePath = join(stateRoot, `${stem}.state.json`);
      const document = await readRequest(requestPath, binding.requestSha256);
      const request = document.request;
      assertBindingMatches(binding, request, document.sha256);
      if (await readTrustedTerminal(request, binding).catch(() => undefined)) continue;
      const state = await readState(statePath, request, document.sha256, this.helperPath, this.helperSha256);
      const observation = await this.invoke("observe", requestPath, statePath, document.sha256);
      const observed = await observation.wait();
      if (observed.code !== 0) continue;
      recovered.push(this.handle(request, document.sha256, state, undefined, true));
    }
    return recovered;
  }

  async observeOperation(input: RepositoryProcessObservationRequest): Promise<OperationControllerObservation> {
    await this.assertHelperIdentity();
    const repositoryRoot = await realpath(input.repositoryRoot);
    if (!safeDigest.test(input.manifestSha256) || !safeDigest.test(input.targetSnapshotId)
      || typeof input.operationId !== "string" || !input.operationId.trim() || input.operationId.length > 256 || /[\0\r\n]/.test(input.operationId)) {
      throw new Error("Repository supervisor observation requires exact operation, target, and manifest bindings.");
    }
    const stateRoot = await this.ensureStateRoot();
    const bindings = await this.bindings();
    if (bindings.length > maximumStateFiles) throw new Error("Repository supervisor observation exceeded its bounded record count.");
    const matches = bindings.filter((binding) => binding.operationId === input.operationId && binding.action === input.action
      && binding.targetSnapshotId === input.targetSnapshotId && binding.sessionId === (input.sessionId ?? null)
      && binding.authorityId === (input.authorityId ?? null) && samePath(binding.repositoryRoot, repositoryRoot)
      && binding.manifestSha256 === input.manifestSha256.toLowerCase());
    if (matches.length === 0) return { state: "not_owner", operationId: input.operationId, summary: "No exact durable repository supervisor record owns this operation." };
    if (matches.length !== 1) return activeObservation(input, "More than one durable supervisor record claimed the exact operation; terminal state remains ambiguous.");
    const binding = matches[0]!;
    const stem = binding.supervisorId.slice("managed:".length);
    const requestPath = join(stateRoot, `${stem}.request.json`);
    const statePath = join(stateRoot, `${stem}.state.json`);
    const document = await readRequest(requestPath, binding.requestSha256);
    assertBindingMatches(binding, document.request, document.sha256);
    const match = { requestPath, statePath, request: document.request, requestSha256: document.sha256 };
    const trusted = this.trustedTerminals.get(match.request.supervisorId) ?? await readTrustedTerminal(match.request, binding).catch(() => undefined);
    if (trusted) return terminalObservation(input, trusted);
    try {
      await readState(statePath, document.request, document.sha256, this.helperPath, this.helperSha256);
    } catch {
      return activeObservation(input, "The child-writable supervisor state is invalid and no authenticated helper terminal evidence exists; semantic outcome remains ambiguous and no work was replayed.");
    }
    const observation = await this.invoke("observe", match.requestPath, match.statePath, match.requestSha256);
    const observed = await observation.wait();
    if (observed.code === 0) return activeObservation(input, "The exact Job-Object process tree remains active.");
    const terminal = observed.code === 3 ? await readTrustedTerminal(match.request, binding).catch(() => undefined) : undefined;
    if (terminal) return terminalObservation(input, terminal);
    return observed.code === 3
      ? activeObservation(input, "The exact Job is inactive after restart, but no authenticated helper terminal evidence exists; semantic outcome remains ambiguous and no work was replayed.")
      : activeObservation(input, "The helper could not prove the exact process tree live or terminal; PID reuse, stale state, or helper failure remains ambiguous.");
  }

  private handle(request: SupervisorRequest, requestSha256: string, state: SupervisorState, helper: RepositorySupervisorHelperProcess | undefined, recovered: boolean): RepositorySupervisedProcess {
    const requestPath = join(this.stateRoot, `${request.supervisorId.slice("managed:".length)}.request.json`);
    const statePath = request.statePath;
    const liveHelperWait = helper ? this.monitorLiveHelper(request, helper) : undefined;
    const wait = liveHelperWait
      ? async (): ReturnType<RepositorySupervisedProcess["wait"]> => liveHelperWait
      : async (): ReturnType<RepositorySupervisedProcess["wait"]> => this.waitForTerminal(request, requestSha256);
    return {
      supervisorId: request.supervisorId,
      operationId: request.operationId,
      action: request.action,
      targetSnapshotId: request.targetSnapshotId,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(request.authorityId ? { authorityId: request.authorityId } : {}),
      pid: state.childPid,
      startedAt: state.startedAt,
      stdout: helper?.stdout ?? Readable.from([]),
      stderr: helper?.stderr ?? Readable.from([]),
      recovered,
      wait,
      isAlive: async () => {
        if (this.trustedTerminals.has(request.supervisorId)) return false;
        const observation = await this.invoke("observe", requestPath, statePath, requestSha256);
        const result = await observation.wait();
        return result.code !== 3;
      },
      terminateTree: async (gracefulTimeoutMs, forceTimeoutMs) => {
        if (!Number.isSafeInteger(gracefulTimeoutMs) || gracefulTimeoutMs < 0 || gracefulTimeoutMs > 60_000 || !Number.isSafeInteger(forceTimeoutMs) || forceTimeoutMs < 1 || forceTimeoutMs > 60_000) {
          throw new Error("Repository process-tree termination bounds are invalid.");
        }
        const termination = await this.invoke("terminate", requestPath, statePath, requestSha256, gracefulTimeoutMs, forceTimeoutMs);
        const result = await termination.wait();
        if (result.code !== 0) throw new Error("The exact Job Object could not be terminated within its bounded window.");
        const existing = this.trustedTerminals.get(request.supervisorId);
        if (existing?.state !== "completed") {
          this.trustedTerminals.set(request.supervisorId, {
            supervisorId: request.supervisorId,
            helperSha256: this.helperSha256,
            source: "exact_job_termination",
            state: "cancelled",
            exitCode: 130
          });
        }
      }
    };
  }

  private monitorLiveHelper(
    request: SupervisorRequest,
    helper: RepositorySupervisorHelperProcess
  ): Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }> {
    const existing = this.liveHelperWaits.get(request.supervisorId);
    if (existing) return existing;
    const monitored = helper.wait().then((exit) => {
      if (!this.trustedTerminals.has(request.supervisorId)) {
        this.trustedTerminals.set(request.supervisorId, {
          supervisorId: request.supervisorId,
          helperSha256: this.helperSha256,
          source: "live_helper_exit",
          state: exit.code === 0 ? "completed" : "failed",
          exitCode: exit.code
        });
      }
      return exit;
    });
    this.liveHelperWaits.set(request.supervisorId, monitored);
    return monitored;
  }

  private async waitForTerminal(request: SupervisorRequest, requestSha256: string): ReturnType<RepositorySupervisedProcess["wait"]> {
    while (true) {
      const trusted = this.trustedTerminals.get(request.supervisorId);
      if (trusted) return { code: trusted.exitCode, signal: null };
      const requestPath = join(this.stateRoot, `${request.supervisorId.slice("managed:".length)}.request.json`);
      const observation = await this.invoke("observe", requestPath, request.statePath, requestSha256);
      const result = await observation.wait();
      if (result.code === 3) return { code: -1, signal: null, terminalEvidence: "ambiguous" };
      await delay(250);
    }
  }

  private async waitForState(request: SupervisorRequest, requestSha256: string, timeoutMs: number): Promise<SupervisorState> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      try { return await readState(request.statePath, request, requestSha256, this.helperPath, this.helperSha256); }
      catch (error) { last = error; await delay(25); }
    }
    throw new Error(`The Job-Object helper did not persist its bounded launch state: ${(last as Error | undefined)?.message ?? "state absent"}`);
  }

  private async invoke(mode: RepositorySupervisorHelperInvocation["mode"], requestPath: string, statePath: string, requestSha256: string, gracefulTimeoutMs?: number, forceTimeoutMs?: number): Promise<RepositorySupervisorHelperProcess> {
    const helperPath = await this.assertHelperIdentity();
    if (!safeDigest.test(requestSha256)) throw new Error("Repository supervisor helper invocation lacks an exact request digest.");
    const arguments_ = mode === "terminate"
      ? ["--terminate", requestPath, statePath, requestSha256, String(gracefulTimeoutMs), String(forceTimeoutMs)]
      : [`--${mode}`, requestPath, statePath, requestSha256];
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

  private async bindings(): Promise<readonly SupervisorBinding[]> {
    const entries = await this.protectedStore.readEntries<JsonValue>();
    const bindings = entries.filter((entry) => entry.kind === bindingKind).map((entry) => parseBinding(entry.payload));
    const seen = new Set<string>();
    for (const binding of bindings) {
      if (seen.has(binding.supervisorId)) throw new Error("The authenticated repository supervisor journal contains a conflicting duplicate identity.");
      seen.add(binding.supervisorId);
    }
    return bindings;
  }
}

function activeObservation(input: RepositoryProcessObservationRequest, summary: string): Extract<OperationControllerObservation, { state: "active" }> {
  return {
    state: "active",
    operationId: input.operationId,
    action: input.action,
    targetSnapshotId: input.targetSnapshotId,
    repositoryRoot: input.repositoryRoot,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.authorityId ? { authorityId: input.authorityId } : {}),
    effectDisposition: "ambiguous",
    summary
  };
}

function terminalObservation(input: RepositoryProcessObservationRequest, terminal: TrustedTerminalEvidence): Extract<OperationControllerObservation, { state: "terminal" }> {
  const status = terminal.state === "completed" ? "completed" as const
    : terminal.state === "cancelled" ? "cancelled" as const
      : terminal.state === "timed_out" ? "timed_out" as const : "failed" as const;
  const effectDisposition = "committed" as const;
  const summary = terminal.state === "completed"
    ? "The exact Job-Object process tree exited successfully."
    : terminal.state === "cancelled"
      ? "The exact Job-Object process tree was stopped; prior repository or network effects were not rolled back."
      : "The exact Job-Object process tree exited unsuccessfully after its effect began.";
  const evidenceDigest = sha256(JSON.stringify({
    operationId: input.operationId,
    action: input.action,
    targetSnapshotId: input.targetSnapshotId,
    sessionId: input.sessionId,
    authorityId: input.authorityId,
    repositoryRoot: input.repositoryRoot,
    manifestSha256: input.manifestSha256,
    supervisorId: terminal.supervisorId,
    state: terminal.state,
    exitCode: terminal.exitCode,
    source: terminal.source,
    effectDisposition
  }));
  return {
    state: "terminal",
    operationId: input.operationId,
    action: input.action,
    targetSnapshotId: input.targetSnapshotId,
    repositoryRoot: input.repositoryRoot,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.authorityId ? { authorityId: input.authorityId } : {}),
    status,
    effectDisposition,
    summary,
    evidenceDigest,
    toolVersions: { repositorySupervisor: `windows-job-object-v2:${terminal.helperSha256}` }
  };
}

async function readRequest(path: string, expectedSha256?: string): Promise<SupervisorRequestDocument> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumStateBytes) throw new Error("Repository supervisor request is absent or oversized.");
  const bytes = await readFile(path);
  const actualSha256 = sha256(bytes);
  if (expectedSha256 !== undefined && actualSha256 !== expectedSha256) throw new Error("Repository supervisor request bytes no longer match the authenticated immutable request digest.");
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (!record(value) || !exactKeys(value, ["schema", "version", "supervisorId", "operationId", "action", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "manifestSha256", "helperPath", "helperSha256", "executable", "executableSha256", "arguments", "workingDirectory", "environment", "lifecycle", "timeoutMs", "maxOutputBytes", "controlToken", "statePath", "bindingAckPath", "terminalPath"])) {
    throw new Error("Repository supervisor request has an invalid exact schema.");
  }
  if (value.schema !== requestSchema || value.version !== 3 || typeof value.supervisorId !== "string" || !safeManagedId.test(value.supervisorId)
    || typeof value.operationId !== "string" || !value.operationId.trim() || value.operationId.length > 256 || /[\0\r\n]/.test(value.operationId)
    || typeof value.targetSnapshotId !== "string" || !safeDigest.test(value.targetSnapshotId)
    || !optionalId(value.sessionId) || !optionalId(value.authorityId)
    || typeof value.repositoryRoot !== "string" || typeof value.manifestSha256 !== "string" || !safeDigest.test(value.manifestSha256)
    || typeof value.helperPath !== "string" || typeof value.helperSha256 !== "string" || !safeDigest.test(value.helperSha256)
    || typeof value.executable !== "string" || typeof value.executableSha256 !== "string" || !safeDigest.test(value.executableSha256)
    || !Array.isArray(value.arguments) || !record(value.environment) || typeof value.workingDirectory !== "string"
    || typeof value.controlToken !== "string" || !safeDigest.test(value.controlToken) || typeof value.statePath !== "string"
    || typeof value.bindingAckPath !== "string" || typeof value.terminalPath !== "string") {
    throw new Error("Repository supervisor request contains invalid bindings.");
  }
  const stem = basename(path).replace(/\.request\.json$/i, "");
  if (!safeDigest.test(stem) || value.supervisorId !== `managed:${stem}`
    || !samePath(value.statePath, join(dirname(path), `${stem}.state.json`))
    || !samePath(value.bindingAckPath, join(dirname(path), `${stem}.binding-ack`))
    || !samePath(value.terminalPath, join(dirname(path), `${stem}.terminal.json`))) {
    throw new Error("Repository supervisor request identity does not match its exact host-owned file path.");
  }
  return { request: value as unknown as SupervisorRequest, sha256: actualSha256 };
}

async function readState(path: string, request: SupervisorRequest, requestSha256: string, helperPath: string, helperSha256: string): Promise<SupervisorState> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumStateBytes) throw new Error("Repository supervisor state is absent or oversized.");
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!record(value) || !exactKeys(value, ["schema", "version", "supervisorId", "operationId", "action", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "manifestSha256", "helperPath", "helperSha256", "requestSha256", "signingPublicKeySpki", "signingPublicKeySha256", "jobName", "supervisorPid", "childPid", "startedAt", "state", "exitCode", "outputTruncated"])) {
    throw new Error("Repository supervisor state has an invalid exact schema.");
  }
  if (value.schema !== stateSchema || value.version !== 3 || value.supervisorId !== request.supervisorId || value.operationId !== request.operationId || value.action !== request.action
    || value.targetSnapshotId !== request.targetSnapshotId
    || value.sessionId !== request.sessionId || value.authorityId !== request.authorityId
    || value.repositoryRoot !== request.repositoryRoot || value.manifestSha256 !== request.manifestSha256 || !samePath(String(value.helperPath), helperPath)
    || value.helperSha256 !== helperSha256 || !Number.isSafeInteger(value.supervisorPid) || (value.supervisorPid as number) <= 0
    || value.requestSha256 !== requestSha256
    || typeof value.signingPublicKeySpki !== "string" || !validSpki(value.signingPublicKeySpki)
    || typeof value.signingPublicKeySha256 !== "string" || value.signingPublicKeySha256 !== sha256(Buffer.from(value.signingPublicKeySpki, "base64"))
    || typeof value.jobName !== "string" || value.jobName !== `Local\\SxsyB122-${request.supervisorId.slice("managed:".length)}`
    || !Number.isSafeInteger(value.childPid) || (value.childPid as number) <= 0 || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))
    || typeof value.state !== "string" || !new Set(["running", ...terminalStates]).has(value.state)
    || !(value.exitCode === null || Number.isSafeInteger(value.exitCode)) || typeof value.outputTruncated !== "boolean") {
    throw new Error("Repository supervisor state is stale, tampered, or confused.");
  }
  return value as unknown as SupervisorState;
}

function bindingFrom(request: SupervisorRequest, requestSha256: string, state: SupervisorState): SupervisorBinding {
  return {
    supervisorId: request.supervisorId,
    operationId: request.operationId,
    action: request.action,
    targetSnapshotId: request.targetSnapshotId,
    sessionId: request.sessionId,
    authorityId: request.authorityId,
    repositoryRoot: request.repositoryRoot,
    manifestSha256: request.manifestSha256,
    helperSha256: request.helperSha256,
    requestSha256,
    signingPublicKeySpki: state.signingPublicKeySpki,
    signingPublicKeySha256: state.signingPublicKeySha256,
    startedAt: state.startedAt
  };
}

function parseBinding(value: JsonValue): SupervisorBinding {
  const keys = ["supervisorId", "operationId", "action", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "manifestSha256", "helperSha256", "requestSha256", "signingPublicKeySpki", "signingPublicKeySha256", "startedAt"];
  if (!record(value) || !exactKeys(value, keys)
    || typeof value.supervisorId !== "string" || !safeManagedId.test(value.supervisorId)
    || typeof value.operationId !== "string" || !value.operationId.trim() || value.operationId.length > 256 || /[\0\r\n]/.test(value.operationId)
    || typeof value.action !== "string" || !repositoryProcessAction(value.action)
    || typeof value.targetSnapshotId !== "string" || !safeDigest.test(value.targetSnapshotId)
    || !optionalId(value.sessionId) || !optionalId(value.authorityId)
    || typeof value.repositoryRoot !== "string" || !isAbsolute(value.repositoryRoot)
    || typeof value.manifestSha256 !== "string" || !safeDigest.test(value.manifestSha256)
    || typeof value.helperSha256 !== "string" || !safeDigest.test(value.helperSha256)
    || typeof value.requestSha256 !== "string" || !safeDigest.test(value.requestSha256)
    || typeof value.signingPublicKeySpki !== "string" || !validSpki(value.signingPublicKeySpki)
    || typeof value.signingPublicKeySha256 !== "string" || value.signingPublicKeySha256 !== sha256(Buffer.from(value.signingPublicKeySpki, "base64"))
    || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) {
    throw new Error("The authenticated repository supervisor launch binding is malformed or inconsistent.");
  }
  return value as unknown as SupervisorBinding;
}

function assertBindingMatches(binding: SupervisorBinding, request: SupervisorRequest, requestSha256: string): void {
  if (requestSha256 !== binding.requestSha256 || request.supervisorId !== binding.supervisorId
    || request.operationId !== binding.operationId || request.action !== binding.action
    || request.targetSnapshotId !== binding.targetSnapshotId || request.sessionId !== binding.sessionId
    || request.authorityId !== binding.authorityId || !samePath(request.repositoryRoot, binding.repositoryRoot)
    || request.manifestSha256 !== binding.manifestSha256 || request.helperSha256 !== binding.helperSha256) {
    throw new Error("Repository supervisor request does not match its authenticated immutable full binding.");
  }
}

async function readTrustedTerminal(request: SupervisorRequest, binding: SupervisorBinding): Promise<TrustedTerminalEvidence | undefined> {
  const metadata = await stat(request.terminalPath).catch(() => undefined);
  if (!metadata) return undefined;
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumStateBytes) throw new Error("The helper terminal receipt is absent or oversized.");
  const value: unknown = JSON.parse(await readFile(request.terminalPath, "utf8"));
  const keys = ["schema", "version", "supervisorId", "operationId", "action", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "manifestSha256", "helperSha256", "requestSha256", "signingPublicKeySha256", "startedAt", "finishedAt", "state", "exitCode", "outputTruncated", "effectDisposition", "signature"];
  if (!record(value) || !exactKeys(value, keys) || value.schema !== terminalSchema || value.version !== 1
    || value.supervisorId !== binding.supervisorId || value.operationId !== binding.operationId || value.action !== binding.action
    || value.targetSnapshotId !== binding.targetSnapshotId || value.sessionId !== binding.sessionId || value.authorityId !== binding.authorityId
    || typeof value.repositoryRoot !== "string" || !samePath(value.repositoryRoot, binding.repositoryRoot)
    || value.manifestSha256 !== binding.manifestSha256 || value.helperSha256 !== binding.helperSha256
    || value.requestSha256 !== binding.requestSha256 || value.signingPublicKeySha256 !== binding.signingPublicKeySha256
    || value.startedAt !== binding.startedAt || typeof value.finishedAt !== "string" || !Number.isFinite(Date.parse(value.finishedAt))
    || Date.parse(value.finishedAt) < Date.parse(binding.startedAt)
    || (value.state !== "completed" && value.state !== "failed" && value.state !== "timed_out")
    || !Number.isSafeInteger(value.exitCode) || typeof value.outputTruncated !== "boolean" || value.effectDisposition !== "committed"
    || typeof value.signature !== "string" || value.signature.length < 64 || value.signature.length > 512) {
    throw new Error("The helper terminal receipt is malformed or does not match the authenticated launch binding.");
  }
  const signature = Buffer.from(value.signature, "base64");
  if (signature.toString("base64") !== value.signature) throw new Error("The helper terminal receipt signature is malformed.");
  const { signature: _signature, ...unsigned } = value;
  const publicKey = createPublicKey({ key: Buffer.from(binding.signingPublicKeySpki, "base64"), format: "der", type: "spki" });
  if (!verify("sha256", Buffer.from(stableJson(unsigned), "utf8"), publicKey, signature)) {
    throw new Error("The helper terminal receipt signature is invalid.");
  }
  const receipt = value as unknown as SignedTerminalReceipt;
  return {
    supervisorId: receipt.supervisorId,
    helperSha256: receipt.helperSha256,
    source: "signed_helper_receipt",
    state: receipt.state,
    exitCode: receipt.exitCode
  };
}

async function writeJsonNew(path: string, value: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function repositoryProcessAction(value: string): value is RepositoryProcessStartRequest["action"] {
  return ["run_target", "launch_web_app", "venv", "rebuild_venv", "pipeline_local_gate", "pipeline_clean_reproduction", "shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"].includes(value);
}

function exactOptionalId(value: string | undefined, label: string): string | null {
  if (value === undefined) return null;
  if (!optionalId(value)) throw new Error(`Repository supervisor ${label} is invalid.`);
  return value;
}

function optionalId(value: unknown): value is string | null {
  return value === null || typeof value === "string" && !!value.trim() && value.length <= 256 && !/[\0\r\n]/.test(value);
}

function validSpki(value: string): boolean {
  if (value.length < 80 || value.length > 512) return false;
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) return false;
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch { return false; }
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
