/**
 * Crash-recoverable, repository-scoped Python virtual-environment lifecycle.
 *
 * This component never uses `venv --clear`. It builds a replacement in an
 * owned sibling, validates the interpreter and optional offline dependency
 * lock, then uses rename-only swaps while preserving the last-known-good
 * environment until the replacement is proven at its final path.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const stateFileName = ".sxsy-b122-venv-state.json";
const lifecycleLockName = ".sxsy-b122-venv-lifecycle.lock";
const ownedDirectoryPattern = /^\.b122-venv-(staging|recovery)-([a-f0-9]{64})$/;
const digestPattern = /^[a-f0-9]{64}$/i;
const maximumRequirementsBytes = 2 * 1024 * 1024;
const maximumProcessOutputBytes = 256 * 1024;
const processTimeoutMs = 10 * 60_000;

export type PythonVenvMode = "ensure" | "rebuild";
export type PythonVenvStatus = "completed" | "blocked" | "failed";

export interface PythonDependencyLock {
  /** Repository-relative, concrete requirements lock. */
  readonly requirementsPath: string;
  readonly requirementsSha256: string;
  /** Repository-relative, concrete offline wheel/archive directory. */
  readonly wheelhousePath: string;
}

export interface AtomicPythonVenvRequest {
  readonly mode: PythonVenvMode;
  readonly operationId: string;
  readonly repositoryRoot: string;
  readonly basePython: string;
  readonly basePythonSha256: string;
  readonly dependencies?: PythonDependencyLock;
  /** The mediated control plane supplies this only after exact confirmation. */
  readonly confirmed?: boolean;
}

export interface AtomicPythonVenvResult {
  readonly status: PythonVenvStatus;
  readonly summary: string;
  readonly pythonInterpreter?: string;
  readonly reconciliation: readonly string[];
  readonly stagingPaths: readonly string[];
  readonly recoveryPaths: readonly string[];
  readonly recoverySteps: readonly string[];
}

export interface ExactPythonProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface ExactPythonProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
  readonly outputTruncated?: boolean;
}

export interface ExactPythonProcessRunner {
  run(request: ExactPythonProcessRequest): Promise<ExactPythonProcessResult>;
}

export interface PythonVenvTerminalCoordinator {
  detach(input: Readonly<{
    repositoryRoot: string;
    pythonInterpreter: string;
    operationId: string;
  }>): Promise<Readonly<{ detached: boolean; detail: string }>>;
}

export interface PythonVenvInspection {
  readonly activePath: string;
  readonly stagingPaths: readonly string[];
  readonly recoveryPaths: readonly string[];
}

export interface AtomicPythonVenvLifecycleDependencies {
  readonly processRunner?: ExactPythonProcessRunner;
  readonly terminalCoordinator?: PythonVenvTerminalCoordinator;
  readonly renamePath?: (source: string, destination: string) => Promise<void>;
  readonly removePath?: (path: string) => Promise<void>;
  readonly now?: () => Date;
  readonly isProcessAlive?: (pid: number) => boolean;
}

interface PreparedDependencyLock {
  readonly requirementsPath: string;
  readonly requirementsSha256: string;
  readonly wheelhousePath: string;
  readonly archives: readonly FileIdentity[];
}

interface OperationContext {
  readonly request: AtomicPythonVenvRequest;
  readonly repositoryRoot: string;
  readonly activePath: string;
  readonly stagingPath: string;
  readonly recoveryPath: string;
  readonly operationKey: string;
  readonly basePython: FileIdentity;
  readonly dependencies?: PreparedDependencyLock;
}

interface FileIdentity {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly modifiedMs: number;
}

type EnvironmentState = "staging" | "recovery" | "active";

interface EnvironmentReceipt {
  readonly schema: "sxsy-b122.python-venv-state";
  readonly version: 1;
  readonly state: EnvironmentState;
  readonly repositoryRoot: string;
  readonly operationKey: string;
  readonly basePythonSha256: string;
  readonly requirementsSha256: string | null;
  readonly interpreterSha256: string;
  readonly freezeSha256: string;
  readonly createdAt: string;
}

interface EnvironmentObservation {
  readonly interpreter: FileIdentity;
  readonly freezeSha256: string;
  readonly receipt?: EnvironmentReceipt;
}

class SafetyError extends Error {
  readonly recoverySteps: readonly string[];
  constructor(message: string, recoverySteps: readonly string[] = []) {
    super(message);
    this.recoverySteps = recoverySteps;
  }
}

class ProcessStepError extends Error {}

const failClosedTerminalCoordinator: PythonVenvTerminalCoordinator = {
  async detach() {
    return {
      detached: false,
      detail: "No authenticated VS Code terminal coordinator is attached; the current environment remains active."
    };
  }
};

export class AtomicPythonVenvLifecycle {
  private readonly runner: ExactPythonProcessRunner;
  private readonly terminals: PythonVenvTerminalCoordinator;
  private readonly renamePath: (source: string, destination: string) => Promise<void>;
  private readonly removePath: (path: string) => Promise<void>;
  private readonly now: () => Date;
  private readonly isProcessAlive: (pid: number) => boolean;

  constructor(dependencies: AtomicPythonVenvLifecycleDependencies = {}) {
    this.runner = dependencies.processRunner ?? new SpawnExactPythonProcessRunner();
    this.terminals = dependencies.terminalCoordinator ?? failClosedTerminalCoordinator;
    this.renamePath = dependencies.renamePath ?? rename;
    this.removePath = dependencies.removePath ?? (async (path) => rm(path, { recursive: true }));
    this.now = dependencies.now ?? (() => new Date());
    this.isProcessAlive = dependencies.isProcessAlive ?? processAlive;
  }

  async inspect(repositoryRootInput: string): Promise<PythonVenvInspection> {
    const repositoryRoot = await canonicalRepositoryRoot(repositoryRootInput);
    const paths = await this.ownedPaths(repositoryRoot);
    return {
      activePath: join(repositoryRoot, ".venv"),
      stagingPaths: paths.filter((item) => item.kind === "staging").map((item) => item.path),
      recoveryPaths: paths.filter((item) => item.kind === "recovery").map((item) => item.path)
    };
  }

  async execute(request: AtomicPythonVenvRequest): Promise<AtomicPythonVenvResult> {
    let context: OperationContext;
    try {
      context = await this.prepare(request);
      if (request.mode === "rebuild" && request.confirmed !== true) {
        throw new SafetyError("Fresh .venv rebuild requires exact mediated confirmation before any replacement is prepared.");
      }
    } catch (error) {
      return this.errorResult(error, [], request.repositoryRoot);
    }

    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await this.acquireLock(context);
      const reconciliation = await this.reconcile(context);
      if (request.mode === "ensure") return await this.ensure(context, reconciliation);
      return await this.rebuild(context, reconciliation);
    } catch (error) {
      return this.errorResult(error, [], context.repositoryRoot);
    } finally {
      await releaseLock?.().catch(() => undefined);
    }
  }

  private async prepare(request: AtomicPythonVenvRequest): Promise<OperationContext> {
    if (request.mode !== "ensure" && request.mode !== "rebuild") throw new SafetyError("Python environment mode is invalid.");
    if (typeof request.operationId !== "string" || !request.operationId.trim() || request.operationId.length > 256 || /[\0\r\n]/.test(request.operationId)) {
      throw new SafetyError("Python environment operation identity is invalid.");
    }
    if (!digestPattern.test(request.basePythonSha256)) throw new SafetyError("Base Python requires an exact SHA-256 identity.");
    const repositoryRoot = await canonicalRepositoryRoot(request.repositoryRoot);
    const basePython = await concreteFile(request.basePython, "base Python executable", 256 * 1024 * 1024);
    if (basePython.sha256 !== request.basePythonSha256.toLowerCase()) throw new SafetyError("Base Python digest does not match the reviewed pinned executable.");
    const operationKey = sha256(request.operationId);
    const dependencies = request.dependencies
      ? await prepareDependencyLock(repositoryRoot, request.dependencies)
      : undefined;
    return {
      request,
      repositoryRoot,
      activePath: join(repositoryRoot, ".venv"),
      stagingPath: join(repositoryRoot, `.b122-venv-staging-${operationKey}`),
      recoveryPath: join(repositoryRoot, `.b122-venv-recovery-${operationKey}`),
      operationKey,
      basePython,
      ...(dependencies ? { dependencies } : {})
    };
  }

  private async acquireLock(context: OperationContext): Promise<() => Promise<void>> {
    const path = join(context.repositoryRoot, lifecycleLockName);
    const token = randomUUID();
    const record = {
      schema: "sxsy-b122.python-venv-lock",
      version: 1,
      repositoryRoot: context.repositoryRoot,
      operationKey: context.operationKey,
      pid: process.pid,
      token,
      acquiredAt: this.now().toISOString()
    } as const;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(path, "wx", 0o600);
        try { await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"); }
        finally { await handle.close(); }
        return async () => {
          const current = await readBoundedJson(path, 16 * 1024).catch(() => undefined);
          if (isLockRecord(current) && current.token === token && current.pid === process.pid) await rm(path, { force: true });
        };
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        const current = await readBoundedJson(path, 16 * 1024).catch(() => undefined);
        if (!isLockRecord(current) || !samePath(current.repositoryRoot, context.repositoryRoot)) {
          throw new SafetyError(`Python environment lifecycle lock is malformed at ${path}; no environment was changed.`, [`Inspect and remove ${path} only after proving no B122 environment operation is active.`]);
        }
        if (this.isProcessAlive(current.pid)) {
          throw new SafetyError(`Python environment operation ${current.operationKey} is still active in process ${current.pid}; no duplicate rebuild was started.`);
        }
        await rm(path, { force: true });
      }
    }
    throw new SafetyError("Python environment lifecycle lock could not be acquired safely.");
  }

  private async reconcile(context: OperationContext): Promise<string[]> {
    const notes: string[] = [];
    const owned = await this.ownedPaths(context.repositoryRoot);
    const recoveries = owned.filter((item) => item.kind === "recovery");
    const stagings = owned.filter((item) => item.kind === "staging");
    const activeExists = await pathExists(context.activePath);

    if (activeExists) {
      await this.validateEnvironment(context.activePath, context, "ignore");
      for (const item of [...recoveries, ...stagings]) {
        await this.removeOwnedDirectory(item.path, item.kind, item.operationKey, context.repositoryRoot);
        notes.push(`Removed stale owned ${item.kind} environment ${item.path}.`);
      }
      return notes;
    }

    if (recoveries.length > 1) {
      throw new SafetyError(
        "Multiple owned recovery environments exist while .venv is absent; automatic selection would risk discarding the last-known-good copy.",
        recoveries.map((item) => `Preserve and inspect ${item.path}; restore exactly one verified recovery to ${context.activePath}.`)
      );
    }

    if (recoveries.length === 1) {
      const recovery = recoveries[0]!;
      const observation = await this.validateEnvironment(recovery.path, context, "ignore");
      try {
        await this.renamePath(recovery.path, context.activePath);
        await this.writeReceipt(context.activePath, receiptFromObservation("active", recovery.operationKey, context.repositoryRoot, observation, this.now()));
        await this.validateEnvironment(context.activePath, context, "ignore");
      } catch (error) {
        if (await pathExists(context.activePath) && !await pathExists(recovery.path)) {
          await this.renamePath(context.activePath, recovery.path).catch(() => undefined);
        }
        throw new SafetyError(
          `Interrupted .venv swap recovery could not be restored: ${errorMessage(error)}.`,
          [`Preserve ${recovery.path}.`, `After closing processes using it, rename ${recovery.path} to ${context.activePath}.`]
        );
      }
      notes.push(`Restored last-known-good environment ${recovery.path} to ${context.activePath}.`);
      for (const staging of stagings) {
        await this.removeOwnedDirectory(staging.path, staging.kind, staging.operationKey, context.repositoryRoot);
        notes.push(`Removed stale owned staging environment ${staging.path}.`);
      }
      return notes;
    }

    if (stagings.length === 1) {
      const staging = stagings[0]!;
      try {
        const observation = await this.validateEnvironment(staging.path, context, "current");
        await this.renamePath(staging.path, context.activePath);
        await this.writeReceipt(context.activePath, receiptFromObservation("active", staging.operationKey, context.repositoryRoot, observation, this.now()));
        await this.validateEnvironment(context.activePath, context, "current");
        notes.push(`Promoted the sole fully validated interrupted staging environment ${staging.path}.`);
        return notes;
      } catch {
        if (await pathExists(context.activePath) && !await pathExists(staging.path)) {
          const activeObservation = await this.validateEnvironment(context.activePath, context, "ignore").catch(() => undefined);
          if (activeObservation) {
            await this.writeReceipt(context.activePath, receiptFromObservation("staging", staging.operationKey, context.repositoryRoot, activeObservation, this.now(), context)).catch(() => undefined);
            await this.renamePath(context.activePath, staging.path).catch(() => undefined);
          }
        }
        await this.removeOwnedDirectory(staging.path, staging.kind, staging.operationKey, context.repositoryRoot);
        notes.push(`Removed an incomplete owned staging environment ${staging.path}.`);
        return notes;
      }
    }

    for (const staging of stagings) {
      await this.removeOwnedDirectory(staging.path, staging.kind, staging.operationKey, context.repositoryRoot);
      notes.push(`Removed stale owned staging environment ${staging.path}.`);
    }
    return notes;
  }

  private async ensure(context: OperationContext, reconciliation: readonly string[]): Promise<AtomicPythonVenvResult> {
    if (await pathExists(context.activePath)) {
      const observation = await this.validateEnvironment(context.activePath, context, context.dependencies ? "current" : "ignore");
      return this.successResult("Verified the existing canonical repository-local .venv without rebuilding it.", observation.interpreter.path, reconciliation, context.repositoryRoot);
    }
    let built: EnvironmentObservation;
    try {
      built = await this.buildStaging(context);
    } catch (error) {
      await this.removeOwnedDirectory(context.stagingPath, "staging", context.operationKey, context.repositoryRoot).catch(() => undefined);
      throw error;
    }
    try {
      await this.renamePath(context.stagingPath, context.activePath);
      await this.writeReceipt(context.activePath, receiptFromObservation("active", context.operationKey, context.repositoryRoot, built, this.now(), context));
      const active = await this.validateEnvironment(context.activePath, context, "current");
      return this.successResult("Created and validated the canonical repository-local .venv by atomic sibling promotion.", active.interpreter.path, reconciliation, context.repositoryRoot);
    } catch (error) {
      if (await pathExists(context.activePath) && !await pathExists(context.stagingPath)) {
        await this.writeReceipt(context.activePath, receiptFromObservation("staging", context.operationKey, context.repositoryRoot, built, this.now(), context)).catch(() => undefined);
        await this.renamePath(context.activePath, context.stagingPath).catch(() => undefined);
      }
      throw new SafetyError(
        `The validated staging environment could not be promoted atomically: ${errorMessage(error)}.`,
        [`Preserve ${context.stagingPath}.`, `After closing processes holding ${context.activePath}, rename ${context.stagingPath} to ${context.activePath}.`]
      );
    }
  }

  private async rebuild(context: OperationContext, reconciliation: readonly string[]): Promise<AtomicPythonVenvResult> {
    const current = await pathExists(context.activePath)
      ? await this.validateEnvironment(context.activePath, context, "ignore")
      : undefined;
    let replacement: EnvironmentObservation;
    try {
      replacement = await this.buildStaging(context);
    } catch (error) {
      await this.removeOwnedDirectory(context.stagingPath, "staging", context.operationKey, context.repositoryRoot).catch(() => undefined);
      throw error;
    }

    if (!current) {
      return this.ensurePreparedReplacement(context, replacement, reconciliation);
    }

    const detached = await this.terminals.detach({
      repositoryRoot: context.repositoryRoot,
      pythonInterpreter: current.interpreter.path,
      operationId: context.request.operationId
    });
    if (!detached.detached) {
      throw new SafetyError(
        `Fresh .venv replacement is staged but active terminals were not detached: ${boundedDetail(detached.detail)}.`,
        [
          `Keep the current environment at ${context.activePath}.`,
          `Keep the validated replacement at ${context.stagingPath}.`,
          "Close or detach every terminal and process using the current interpreter, then retry Shift rebuild."
        ]
      );
    }

    await this.writeReceipt(context.activePath, receiptFromObservation("recovery", context.operationKey, context.repositoryRoot, current, this.now()));
    try {
      await this.renamePath(context.activePath, context.recoveryPath);
    } catch (error) {
      await this.writeReceipt(context.activePath, receiptFromObservation("active", context.operationKey, context.repositoryRoot, current, this.now())).catch(() => undefined);
      throw new SafetyError(
        `The current .venv is locked or could not move to recovery: ${errorMessage(error)}. Both active and staged copies were preserved.`,
        [
          `Keep ${context.activePath} as the active last-known-good environment.`,
          `Keep ${context.stagingPath} as the validated replacement.`,
          "Close or detach every terminal and process using the current interpreter, then retry Shift rebuild."
        ]
      );
    }

    try {
      await this.renamePath(context.stagingPath, context.activePath);
    } catch (error) {
      const rolledBack = await this.rollbackRecovery(context, current);
      throw new SafetyError(
        rolledBack
          ? `The replacement rename failed and the last-known-good environment was rolled back: ${errorMessage(error)}.`
          : `The replacement rename failed and automatic rollback was also blocked: ${errorMessage(error)}.`,
        rolledBack
          ? [`The old environment is active at ${context.activePath}.`, `The validated replacement remains at ${context.stagingPath}; close locks and retry.`]
          : [`Preserve ${context.recoveryPath} and ${context.stagingPath}.`, `After closing locks, rename ${context.recoveryPath} to ${context.activePath}.`]
      );
    }

    try {
      await this.writeReceipt(context.activePath, receiptFromObservation("active", context.operationKey, context.repositoryRoot, replacement, this.now(), context));
      const final = await this.validateEnvironment(context.activePath, context, "current");
      try {
        await this.removeOwnedDirectory(context.recoveryPath, "recovery", context.operationKey, context.repositoryRoot);
      } catch (error) {
        return this.successResult(
          `The replacement .venv is active and validated; the old recovery copy remains because cleanup was locked: ${errorMessage(error)}.`,
          final.interpreter.path,
          reconciliation,
          context.repositoryRoot,
          [`After confirming ${context.activePath} remains healthy, retry reconciliation to remove ${context.recoveryPath}.`]
        );
      }
      return this.successResult("Rebuilt and atomically swapped the canonical repository-local .venv; the old copy was removed only after final validation.", final.interpreter.path, reconciliation, context.repositoryRoot);
    } catch (error) {
      const restored = await this.rollbackInvalidReplacement(context, current, replacement);
      throw new SafetyError(
        restored
          ? `Replacement validation failed at its final path and the last-known-good environment was restored: ${errorMessage(error)}.`
          : `Replacement validation failed and automatic last-known-good restoration was blocked: ${errorMessage(error)}.`,
        restored
          ? [`The old environment is active at ${context.activePath}.`, `The failed replacement is preserved at ${context.stagingPath}.`]
          : [`Preserve ${context.recoveryPath}, ${context.activePath}, and ${context.stagingPath} if present.`, "Close locks and restore the recovery directory to .venv before retrying."]
      );
    }
  }

  private async ensurePreparedReplacement(context: OperationContext, replacement: EnvironmentObservation, reconciliation: readonly string[]): Promise<AtomicPythonVenvResult> {
    try {
      await this.renamePath(context.stagingPath, context.activePath);
      await this.writeReceipt(context.activePath, receiptFromObservation("active", context.operationKey, context.repositoryRoot, replacement, this.now(), context));
      const final = await this.validateEnvironment(context.activePath, context, "current");
      return this.successResult("No prior .venv existed; Shift rebuild safely promoted the validated sibling environment.", final.interpreter.path, reconciliation, context.repositoryRoot);
    } catch (error) {
      if (await pathExists(context.activePath) && !await pathExists(context.stagingPath)) {
        await this.writeReceipt(context.activePath, receiptFromObservation("staging", context.operationKey, context.repositoryRoot, replacement, this.now(), context)).catch(() => undefined);
        await this.renamePath(context.activePath, context.stagingPath).catch(() => undefined);
      }
      throw new SafetyError(`The replacement could not be promoted: ${errorMessage(error)}.`, [`Preserve ${context.stagingPath}; no previous environment was removed.`]);
    }
  }

  private async buildStaging(context: OperationContext): Promise<EnvironmentObservation> {
    if (await pathExists(context.stagingPath) || await pathExists(context.recoveryPath)) {
      throw new SafetyError("Operation-owned staging or recovery path already exists after reconciliation; no overwrite was attempted.");
    }
    await mkdir(context.stagingPath, { recursive: false });
    await this.writeReceipt(context.stagingPath, emptyReceipt("staging", context, this.now()));
    await this.assertBasePythonUnchanged(context.basePython);
    await this.runChecked("create sibling virtual environment", {
      executable: context.basePython.path,
      args: ["-I", "-m", "venv", context.stagingPath],
      timeoutMs: processTimeoutMs,
      maxOutputBytes: maximumProcessOutputBytes
    });
    if (context.dependencies) {
      const privateLock = await this.snapshotDependencyLock(context);
      const interpreter = await concreteFile(join(context.stagingPath, "Scripts", "python.exe"), "staging Python interpreter", 256 * 1024 * 1024);
      await this.runChecked("install pinned offline dependencies", {
        executable: interpreter.path,
        args: [
          "-I", "-m", "pip", "install", "--no-input", "--disable-pip-version-check",
          "--no-index", "--require-hashes", "--find-links", privateLock.wheelhousePath,
          "-r", privateLock.requirementsPath
        ],
        timeoutMs: processTimeoutMs,
        maxOutputBytes: maximumProcessOutputBytes
      });
      await this.removePath(privateLock.root);
    }
    const observation = await this.validateEnvironment(context.stagingPath, context, "ignore");
    await this.writeReceipt(context.stagingPath, receiptFromObservation("staging", context.operationKey, context.repositoryRoot, observation, this.now(), context));
    return { ...observation, receipt: await this.readReceipt(context.stagingPath) };
  }

  private async snapshotDependencyLock(context: OperationContext): Promise<{ root: string; requirementsPath: string; wheelhousePath: string }> {
    const dependencies = context.dependencies!;
    const currentRequirements = await concreteFile(dependencies.requirementsPath, "dependency requirements", maximumRequirementsBytes);
    if (currentRequirements.sha256 !== dependencies.requirementsSha256) throw new SafetyError("Dependency requirements changed before offline installation.");
    const currentWheelhouse = await concreteDirectory(dependencies.wheelhousePath, "offline wheelhouse");
    if (!samePath(currentWheelhouse, dependencies.wheelhousePath)) throw new SafetyError("Offline wheelhouse changed before installation.");
    const root = join(context.stagingPath, ".sxsy-b122-offline-input");
    const wheelhousePath = join(root, "wheelhouse");
    const requirementsPath = join(root, "requirements.lock");
    await mkdir(wheelhousePath, { recursive: true });
    await writeFile(requirementsPath, await readFile(currentRequirements.path), { flag: "wx", mode: 0o600 });
    if ((await concreteFile(requirementsPath, "private dependency requirements", maximumRequirementsBytes)).sha256 !== dependencies.requirementsSha256) {
      throw new SafetyError("Private dependency requirements snapshot failed digest validation.");
    }
    for (const expected of dependencies.archives) {
      const current = await concreteFile(expected.path, "offline package archive", 1024 * 1024 * 1024);
      if (current.sha256 !== expected.sha256 || current.size !== expected.size || current.modifiedMs !== expected.modifiedMs) {
        throw new SafetyError("Offline package archive changed before private snapshot creation.");
      }
      const destination = join(wheelhousePath, expected.path.slice(expected.path.lastIndexOf(sep) + 1));
      await copyFile(current.path, destination, 1);
      const copied = await concreteFile(destination, "private offline package archive", 1024 * 1024 * 1024);
      if (copied.sha256 !== expected.sha256 || copied.size !== expected.size) throw new SafetyError("Private offline package archive snapshot failed digest validation.");
    }
    return { root, requirementsPath, wheelhousePath };
  }

  private async validateEnvironment(path: string, context: OperationContext, receiptPolicy: "ignore" | "current"): Promise<EnvironmentObservation> {
    const canonicalPath = await concreteDirectory(path, "Python virtual environment");
    if (!inside(canonicalPath, context.repositoryRoot) || samePath(canonicalPath, context.repositoryRoot)) throw new SafetyError("Python virtual environment escaped the canonical repository boundary.");
    await concreteFile(join(canonicalPath, "pyvenv.cfg"), "Python virtual environment configuration", 1024 * 1024);
    const interpreter = await concreteFile(join(canonicalPath, "Scripts", "python.exe"), "Python virtual environment interpreter", 256 * 1024 * 1024);
    const identity = await this.runChecked("verify virtual environment identity", {
      executable: interpreter.path,
      args: [
        "-I", "-c",
        "import json,os,sys;print(json.dumps({'executable':os.path.realpath(sys.executable),'prefix':os.path.realpath(sys.prefix),'basePrefix':os.path.realpath(sys.base_prefix)}))"
      ],
      timeoutMs: 60_000,
      maxOutputBytes: 16 * 1024
    });
    const parsed = parseIdentity(identity.stdout);
    if (!samePath(parsed.executable, interpreter.path) || !samePath(parsed.prefix, canonicalPath) || samePath(parsed.basePrefix, parsed.prefix)) {
      throw new SafetyError("Python interpreter does not identify as the exact repository-local virtual environment.");
    }
    await this.runChecked("verify installed dependency consistency", {
      executable: interpreter.path,
      args: ["-I", "-m", "pip", "check", "--disable-pip-version-check"],
      timeoutMs: 120_000,
      maxOutputBytes: maximumProcessOutputBytes
    });
    const freeze = await this.runChecked("capture installed dependency identity", {
      executable: interpreter.path,
      args: ["-I", "-m", "pip", "freeze", "--all", "--disable-pip-version-check"],
      timeoutMs: 120_000,
      maxOutputBytes: maximumProcessOutputBytes
    });
    const freezeSha256 = sha256(normalizeFreeze(freeze.stdout));
    const receipt = await this.readReceipt(canonicalPath);
    if (receiptPolicy === "current") {
      if (!receipt) throw new SafetyError("Configured pinned dependencies require a B122 environment identity receipt; use confirmed Shift rebuild.");
      const expectedState: EnvironmentState = samePath(canonicalPath, context.activePath)
        ? "active"
        : samePath(canonicalPath, context.stagingPath) ? "staging" : "recovery";
      if (!samePath(receipt.repositoryRoot, context.repositoryRoot)
        || receipt.state !== expectedState
        || receipt.basePythonSha256 !== context.basePython.sha256
        || receipt.requirementsSha256 !== (context.dependencies?.requirementsSha256 ?? null)
        || receipt.interpreterSha256 !== interpreter.sha256
        || receipt.freezeSha256 !== freezeSha256) {
        throw new SafetyError("The existing .venv no longer matches its pinned base Python, dependency lock, or installed-package identity; use confirmed Shift rebuild.");
      }
    }
    return { interpreter, freezeSha256, ...(receipt ? { receipt } : {}) };
  }

  private async rollbackRecovery(context: OperationContext, current: EnvironmentObservation): Promise<boolean> {
    try {
      await this.renamePath(context.recoveryPath, context.activePath);
      await this.writeReceipt(context.activePath, receiptFromObservation("active", context.operationKey, context.repositoryRoot, current, this.now()));
      await this.validateEnvironment(context.activePath, context, "ignore");
      return true;
    } catch { return false; }
  }

  private async rollbackInvalidReplacement(context: OperationContext, current: EnvironmentObservation, replacement: EnvironmentObservation): Promise<boolean> {
    try {
      if (await pathExists(context.activePath)) {
        await this.writeReceipt(context.activePath, receiptFromObservation("staging", context.operationKey, context.repositoryRoot, replacement, this.now(), context));
        await this.renamePath(context.activePath, context.stagingPath);
      }
      await this.renamePath(context.recoveryPath, context.activePath);
      await this.writeReceipt(context.activePath, receiptFromObservation("active", context.operationKey, context.repositoryRoot, current, this.now()));
      await this.validateEnvironment(context.activePath, context, "ignore");
      return true;
    } catch { return false; }
  }

  private async removeOwnedDirectory(path: string, kind: "staging" | "recovery", operationKey: string, repositoryRoot: string): Promise<void> {
    if (!await pathExists(path)) return;
    const canonical = await concreteDirectory(path, `owned ${kind} environment`);
    if (!inside(canonical, repositoryRoot) || samePath(canonical, repositoryRoot)) throw new SafetyError(`Refusing cleanup outside the canonical repository: ${path}.`);
    const receipt = await this.readReceipt(canonical);
    if (!receipt || receipt.state !== kind || receipt.operationKey !== operationKey || !samePath(receipt.repositoryRoot, repositoryRoot)) {
      throw new SafetyError(`Refusing to remove unverified ${kind} path ${path}.`, [`Inspect ${path}; B122 ownership metadata does not match.`]);
    }
    try { await this.removePath(canonical); }
    catch (error) { throw new SafetyError(`Owned ${kind} environment is locked at ${canonical}: ${errorMessage(error)}.`); }
  }

  private async ownedPaths(repositoryRoot: string): Promise<readonly { kind: "staging" | "recovery"; operationKey: string; path: string }[]> {
    const items = await readdir(repositoryRoot, { withFileTypes: true });
    const result: { kind: "staging" | "recovery"; operationKey: string; path: string }[] = [];
    for (const item of items) {
      const match = ownedDirectoryPattern.exec(item.name);
      if (!match) continue;
      if (!item.isDirectory() || item.isSymbolicLink()) throw new SafetyError(`Owned environment name ${item.name} is not a concrete directory; no cleanup was attempted.`);
      const path = join(repositoryRoot, item.name);
      const canonical = await realpath(path);
      if (!samePath(path, canonical) || !inside(canonical, repositoryRoot)) throw new SafetyError(`Owned environment path ${path} traverses an alias or reparse point.`);
      const kind = match[1] as "staging" | "recovery";
      const operationKey = match[2]!;
      const receipt = await this.readReceipt(path);
      if (!receipt || receipt.state !== kind || receipt.operationKey !== operationKey || !samePath(receipt.repositoryRoot, repositoryRoot)) {
        throw new SafetyError(`Owned-looking environment path ${path} lacks matching B122 ownership metadata; it was preserved.`);
      }
      result.push({ kind, operationKey, path });
    }
    return result.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async readReceipt(directory: string): Promise<EnvironmentReceipt | undefined> {
    const path = join(directory, stateFileName);
    if (!await pathExists(path)) return undefined;
    const value = await readBoundedJson(path, 64 * 1024);
    if (!isEnvironmentReceipt(value)) throw new SafetyError(`Python environment state receipt is malformed at ${path}.`);
    return value;
  }

  private async writeReceipt(directory: string, receipt: EnvironmentReceipt): Promise<void> {
    const canonicalDirectory = await concreteDirectory(directory, "Python environment receipt directory");
    const path = join(canonicalDirectory, stateFileName);
    if (await pathExists(path)) {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new SafetyError(`Python environment state path is not a concrete file at ${path}.`);
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try { await this.renamePath(temporary, path); }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }

  private async assertBasePythonUnchanged(expected: FileIdentity): Promise<void> {
    const current = await concreteFile(expected.path, "base Python executable", 256 * 1024 * 1024);
    if (current.sha256 !== expected.sha256 || current.size !== expected.size || current.modifiedMs !== expected.modifiedMs) {
      throw new SafetyError("Base Python executable changed after request validation.");
    }
  }

  private async runChecked(label: string, request: ExactPythonProcessRequest): Promise<ExactPythonProcessResult> {
    const result = await this.runner.run(request);
    if (result.timedOut) throw new ProcessStepError(`Python environment step '${label}' timed out.`);
    if (result.exitCode !== 0) throw new ProcessStepError(`Python environment step '${label}' failed with exit code ${result.exitCode}.`);
    return result;
  }

  private async successResult(summary: string, pythonInterpreter: string, reconciliation: readonly string[], repositoryRoot: string, recoverySteps: readonly string[] = []): Promise<AtomicPythonVenvResult> {
    return this.result("completed", summary, reconciliation, repositoryRoot, recoverySteps, pythonInterpreter);
  }

  private async errorResult(error: unknown, reconciliation: readonly string[], repositoryRoot: string): Promise<AtomicPythonVenvResult> {
    const status: PythonVenvStatus = error instanceof SafetyError ? "blocked" : "failed";
    const recoverySteps = error instanceof SafetyError ? error.recoverySteps : [];
    return this.result(status, boundedDetail(errorMessage(error)), reconciliation, repositoryRoot, recoverySteps);
  }

  private async result(status: PythonVenvStatus, summary: string, reconciliation: readonly string[], repositoryRootInput: string, recoverySteps: readonly string[], pythonInterpreter?: string): Promise<AtomicPythonVenvResult> {
    const repositoryRoot = isAbsolute(repositoryRootInput) ? resolve(repositoryRootInput) : repositoryRootInput;
    const activePath = isAbsolute(repositoryRoot) ? join(repositoryRoot, ".venv") : ".venv";
    const inspection = await inspectMatchingPaths(repositoryRoot).catch(() => ({ stagingPaths: [] as string[], recoveryPaths: [] as string[] }));
    return {
      status,
      summary,
      ...(pythonInterpreter ? { pythonInterpreter } : {}),
      reconciliation,
      stagingPaths: inspection.stagingPaths,
      recoveryPaths: inspection.recoveryPaths,
      recoverySteps: recoverySteps.length ? recoverySteps : status === "completed" ? [] : [`No unverified path was removed. Inspect ${activePath} and B122-owned sibling paths before retrying.`]
    };
  }
}

/** Shell-free exact-environment runner; the outer Job Object owns tree kill. */
export class SpawnExactPythonProcessRunner implements ExactPythonProcessRunner {
  async run(request: ExactPythonProcessRequest): Promise<ExactPythonProcessResult> {
    if (!isAbsolute(request.executable) || request.args.length > 128 || request.args.some((item) => typeof item !== "string" || item.length > 8_192 || /[\0\r\n]/.test(item))) {
      throw new SafetyError("Exact Python process request is invalid.");
    }
    const environment: Record<string, string> = {
      PYTHONNOUSERSITE: "1",
      PYTHONUTF8: "1",
      PIP_NO_INPUT: "1",
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      PIP_CONFIG_FILE: process.platform === "win32" ? "NUL" : "/dev/null"
    };
    for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP"] as const) {
      const value = process.env[name];
      if (value) environment[name] = value;
    }
    const child = spawn(request.executable, [...request.args], {
      cwd: undefined,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const output = new BoundedOutput(request.maxOutputBytes);
    child.stdout.on("data", (chunk: Buffer) => output.stdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => output.stderr(chunk));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, request.timeoutMs);
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolveExit(code ?? -1));
    }).finally(() => clearTimeout(timer));
    return { exitCode, stdout: output.stdoutText(), stderr: output.stderrText(), timedOut, outputTruncated: output.truncated };
  }
}

class BoundedOutput {
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  private remaining: number;
  truncated = false;
  constructor(limit: number) { this.remaining = Math.max(1, Math.min(limit, maximumProcessOutputBytes)); }
  stdout(chunk: Buffer): void { this.collect(chunk, this.stdoutChunks); }
  stderr(chunk: Buffer): void { this.collect(chunk, this.stderrChunks); }
  stdoutText(): string { return Buffer.concat(this.stdoutChunks).toString("utf8"); }
  stderrText(): string { return Buffer.concat(this.stderrChunks).toString("utf8"); }
  private collect(chunk: Buffer, destination: Buffer[]): void {
    const accepted = chunk.subarray(0, this.remaining);
    if (accepted.byteLength) destination.push(accepted);
    this.remaining -= accepted.byteLength;
    if (accepted.byteLength < chunk.byteLength) this.truncated = true;
  }
}

async function canonicalRepositoryRoot(input: string): Promise<string> {
  if (typeof input !== "string" || !input.trim() || input.length > 4_096 || /[\0\r\n]/.test(input) || !isAbsolute(input)) {
    throw new SafetyError("Repository root must be one bounded absolute path.");
  }
  const requested = resolve(input);
  const metadata = await lstat(requested).catch(() => undefined);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) throw new SafetyError("Repository root must be a concrete directory, not an alias or reparse point.");
  const canonical = await realpath(requested);
  if (!samePath(requested, canonical)) throw new SafetyError("Repository root is not canonical or traverses an alias/reparse point.");
  return canonical;
}

async function prepareDependencyLock(repositoryRoot: string, input: PythonDependencyLock): Promise<PreparedDependencyLock> {
  if (!digestPattern.test(input.requirementsSha256)) throw new SafetyError("Dependency requirements require an exact SHA-256 digest.");
  const requirementsPath = await concreteRepositoryFile(repositoryRoot, input.requirementsPath, "dependency requirements", maximumRequirementsBytes);
  const bytes = await readFile(requirementsPath);
  if (sha256(bytes) !== input.requirementsSha256.toLowerCase()) throw new SafetyError("Dependency requirements digest does not match the reviewed pinned lock.");
  validateHashCompleteRequirements(bytes.toString("utf8"));
  const wheelhousePath = await concreteRepositoryDirectory(repositoryRoot, input.wheelhousePath, "offline wheelhouse");
  const entries = await readdir(wheelhousePath, { withFileTypes: true });
  const archives = entries.filter((item) => item.isFile() && !item.isSymbolicLink() && /(?:\.whl|\.tar\.gz|\.zip)$/i.test(item.name));
  if (archives.length === 0) throw new SafetyError("Offline wheelhouse contains no concrete Python package archives.");
  if (archives.length > 512) throw new SafetyError("Offline wheelhouse exceeds the bounded archive count.");
  const identities: FileIdentity[] = [];
  let totalBytes = 0;
  for (const archive of archives) {
    const identity = await concreteFile(join(wheelhousePath, archive.name), "offline package archive", 1024 * 1024 * 1024);
    totalBytes += identity.size;
    if (totalBytes > 4 * 1024 * 1024 * 1024) throw new SafetyError("Offline wheelhouse exceeds the bounded package size.");
    identities.push(identity);
  }
  return { requirementsPath, requirementsSha256: input.requirementsSha256.toLowerCase(), wheelhousePath, archives: identities };
}

function validateHashCompleteRequirements(contents: string): void {
  if (contents.includes("\0")) throw new SafetyError("Dependency requirements contain invalid text.");
  const logical: string[] = [];
  let pending = "";
  for (const raw of contents.replaceAll("\r\n", "\n").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.includes(" #")) throw new SafetyError("Dependency requirements cannot use ambiguous inline comments.");
    const continuation = trimmed.endsWith("\\");
    pending += `${pending ? " " : ""}${continuation ? trimmed.slice(0, -1).trim() : trimmed}`;
    if (!continuation) { logical.push(pending); pending = ""; }
  }
  if (pending) throw new SafetyError("Dependency requirements end with an incomplete continuation.");
  if (logical.length === 0) throw new SafetyError("Configured dependency requirements are empty.");
  for (const requirement of logical) {
    if (/(?:^|\s)(?:-e|--editable|-r|--requirement|-c|--constraint|--index-url|--extra-index-url|--find-links|--trusted-host)(?:\s|=|$)/i.test(requirement)
      || /(?:https?:|git\+|file:|@|;)/i.test(requirement)) {
      throw new SafetyError("Dependency requirements may contain only exact package pins and SHA-256 hashes.");
    }
    const packagePin = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9,._-]+\])?==[A-Za-z0-9][A-Za-z0-9._+!-]*/;
    if (!packagePin.test(requirement) || !/--hash=sha256:[a-f0-9]{64}(?:\s|$)/i.test(requirement)) {
      throw new SafetyError("Every configured dependency must be exactly version-pinned and include a SHA-256 archive hash.");
    }
    const remainder = requirement.replace(packagePin, "").replace(/--hash=sha256:[a-f0-9]{64}/gi, "").trim();
    if (remainder) throw new SafetyError("Dependency requirements contain unsupported options or unpinned material.");
  }
}

async function concreteRepositoryFile(repositoryRoot: string, input: string, label: string, maximumBytes: number): Promise<string> {
  const path = safeRepositoryRelative(repositoryRoot, input, label);
  const file = await concreteFile(path, label, maximumBytes);
  if (!inside(file.path, repositoryRoot)) throw new SafetyError(`${label} escaped the canonical repository.`);
  return file.path;
}

async function concreteRepositoryDirectory(repositoryRoot: string, input: string, label: string): Promise<string> {
  const path = safeRepositoryRelative(repositoryRoot, input, label);
  const directory = await concreteDirectory(path, label);
  if (!inside(directory, repositoryRoot)) throw new SafetyError(`${label} escaped the canonical repository.`);
  return directory;
}

function safeRepositoryRelative(repositoryRoot: string, input: string, label: string): string {
  if (typeof input !== "string" || !input.trim() || input.length > 2_048 || /[\0\r\n]/.test(input) || isAbsolute(input)) {
    throw new SafetyError(`${label} must be one repository-relative path.`);
  }
  const path = resolve(repositoryRoot, input);
  if (!inside(path, repositoryRoot) || samePath(path, repositoryRoot)) throw new SafetyError(`${label} escaped the canonical repository.`);
  return path;
}

async function concreteDirectory(path: string, label: string): Promise<string> {
  const requested = resolve(path);
  const metadata = await lstat(requested).catch(() => undefined);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) throw new SafetyError(`${label} must be a concrete directory, not a link or reparse point.`);
  const canonical = await realpath(requested);
  if (!samePath(requested, canonical)) throw new SafetyError(`${label} traverses an alias or reparse point.`);
  return canonical;
}

async function concreteFile(path: string, label: string, maximumBytes: number): Promise<FileIdentity> {
  const requested = resolve(path);
  const metadata = await lstat(requested).catch(() => undefined);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new SafetyError(`${label} must be a bounded concrete file.`);
  }
  const canonical = await realpath(requested);
  if (!samePath(requested, canonical)) throw new SafetyError(`${label} traverses an alias or reparse point.`);
  return {
    path: canonical,
    sha256: sha256(await readFile(canonical)),
    size: metadata.size,
    modifiedMs: metadata.mtimeMs
  };
}

function emptyReceipt(state: "staging", context: OperationContext, now: Date): EnvironmentReceipt {
  return {
    schema: "sxsy-b122.python-venv-state",
    version: 1,
    state,
    repositoryRoot: context.repositoryRoot,
    operationKey: context.operationKey,
    basePythonSha256: context.basePython.sha256,
    requirementsSha256: context.dependencies?.requirementsSha256 ?? null,
    interpreterSha256: "0".repeat(64),
    freezeSha256: "0".repeat(64),
    createdAt: now.toISOString()
  };
}

function receiptFromObservation(
  state: EnvironmentState,
  operationKey: string,
  repositoryRoot: string,
  observation: EnvironmentObservation,
  now: Date,
  context?: OperationContext
): EnvironmentReceipt {
  return {
    schema: "sxsy-b122.python-venv-state",
    version: 1,
    state,
    repositoryRoot,
    operationKey,
    basePythonSha256: context?.basePython.sha256 ?? observation.receipt?.basePythonSha256 ?? "0".repeat(64),
    requirementsSha256: context ? context.dependencies?.requirementsSha256 ?? null : observation.receipt?.requirementsSha256 ?? null,
    interpreterSha256: observation.interpreter.sha256,
    freezeSha256: observation.freezeSha256,
    createdAt: now.toISOString()
  };
}

function isEnvironmentReceipt(value: unknown): value is EnvironmentReceipt {
  if (!record(value) || Object.keys(value).sort().join(",") !== [
    "basePythonSha256", "createdAt", "freezeSha256", "interpreterSha256", "operationKey",
    "repositoryRoot", "requirementsSha256", "schema", "state", "version"
  ].sort().join(",")) return false;
  return value.schema === "sxsy-b122.python-venv-state"
    && value.version === 1
    && (value.state === "staging" || value.state === "recovery" || value.state === "active")
    && typeof value.repositoryRoot === "string"
    && typeof value.operationKey === "string" && digestPattern.test(value.operationKey)
    && typeof value.basePythonSha256 === "string" && digestPattern.test(value.basePythonSha256)
    && (value.requirementsSha256 === null || typeof value.requirementsSha256 === "string" && digestPattern.test(value.requirementsSha256))
    && typeof value.interpreterSha256 === "string" && digestPattern.test(value.interpreterSha256)
    && typeof value.freezeSha256 === "string" && digestPattern.test(value.freezeSha256)
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}

function isLockRecord(value: unknown): value is { repositoryRoot: string; operationKey: string; pid: number; token: string } {
  return record(value)
    && value.schema === "sxsy-b122.python-venv-lock"
    && value.version === 1
    && typeof value.repositoryRoot === "string"
    && typeof value.operationKey === "string" && digestPattern.test(value.operationKey)
    && Number.isSafeInteger(value.pid) && (value.pid as number) > 0
    && typeof value.token === "string" && /^[a-f0-9-]{36}$/i.test(value.token);
}

function parseIdentity(stdout: string): { executable: string; prefix: string; basePrefix: string } {
  if (Buffer.byteLength(stdout, "utf8") > 16 * 1024) throw new SafetyError("Python identity output exceeded its bound.");
  let value: unknown;
  try { value = JSON.parse(stdout.trim()); }
  catch { throw new SafetyError("Python interpreter returned invalid identity evidence."); }
  if (!record(value) || Object.keys(value).sort().join(",") !== "basePrefix,executable,prefix"
    || typeof value.executable !== "string" || typeof value.prefix !== "string" || typeof value.basePrefix !== "string"
    || !isAbsolute(value.executable) || !isAbsolute(value.prefix) || !isAbsolute(value.basePrefix)) {
    throw new SafetyError("Python interpreter returned confused identity evidence.");
  }
  return { executable: value.executable, prefix: value.prefix, basePrefix: value.basePrefix };
}

async function readBoundedJson(path: string, maximumBytes: number): Promise<unknown> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximumBytes) throw new SafetyError(`Bounded JSON file is invalid at ${path}.`);
  const canonical = await realpath(path);
  if (!samePath(path, canonical)) throw new SafetyError(`Bounded JSON file traverses an alias at ${path}.`);
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function inspectMatchingPaths(repositoryRoot: string): Promise<{ stagingPaths: string[]; recoveryPaths: string[] }> {
  if (!isAbsolute(repositoryRoot)) return { stagingPaths: [], recoveryPaths: [] };
  const items = await readdir(repositoryRoot, { withFileTypes: true });
  const stagingPaths: string[] = [];
  const recoveryPaths: string[] = [];
  for (const item of items) {
    const match = ownedDirectoryPattern.exec(item.name);
    if (!match || !item.isDirectory() || item.isSymbolicLink()) continue;
    const path = join(repositoryRoot, item.name);
    if (match[1] === "staging") stagingPaths.push(path);
    else recoveryPaths.push(path);
  }
  return { stagingPaths: stagingPaths.sort(), recoveryPaths: recoveryPaths.sort() };
}

function normalizeFreeze(value: string): string {
  return `${value.replaceAll("\r\n", "\n").split("\n").map((line) => line.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right)).join("\n")}\n`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => resolve(value).replace(/[\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function inside(child: string, root: string): boolean {
  const result = relative(root, child);
  return result === "" || (result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result));
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(() => true).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  });
}

function hasCode(error: unknown, code: string): boolean {
  return record(error) && error.code === code;
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Python environment lifecycle failure";
}

function boundedDetail(value: string): string {
  const singleLine = value.replace(/[\0\r\n]+/g, " ").trim();
  return singleLine.length > 1_024 ? `${singleLine.slice(0, 1_021)}...` : singleLine;
}
