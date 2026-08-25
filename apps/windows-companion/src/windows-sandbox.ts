/**
 * Concrete Windows Sandbox boundary for B122.
 *
 * The host starts only the inbox WindowsSandbox.exe at its fixed absolute
 * path.  A fixed, host-owned guest helper reads a digest-pinned repository
 * recipe catalog and a bounded recipe selector.  No repository value becomes
 * a host command line, networking is disabled in the .wsb document, and all
 * sandbox output remains quarantined until its complete manifest is checked.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  BrokerOutcome,
  EffectGuard,
  IsolationRequest,
  IsolationRuntime,
  PermitVerifier
} from "../../../packages/control-plane/src/brokers.ts";
import { redactText, untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";

export const WINDOWS_SANDBOX_EXECUTABLE = "C:\\Windows\\System32\\WindowsSandbox.exe" as const;
export const WINDOWS_SANDBOX_FEATURE_TOOL = "C:\\Windows\\System32\\dism.exe" as const;
export const windowsSandboxResultSchema = "sxsy-b122.windows-sandbox-result" as const;
export const windowsSandboxReceiptSchema = "sxsy-b122.windows-sandbox-receipt" as const;

const maximumReceiptBytes = 256 * 1024;
const maximumManifestBytes = 256 * 1024;
const maximumOutputs = 256;
const maximumSingleOutputBytes = 64 * 1024 * 1024;
const maximumTimeoutMs = 24 * 60 * 60_000;
const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const safeUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export type WindowsSandboxProfile = "full_sandbox" | "fresh_full_sandbox" | "quarantine";

export interface WindowsSandboxResourcePolicy {
  readonly cpuRatePercent: number;
  readonly jobMemoryMiB: number;
  readonly processMemoryMiB: number;
  readonly activeProcessLimit: number;
  readonly wallTimeMs: number;
}

export interface ApprovedWindowsSandboxPersistentVolume {
  /** Stable host-approved identifier; repository content cannot invent one. */
  readonly id: string;
  /** Concrete task-owned host directory mapped only for full/fresh-full. */
  readonly hostRoot: string;
  readonly readOnly?: boolean;
}

export interface WindowsSandboxFileStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly size: number;
}

/** Injectable to keep the safety state machine testable without Windows. */
export interface WindowsSandboxFileSystem {
  mkdir(path: string): Promise<void>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<WindowsSandboxFileStat>;
  lstat(path: string): Promise<WindowsSandboxFileStat>;
  readBytes(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  readDirectory(path: string): Promise<readonly string[]>;
  writeBytes(path: string, contents: Uint8Array): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface WindowsSandboxRunSpec {
  readonly executable: typeof WINDOWS_SANDBOX_EXECUTABLE;
  readonly args: readonly [string];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface WindowsSandboxProcessResult {
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputTruncated: boolean;
  /** True only once the WindowsSandbox.exe process handle has closed. */
  readonly hostProcessContained: boolean;
}

export interface WindowsSandboxProcessRunner {
  run(
    spec: WindowsSandboxRunSpec,
    signal: AbortSignal,
    onStarted: (pid: number) => Promise<void>
  ): Promise<WindowsSandboxProcessResult>;
  /** Unknown or reused process identities must conservatively report active. */
  isProcessActive?(pid: number): Promise<boolean>;
}

/** Exact native identity for one non-reusable WindowsSandbox.exe process. */
export interface WindowsSandboxProcessIdentity {
  readonly pid: number;
  /** Unsigned Windows FILETIME encoded as decimal to avoid JavaScript precision loss. */
  readonly creationFileTimeUtc: string;
  readonly executablePath: typeof WINDOWS_SANDBOX_EXECUTABLE;
  readonly executableVolumeSerialNumber: string;
  readonly executableFileIndex: string;
  readonly sessionId: number;
}

export type WindowsSandboxIdentityStatus = "same" | "absent" | "mismatch";

/**
 * Fixed native lifecycle boundary. Implementations must atomically compare the
 * complete identity before focus or termination; a PID alone is insufficient.
 */
export interface WindowsSandboxLifecycleController {
  launch(spec: WindowsSandboxRunSpec, configurationSha256: string, signal: AbortSignal): Promise<WindowsSandboxProcessIdentity>;
  inspect(identity: WindowsSandboxProcessIdentity): Promise<WindowsSandboxIdentityStatus>;
  focus(identity: WindowsSandboxProcessIdentity): Promise<Readonly<{ focused: true }>>;
  terminate(identity: WindowsSandboxProcessIdentity): Promise<Readonly<{ terminated: true }>>;
}

export interface WindowsSandboxFeatureProbe {
  check(): Promise<{ readonly available: boolean; readonly reason: string }>;
}

export type WindowsSandboxEffectPhase = "launch" | "focus" | "terminate" | "extract";
export interface WindowsSandboxEffectGuard {
  check(input: Readonly<{
    phase: WindowsSandboxEffectPhase;
    leaseId: string;
    recipeId: string;
    targetRoot: string;
    destinationRoot: string;
  }>): Promise<{ readonly allowed: boolean; readonly reason: string }>;
}

export type WindowsSandboxReceiptState =
  | "prepared"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "timed_out"
  | "cancelled";

export interface WindowsSandboxReceipt {
  readonly schema: typeof windowsSandboxReceiptSchema;
  readonly version: 2;
  readonly leaseId: string;
  readonly processId: string;
  readonly requestId: string;
  readonly recipeId: string;
  readonly profile: WindowsSandboxProfile;
  readonly state: WindowsSandboxReceiptState;
  readonly targetRoot: string;
  readonly destinationRoot: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deadline: string;
  readonly hostPid?: number;
  readonly hostProcessIdentity?: WindowsSandboxProcessIdentity;
  readonly exitCode?: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly processOutput: string;
  readonly processOutputTruncated: boolean;
  readonly recipeCatalogDigest: string;
  readonly helperDigest: string;
  readonly resourcePolicyDigest: string;
  readonly requestDigest: string;
  readonly configurationDigest: string;
  readonly persistentVolumeIds: readonly string[];
  readonly cleanupVerified: boolean;
  readonly reconciledAt?: string;
  readonly resultManifestDigest?: string;
  readonly resultRoot?: string;
  readonly summary: string;
}

export type WindowsSandboxStatus = "running" | "completed" | "failed" | "unavailable" | "blocked" | "timed_out" | "cancelled";
export interface WindowsSandboxExecutionResult {
  readonly status: WindowsSandboxStatus;
  readonly summary: string;
  readonly leaseId?: string;
  readonly processId?: string;
  readonly receiptPath?: string;
  readonly resultRoot?: string;
  /** Host-memory bindings from the already validated result manifest. */
  readonly resultManifestSha256?: string;
  readonly recipeCatalogSha256?: string;
  readonly sandboxHelperSha256?: string;
  readonly validatedOutputs?: readonly Readonly<{ path: string; size: number; sha256: string }>[];
  readonly lifecycleEffect?: "created" | "entered" | "rebuilt";
}

export interface WindowsSandboxExecutionRequest {
  readonly targetRoot: string;
  readonly destinationRoot?: string;
  /** Selects a recipe in the fixed repository catalog; never a command line. */
  readonly recipeId?: string;
  readonly profile?: WindowsSandboxProfile;
  /** Host-attested digests; repository bytes cannot authorize themselves. */
  readonly expectedRecipeCatalogSha256: string;
  readonly expectedHelperSha256: string;
  readonly signal?: AbortSignal;
  readonly effectGuard?: WindowsSandboxEffectGuard;
}

export interface WindowsSandboxBackendOptions {
  readonly allowedTaskRoots: readonly string[];
  readonly stateRoot: string;
  readonly helperDirectory: string;
  readonly helperFilename: string;
  readonly jobManifestRelativePath: string;
  readonly defaultDestinationRoot?: string;
  readonly effectGuard: WindowsSandboxEffectGuard;
  readonly featureProbe?: WindowsSandboxFeatureProbe;
  readonly runner?: WindowsSandboxProcessRunner;
  readonly lifecycleController?: WindowsSandboxLifecycleController;
  readonly filesystem?: WindowsSandboxFileSystem;
  readonly timeoutMs?: number;
  readonly maxProcessOutputBytes?: number;
  readonly maxExtractedBytes?: number;
  readonly approvedPersistentVolumes?: readonly ApprovedWindowsSandboxPersistentVolume[];
  readonly idFactory?: () => string;
  readonly now?: () => Date;
}

interface ValidatedOutput {
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly sha256: string;
  readonly size: number;
}

interface ValidatedResultManifest {
  readonly summary: string;
  readonly digest: string;
  readonly outputs: readonly ValidatedOutput[];
}

interface PersistentVolumeMapping {
  readonly id: string;
  readonly hostRoot: string;
  readonly sandboxRoot: string;
  readonly readOnly: boolean;
}

class SandboxBlockedError extends Error {}
class SandboxValidationError extends Error {}
class SandboxCancelledError extends Error {}

const nodeFileSystem: WindowsSandboxFileSystem = {
  async mkdir(path) { await mkdir(path, { recursive: true, mode: 0o700 }); },
  realpath,
  async stat(path) {
    const value = await stat(path);
    return { isFile: value.isFile(), isDirectory: value.isDirectory(), isSymbolicLink: false, size: value.size };
  },
  async lstat(path) {
    const value = await lstat(path);
    return { isFile: value.isFile(), isDirectory: value.isDirectory(), isSymbolicLink: value.isSymbolicLink(), size: value.size };
  },
  readBytes: readFile,
  readText: async (path) => readFile(path, "utf8"),
  readDirectory: async (path) => readdir(path),
  async writeBytes(path, contents) { await writeFile(path, contents, { mode: 0o600 }); },
  async writeText(path, contents) { await writeFile(path, contents, { encoding: "utf8", mode: 0o600 }); },
  rename,
  copyFile,
  async remove(path) { await rm(path, { recursive: true, force: true }); }
};

/** Concrete shell-free child supervisor used for WindowsSandbox.exe itself. */
export class SpawnWindowsSandboxRunner implements WindowsSandboxProcessRunner {
  async isProcessActive(pid: number): Promise<boolean> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }

  async run(spec: WindowsSandboxRunSpec, signal: AbortSignal, onStarted: (pid: number) => Promise<void>): Promise<WindowsSandboxProcessResult> {
    if (spec.executable !== WINDOWS_SANDBOX_EXECUTABLE || spec.args.length !== 1 || !isAbsolute(spec.args[0])) {
      throw new SandboxBlockedError("Windows Sandbox runner rejected a non-fixed executable or non-exact configuration path.");
    }
    if (signal.aborted) return { exitCode: null, stdout: "", stderr: "", timedOut: false, cancelled: true, outputTruncated: false, hostProcessContained: true };
    return new Promise((resolveRun, rejectRun) => {
      const child = spawn(spec.executable, [...spec.args], {
        cwd: spec.cwd,
        env: { ...spec.environment },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let outputTruncated = false;
      let startReceipt: Promise<void> | undefined;
      let startFailure: unknown;
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      const append = (current: Buffer, chunk: Buffer): Buffer => {
        const remaining = Math.max(0, spec.maxOutputBytes - stdout.byteLength - stderr.byteLength);
        if (chunk.byteLength > remaining) outputTruncated = true;
        return remaining ? Buffer.concat([current, chunk.subarray(0, remaining)]) : current;
      };
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const stop = (reason: "timeout" | "cancel"): void => {
        if (settled) return;
        timedOut ||= reason === "timeout";
        cancelled ||= reason === "cancel";
        child.kill();
      };
      const timer = setTimeout(() => stop("timeout"), spec.timeoutMs);
      const abort = (): void => stop("cancel");
      signal.addEventListener("abort", abort, { once: true });
      child.once("spawn", () => {
        startReceipt = onStarted(child.pid ?? 0).catch((error: unknown) => {
          startFailure = error;
          child.kill();
        });
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        rejectRun(error);
      });
      child.once("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        void (async () => {
          await startReceipt;
          if (startFailure) { rejectRun(startFailure); return; }
          resolveRun({
            pid: child.pid,
            exitCode,
            stdout: stdout.toString("utf8"),
            stderr: stderr.toString("utf8"),
            timedOut,
            cancelled,
            outputTruncated,
            hostProcessContained: true
          });
        })();
      });
    });
  }
}

interface LifecycleHelperResponse {
  readonly schema: "sxsy-b122.sandbox-lifecycle-response";
  readonly version: 1;
  readonly requestId: string;
  readonly kind: "result" | "error";
  readonly status?: WindowsSandboxIdentityStatus;
  readonly effect?: "launched" | "focused" | "terminated";
  readonly identity?: WindowsSandboxProcessIdentity;
  readonly code?: string;
}

/**
 * Invokes only the installed digest-pinned native helper. The helper is
 * started with no request, its exact bytes/file identity are rechecked after
 * process creation, and only then is one bounded structured request written.
 */
export class FixedWindowsSandboxLifecycleController implements WindowsSandboxLifecycleController {
  private readonly helperPath: string;
  private readonly helperSha256: string;

  constructor(helperPath: string, helperSha256: string) {
    if (!isAbsolute(helperPath) || basename(helperPath).toLowerCase() !== "b122-sandbox-lifecycle.exe" || !validDigest(helperSha256)) {
      throw new Error("Windows Sandbox lifecycle requires one fixed digest-pinned native helper.");
    }
    this.helperPath = resolve(helperPath);
    this.helperSha256 = helperSha256.toLowerCase();
  }

  async launch(spec: WindowsSandboxRunSpec, configurationSha256: string, signal: AbortSignal): Promise<WindowsSandboxProcessIdentity> {
    if (spec.executable !== WINDOWS_SANDBOX_EXECUTABLE || spec.args.length !== 1 || !isAbsolute(spec.args[0]) || !validDigest(configurationSha256)) {
      throw new SandboxBlockedError("Windows Sandbox lifecycle rejected a non-exact launch request.");
    }
    if (signal.aborted) throw new SandboxCancelledError("Windows Sandbox lifecycle launch was cancelled.");
    const response = await this.call({
      schema: "sxsy-b122.sandbox-lifecycle-request",
      version: 1,
      requestId: `sandbox-lifecycle:${randomUUID()}`,
      action: "launch",
      configurationPath: spec.args[0],
      configurationSha256: configurationSha256.toLowerCase()
    }, signal);
    if (response.effect !== "launched" || !response.identity) throw new SandboxBlockedError("Windows Sandbox native lifecycle helper did not prove an exact launch identity.");
    return assertProcessIdentity(response.identity);
  }

  async inspect(identity: WindowsSandboxProcessIdentity): Promise<WindowsSandboxIdentityStatus> {
    const response = await this.call(this.identityRequest("inspect", identity));
    if (response.status !== "same" && response.status !== "absent" && response.status !== "mismatch") throw new SandboxBlockedError("Windows Sandbox native lifecycle inspection was ambiguous.");
    return response.status;
  }

  async focus(identity: WindowsSandboxProcessIdentity): Promise<Readonly<{ focused: true }>> {
    const response = await this.call(this.identityRequest("focus", identity));
    if (response.effect !== "focused" || !response.identity || !sameProcessIdentity(assertProcessIdentity(response.identity), identity)) {
      throw new SandboxBlockedError("Windows Sandbox native lifecycle focus did not remain bound to the exact process identity.");
    }
    return { focused: true };
  }

  async terminate(identity: WindowsSandboxProcessIdentity): Promise<Readonly<{ terminated: true }>> {
    const response = await this.call(this.identityRequest("terminate", identity));
    if (response.effect !== "terminated" || !response.identity || !sameProcessIdentity(assertProcessIdentity(response.identity), identity)) {
      throw new SandboxBlockedError("Windows Sandbox native lifecycle termination did not remain bound to the exact process identity.");
    }
    return { terminated: true };
  }

  private identityRequest(action: "inspect" | "focus" | "terminate", identity: WindowsSandboxProcessIdentity): Readonly<Record<string, unknown>> {
    return {
      schema: "sxsy-b122.sandbox-lifecycle-request",
      version: 1,
      requestId: `sandbox-lifecycle:${randomUUID()}`,
      action,
      identity: assertProcessIdentity(identity)
    };
  }

  private async call(request: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<LifecycleHelperResponse> {
    if (process.platform !== "win32") throw new SandboxBlockedError("Windows Sandbox native lifecycle is available only on Windows.");
    const requestId = typeof request.requestId === "string" ? request.requestId : "";
    if (requestId.length < 24 || requestId.length > 128) throw new SandboxBlockedError("Windows Sandbox native lifecycle request identity is invalid.");
    const before = await attestLifecycleHelper(this.helperPath, this.helperSha256);
    return new Promise((resolveCall, rejectCall) => {
      const child = spawn(before.path, ["--stdio-v1"], {
        cwd: dirname(before.path),
        env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let settled = false;
      let output: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let errorOutput: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        callback();
      };
      const fail = (error: unknown): void => finish(() => rejectCall(error));
      const append = (current: Buffer, chunk: Buffer): Buffer => {
        if (current.byteLength + chunk.byteLength > 64 * 1024) {
          child.kill();
          fail(new SandboxBlockedError("Windows Sandbox native lifecycle helper emitted oversized output."));
          return current;
        }
        return Buffer.concat([current, chunk]);
      };
      child.stdout.on("data", (chunk: Buffer) => { output = append(output, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { errorOutput = append(errorOutput, chunk); });
      const abort = (): void => { child.kill(); fail(new SandboxCancelledError("Windows Sandbox native lifecycle request was cancelled.")); };
      const timer = setTimeout(() => { child.kill(); fail(new SandboxBlockedError("Windows Sandbox native lifecycle helper exceeded its deadline.")); }, 15_000);
      signal?.addEventListener("abort", abort, { once: true });
      child.once("error", fail);
      child.once("spawn", () => {
        void (async () => {
          const after = await attestLifecycleHelper(this.helperPath, this.helperSha256);
          if (!sameAttestedHelper(before, after)) throw new SandboxBlockedError("Windows Sandbox lifecycle helper changed during process creation.");
          child.stdin.end(`${JSON.stringify(request)}\n`);
        })().catch((error: unknown) => { child.kill(); fail(error); });
      });
      child.once("close", (exitCode) => finish(() => {
        let value: unknown;
        try { value = JSON.parse(output.toString("utf8")); }
        catch { rejectCall(new SandboxBlockedError("Windows Sandbox native lifecycle helper returned malformed JSON.")); return; }
        if (!lifecycleResponse(value) || value.requestId !== requestId || value.kind !== "result" || exitCode !== 0) {
          rejectCall(new SandboxBlockedError(`Windows Sandbox native lifecycle helper failed closed (${untrustedSummary(lifecycleErrorCode(value, errorOutput))}).`));
          return;
        }
        resolveCall(value);
      }));
    });
  }
}

/** Verifies both the inbox executable and the optional Windows feature. */
export class DefaultWindowsSandboxFeatureProbe implements WindowsSandboxFeatureProbe {
  private readonly filesystem: WindowsSandboxFileSystem;
  constructor(filesystem: WindowsSandboxFileSystem = nodeFileSystem) { this.filesystem = filesystem; }
  async check(): Promise<{ readonly available: boolean; readonly reason: string }> {
    if (process.platform !== "win32") return { available: false, reason: "Windows Sandbox is available only on Windows." };
    try {
      const [sandbox, dism] = await Promise.all([
        this.filesystem.stat(WINDOWS_SANDBOX_EXECUTABLE),
        this.filesystem.stat(WINDOWS_SANDBOX_FEATURE_TOOL)
      ]);
      if (!sandbox.isFile || !dism.isFile) return { available: false, reason: "Required inbox Windows Sandbox executables are absent." };
    } catch {
      return { available: false, reason: "Required inbox Windows Sandbox executables are inaccessible." };
    }
    const checked = await runFeatureCheck();
    return checked.exitCode === 0 && /State\s*:\s*Enabled/i.test(checked.output)
      ? { available: true, reason: "Containers-DisposableClientVM is enabled." }
      : { available: false, reason: "Containers-DisposableClientVM is not enabled or could not be verified." };
  }
}

async function runFeatureCheck(): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolveCheck) => {
    const child = spawn(WINDOWS_SANDBOX_FEATURE_TOOL, ["/Online", "/Get-FeatureInfo", "/FeatureName:Containers-DisposableClientVM", "/English"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" }
    });
    let output = "";
    const collect = (chunk: Buffer): void => { if (output.length < 16_384) output += chunk.toString("utf8").slice(0, 16_384 - output.length); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill(), 10_000);
    child.once("error", () => { clearTimeout(timer); resolveCheck({ exitCode: null, output }); });
    child.once("close", (exitCode) => { clearTimeout(timer); resolveCheck({ exitCode, output }); });
  });
}

/**
 * Reusable backend for full-sandbox, quarantine, and repository pipeline
 * recipes.  `execute` is the primary API; `run` is a compatibility alias.
 */
export class WindowsSandboxBackend {
  private readonly options: WindowsSandboxBackendOptions;
  private readonly filesystem: WindowsSandboxFileSystem;
  private readonly runner: WindowsSandboxProcessRunner;
  private readonly lifecycle?: WindowsSandboxLifecycleController;
  private readonly featureProbe: WindowsSandboxFeatureProbe;
  private readonly timeoutMs: number;
  private readonly maxProcessOutputBytes: number;
  private readonly maxExtractedBytes: number;
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(options: WindowsSandboxBackendOptions) {
    if (!options.allowedTaskRoots.length) throw new Error("Windows Sandbox requires at least one task-owned root.");
    if (!safeIdentifier.test(options.helperFilename) || !options.helperFilename.toLowerCase().endsWith(".exe")) throw new Error("Windows Sandbox helper filename must be a fixed safe executable filename.");
    if (!validRelativePath(options.jobManifestRelativePath)) throw new Error("Windows Sandbox job manifest must be a safe relative path.");
    const volumeIds = new Set<string>();
    for (const volume of options.approvedPersistentVolumes ?? []) {
      if (!safeIdentifier.test(volume.id) || !isAbsolute(volume.hostRoot) || volumeIds.has(volume.id.toLowerCase())) {
        throw new Error("Windows Sandbox persistent volumes require unique safe IDs and absolute host roots.");
      }
      volumeIds.add(volume.id.toLowerCase());
    }
    this.options = options;
    this.filesystem = options.filesystem ?? nodeFileSystem;
    this.runner = options.runner ?? new SpawnWindowsSandboxRunner();
    this.lifecycle = options.lifecycleController;
    this.featureProbe = options.featureProbe ?? new DefaultWindowsSandboxFeatureProbe(this.filesystem);
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 30 * 60_000, 1_000, maximumTimeoutMs, "timeout");
    this.maxProcessOutputBytes = boundedInteger(options.maxProcessOutputBytes ?? 64 * 1024, 1, 1024 * 1024, "process output limit");
    this.maxExtractedBytes = boundedInteger(options.maxExtractedBytes ?? 64 * 1024 * 1024, 1, 1024 * 1024 * 1024, "extraction limit");
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  run(request: WindowsSandboxExecutionRequest): Promise<WindowsSandboxExecutionResult> { return this.execute(request); }

  async execute(request: WindowsSandboxExecutionRequest): Promise<WindowsSandboxExecutionResult> {
    const recipeId = request.recipeId ?? "full_sandbox";
    if (!safeIdentifier.test(recipeId)) return { status: "blocked", summary: "Windows Sandbox rejected an invalid repository recipe identifier." };
    const profile = resolveProfile(request.profile, recipeId);
    if (!profile) return { status: "blocked", summary: "Windows Sandbox rejected a recipe/profile mismatch." };
    const resourcePolicy = resourcePolicyFor(profile, this.timeoutMs);
    const resourcePolicyDigest = sha256(JSON.stringify(resourcePolicy));
    if (!validDigest(request.expectedRecipeCatalogSha256) || !validDigest(request.expectedHelperSha256)) {
      return { status: "blocked", summary: "Windows Sandbox requires exact host-attested catalog and helper digests." };
    }
    const destinationAddress = request.destinationRoot ?? this.options.defaultDestinationRoot;
    if (!destinationAddress) return { status: "unavailable", summary: "Windows Sandbox has no host-owned validated output destination." };
    if (request.signal?.aborted) return { status: "cancelled", summary: "Windows Sandbox was cancelled before preparation." };
    let reconciled: readonly WindowsSandboxReceipt[];
    try { reconciled = await this.reconcile(); }
    catch (error) {
      const summary = untrustedSummary((error as Error).message || "Windows Sandbox could not reconcile its durable lease state.");
      return { status: error instanceof SandboxBlockedError ? "blocked" : "unavailable", summary };
    }
    const live = reconciled.filter((entry) => entry.state === "prepared" || entry.state === "running");
    const interactiveLifecycle = recipeId === "full_sandbox" || recipeId === "rebuild_full_sandbox" ? this.lifecycle : undefined;
    let lifecycleEffect: "created" | "rebuilt" = recipeId === "rebuild_full_sandbox" ? "rebuilt" : "created";
    if (live.length) {
      if (!interactiveLifecycle || live.length !== 1) {
        return { status: "unavailable", summary: "Windows Sandbox has an unreconciled live lease; no concurrent launch was attempted." };
      }
      try {
        const allowedRoots = await Promise.all(this.options.allowedTaskRoots.map((path) => this.filesystem.realpath(path)));
        const targetRoot = await this.canonicalOwnedDirectory(request.targetRoot, allowedRoots, "target");
        const destinationRoot = await this.canonicalOwnedDirectory(destinationAddress, allowedRoots, "destination");
        const stateRoot = await this.ensureOwnedDirectory(this.options.stateRoot, allowedRoots, "state");
        const current = live[0]!;
        if (current.state !== "running" || !samePath(current.targetRoot, targetRoot) || !samePath(current.destinationRoot, destinationRoot)
          || (current.profile !== "full_sandbox" && current.profile !== "fresh_full_sandbox") || !current.hostProcessIdentity) {
          return { status: "unavailable", summary: "Windows Sandbox live state is not one exact enterable Full Sandbox for this target." };
        }
        const guard = request.effectGuard ?? this.options.effectGuard;
        if (recipeId === "full_sandbox") return await this.enterLive(current, targetRoot, destinationRoot, guard, request.signal);
        await this.terminateForRebuild(current, stateRoot, targetRoot, destinationRoot, guard, request.signal);
      } catch (error) {
        return {
          status: error instanceof SandboxCancelledError ? "cancelled" : error instanceof SandboxBlockedError ? "blocked" : "failed",
          summary: untrustedSummary((error as Error).message || "Windows Sandbox lifecycle effect failed closed.")
        };
      }
    }
    const feature = await this.featureProbe.check().catch(() => ({ available: false, reason: "Windows Sandbox feature verification failed." }));
    if (!feature.available) return { status: "unavailable", summary: untrustedSummary(feature.reason) };

    const rawId = this.idFactory();
    if (!safeUuid.test(rawId)) return { status: "blocked", summary: "Windows Sandbox could not allocate a valid opaque lease identity." };
    const leaseId = `sandbox:${rawId}`;
    const processId = `sandbox-process:${rawId}`;
    const requestId = `sandbox-request:${rawId}`;
    let receiptPath: string | undefined;
    let receipt: WindowsSandboxReceipt | undefined;
    let leaseRoot: string | undefined;

    try {
      const allowedRoots = await Promise.all(this.options.allowedTaskRoots.map((path) => this.filesystem.realpath(path)));
      const targetRoot = await this.canonicalOwnedDirectory(request.targetRoot, allowedRoots, "target");
      const destinationRoot = await this.canonicalOwnedDirectory(destinationAddress, allowedRoots, "destination");
      const helperDirectory = await this.canonicalOwnedDirectory(this.options.helperDirectory, allowedRoots, "helper");
      const stateRoot = await this.ensureOwnedDirectory(this.options.stateRoot, allowedRoots, "state");
      const persistentVolumes = await this.resolvePersistentVolumes(profile, recipeId, allowedRoots, [targetRoot, destinationRoot, helperDirectory, stateRoot]);
      const helperPath = join(helperDirectory, this.options.helperFilename);
      const helper = await this.filesystem.lstat(helperPath);
      if (!helper.isFile || helper.isSymbolicLink) throw new SandboxBlockedError("Windows Sandbox fixed guest helper is absent or is a symbolic link.");
      const helperDigest = sha256(await this.filesystem.readBytes(helperPath));
      if (!sameDigest(helperDigest, request.expectedHelperSha256)) throw new SandboxBlockedError("Windows Sandbox fixed guest helper changed after host attestation.");
      const manifestPath = join(targetRoot, this.options.jobManifestRelativePath);
      const manifest = await this.filesystem.lstat(manifestPath);
      if (!manifest.isFile || manifest.isSymbolicLink || manifest.size <= 0 || manifest.size > maximumManifestBytes) throw new SandboxBlockedError("Windows Sandbox repository recipe catalog is absent, linked, empty, or oversized.");
      const recipeCatalogDigest = sha256(await this.filesystem.readBytes(manifestPath));
      if (!sameDigest(recipeCatalogDigest, request.expectedRecipeCatalogSha256)) throw new SandboxBlockedError("Windows Sandbox recipe catalog changed after host attestation.");

      leaseRoot = join(stateRoot, "leases", rawId);
      const exchangeRoot = join(leaseRoot, "exchange");
      await this.filesystem.mkdir(exchangeRoot);
      const canonicalLeaseRoot = await this.canonicalOwnedDirectory(leaseRoot, allowedRoots, "lease");
      const canonicalExchangeRoot = await this.canonicalOwnedDirectory(exchangeRoot, allowedRoots, "exchange");
      const configurationPath = join(canonicalLeaseRoot, "sandbox.wsb");
      const requestPath = join(canonicalExchangeRoot, "request.json");
      const requestDocument = JSON.stringify({
        schema: "sxsy-b122.windows-sandbox-request",
        version: 2,
        requestId,
        leaseId,
        recipeId,
        profile,
        recipeCatalogDigest,
        helperDigest,
        resourcePolicy,
        resourcePolicyDigest
      });
      await this.filesystem.writeText(requestPath, requestDocument);
      const configurationDocument = createConfiguration({
        targetRoot,
        helperDirectory,
        exchangeRoot: canonicalExchangeRoot,
        helperFilename: this.options.helperFilename,
        manifestRelativePath: this.options.jobManifestRelativePath,
        profile,
        resourcePolicy,
        persistentVolumes,
        interactive: Boolean(interactiveLifecycle)
      });
      await this.filesystem.writeText(configurationPath, configurationDocument);
      const requestDigest = sha256(requestDocument);
      const configurationDigest = sha256(configurationDocument);

      const created = this.now();
      const createdAt = created.toISOString();
      receiptPath = join(canonicalLeaseRoot, "receipt.json");
      receipt = {
        schema: windowsSandboxReceiptSchema,
        version: 2,
        leaseId,
        processId,
        requestId,
        recipeId,
        profile,
        state: "prepared",
        targetRoot,
        destinationRoot,
        createdAt,
        updatedAt: createdAt,
        deadline: new Date(created.getTime() + this.timeoutMs).toISOString(),
        timedOut: false,
        cancelled: false,
        processOutput: "",
        processOutputTruncated: false,
        recipeCatalogDigest,
        helperDigest,
        resourcePolicyDigest,
        requestDigest,
        configurationDigest,
        persistentVolumeIds: persistentVolumes.map((volume) => volume.id),
        cleanupVerified: false,
        summary: "Windows Sandbox launch is prepared but has not started."
      };
      await this.writeReceipt(receiptPath, receipt);

      await this.assertCanonicalUnchanged(targetRoot, "target");
      await this.assertCanonicalUnchanged(helperDirectory, "helper");
      await this.assertCanonicalUnchanged(canonicalExchangeRoot, "exchange");
      for (const volume of persistentVolumes) await this.assertCanonicalUnchanged(volume.hostRoot, `persistent volume ${volume.id}`);
      if (sha256(await this.filesystem.readBytes(helperPath)) !== helperDigest) throw new SandboxBlockedError("Windows Sandbox fixed guest helper changed after validation.");
      if (sha256(await this.filesystem.readBytes(manifestPath)) !== recipeCatalogDigest) throw new SandboxBlockedError("Windows Sandbox repository recipe catalog changed after validation.");
      if (sha256(await this.filesystem.readText(requestPath)) !== requestDigest) throw new SandboxBlockedError("Windows Sandbox exact request changed after validation.");
      if (sha256(await this.filesystem.readText(configurationPath)) !== configurationDigest) throw new SandboxBlockedError("Windows Sandbox configuration changed after validation.");
      const sandboxExecutable = await this.filesystem.lstat(WINDOWS_SANDBOX_EXECUTABLE).catch(() => undefined);
      if (!sandboxExecutable?.isFile || sandboxExecutable.isSymbolicLink) throw new SandboxBlockedError("The fixed inbox Windows Sandbox executable is unavailable at final launch.");
      const guard = request.effectGuard ?? this.options.effectGuard;
      await this.assertEffect(guard, { phase: "launch", leaseId, recipeId, targetRoot, destinationRoot });
      if (request.signal?.aborted) throw new SandboxCancelledError("Windows Sandbox cancellation arrived before launch.");

      const controller = request.signal ? undefined : new AbortController();
      const signal = request.signal ?? controller!.signal;
      const runSpec: WindowsSandboxRunSpec = {
        executable: WINDOWS_SANDBOX_EXECUTABLE,
        args: [configurationPath],
        cwd: canonicalLeaseRoot,
        environment: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" },
        shell: false,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: this.maxProcessOutputBytes
      };
      if (interactiveLifecycle) {
        const identity = assertProcessIdentity(await interactiveLifecycle.launch(runSpec, configurationDigest, signal));
        receipt = this.updateReceipt(receipt, {
          state: "running",
          hostPid: identity.pid,
          hostProcessIdentity: identity,
          summary: "Windows Sandbox exact interactive process is running."
        });
        await this.writeReceipt(receiptPath, receipt);
        return {
          status: "running",
          summary: recipeId === "rebuild_full_sandbox"
            ? "Rebuilt and entered a fresh exact Full Sandbox while preserving only approved persistent volumes."
            : "Created and entered the exact target-owned Full Sandbox.",
          leaseId,
          processId,
          receiptPath,
          recipeCatalogSha256: recipeCatalogDigest,
          sandboxHelperSha256: helperDigest,
          lifecycleEffect
        };
      }
      const processResult = await this.runner.run(runSpec, signal, async (pid) => {
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Windows Sandbox did not expose a valid owned child process identity.");
        receipt = this.updateReceipt(receipt!, { state: "running", hostPid: pid, summary: "Windows Sandbox owned process is running." });
        await this.writeReceipt(receiptPath!, receipt);
      });

      const combined = boundedRedactedOutput(`${processResult.stdout}\n${processResult.stderr}`, this.maxProcessOutputBytes);
      receipt = this.updateReceipt(receipt, {
        hostPid: processResult.pid ?? receipt.hostPid,
        exitCode: processResult.exitCode,
        timedOut: processResult.timedOut,
        cancelled: processResult.cancelled,
        processOutput: combined.output,
        processOutputTruncated: processResult.outputTruncated || combined.truncated
      });
      if (!processResult.hostProcessContained) return await this.finish(receiptPath, receipt, "failed", "Windows Sandbox could not prove host-process containment or the absence of survivors.");
      if (processResult.timedOut) return await this.finish(receiptPath, receipt, "timed_out", "Windows Sandbox exceeded its bounded deadline and its owned process was terminated.");
      if (processResult.cancelled || signal.aborted) return await this.finish(receiptPath, receipt, "cancelled", "Windows Sandbox was cancelled and its owned process was terminated.");
      if (processResult.exitCode !== 0) return await this.finish(receiptPath, receipt, "failed", `Windows Sandbox exited without a successful receipt (${processResult.exitCode ?? "no exit code"}).`);

      const validated = await this.validateResultManifest(canonicalExchangeRoot, { requestId, leaseId, recipeId, profile, recipeCatalogDigest, resourcePolicyDigest });
      await this.assertCanonicalUnchanged(targetRoot, "target");
      await this.assertCanonicalUnchanged(destinationRoot, "destination");
      await this.assertCanonicalUnchanged(canonicalExchangeRoot, "exchange");
      await this.assertEffect(guard, { phase: "extract", leaseId, recipeId, targetRoot, destinationRoot });
      if (signal.aborted) return await this.finish(receiptPath, receipt, "cancelled", "Windows Sandbox extraction was cancelled before any output left quarantine.");
      const resultRoot = await this.extractValidated(rawId, destinationRoot, validated.outputs);
      receipt = this.updateReceipt(receipt, {
        resultManifestDigest: validated.digest,
        resultRoot
      });
      const finished = await this.finish(receiptPath, receipt, "completed", `Windows Sandbox completed the verified ${recipeId} recipe and extracted validated output: ${validated.summary}`);
      return {
        ...finished,
        resultManifestSha256: validated.digest,
        recipeCatalogSha256: recipeCatalogDigest,
        sandboxHelperSha256: helperDigest,
        validatedOutputs: validated.outputs.map((output) => ({ path: output.relativePath, size: output.size, sha256: output.sha256 }))
      };
    } catch (error) {
      const status: Exclude<WindowsSandboxReceiptState, "prepared" | "running"> = error instanceof SandboxCancelledError ? "cancelled" : error instanceof SandboxBlockedError ? "blocked" : "failed";
      const summary = untrustedSummary((error as Error).message || "Windows Sandbox failed closed.");
      if (receipt && receiptPath) return this.finish(receiptPath, receipt, status, summary);
      if (leaseRoot) await this.filesystem.remove(leaseRoot).catch(() => undefined);
      return { status, summary, leaseId, processId, ...(receiptPath ? { receiptPath } : {}) };
    }
  }

  private async enterLive(
    receipt: WindowsSandboxReceipt,
    targetRoot: string,
    destinationRoot: string,
    guard: WindowsSandboxEffectGuard,
    signal?: AbortSignal
  ): Promise<WindowsSandboxExecutionResult> {
    if (!this.lifecycle || !receipt.hostProcessIdentity) throw new SandboxBlockedError("Windows Sandbox cannot enter a live lease without its exact native process identity.");
    if (signal?.aborted) throw new SandboxCancelledError("Windows Sandbox entry was cancelled.");
    const approvedVolumeIds = (this.options.approvedPersistentVolumes ?? []).map((volume) => volume.id).sort();
    if (JSON.stringify([...receipt.persistentVolumeIds].sort()) !== JSON.stringify(approvedVolumeIds)) {
      throw new SandboxBlockedError("Windows Sandbox persistent-volume approval changed while the interactive instance was running.");
    }
    await this.assertCanonicalUnchanged(targetRoot, "target");
    await this.assertCanonicalUnchanged(destinationRoot, "destination");
    const observation = await this.lifecycle.inspect(receipt.hostProcessIdentity);
    if (observation === "mismatch") throw new SandboxBlockedError("Windows Sandbox refused to focus a reused process identity.");
    if (observation !== "same") throw new SandboxBlockedError("Windows Sandbox exact process ended before focus.");
    await this.assertCanonicalUnchanged(targetRoot, "target");
    await this.assertCanonicalUnchanged(destinationRoot, "destination");
    await this.assertEffect(guard, { phase: "focus", leaseId: receipt.leaseId, recipeId: receipt.recipeId, targetRoot, destinationRoot });
    if (signal?.aborted) throw new SandboxCancelledError("Windows Sandbox entry was cancelled before focus.");
    await this.lifecycle.focus(receipt.hostProcessIdentity);
    if (await this.lifecycle.inspect(receipt.hostProcessIdentity) !== "same") throw new SandboxBlockedError("Windows Sandbox exact process changed during focus.");
    return {
      status: "running",
      summary: "Entered and focused the existing exact target-owned Full Sandbox.",
      leaseId: receipt.leaseId,
      processId: receipt.processId,
      receiptPath: this.receiptPath(receipt),
      recipeCatalogSha256: receipt.recipeCatalogDigest,
      sandboxHelperSha256: receipt.helperDigest,
      lifecycleEffect: "entered"
    };
  }

  private async terminateForRebuild(
    receipt: WindowsSandboxReceipt,
    stateRoot: string,
    targetRoot: string,
    destinationRoot: string,
    guard: WindowsSandboxEffectGuard,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.lifecycle || !receipt.hostProcessIdentity) throw new SandboxBlockedError("Windows Sandbox cannot rebuild without the exact prior process identity.");
    if (signal?.aborted) throw new SandboxCancelledError("Windows Sandbox rebuild was cancelled.");
    await this.assertCanonicalUnchanged(targetRoot, "target");
    await this.assertCanonicalUnchanged(destinationRoot, "destination");
    const observation = await this.lifecycle.inspect(receipt.hostProcessIdentity);
    if (observation === "mismatch") throw new SandboxBlockedError("Windows Sandbox refused to terminate a reused process identity.");
    if (observation !== "same") throw new SandboxBlockedError("Windows Sandbox prior process ended before the guarded rebuild.");
    await this.assertCanonicalUnchanged(targetRoot, "target");
    await this.assertCanonicalUnchanged(destinationRoot, "destination");
    await this.assertEffect(guard, { phase: "terminate", leaseId: receipt.leaseId, recipeId: "rebuild_full_sandbox", targetRoot, destinationRoot });
    if (signal?.aborted) throw new SandboxCancelledError("Windows Sandbox rebuild was cancelled before termination.");
    await this.lifecycle.terminate(receipt.hostProcessIdentity);
    if (await this.lifecycle.inspect(receipt.hostProcessIdentity) !== "absent") throw new SandboxBlockedError("Windows Sandbox could not prove the exact prior process terminated.");
    const receiptPath = this.receiptPath(receipt, stateRoot);
    const finished = await this.finish(receiptPath, receipt, "completed", "Windows Sandbox exact prior instance was terminated for a guarded rebuild.");
    if (finished.status !== "completed") throw new SandboxBlockedError("Windows Sandbox prior instance terminated but its owned cleanup could not be verified; no replacement was launched.");
  }

  private receiptPath(receipt: WindowsSandboxReceipt, stateRoot = this.options.stateRoot): string {
    const rawId = receipt.leaseId.slice("sandbox:".length);
    if (!safeUuid.test(rawId)) throw new SandboxBlockedError("Windows Sandbox durable lease identity is invalid.");
    return join(stateRoot, "leases", rawId, "receipt.json");
  }

  /**
   * Reconciles durable leases without ever terminating an unverified PID.  A
   * stale PID that still exists remains live/blocked; a missing PID can be
   * cleaned because the guest job and Windows Sandbox host have both exited.
   */
  async reconcile(): Promise<readonly WindowsSandboxReceipt[]> {
    const allowedRoots = await Promise.all(this.options.allowedTaskRoots.map((path) => this.filesystem.realpath(path)));
    const stateRoot = await this.ensureOwnedDirectory(this.options.stateRoot, allowedRoots, "state");
    const leasesRoot = join(stateRoot, "leases");
    await this.filesystem.mkdir(leasesRoot);
    const canonicalLeasesRoot = await this.canonicalOwnedDirectory(leasesRoot, [stateRoot], "leases");
    const receipts: WindowsSandboxReceipt[] = [];
    for (const entry of [...await this.filesystem.readDirectory(canonicalLeasesRoot)].sort()) {
      if (!safeUuid.test(entry)) continue;
      const leaseRoot = join(canonicalLeasesRoot, entry);
      const metadata = await this.filesystem.lstat(leaseRoot).catch(() => undefined);
      if (!metadata?.isDirectory || metadata.isSymbolicLink) continue;
      const receiptPath = join(leaseRoot, "receipt.json");
      const receiptMetadata = await this.filesystem.lstat(receiptPath).catch(() => undefined);
      if (!receiptMetadata?.isFile || receiptMetadata.isSymbolicLink || receiptMetadata.size <= 0 || receiptMetadata.size > maximumReceiptBytes) {
        throw new Error("Windows Sandbox found an ambiguous lease without a valid durable receipt.");
      }
      let receipt: WindowsSandboxReceipt;
      try { receipt = parseReceipt(await this.filesystem.readText(receiptPath), entry); }
      catch { throw new Error("Windows Sandbox found a malformed durable lease receipt."); }
      if (receipt.cleanupVerified) {
        receipts.push(receipt);
        continue;
      }
      if (receipt.state === "prepared" || receipt.state === "running") {
        if (receipt.hostProcessIdentity) {
          if (!this.lifecycle) throw new SandboxBlockedError("Windows Sandbox found an exact interactive lease but no native identity controller is available.");
          const identity = await this.lifecycle.inspect(receipt.hostProcessIdentity).catch(() => "mismatch" as const);
          if (identity === "same") {
            receipts.push(receipt);
            continue;
          }
          if (identity === "mismatch") throw new SandboxBlockedError("Windows Sandbox found a reused or changed durable process identity.");
          receipt = this.updateReceipt(receipt, {
            state: "completed",
            timedOut: false,
            reconciledAt: this.now().toISOString(),
            summary: "Windows Sandbox reconciled a normally ended exact interactive instance."
          });
          await this.writeReceipt(receiptPath, receipt);
        } else if (receipt.hostPid) {
          const active = this.runner.isProcessActive ? await this.runner.isProcessActive(receipt.hostPid).catch(() => true) : true;
          if (active) {
            receipts.push(receipt);
            continue;
          }
        } else if (Date.parse(receipt.deadline) > this.now().getTime()) {
          receipts.push(receipt);
          continue;
        }
        if (receipt.state === "prepared" || receipt.state === "running") {
          receipt = this.updateReceipt(receipt, {
            state: "failed",
            timedOut: true,
            reconciledAt: this.now().toISOString(),
            summary: "Windows Sandbox recovered an expired crash lease after proving its recorded host process was absent."
          });
          await this.writeReceipt(receiptPath, receipt);
        }
      }
      try {
        await this.cleanupLease(receiptPath, receipt);
        receipt = this.updateReceipt(receipt, { cleanupVerified: true });
        await this.writeReceipt(receiptPath, receipt);
      } catch {
        receipt = this.updateReceipt(receipt, {
          state: "failed",
          cleanupVerified: false,
          summary: "Windows Sandbox durable lease cleanup could not be verified."
        });
        await this.writeReceipt(receiptPath, receipt);
      }
      receipts.push(receipt);
    }
    return receipts;
  }

  private async resolvePersistentVolumes(
    profile: WindowsSandboxProfile,
    recipeId: string,
    allowedRoots: readonly string[],
    protectedRoots: readonly string[]
  ): Promise<readonly PersistentVolumeMapping[]> {
    if (profile === "quarantine" || (recipeId !== "full_sandbox" && recipeId !== "rebuild_full_sandbox")) return [];
    const mappings: PersistentVolumeMapping[] = [];
    for (const approved of this.options.approvedPersistentVolumes ?? []) {
      const hostRoot = await this.canonicalOwnedDirectory(approved.hostRoot, allowedRoots, `persistent volume ${approved.id}`);
      if (protectedRoots.some((root) => overlaps(root, hostRoot))) {
        throw new SandboxBlockedError("Windows Sandbox persistent volumes must be disjoint from source, helper, state, and result roots.");
      }
      mappings.push({
        id: approved.id,
        hostRoot,
        sandboxRoot: `C:\\B122\\persistent\\${approved.id}`,
        readOnly: approved.readOnly === true
      });
    }
    return mappings;
  }

  private async canonicalOwnedDirectory(path: string, roots: readonly string[], label: string): Promise<string> {
    if (!isAbsolute(path)) throw new SandboxBlockedError(`Windows Sandbox ${label} root must be absolute.`);
    const canonical = await this.filesystem.realpath(path).catch(() => { throw new SandboxBlockedError(`Windows Sandbox ${label} root is inaccessible.`); });
    const metadata = await this.filesystem.lstat(canonical);
    if (!metadata.isDirectory || metadata.isSymbolicLink) throw new SandboxBlockedError(`Windows Sandbox ${label} root is not a concrete directory.`);
    if (!roots.some((root) => inside(root, canonical))) throw new SandboxBlockedError(`Windows Sandbox ${label} root is outside the allowlisted task root.`);
    return canonical;
  }

  private async ensureOwnedDirectory(path: string, roots: readonly string[], label: string): Promise<string> {
    if (!isAbsolute(path)) throw new SandboxBlockedError(`Windows Sandbox ${label} root must be absolute.`);
    try { return await this.canonicalOwnedDirectory(path, roots, label); }
    catch (error) {
      const canonicalParent = await this.filesystem.realpath(dirname(path)).catch(() => "");
      if (!canonicalParent || !roots.some((root) => inside(root, canonicalParent))) {
        if (error instanceof SandboxBlockedError && !/inaccessible/i.test(error.message)) throw error;
        throw new SandboxBlockedError(`Windows Sandbox ${label} root is outside the allowlisted task root.`);
      }
    }
    await this.filesystem.mkdir(path);
    return this.canonicalOwnedDirectory(path, roots, label);
  }

  private async assertCanonicalUnchanged(path: string, label: string): Promise<void> {
    const current = await this.filesystem.realpath(path).catch(() => "");
    if (!samePath(path, current)) throw new SandboxBlockedError(`Windows Sandbox ${label} root changed after validation.`);
  }

  private async assertEffect(guard: WindowsSandboxEffectGuard, input: Parameters<WindowsSandboxEffectGuard["check"]>[0]): Promise<void> {
    const result = await guard.check(input);
    if (!result.allowed) throw new SandboxBlockedError(untrustedSummary(result.reason));
  }

  private async validateResultManifest(
    exchangeRoot: string,
    binding: Readonly<{
      requestId: string;
      leaseId: string;
      recipeId: string;
      profile: WindowsSandboxProfile;
      recipeCatalogDigest: string;
      resourcePolicyDigest: string;
    }>
  ): Promise<ValidatedResultManifest> {
    const manifestPath = join(exchangeRoot, "result-manifest.json");
    const metadata = await this.filesystem.lstat(manifestPath).catch(() => undefined);
    if (!metadata?.isFile || metadata.isSymbolicLink || metadata.size <= 0 || metadata.size > maximumManifestBytes) throw new SandboxValidationError("Windows Sandbox result manifest is absent, linked, empty, or oversized.");
    const bytes = await this.filesystem.readBytes(manifestPath);
    let unknown: unknown;
    try { unknown = JSON.parse(Buffer.from(bytes).toString("utf8")); }
    catch { throw new SandboxValidationError("Windows Sandbox result manifest is not valid JSON."); }
    if (!isRecord(unknown) || !exactKeys(unknown, ["schema", "version", "requestId", "leaseId", "recipeId", "profile", "recipeCatalogDigest", "resourcePolicyDigest", "outcome", "summary", "resourceEnforcement", "outputs"])) throw new SandboxValidationError("Windows Sandbox result manifest does not use the exact v2 schema.");
    if (unknown.schema !== windowsSandboxResultSchema || unknown.version !== 2 || unknown.outcome !== "completed") throw new SandboxValidationError("Windows Sandbox helper did not provide a successful exact-schema result.");
    if (unknown.requestId !== binding.requestId || unknown.leaseId !== binding.leaseId || unknown.recipeId !== binding.recipeId || unknown.profile !== binding.profile || unknown.recipeCatalogDigest !== binding.recipeCatalogDigest || unknown.resourcePolicyDigest !== binding.resourcePolicyDigest) throw new SandboxValidationError("Windows Sandbox result manifest is stale or is not bound to this exact request, profile, resource policy, and recipe catalog.");
    if (!isRecord(unknown.resourceEnforcement) || !exactKeys(unknown.resourceEnforcement, ["jobObject", "cpuHardCap", "memoryLimit", "processLimit", "noSurvivors", "activeProcessesAfterCleanup"])
      || unknown.resourceEnforcement.jobObject !== true || unknown.resourceEnforcement.cpuHardCap !== true
      || unknown.resourceEnforcement.memoryLimit !== true || unknown.resourceEnforcement.processLimit !== true
      || unknown.resourceEnforcement.noSurvivors !== true || unknown.resourceEnforcement.activeProcessesAfterCleanup !== 0) {
      throw new SandboxValidationError("Windows Sandbox helper did not prove enforced CPU, memory, process-count, and no-survivor boundaries.");
    }
    if (typeof unknown.summary !== "string" || Buffer.byteLength(unknown.summary, "utf8") > 1_024) throw new SandboxValidationError("Windows Sandbox result summary is invalid or oversized.");
    if (!Array.isArray(unknown.outputs) || unknown.outputs.length > maximumOutputs) throw new SandboxValidationError("Windows Sandbox output manifest exceeds its file-count bound.");
    const outputRoot = join(exchangeRoot, "output");
    await this.canonicalOwnedDirectory(outputRoot, [exchangeRoot], "quarantine output");
    const validated: ValidatedOutput[] = [];
    let total = 0;
    const seen = new Set<string>();
    for (const item of unknown.outputs) {
      if (!isRecord(item) || !exactKeys(item, ["path", "size", "sha256"])) throw new SandboxValidationError("Windows Sandbox output entry does not use the exact v1 schema.");
      if (typeof item.path !== "string" || !validRelativePath(item.path) || seen.has(normalizePath(item.path))) throw new SandboxValidationError("Windows Sandbox output path is unsafe or duplicated.");
      if (!Number.isSafeInteger(item.size) || (item.size as number) < 0 || (item.size as number) > maximumSingleOutputBytes) throw new SandboxValidationError("Windows Sandbox output size is invalid or oversized.");
      if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.sha256)) throw new SandboxValidationError("Windows Sandbox output digest is invalid.");
      total += item.size as number;
      if (total > this.maxExtractedBytes) throw new SandboxValidationError("Windows Sandbox total extracted output exceeds its configured bound.");
      const sourcePath = resolve(outputRoot, item.path);
      if (!inside(outputRoot, sourcePath)) throw new SandboxValidationError("Windows Sandbox output escapes quarantine.");
      const sourceMetadata = await this.filesystem.lstat(sourcePath).catch(() => undefined);
      if (!sourceMetadata?.isFile || sourceMetadata.isSymbolicLink || sourceMetadata.size !== item.size) throw new SandboxValidationError("Windows Sandbox output is missing, linked, or has the wrong size.");
      const canonicalSource = await this.filesystem.realpath(sourcePath);
      if (!inside(outputRoot, canonicalSource)) throw new SandboxValidationError("Windows Sandbox output resolves outside quarantine.");
      const contents = await this.filesystem.readBytes(canonicalSource);
      if (contents.byteLength !== item.size || sha256(contents) !== item.sha256.toLowerCase()) throw new SandboxValidationError("Windows Sandbox output digest does not match its quarantine manifest.");
      seen.add(normalizePath(item.path));
      validated.push({ relativePath: item.path, sourcePath: canonicalSource, sha256: item.sha256.toLowerCase(), size: item.size as number });
    }
    return { summary: untrustedSummary(unknown.summary), digest: sha256(bytes), outputs: validated };
  }

  private async extractValidated(rawId: string, destinationRoot: string, outputs: readonly ValidatedOutput[]): Promise<string> {
    const stagingRoot = join(destinationRoot, `.sandbox-${rawId}.extracting`);
    const finalRoot = join(destinationRoot, `sandbox-${rawId}`);
    try {
      await this.filesystem.lstat(stagingRoot);
      throw new SandboxBlockedError("Windows Sandbox extraction staging path already exists.");
    } catch (error) {
      if (error instanceof SandboxBlockedError) throw error;
    }
    try {
      await this.filesystem.lstat(finalRoot);
      throw new SandboxBlockedError("Windows Sandbox validated result path already exists.");
    } catch (error) {
      if (error instanceof SandboxBlockedError) throw error;
    }
    await this.filesystem.mkdir(stagingRoot);
    try {
      for (const output of outputs) {
        const current = await this.filesystem.readBytes(output.sourcePath);
        if (current.byteLength !== output.size || sha256(current) !== output.sha256) throw new SandboxValidationError("Windows Sandbox quarantine output changed during extraction.");
        const destination = resolve(stagingRoot, output.relativePath);
        if (!inside(stagingRoot, destination)) throw new SandboxValidationError("Windows Sandbox extraction destination escaped its owned staging root.");
        await this.filesystem.mkdir(dirname(destination));
        await this.filesystem.copyFile(output.sourcePath, destination);
        const copied = await this.filesystem.readBytes(destination);
        if (copied.byteLength !== output.size || sha256(copied) !== output.sha256) throw new SandboxValidationError("Windows Sandbox copied output failed post-copy verification.");
      }
      await this.filesystem.rename(stagingRoot, finalRoot);
      return finalRoot;
    } catch (error) {
      await this.filesystem.remove(stagingRoot);
      throw error;
    }
  }

  private updateReceipt(receipt: WindowsSandboxReceipt, changes: Partial<WindowsSandboxReceipt>): WindowsSandboxReceipt {
    return { ...receipt, ...changes, updatedAt: this.now().toISOString() };
  }

  private async finish(
    receiptPath: string,
    receipt: WindowsSandboxReceipt,
    state: Exclude<WindowsSandboxReceiptState, "prepared" | "running">,
    summary: string
  ): Promise<WindowsSandboxExecutionResult> {
    let next = this.updateReceipt(receipt, { state, summary: untrustedSummary(summary), cleanupVerified: false });
    await this.writeReceipt(receiptPath, next);
    try {
      await this.cleanupLease(receiptPath, next);
      next = this.updateReceipt(next, { cleanupVerified: true });
      await this.writeReceipt(receiptPath, next);
    } catch (error) {
      next = this.updateReceipt(next, {
        state: "failed",
        cleanupVerified: false,
        summary: `Windows Sandbox finished but durable lease cleanup could not be verified: ${untrustedSummary((error as Error).message)}`
      });
      await this.writeReceipt(receiptPath, next);
    }
    return {
      status: terminalStatus(next.state),
      summary: next.summary,
      leaseId: next.leaseId,
      processId: next.processId,
      receiptPath,
      ...(next.resultRoot ? { resultRoot: next.resultRoot } : {})
    };
  }

  private async cleanupLease(receiptPath: string, receipt: WindowsSandboxReceipt): Promise<void> {
    const leaseRoot = dirname(receiptPath);
    const rawId = basename(leaseRoot);
    if (!safeUuid.test(rawId)) throw new Error("Windows Sandbox refused an invalid durable lease cleanup identity.");
    await this.filesystem.remove(join(leaseRoot, "exchange"));
    await this.filesystem.remove(join(leaseRoot, "sandbox.wsb"));
    const destinationRoot = await this.filesystem.realpath(receipt.destinationRoot);
    const allowedRoots = await Promise.all(this.options.allowedTaskRoots.map((path) => this.filesystem.realpath(path)));
    if (!allowedRoots.some((root) => inside(root, destinationRoot))) throw new Error("Windows Sandbox refused an unowned extraction cleanup path.");
    await this.filesystem.remove(join(destinationRoot, `.sandbox-${rawId}.extracting`));
  }

  private async writeReceipt(path: string, receipt: WindowsSandboxReceipt): Promise<void> {
    const contents = JSON.stringify(receipt, null, 2);
    if (Buffer.byteLength(contents, "utf8") > maximumReceiptBytes) throw new Error("Windows Sandbox durable receipt exceeded its bound.");
    const temporary = `${path}.${randomUUID()}.tmp`;
    await this.filesystem.writeText(temporary, contents);
    await this.filesystem.rename(temporary, path);
  }
}

export interface WindowsSandboxIsolationRuntimeOptions {
  readonly destinationRoot: string;
  readonly permitVerifier: PermitVerifier;
  readonly recipeCatalogDigest: string;
  readonly helperDigest: string;
}

/** Control-plane wrapper; success is reported only for a concrete completed backend receipt. */
export class WindowsSandboxIsolationRuntime implements IsolationRuntime {
  private readonly backend: WindowsSandboxBackend;
  private readonly options: WindowsSandboxIsolationRuntimeOptions;
  constructor(backend: WindowsSandboxBackend, options: WindowsSandboxIsolationRuntimeOptions) {
    this.backend = backend;
    this.options = options;
  }
  async start(request: IsolationRequest): Promise<BrokerOutcome> {
    return this.executeRecipe(request, request.profile);
  }
  async executeRecipe(request: IsolationRequest, recipeId: string): Promise<BrokerOutcome> {
    if (!safeIdentifier.test(recipeId)) return { status: "blocked", summary: "Windows Sandbox rejected an invalid exact recipe identity." };
    if (!this.options.permitVerifier.verifyPermit(request.permit, {
      action: request.action,
      operationId: request.operationId,
      targetSnapshotId: request.target.id,
      ...(request.session ? { sessionId: request.session.id } : {}),
      ...(request.authority ? { authorityId: request.authority.id } : {})
    })) return { status: "blocked", summary: "Windows Sandbox denied an absent, expired, forged, or mismatched policy permit." };
    if (!request.effectGuard) return { status: "blocked", summary: "Windows Sandbox requires a host-owned final effect guard." };
    if (request.executionControl && Date.parse(request.executionControl.deadline) <= Date.now()) return { status: "timed_out", summary: "Windows Sandbox refused an expired durable deadline." };
    if (request.executionControl && await request.executionControl.isCancellationRequested()) return { status: "cancelled", summary: "Windows Sandbox refused a cancelled durable operation." };
    const controller = new AbortController();
    let poll: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    if (request.executionControl) {
      const remaining = Math.max(1, Date.parse(request.executionControl.deadline) - Date.now());
      deadline = setTimeout(() => controller.abort(), remaining);
      poll = setInterval(() => {
        void request.executionControl!.isCancellationRequested().then(
          (cancelled) => { if (cancelled) controller.abort(); },
          () => controller.abort()
        );
      }, 100);
    }
    const controlPlaneGuard: WindowsSandboxEffectGuard = {
      check: async (input) => {
        if (controller.signal.aborted) return { allowed: false, reason: "Windows Sandbox durable operation was cancelled or expired." };
        const checked = await (request.effectGuard as EffectGuard).assertCurrent({
          action: request.action,
          operationId: request.operationId,
          target: request.target,
          ...(request.session ? { session: request.session } : {}),
          ...(request.authority ? { authority: request.authority } : {})
        });
        return checked.allowed ? { allowed: true, reason: `${input.phase} target is current` } : checked;
      }
    };
    try {
      const result = await this.backend.execute({
        targetRoot: request.target.repositoryRoot,
        destinationRoot: this.options.destinationRoot,
        recipeId,
        profile: request.profile === "rebuild_full_sandbox" ? "fresh_full_sandbox" : request.profile,
        expectedRecipeCatalogSha256: this.options.recipeCatalogDigest,
        expectedHelperSha256: this.options.helperDigest,
        signal: controller.signal,
        effectGuard: controlPlaneGuard
      });
      return {
        status: result.status,
        summary: result.summary,
        data: {
          backend: "windows-sandbox",
          enforced: result.status === "completed" || result.status === "running",
          ...(result.leaseId ? { leaseId: result.leaseId } : {}),
          ...(result.processId ? { processId: result.processId } : {}),
          ...(result.receiptPath ? { receiptPath: result.receiptPath } : {}),
          ...(result.resultRoot ? { resultRoot: result.resultRoot } : {}),
          ...(result.resultManifestSha256 ? { resultManifestSha256: result.resultManifestSha256 } : {}),
          ...(result.recipeCatalogSha256 ? { recipeCatalogSha256: result.recipeCatalogSha256 } : {}),
          ...(result.sandboxHelperSha256 ? { sandboxHelperSha256: result.sandboxHelperSha256 } : {}),
          ...(result.validatedOutputs ? { validatedOutputs: result.validatedOutputs } : {}),
          ...(result.lifecycleEffect ? { lifecycleEffect: result.lifecycleEffect } : {})
        }
      };
    } finally {
      if (poll) clearInterval(poll);
      if (deadline) clearTimeout(deadline);
    }
  }
}

function createConfiguration(input: Readonly<{
  targetRoot: string;
  helperDirectory: string;
  exchangeRoot: string;
  helperFilename: string;
  manifestRelativePath: string;
  profile: WindowsSandboxProfile;
  resourcePolicy: WindowsSandboxResourcePolicy;
  persistentVolumes: readonly PersistentVolumeMapping[];
  interactive: boolean;
}>): string {
  const command = `&quot;C:\\B122\\tools\\${input.helperFilename}&quot; --catalog &quot;C:\\B122\\input\\${input.manifestRelativePath.replace(/\//g, "\\")}&quot; --request &quot;C:\\B122\\exchange\\request.json&quot; --output &quot;C:\\B122\\exchange&quot;`;
  return [
    "<Configuration>",
    "  <VGpu>Disable</VGpu>",
    "  <Networking>Disable</Networking>",
    "  <AudioInput>Disable</AudioInput>",
    "  <VideoInput>Disable</VideoInput>",
    "  <PrinterRedirection>Disable</PrinterRedirection>",
    "  <ClipboardRedirection>Disable</ClipboardRedirection>",
    "  <ProtectedClient>Enable</ProtectedClient>",
    `  <MemoryInMB>${input.profile === "quarantine" ? 2048 : 4096}</MemoryInMB>`,
    "  <MappedFolders>",
    mappedFolder(input.targetRoot, "C:\\B122\\input", true),
    mappedFolder(input.helperDirectory, "C:\\B122\\tools", true),
    mappedFolder(input.exchangeRoot, "C:\\B122\\exchange", false),
    ...input.persistentVolumes.map((volume) => mappedFolder(volume.hostRoot, volume.sandboxRoot, volume.readOnly)),
    "  </MappedFolders>",
    ...(input.interactive ? [] : [`  <LogonCommand><Command>${command}</Command></LogonCommand>`]),
    "</Configuration>",
    ""
  ].join("\n");
}

function mappedFolder(hostFolder: string, sandboxFolder: string, readOnly: boolean): string {
  return `    <MappedFolder><HostFolder>${xml(hostFolder)}</HostFolder><SandboxFolder>${xml(sandboxFolder)}</SandboxFolder><ReadOnly>${readOnly ? "true" : "false"}</ReadOnly></MappedFolder>`;
}

function resolveProfile(requested: WindowsSandboxProfile | undefined, recipeId: string): WindowsSandboxProfile | undefined {
  const derived: WindowsSandboxProfile = recipeId === "rebuild_full_sandbox"
    ? "fresh_full_sandbox"
    : recipeId === "quarantine" ? "quarantine" : "full_sandbox";
  const profile = requested ?? derived;
  if (recipeId === "full_sandbox" && profile !== "full_sandbox") return undefined;
  if (recipeId === "rebuild_full_sandbox" && profile !== "fresh_full_sandbox") return undefined;
  if (recipeId === "quarantine" && profile !== "quarantine") return undefined;
  if (recipeId !== "full_sandbox" && recipeId !== "rebuild_full_sandbox" && recipeId !== "quarantine" && profile !== "full_sandbox") return undefined;
  return profile;
}

function resourcePolicyFor(profile: WindowsSandboxProfile, wallTimeMs: number): WindowsSandboxResourcePolicy {
  if (profile === "quarantine") {
    return {
      cpuRatePercent: 25,
      jobMemoryMiB: 1536,
      processMemoryMiB: 512,
      activeProcessLimit: 8,
      wallTimeMs
    };
  }
  return {
    cpuRatePercent: 75,
    jobMemoryMiB: 3584,
    processMemoryMiB: 2048,
    activeProcessLimit: 64,
    wallTimeMs
  };
}

function terminalStatus(state: WindowsSandboxReceiptState): WindowsSandboxStatus {
  return state === "completed" || state === "failed" || state === "blocked" || state === "timed_out" || state === "cancelled"
    ? state
    : "failed";
}

function parseReceipt(contents: string, rawId: string): WindowsSandboxReceipt {
  if (Buffer.byteLength(contents, "utf8") <= 0 || Buffer.byteLength(contents, "utf8") > maximumReceiptBytes) throw new Error("Windows Sandbox receipt is outside its bound.");
  let value: unknown;
  try { value = JSON.parse(contents); }
  catch { throw new Error("Windows Sandbox receipt is not valid JSON."); }
  if (!isRecord(value) || value.schema !== windowsSandboxReceiptSchema || value.version !== 2
    || value.leaseId !== `sandbox:${rawId}` || value.processId !== `sandbox-process:${rawId}` || value.requestId !== `sandbox-request:${rawId}`
    || typeof value.recipeId !== "string" || !safeIdentifier.test(value.recipeId)
    || (value.profile !== "full_sandbox" && value.profile !== "fresh_full_sandbox" && value.profile !== "quarantine")
    || !["prepared", "running", "completed", "failed", "blocked", "timed_out", "cancelled"].includes(String(value.state))
    || typeof value.targetRoot !== "string" || !isAbsolute(value.targetRoot)
    || typeof value.destinationRoot !== "string" || !isAbsolute(value.destinationRoot)
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
    || typeof value.deadline !== "string" || !Number.isFinite(Date.parse(value.deadline))
    || typeof value.timedOut !== "boolean" || typeof value.cancelled !== "boolean"
    || typeof value.processOutput !== "string" || Buffer.byteLength(value.processOutput, "utf8") > 1024 * 1024
    || typeof value.processOutputTruncated !== "boolean"
    || typeof value.recipeCatalogDigest !== "string" || !validDigest(value.recipeCatalogDigest)
    || typeof value.helperDigest !== "string" || !validDigest(value.helperDigest)
    || typeof value.resourcePolicyDigest !== "string" || !validDigest(value.resourcePolicyDigest)
    || typeof value.requestDigest !== "string" || !validDigest(value.requestDigest)
    || typeof value.configurationDigest !== "string" || !validDigest(value.configurationDigest)
    || !Array.isArray(value.persistentVolumeIds) || value.persistentVolumeIds.length > 32 || value.persistentVolumeIds.some((id) => typeof id !== "string" || !safeIdentifier.test(id))
    || typeof value.cleanupVerified !== "boolean" || typeof value.summary !== "string"
    || (value.hostPid !== undefined && (!Number.isSafeInteger(value.hostPid) || (value.hostPid as number) <= 0))
    || (value.hostProcessIdentity !== undefined && !validProcessIdentity(value.hostProcessIdentity))
    || (value.hostProcessIdentity !== undefined && value.hostPid !== (value.hostProcessIdentity as WindowsSandboxProcessIdentity).pid)) {
    throw new Error("Windows Sandbox receipt is malformed or not bound to its lease path.");
  }
  return value as unknown as WindowsSandboxReceipt;
}

function xml(value: string): string {
  if (/[\0-\x08\x0B\x0C\x0E-\x1F]/.test(value)) throw new SandboxBlockedError("Windows Sandbox path contains invalid XML controls.");
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Windows Sandbox ${label} is outside its safe bound.`);
  return value;
}

function validDigest(value: string): boolean { return /^[a-f0-9]{64}$/i.test(value); }
function sameDigest(left: string, right: string): boolean {
  return validDigest(left) && validDigest(right) && left.toLowerCase() === right.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function validRelativePath(value: string): boolean {
  if (!value || isAbsolute(value) || /[\0\r\n]/.test(value) || Buffer.byteLength(value, "utf8") > 1_024) return false;
  const parts = value.split(/[\\/]/);
  return parts.every((part) => part && part !== "." && part !== ".." && !/[<>:"|?*]/.test(part));
}

function normalizePath(value: string): string { return value.replace(/\\/g, "/").toLowerCase(); }
function samePath(left: string, right: string): boolean { return normalizePath(resolve(left)) === normalizePath(resolve(right)); }
function overlaps(left: string, right: string): boolean { return inside(left, right) || inside(right, left); }
function inside(root: string, candidate: string): boolean {
  const difference = relative(resolve(root), resolve(candidate));
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference) && !difference.split(sep).includes(".."));
}
function sha256(contents: Uint8Array | string): string { return createHash("sha256").update(contents).digest("hex"); }
function boundedRedactedOutput(value: string, maximumBytes: number): { output: string; truncated: boolean } {
  const redacted = redactText(value);
  const bytes = Buffer.from(redacted, "utf8");
  return bytes.byteLength <= maximumBytes
    ? { output: redacted, truncated: false }
    : { output: bytes.subarray(0, maximumBytes).toString("utf8"), truncated: true };
}

interface AttestedLifecycleHelper {
  readonly path: string;
  readonly sha256: string;
  readonly size: string;
  readonly modifiedNanoseconds: string;
  readonly device: string;
  readonly inode: string;
}

async function attestLifecycleHelper(configuredPath: string, expectedSha256: string): Promise<AttestedLifecycleHelper> {
  const link = await lstat(configuredPath).catch(() => { throw new SandboxBlockedError("Windows Sandbox lifecycle helper is unavailable."); });
  if (!link.isFile() || link.isSymbolicLink()) throw new SandboxBlockedError("Windows Sandbox lifecycle helper is not one concrete regular file.");
  const canonical = await realpath(configuredPath).catch(() => { throw new SandboxBlockedError("Windows Sandbox lifecycle helper cannot be canonicalized."); });
  if (!samePath(canonical, configuredPath) || basename(canonical).toLowerCase() !== "b122-sandbox-lifecycle.exe") {
    throw new SandboxBlockedError("Windows Sandbox lifecycle helper path changed after installation.");
  }
  const before = await stat(canonical, { bigint: true });
  if (!before.isFile() || before.size <= 0n || before.size > 256n * 1024n * 1024n) throw new SandboxBlockedError("Windows Sandbox lifecycle helper is outside its size bound.");
  const bytes = await readFile(canonical);
  if (!sameDigest(sha256(bytes), expectedSha256)) throw new SandboxBlockedError("Windows Sandbox lifecycle helper changed after current-user attestation.");
  const after = await stat(canonical, { bigint: true });
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.dev !== after.dev || before.ino !== after.ino) {
    throw new SandboxBlockedError("Windows Sandbox lifecycle helper changed during verification.");
  }
  return {
    path: canonical,
    sha256: expectedSha256.toLowerCase(),
    size: before.size.toString(10),
    modifiedNanoseconds: before.mtimeNs.toString(10),
    device: unsignedDecimal(before.dev),
    inode: unsignedDecimal(before.ino)
  };
}

function sameAttestedHelper(left: AttestedLifecycleHelper, right: AttestedLifecycleHelper): boolean {
  return samePath(left.path, right.path) && left.sha256 === right.sha256 && left.size === right.size
    && left.modifiedNanoseconds === right.modifiedNanoseconds && left.device === right.device && left.inode === right.inode;
}

function unsignedDecimal(value: bigint): string {
  return BigInt.asUintN(64, value).toString(10);
}

function assertProcessIdentity(value: unknown): WindowsSandboxProcessIdentity {
  if (!validProcessIdentity(value)) throw new SandboxBlockedError("Windows Sandbox native process identity is malformed.");
  return value;
}

function validProcessIdentity(value: unknown): value is WindowsSandboxProcessIdentity {
  return isRecord(value)
    && exactKeys(value, ["pid", "creationFileTimeUtc", "executablePath", "executableVolumeSerialNumber", "executableFileIndex", "sessionId"])
    && Number.isSafeInteger(value.pid) && (value.pid as number) > 0 && (value.pid as number) <= 0xffff_ffff
    && typeof value.creationFileTimeUtc === "string" && unsigned64(value.creationFileTimeUtc)
    && typeof value.executablePath === "string" && samePath(value.executablePath, WINDOWS_SANDBOX_EXECUTABLE)
    && typeof value.executableVolumeSerialNumber === "string" && unsigned64(value.executableVolumeSerialNumber)
    && typeof value.executableFileIndex === "string" && unsigned64(value.executableFileIndex)
    && Number.isSafeInteger(value.sessionId) && (value.sessionId as number) >= 0 && (value.sessionId as number) <= 0xffff_ffff;
}

function unsigned64(value: string): boolean {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) return false;
  try { return BigInt(value) <= 18_446_744_073_709_551_615n; }
  catch { return false; }
}

function sameProcessIdentity(left: WindowsSandboxProcessIdentity, right: WindowsSandboxProcessIdentity): boolean {
  return left.pid === right.pid && left.creationFileTimeUtc === right.creationFileTimeUtc
    && samePath(left.executablePath, right.executablePath)
    && left.executableVolumeSerialNumber === right.executableVolumeSerialNumber
    && left.executableFileIndex === right.executableFileIndex && left.sessionId === right.sessionId;
}

function lifecycleResponse(value: unknown): value is LifecycleHelperResponse {
  return isRecord(value)
    && value.schema === "sxsy-b122.sandbox-lifecycle-response"
    && value.version === 1
    && typeof value.requestId === "string" && value.requestId.length >= 24 && value.requestId.length <= 128
    && (value.kind === "result" || value.kind === "error")
    && (value.status === undefined || value.status === "same" || value.status === "absent" || value.status === "mismatch")
    && (value.effect === undefined || value.effect === "launched" || value.effect === "focused" || value.effect === "terminated")
    && (value.identity === undefined || validProcessIdentity(value.identity))
    && (value.code === undefined || typeof value.code === "string" && safeIdentifier.test(value.code));
}

function lifecycleErrorCode(value: unknown, stderr: Uint8Array): string {
  if (isRecord(value) && typeof value.code === "string" && safeIdentifier.test(value.code)) return value.code;
  const message = Buffer.from(stderr).toString("utf8").trim();
  return message ? boundedRedactedOutput(message, 256).output : "native_failure";
}
