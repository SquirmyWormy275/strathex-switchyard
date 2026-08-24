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
}

export interface WindowsSandboxProcessRunner {
  run(
    spec: WindowsSandboxRunSpec,
    signal: AbortSignal,
    onStarted: (pid: number) => Promise<void>
  ): Promise<WindowsSandboxProcessResult>;
}

export interface WindowsSandboxFeatureProbe {
  check(): Promise<{ readonly available: boolean; readonly reason: string }>;
}

export type WindowsSandboxEffectPhase = "launch" | "extract";
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
  readonly version: 1;
  readonly leaseId: string;
  readonly processId: string;
  readonly requestId: string;
  readonly recipeId: string;
  readonly state: WindowsSandboxReceiptState;
  readonly targetRoot: string;
  readonly destinationRoot: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly hostPid?: number;
  readonly exitCode?: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly processOutput: string;
  readonly processOutputTruncated: boolean;
  readonly recipeCatalogDigest: string;
  readonly helperDigest: string;
  readonly resultManifestDigest?: string;
  readonly resultRoot?: string;
  readonly summary: string;
}

export type WindowsSandboxStatus = "completed" | "failed" | "unavailable" | "blocked" | "timed_out" | "cancelled";
export interface WindowsSandboxExecutionResult {
  readonly status: WindowsSandboxStatus;
  readonly summary: string;
  readonly leaseId?: string;
  readonly processId?: string;
  readonly receiptPath?: string;
  readonly resultRoot?: string;
}

export interface WindowsSandboxExecutionRequest {
  readonly targetRoot: string;
  readonly destinationRoot?: string;
  /** Selects a recipe in the fixed repository catalog; never a command line. */
  readonly recipeId?: string;
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
  readonly filesystem?: WindowsSandboxFileSystem;
  readonly timeoutMs?: number;
  readonly maxProcessOutputBytes?: number;
  readonly maxExtractedBytes?: number;
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
  async writeBytes(path, contents) { await writeFile(path, contents, { mode: 0o600 }); },
  async writeText(path, contents) { await writeFile(path, contents, { encoding: "utf8", mode: 0o600 }); },
  rename,
  copyFile,
  async remove(path) { await rm(path, { recursive: true, force: true }); }
};

/** Concrete shell-free child supervisor used for WindowsSandbox.exe itself. */
export class SpawnWindowsSandboxRunner implements WindowsSandboxProcessRunner {
  async run(spec: WindowsSandboxRunSpec, signal: AbortSignal, onStarted: (pid: number) => Promise<void>): Promise<WindowsSandboxProcessResult> {
    if (spec.executable !== WINDOWS_SANDBOX_EXECUTABLE || spec.args.length !== 1 || !isAbsolute(spec.args[0])) {
      throw new SandboxBlockedError("Windows Sandbox runner rejected a non-fixed executable or non-exact configuration path.");
    }
    if (signal.aborted) return { exitCode: null, stdout: "", stderr: "", timedOut: false, cancelled: true, outputTruncated: false };
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
            outputTruncated
          });
        })();
      });
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
    this.options = options;
    this.filesystem = options.filesystem ?? nodeFileSystem;
    this.runner = options.runner ?? new SpawnWindowsSandboxRunner();
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
    if (!validDigest(request.expectedRecipeCatalogSha256) || !validDigest(request.expectedHelperSha256)) {
      return { status: "blocked", summary: "Windows Sandbox requires exact host-attested catalog and helper digests." };
    }
    const destinationAddress = request.destinationRoot ?? this.options.defaultDestinationRoot;
    if (!destinationAddress) return { status: "unavailable", summary: "Windows Sandbox has no host-owned validated output destination." };
    if (request.signal?.aborted) return { status: "cancelled", summary: "Windows Sandbox was cancelled before preparation." };
    const feature = await this.featureProbe.check().catch(() => ({ available: false, reason: "Windows Sandbox feature verification failed." }));
    if (!feature.available) return { status: "unavailable", summary: untrustedSummary(feature.reason) };

    const rawId = this.idFactory();
    if (!safeUuid.test(rawId)) return { status: "blocked", summary: "Windows Sandbox could not allocate a valid opaque lease identity." };
    const leaseId = `sandbox:${rawId}`;
    const processId = `sandbox-process:${rawId}`;
    const requestId = `sandbox-request:${rawId}`;
    let receiptPath: string | undefined;
    let receipt: WindowsSandboxReceipt | undefined;

    try {
      const allowedRoots = await Promise.all(this.options.allowedTaskRoots.map((path) => this.filesystem.realpath(path)));
      const targetRoot = await this.canonicalOwnedDirectory(request.targetRoot, allowedRoots, "target");
      const destinationRoot = await this.canonicalOwnedDirectory(destinationAddress, allowedRoots, "destination");
      const helperDirectory = await this.canonicalOwnedDirectory(this.options.helperDirectory, allowedRoots, "helper");
      const stateRoot = await this.ensureOwnedDirectory(this.options.stateRoot, allowedRoots, "state");
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

      const leaseRoot = join(stateRoot, "leases", rawId);
      const exchangeRoot = join(leaseRoot, "exchange");
      await this.filesystem.mkdir(exchangeRoot);
      const canonicalLeaseRoot = await this.canonicalOwnedDirectory(leaseRoot, allowedRoots, "lease");
      const canonicalExchangeRoot = await this.canonicalOwnedDirectory(exchangeRoot, allowedRoots, "exchange");
      const configurationPath = join(canonicalLeaseRoot, "sandbox.wsb");
      const requestPath = join(canonicalExchangeRoot, "request.json");
      const requestDocument = JSON.stringify({
        schema: "sxsy-b122.windows-sandbox-request",
        version: 1,
        requestId,
        leaseId,
        recipeId,
        recipeCatalogDigest,
        helperDigest
      });
      await this.filesystem.writeText(requestPath, requestDocument);
      await this.filesystem.writeText(configurationPath, createConfiguration({
        targetRoot,
        helperDirectory,
        exchangeRoot: canonicalExchangeRoot,
        helperFilename: this.options.helperFilename,
        manifestRelativePath: this.options.jobManifestRelativePath
      }));

      const createdAt = this.now().toISOString();
      receiptPath = join(canonicalLeaseRoot, "receipt.json");
      receipt = {
        schema: windowsSandboxReceiptSchema,
        version: 1,
        leaseId,
        processId,
        requestId,
        recipeId,
        state: "prepared",
        targetRoot,
        destinationRoot,
        createdAt,
        updatedAt: createdAt,
        timedOut: false,
        cancelled: false,
        processOutput: "",
        processOutputTruncated: false,
        recipeCatalogDigest,
        helperDigest,
        summary: "Windows Sandbox launch is prepared but has not started."
      };
      await this.writeReceipt(receiptPath, receipt);

      await this.assertCanonicalUnchanged(targetRoot, "target");
      await this.assertCanonicalUnchanged(helperDirectory, "helper");
      await this.assertCanonicalUnchanged(canonicalExchangeRoot, "exchange");
      if (sha256(await this.filesystem.readBytes(helperPath)) !== helperDigest) throw new SandboxBlockedError("Windows Sandbox fixed guest helper changed after validation.");
      if (sha256(await this.filesystem.readBytes(manifestPath)) !== recipeCatalogDigest) throw new SandboxBlockedError("Windows Sandbox repository recipe catalog changed after validation.");
      const sandboxExecutable = await this.filesystem.lstat(WINDOWS_SANDBOX_EXECUTABLE).catch(() => undefined);
      if (!sandboxExecutable?.isFile || sandboxExecutable.isSymbolicLink) throw new SandboxBlockedError("The fixed inbox Windows Sandbox executable is unavailable at final launch.");
      const guard = request.effectGuard ?? this.options.effectGuard;
      await this.assertEffect(guard, { phase: "launch", leaseId, recipeId, targetRoot, destinationRoot });
      if (request.signal?.aborted) throw new SandboxCancelledError("Windows Sandbox cancellation arrived before launch.");

      const controller = request.signal ? undefined : new AbortController();
      const signal = request.signal ?? controller!.signal;
      const processResult = await this.runner.run({
        executable: WINDOWS_SANDBOX_EXECUTABLE,
        args: [configurationPath],
        cwd: canonicalLeaseRoot,
        environment: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" },
        shell: false,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: this.maxProcessOutputBytes
      }, signal, async (pid) => {
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
      if (processResult.timedOut) return await this.finish(receiptPath, receipt, "timed_out", "Windows Sandbox exceeded its bounded deadline and its owned process was terminated.");
      if (processResult.cancelled || signal.aborted) return await this.finish(receiptPath, receipt, "cancelled", "Windows Sandbox was cancelled and its owned process was terminated.");
      if (processResult.exitCode !== 0) return await this.finish(receiptPath, receipt, "failed", `Windows Sandbox exited without a successful receipt (${processResult.exitCode ?? "no exit code"}).`);

      const validated = await this.validateResultManifest(canonicalExchangeRoot, { requestId, leaseId, recipeId, recipeCatalogDigest });
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
      return await this.finish(receiptPath, receipt, "completed", `Windows Sandbox completed the verified ${recipeId} recipe and extracted validated output: ${validated.summary}`);
    } catch (error) {
      const status: Exclude<WindowsSandboxReceiptState, "prepared" | "running"> = error instanceof SandboxCancelledError ? "cancelled" : error instanceof SandboxBlockedError ? "blocked" : "failed";
      const summary = untrustedSummary((error as Error).message || "Windows Sandbox failed closed.");
      if (receipt && receiptPath) return this.finish(receiptPath, receipt, status, summary);
      return { status, summary, leaseId, processId, ...(receiptPath ? { receiptPath } : {}) };
    }
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
    binding: Readonly<{ requestId: string; leaseId: string; recipeId: string; recipeCatalogDigest: string }>
  ): Promise<ValidatedResultManifest> {
    const manifestPath = join(exchangeRoot, "result-manifest.json");
    const metadata = await this.filesystem.lstat(manifestPath).catch(() => undefined);
    if (!metadata?.isFile || metadata.isSymbolicLink || metadata.size <= 0 || metadata.size > maximumManifestBytes) throw new SandboxValidationError("Windows Sandbox result manifest is absent, linked, empty, or oversized.");
    const bytes = await this.filesystem.readBytes(manifestPath);
    let unknown: unknown;
    try { unknown = JSON.parse(Buffer.from(bytes).toString("utf8")); }
    catch { throw new SandboxValidationError("Windows Sandbox result manifest is not valid JSON."); }
    if (!isRecord(unknown) || !exactKeys(unknown, ["schema", "version", "requestId", "leaseId", "recipeId", "recipeCatalogDigest", "outcome", "summary", "outputs"])) throw new SandboxValidationError("Windows Sandbox result manifest does not use the exact v1 schema.");
    if (unknown.schema !== windowsSandboxResultSchema || unknown.version !== 1 || unknown.outcome !== "completed") throw new SandboxValidationError("Windows Sandbox helper did not provide a successful exact-schema result.");
    if (unknown.requestId !== binding.requestId || unknown.leaseId !== binding.leaseId || unknown.recipeId !== binding.recipeId || unknown.recipeCatalogDigest !== binding.recipeCatalogDigest) throw new SandboxValidationError("Windows Sandbox result manifest is stale or is not bound to this exact request and recipe catalog.");
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
    const next = this.updateReceipt(receipt, { state, summary: untrustedSummary(summary) });
    await this.writeReceipt(receiptPath, next);
    return {
      status: state,
      summary: next.summary,
      leaseId: next.leaseId,
      processId: next.processId,
      receiptPath,
      ...(next.resultRoot ? { resultRoot: next.resultRoot } : {})
    };
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
      poll = setInterval(() => { void request.executionControl!.isCancellationRequested().then((cancelled) => { if (cancelled) controller.abort(); }); }, 100);
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
          enforced: result.status === "completed",
          ...(result.leaseId ? { leaseId: result.leaseId } : {}),
          ...(result.processId ? { processId: result.processId } : {}),
          ...(result.receiptPath ? { receiptPath: result.receiptPath } : {}),
          ...(result.resultRoot ? { resultRoot: result.resultRoot } : {})
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
    "  <MappedFolders>",
    mappedFolder(input.targetRoot, "C:\\B122\\input", true),
    mappedFolder(input.helperDirectory, "C:\\B122\\tools", true),
    mappedFolder(input.exchangeRoot, "C:\\B122\\exchange", false),
    "  </MappedFolders>",
    `  <LogonCommand><Command>${command}</Command></LogonCommand>`,
    "</Configuration>",
    ""
  ].join("\n");
}

function mappedFolder(hostFolder: string, sandboxFolder: string, readOnly: boolean): string {
  return `    <MappedFolder><HostFolder>${xml(hostFolder)}</HostFolder><SandboxFolder>${xml(sandboxFolder)}</SandboxFolder><ReadOnly>${readOnly ? "true" : "false"}</ReadOnly></MappedFolder>`;
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
