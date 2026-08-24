/**
 * Host-verified, repository-scoped runtime recipes for B122.
 *
 * A repository document is never executable policy by itself. The companion
 * loads an exact v1 JSON document only when a trusted host supplies its SHA-256
 * digest, validates every field, pins executable identities, and rechecks the
 * canonical execution root immediately before a shell-free spawn.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { redactText, untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";

export const repositoryRuntimeManifestSchema = "sxsy-b122.repository-runtime" as const;
export const repositoryRuntimeManifestVersion = 1 as const;

export const repositoryProcessActions = [
  "run_target",
  "debug_target",
  "launch_web_app",
  "venv",
  "rebuild_venv",
  "pipeline_local_gate",
  "pipeline_clean_reproduction",
  "shield_change_scan",
  "shield_codebase_audit",
  "shield_supply_chain",
  "release_shield"
] as const;

export type RepositoryProcessAction = typeof repositoryProcessActions[number];
export type RepositoryRuntimeAction = RepositoryProcessAction | "stop_managed_run";
export type RepositoryRuntimeIsolation = "repository" | "disposable";
export type RepositoryRuntimeLifecycle = "foreground" | "managed";

export interface RepositoryWebRecipe {
  readonly url: string;
  readonly healthUrl: string;
  readonly healthTimeoutMs: number;
  readonly healthIntervalMs: number;
}

export interface RepositoryProcessRecipe {
  readonly kind: "process";
  readonly executable: string;
  readonly args: readonly string[];
  /** Repository-relative, or relative to the attested disposable root. */
  readonly cwd: string;
  /** The complete child environment. The parent environment is never merged. */
  readonly environment: Readonly<Record<string, string>>;
  readonly lifecycle: RepositoryRuntimeLifecycle;
  readonly isolation: RepositoryRuntimeIsolation;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly web?: RepositoryWebRecipe;
}

export interface RepositoryStopRecipe {
  readonly kind: "stop";
  readonly managedActions: readonly ("run_target" | "debug_target" | "launch_web_app")[];
  readonly gracefulTimeoutMs: number;
  readonly forceTimeoutMs: number;
}

export type RepositoryRuntimeRecipe = RepositoryProcessRecipe | RepositoryStopRecipe;

export interface RepositoryRuntimeManifest {
  readonly schema: typeof repositoryRuntimeManifestSchema;
  readonly version: typeof repositoryRuntimeManifestVersion;
  readonly repositoryRoot: string;
  readonly allowedHttpsUrls: readonly string[];
  readonly recipes: Readonly<Partial<Record<RepositoryRuntimeAction, RepositoryRuntimeRecipe>>>;
}

interface ExecutableIdentity {
  readonly canonicalPath: string;
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedMs: number;
}

const verifiedBrand = Symbol("verified-repository-runtime-manifest");

export interface VerifiedRepositoryRuntimeManifest {
  readonly manifest: RepositoryRuntimeManifest;
  readonly digest: string;
  readonly canonicalRepositoryRoot: string;
  readonly [verifiedBrand]: true;
  readonly executableIdentities: ReadonlyMap<RepositoryProcessAction, ExecutableIdentity>;
}

export interface LoadRepositoryRuntimeManifestOptions {
  readonly filePath: string;
  readonly expectedSha256: string;
  readonly repositoryRoot: string;
}

export interface RuntimeEffectGuard {
  check(action: RepositoryRuntimeAction, repositoryRoot: string): Promise<{ readonly allowed: boolean; readonly reason: string }>;
}

export interface RepositoryExecutionRootLease {
  readonly root: string;
  readonly isolation: RepositoryRuntimeIsolation;
  /** Required for test/security recipes; an OS boundary owns these claims. */
  readonly protections?: Readonly<{
    productionData: "denied";
    ambientCredentials: "denied";
  }>;
  release(): Promise<void>;
}

export interface RepositoryExecutionRootProvider {
  prepare(input: Readonly<{
    action: RepositoryProcessAction;
    repositoryRoot: string;
    isolation: RepositoryRuntimeIsolation;
  }>): Promise<RepositoryExecutionRootLease>;
}

export interface RuntimeHealthProbe {
  probe(url: string, signal: AbortSignal): Promise<{ readonly healthy: boolean; readonly detail: string }>;
}

export type RepositoryRuntimeStatus = "completed" | "running" | "failed" | "blocked" | "unavailable" | "timed_out" | "cancelled";

export interface RepositoryRuntimeResult {
  readonly status: RepositoryRuntimeStatus;
  readonly summary: string;
  readonly managedProcessId?: string;
  readonly pid?: number;
  readonly exitCode?: number;
  readonly output?: string;
  readonly outputTruncated?: boolean;
  readonly url?: string;
}

export interface RepositoryRuntimeExecuteOptions {
  readonly managedProcessId?: string;
  readonly signal?: AbortSignal;
  /** Exact dispatch-bound final barrier; the constructor guard remains the fail-closed default. */
  readonly effectGuard?: RuntimeEffectGuard;
}

export interface ManagedRepositoryProcess {
  readonly id: string;
  readonly action: "run_target" | "debug_target" | "launch_web_app";
  readonly pid: number;
  readonly startedAt: string;
  readonly state: "running" | "stopping" | "completed" | "failed" | "timed_out" | "cancelled";
  readonly exitCode?: number;
  readonly outputTruncated: boolean;
}

const manifestMaximumBytes = 256 * 1024;
const maximumRecipes = 32;
const maximumArguments = 128;
const maximumArgumentBytes = 4_096;
const maximumEnvironmentEntries = 64;
const maximumEnvironmentValueBytes = 8_192;
const maximumOutputBytes = 1024 * 1024;
const maximumTimeoutMs = 24 * 60 * 60_000;
const forbiddenEnvironmentName = /(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|AUTHORIZATION|COOKIE|API_KEY|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DSN)(?:$|_)/i;
const filesystemTraversal = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
const supportedActionSet = new Set<string>([...repositoryProcessActions, "stop_managed_run"]);
const processActionSet = new Set<string>(repositoryProcessActions);
const managedActionSet = new Set<string>(["run_target", "debug_target", "launch_web_app"]);
const disposableRequired = new Set<RepositoryProcessAction>(["pipeline_local_gate", "pipeline_clean_reproduction", "release_shield"]);

class RuntimeUnavailableError extends Error {}

export function computeRepositoryRuntimeManifestDigest(contents: string | Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

export async function loadVerifiedRepositoryRuntimeManifest(options: LoadRepositoryRuntimeManifestOptions): Promise<VerifiedRepositoryRuntimeManifest> {
  if (!/^[a-f0-9]{64}$/i.test(options.expectedSha256)) throw new Error("Repository runtime manifest expected digest is invalid.");
  const metadata = await stat(options.filePath);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > manifestMaximumBytes) throw new Error("Repository runtime manifest exceeds its bounded file size or is not a file.");
  const bytes = await readFile(options.filePath);
  const digest = computeRepositoryRuntimeManifestDigest(bytes);
  if (!constantTimeTextEqual(digest, options.expectedSha256.toLowerCase())) throw new Error("Repository runtime manifest digest does not match the trusted host pin.");
  let unknown: unknown;
  try { unknown = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Repository runtime manifest is not valid JSON."); }
  const manifest = validateManifest(unknown);
  const canonicalRepositoryRoot = await realpath(options.repositoryRoot);
  const declaredRoot = await realpath(manifest.repositoryRoot).catch(() => "");
  if (!samePath(canonicalRepositoryRoot, declaredRoot)) throw new Error("Repository runtime manifest root does not match the canonical selected repository.");

  const executableIdentities = new Map<RepositoryProcessAction, ExecutableIdentity>();
  for (const [action, recipe] of Object.entries(manifest.recipes)) {
    if (!recipe || recipe.kind !== "process") continue;
    executableIdentities.set(action as RepositoryProcessAction, await captureExecutableIdentity(recipe.executable));
  }
  return {
    manifest: deepFreeze(manifest),
    digest,
    canonicalRepositoryRoot,
    [verifiedBrand]: true,
    executableIdentities
  };
}

function constantTimeTextEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[], location: string, errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) if (!allowedSet.has(key)) errors.push(`${location} has unknown field ${key}.`);
  for (const key of required) if (!(key in record)) errors.push(`${location} requires field ${key}.`);
}

function boundedString(value: unknown, location: string, errors: string[], maximumBytes = maximumArgumentBytes): value is string {
  if (typeof value !== "string" || !value || /[\0\r\n]/.test(value) || Buffer.byteLength(value, "utf8") > maximumBytes) {
    errors.push(`${location} must be a nonempty bounded single-line string.`);
    return false;
  }
  return true;
}

function boundedInteger(value: unknown, location: string, errors: string[], minimum: number, maximum: number): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    errors.push(`${location} must be an integer from ${minimum} through ${maximum}.`);
    return false;
  }
  return true;
}

function validateManifest(value: unknown): RepositoryRuntimeManifest {
  const errors: string[] = [];
  if (!isRecord(value)) throw new Error("Repository runtime manifest must be an object.");
  exactKeys(value, ["schema", "version", "repositoryRoot", "allowedHttpsUrls", "recipes"], ["schema", "version", "repositoryRoot", "allowedHttpsUrls", "recipes"], "manifest", errors);
  if (value.schema !== repositoryRuntimeManifestSchema) errors.push("Manifest schema is not sxsy-b122.repository-runtime.");
  if (value.version !== repositoryRuntimeManifestVersion) errors.push("Manifest version is not exactly 1.");
  if (!boundedString(value.repositoryRoot, "manifest.repositoryRoot", errors, 2_048) || !isAbsolute(value.repositoryRoot as string)) errors.push("Manifest repositoryRoot must be an absolute path.");

  const allowedHttpsUrls: string[] = [];
  if (!Array.isArray(value.allowedHttpsUrls) || value.allowedHttpsUrls.length > 32) errors.push("Manifest allowedHttpsUrls must be a bounded array.");
  else {
    for (const [index, item] of value.allowedHttpsUrls.entries()) {
      if (!boundedString(item, `manifest.allowedHttpsUrls[${index}]`, errors, 2_048)) continue;
      if (!isExactSafeWebUrl(item, [] as readonly string[], true)) errors.push(`Manifest allowed HTTPS URL ${index} must be exact HTTPS without credentials or fragments.`);
      else if (allowedHttpsUrls.includes(item)) errors.push(`Manifest allowed HTTPS URL ${index} is duplicated.`);
      else allowedHttpsUrls.push(item);
    }
  }

  const recipes: Partial<Record<RepositoryRuntimeAction, RepositoryRuntimeRecipe>> = {};
  if (!isRecord(value.recipes) || Object.keys(value.recipes).length > maximumRecipes) errors.push("Manifest recipes must be a bounded object.");
  else {
    for (const [action, recipe] of Object.entries(value.recipes)) {
      if (!supportedActionSet.has(action)) { errors.push(`Manifest has unsupported recipe action ${action}.`); continue; }
      if (!isRecord(recipe)) { errors.push(`Manifest recipe ${action} must be an object.`); continue; }
      if (action === "stop_managed_run") recipes.stop_managed_run = validateStopRecipe(recipe, errors);
      else recipes[action as RepositoryProcessAction] = validateProcessRecipe(action as RepositoryProcessAction, recipe, allowedHttpsUrls, errors);
    }
  }
  if (errors.length) throw new Error(`Repository runtime manifest validation failed: ${errors.join(" ")}`);
  return {
    schema: repositoryRuntimeManifestSchema,
    version: repositoryRuntimeManifestVersion,
    repositoryRoot: value.repositoryRoot as string,
    allowedHttpsUrls,
    recipes
  };
}

function validateStopRecipe(value: Record<string, unknown>, errors: string[]): RepositoryStopRecipe {
  exactKeys(value, ["kind", "managedActions", "gracefulTimeoutMs", "forceTimeoutMs"], ["kind", "managedActions", "gracefulTimeoutMs", "forceTimeoutMs"], "stop_managed_run", errors);
  if (value.kind !== "stop") errors.push("stop_managed_run must use the dedicated stop recipe, not an executable.");
  const managedActions: ("run_target" | "debug_target" | "launch_web_app")[] = [];
  if (!Array.isArray(value.managedActions) || value.managedActions.length < 1 || value.managedActions.length > 3) errors.push("stop_managed_run requires one to three managed actions.");
  else for (const action of value.managedActions) {
    if (typeof action !== "string" || !managedActionSet.has(action) || managedActions.includes(action as typeof managedActions[number])) errors.push("stop_managed_run contains an invalid or duplicate managed action.");
    else managedActions.push(action as typeof managedActions[number]);
  }
  boundedInteger(value.gracefulTimeoutMs, "stop_managed_run.gracefulTimeoutMs", errors, 10, 60_000);
  boundedInteger(value.forceTimeoutMs, "stop_managed_run.forceTimeoutMs", errors, 10, 60_000);
  return {
    kind: "stop",
    managedActions,
    gracefulTimeoutMs: typeof value.gracefulTimeoutMs === "number" ? value.gracefulTimeoutMs : 1_000,
    forceTimeoutMs: typeof value.forceTimeoutMs === "number" ? value.forceTimeoutMs : 2_000
  };
}

function validateProcessRecipe(action: RepositoryProcessAction, value: Record<string, unknown>, allowedHttpsUrls: readonly string[], errors: string[]): RepositoryProcessRecipe {
  exactKeys(value, ["kind", "executable", "args", "cwd", "environment", "lifecycle", "isolation", "timeoutMs", "maxOutputBytes", "web"], ["kind", "executable", "args", "cwd", "environment", "lifecycle", "isolation", "timeoutMs", "maxOutputBytes"], action, errors);
  if (value.kind !== "process") errors.push(`${action} must use a process recipe.`);
  if (!boundedString(value.executable, `${action}.executable`, errors, 2_048) || !isAbsolute(value.executable as string)) errors.push(`${action}.executable must be an exact absolute executable path.`);
  const args: string[] = [];
  if (!Array.isArray(value.args) || value.args.length > maximumArguments) errors.push(`${action}.args must be a bounded array.`);
  else for (const [index, argument] of value.args.entries()) {
    if (!boundedString(argument, `${action}.args[${index}]`, errors, maximumArgumentBytes)) continue;
    if (filesystemTraversal.test(argument) || redactText(argument) !== argument) errors.push(`${action}.args[${index}] contains traversal or secret material.`);
    else args.push(argument);
  }
  let cwd = ".";
  if (boundedString(value.cwd, `${action}.cwd`, errors, 1_024)) {
    cwd = value.cwd;
    if (isAbsolute(cwd) || filesystemTraversal.test(cwd) || cwd.split(/[\\/]/).some((part) => !part || part === "..") && cwd !== ".") errors.push(`${action}.cwd must be a canonical relative path within its execution root.`);
  }
  const environment: Record<string, string> = {};
  if (!isRecord(value.environment) || Object.keys(value.environment).length > maximumEnvironmentEntries) errors.push(`${action}.environment must be a bounded string map.`);
  else for (const [name, environmentValue] of Object.entries(value.environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || forbiddenEnvironmentName.test(name)) { errors.push(`${action}.environment contains unsafe or secret-bearing name ${name}.`); continue; }
    if (typeof environmentValue !== "string" || /[\0\r\n]/.test(environmentValue) || Buffer.byteLength(environmentValue, "utf8") > maximumEnvironmentValueBytes || redactText(environmentValue) !== environmentValue) {
      errors.push(`${action}.environment.${name} contains invalid or secret material.`); continue;
    }
    environment[name] = environmentValue;
  }
  const lifecycle = value.lifecycle === "managed" ? "managed" : "foreground";
  if (value.lifecycle !== "managed" && value.lifecycle !== "foreground") errors.push(`${action}.lifecycle must be foreground or managed.`);
  if (managedActionSet.has(action) !== (lifecycle === "managed")) errors.push(`${action} has an invalid lifecycle for its command semantics.`);
  const isolation = value.isolation === "disposable" ? "disposable" : "repository";
  if (value.isolation !== "repository" && value.isolation !== "disposable") errors.push(`${action}.isolation must be repository or disposable.`);
  if (disposableRequired.has(action) && isolation !== "disposable") errors.push(`${action} requires a disposable execution root.`);
  boundedInteger(value.timeoutMs, `${action}.timeoutMs`, errors, 50, maximumTimeoutMs);
  boundedInteger(value.maxOutputBytes, `${action}.maxOutputBytes`, errors, 1, maximumOutputBytes);
  const web = value.web === undefined ? undefined : validateWebRecipe(action, value.web, allowedHttpsUrls, errors);
  if (action === "launch_web_app" && !web) errors.push("launch_web_app requires exact web and health URLs.");
  if (action !== "launch_web_app" && value.web !== undefined) errors.push(`${action} cannot declare a web URL.`);
  return {
    kind: "process",
    executable: typeof value.executable === "string" ? value.executable : "",
    args,
    cwd,
    environment,
    lifecycle,
    isolation,
    timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : 1_000,
    maxOutputBytes: typeof value.maxOutputBytes === "number" ? value.maxOutputBytes : 4_096,
    ...(web ? { web } : {})
  };
}

function validateWebRecipe(action: RepositoryProcessAction, value: unknown, allowedHttpsUrls: readonly string[], errors: string[]): RepositoryWebRecipe | undefined {
  if (!isRecord(value)) { errors.push(`${action}.web must be an object.`); return undefined; }
  exactKeys(value, ["url", "healthUrl", "healthTimeoutMs", "healthIntervalMs"], ["url", "healthUrl", "healthTimeoutMs", "healthIntervalMs"], `${action}.web`, errors);
  const url = boundedString(value.url, `${action}.web.url`, errors, 2_048) ? value.url : "";
  const healthUrl = boundedString(value.healthUrl, `${action}.web.healthUrl`, errors, 2_048) ? value.healthUrl : "";
  if (url && !isExactSafeWebUrl(url, allowedHttpsUrls)) errors.push(`${action}.web.url is not exact loopback or host-allowlisted HTTPS.`);
  if (healthUrl && !isExactSafeWebUrl(healthUrl, allowedHttpsUrls)) errors.push(`${action}.web.healthUrl is not exact loopback or host-allowlisted HTTPS.`);
  boundedInteger(value.healthTimeoutMs, `${action}.web.healthTimeoutMs`, errors, 50, 120_000);
  boundedInteger(value.healthIntervalMs, `${action}.web.healthIntervalMs`, errors, 10, 10_000);
  return {
    url,
    healthUrl,
    healthTimeoutMs: typeof value.healthTimeoutMs === "number" ? value.healthTimeoutMs : 5_000,
    healthIntervalMs: typeof value.healthIntervalMs === "number" ? value.healthIntervalMs : 250
  };
}

function isExactSafeWebUrl(value: string, allowlistedHttpsUrls: readonly string[], requireHttps = false): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.href !== value || parsed.username || parsed.password || parsed.hash) return false;
    const hostname = parsed.hostname.toLowerCase();
    const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
    if (requireHttps) return parsed.protocol === "https:";
    if (loopback && (parsed.protocol === "http:" || parsed.protocol === "https:")) return true;
    return parsed.protocol === "https:" && allowlistedHttpsUrls.includes(value);
  } catch { return false; }
}

async function captureExecutableIdentity(executable: string): Promise<ExecutableIdentity> {
  const canonicalPath = await realpath(executable).catch(() => { throw new Error("Repository runtime executable does not exist."); });
  const metadata = await stat(canonicalPath);
  if (!metadata.isFile()) throw new Error("Repository runtime executable is not a regular file.");
  return { canonicalPath, device: metadata.dev, inode: metadata.ino, size: metadata.size, modifiedMs: metadata.mtimeMs };
}

async function assertExecutableUnchanged(expected: ExecutableIdentity): Promise<string> {
  const current = await captureExecutableIdentity(expected.canonicalPath);
  if (!samePath(current.canonicalPath, expected.canonicalPath) || current.device !== expected.device || current.inode !== expected.inode || current.size !== expected.size || current.modifiedMs !== expected.modifiedMs) {
    throw new Error("Repository runtime executable changed after manifest verification.");
  }
  return current.canonicalPath;
}

function samePath(left: string, right: string): boolean {
  const normalized = (value: string): string => resolve(value).replace(/[\\/]+$/, "").toLowerCase();
  return normalized(left) === normalized(right);
}

function inside(child: string, root: string): boolean {
  const result = relative(root, child);
  return result === "" || (!result.startsWith(`..${sep}`) && result !== ".." && !isAbsolute(result));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

class ExactEnvironmentOutput {
  private readonly chunks: Buffer[] = [];
  private readonly limit: number;
  private bytes = 0;
  truncated = false;
  constructor(limit: number) { this.limit = limit; }
  collect(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = this.limit - this.bytes;
    if (remaining > 0) {
      const accepted = buffer.subarray(0, remaining);
      this.chunks.push(accepted);
      this.bytes += accepted.byteLength;
    }
    if (buffer.byteLength > remaining) this.truncated = true;
  }
  text(): string {
    const redacted = redactText(Buffer.concat(this.chunks).toString("utf8"));
    return Buffer.from(redacted, "utf8").subarray(0, this.limit).toString("utf8");
  }
}

interface ManagedRecord {
  readonly public: {
    id: string;
    action: "run_target" | "debug_target" | "launch_web_app";
    pid: number;
    startedAt: string;
    state: ManagedRepositoryProcess["state"];
    exitCode?: number;
    outputTruncated: boolean;
  };
  readonly child: ChildProcessWithoutNullStreams;
  readonly output: ExactEnvironmentOutput;
  readonly exit: Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>;
  readonly lease: RepositoryExecutionRootLease;
  timeout?: ReturnType<typeof setTimeout>;
  abortCleanup?: () => void;
}

const denyEffects: RuntimeEffectGuard = {
  async check() { return { allowed: false, reason: "No host containment/effect guard is configured for repository runtime execution." }; }
};

const defaultExecutionRoots: RepositoryExecutionRootProvider = {
  async prepare(input) {
    if (input.isolation === "disposable") throw new RuntimeUnavailableError("No attested disposable execution-root provider is configured.");
    return { root: input.repositoryRoot, isolation: "repository", release: async () => undefined };
  }
};

const defaultHealthProbe: RuntimeHealthProbe = {
  async probe(url, signal) {
    try {
      const response = await fetch(url, { method: "GET", redirect: "manual", signal, credentials: "omit", cache: "no-store" });
      return response.status >= 200 && response.status < 300
        ? { healthy: true, detail: `Health endpoint returned HTTP ${response.status}.` }
        : { healthy: false, detail: `Health endpoint returned HTTP ${response.status}.` };
    } catch (error) { return { healthy: false, detail: untrustedSummary((error as Error).message) }; }
  }
};

export class RepositoryRuntime {
  private readonly verified: VerifiedRepositoryRuntimeManifest;
  private readonly effectGuard: RuntimeEffectGuard;
  private readonly executionRoots: RepositoryExecutionRootProvider;
  private readonly healthProbe: RuntimeHealthProbe;
  private readonly managed = new Map<string, ManagedRecord>();

  constructor(
    verified: VerifiedRepositoryRuntimeManifest,
    dependencies: Readonly<{
      effectGuard?: RuntimeEffectGuard;
      executionRoots?: RepositoryExecutionRootProvider;
      healthProbe?: RuntimeHealthProbe;
    }> = {}
  ) {
    if (verified[verifiedBrand] !== true) throw new Error("Repository runtime requires a digest-verified host manifest.");
    this.verified = verified;
    this.effectGuard = dependencies.effectGuard ?? denyEffects;
    this.executionRoots = dependencies.executionRoots ?? defaultExecutionRoots;
    this.healthProbe = dependencies.healthProbe ?? defaultHealthProbe;
  }

  listManagedProcesses(): readonly ManagedRepositoryProcess[] {
    return [...this.managed.values()].map((record) => ({ ...record.public, outputTruncated: record.output.truncated }));
  }

  async execute(action: RepositoryRuntimeAction, options: RepositoryRuntimeExecuteOptions = {}): Promise<RepositoryRuntimeResult> {
    const effectGuard = options.effectGuard ?? this.effectGuard;
    const recipe = this.verified.manifest.recipes[action];
    if (!recipe) return { status: "unavailable", summary: `No verified repository runtime recipe is declared for ${action}.` };
    if (action === "stop_managed_run") {
      if (recipe.kind !== "stop") return { status: "blocked", summary: "The verified stop recipe has an invalid type." };
      return this.stopManaged(recipe, options.managedProcessId, effectGuard);
    }
    if (recipe.kind !== "process" || !processActionSet.has(action)) return { status: "blocked", summary: "The verified process recipe has an invalid type." };
    return this.executeProcess(action as RepositoryProcessAction, recipe, options.signal, effectGuard);
  }

  private async executeProcess(action: RepositoryProcessAction, recipe: RepositoryProcessRecipe, signal: AbortSignal | undefined, effectGuard: RuntimeEffectGuard): Promise<RepositoryRuntimeResult> {
    if (signal?.aborted) return { status: "cancelled", summary: `${action} was cancelled before execution.` };
    const admission = await effectGuard.check(action, this.verified.canonicalRepositoryRoot);
    if (!admission.allowed) return { status: "blocked", summary: untrustedSummary(admission.reason) };
    let lease: RepositoryExecutionRootLease;
    try { lease = await this.executionRoots.prepare({ action, repositoryRoot: this.verified.canonicalRepositoryRoot, isolation: recipe.isolation }); }
    catch (error) {
      return error instanceof RuntimeUnavailableError
        ? { status: "unavailable", summary: untrustedSummary(error.message) }
        : { status: "failed", summary: untrustedSummary((error as Error).message) };
    }
    let transferredLease = false;
    try {
      const executionRoot = await realpath(lease.root);
      if (lease.isolation !== recipe.isolation) return { status: "blocked", summary: "Execution-root isolation does not match the verified recipe." };
      if (recipe.isolation === "repository" && !samePath(executionRoot, this.verified.canonicalRepositoryRoot)) return { status: "blocked", summary: "Repository recipe escaped the selected canonical repository." };
      if (recipe.isolation === "disposable") {
        if (samePath(executionRoot, this.verified.canonicalRepositoryRoot)) return { status: "blocked", summary: "Disposable recipe was offered the live repository root." };
        if (lease.protections?.productionData !== "denied" || lease.protections.ambientCredentials !== "denied") return { status: "blocked", summary: "Disposable recipe lacks production-data and ambient-credential denial attestations." };
      }
      const cwd = await realpath(resolve(executionRoot, recipe.cwd));
      if (!inside(cwd, executionRoot)) return { status: "blocked", summary: "Recipe working directory escaped its canonical execution root." };
      const expectedExecutable = this.verified.executableIdentities.get(action);
      if (!expectedExecutable) return { status: "blocked", summary: "Verified executable identity is missing." };
      await assertExecutableUnchanged(expectedExecutable);
      const finalGuard = await effectGuard.check(action, this.verified.canonicalRepositoryRoot);
      if (!finalGuard.allowed) return { status: "blocked", summary: untrustedSummary(finalGuard.reason) };
      const finalRoot = await realpath(executionRoot);
      const finalCwd = await realpath(cwd);
      if (!samePath(finalRoot, executionRoot) || !inside(finalCwd, finalRoot)) return { status: "blocked", summary: "Execution root changed during the final effect check." };
      const executable = await assertExecutableUnchanged(expectedExecutable);
      const started = await this.startChild(action, recipe, executable, finalCwd, lease, signal);
      if ("result" in started) return started.result;
      transferredLease = recipe.lifecycle === "managed";
      if (recipe.lifecycle === "foreground") return await this.waitForeground(action, recipe, started.record, signal);
      const record = started.record;
      if (action === "launch_web_app") {
        const web = recipe.web!;
        const healthy = await this.waitForHealth(record, web, signal, effectGuard);
        if (!healthy.healthy) {
          await this.terminateRecord(record, 250, 1_000, signal?.aborted ? "cancelled" : "failed");
          return { status: signal?.aborted ? "cancelled" : "failed", summary: untrustedSummary(healthy.detail), managedProcessId: record.public.id, pid: record.public.pid, output: record.output.text(), outputTruncated: record.output.truncated };
        }
        return { status: "running", summary: "Managed web application passed its exact configured health probe.", managedProcessId: record.public.id, pid: record.public.pid, url: web.url };
      }
      return { status: "running", summary: `Managed ${action} process started.`, managedProcessId: record.public.id, pid: record.public.pid };
    } catch (error) {
      return { status: "blocked", summary: untrustedSummary((error as Error).message) };
    } finally {
      if (!transferredLease) await lease.release().catch(() => undefined);
    }
  }

  private async startChild(
    action: RepositoryProcessAction,
    recipe: RepositoryProcessRecipe,
    executable: string,
    cwd: string,
    lease: RepositoryExecutionRootLease,
    signal?: AbortSignal
  ): Promise<{ readonly record: ManagedRecord } | { readonly result: RepositoryRuntimeResult }> {
    if (recipe.lifecycle === "managed" && [...this.managed.values()].some((item) => item.public.action === action && item.public.state === "running")) {
      return { result: { status: "blocked", summary: `A managed ${action} process is already running for this repository.` } };
    }
    const output = new ExactEnvironmentOutput(recipe.maxOutputBytes);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(executable, [...recipe.args], {
        cwd,
        env: { ...recipe.environment },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) { return { result: { status: "failed", summary: untrustedSummary((error as Error).message) } }; }
    child.stdout.on("data", (chunk: Buffer) => output.collect(chunk));
    child.stderr.on("data", (chunk: Buffer) => output.collect(chunk));
    const spawned = await new Promise<boolean>((resolveSpawn) => {
      child.once("spawn", () => resolveSpawn(true));
      child.once("error", (error) => { output.collect(error.message); resolveSpawn(false); });
    });
    if (!spawned || child.pid === undefined) return { result: { status: "failed", summary: untrustedSummary(output.text() || "Managed process failed before spawn."), output: output.text(), outputTruncated: output.truncated } };

    let settle!: (value: { readonly code: number; readonly signal: NodeJS.Signals | null }) => void;
    const exit = new Promise<{ readonly code: number; readonly signal: NodeJS.Signals | null }>((resolveExit) => { settle = resolveExit; });
    let settled = false;
    child.once("close", (code, closeSignal) => { if (!settled) { settled = true; settle({ code: code ?? -1, signal: closeSignal }); } });
    child.once("error", (error) => { output.collect(error.message); if (!settled) { settled = true; settle({ code: -1, signal: null }); } });
    const id = `managed:${createHash("sha256").update(`${randomUUID()}:${child.pid}:${Date.now()}:${action}`).digest("hex")}`;
    const record: ManagedRecord = {
      public: { id, action: action as ManagedRecord["public"]["action"], pid: child.pid, startedAt: new Date().toISOString(), state: "running", outputTruncated: false },
      child,
      output,
      exit,
      lease
    };
    if (recipe.lifecycle === "managed") {
      this.managed.set(id, record);
      record.timeout = setTimeout(() => { void this.terminateRecord(record, 250, 1_000, "timed_out"); }, recipe.timeoutMs);
      if (signal) {
        const abort = (): void => { void this.terminateRecord(record, 250, 1_000, "cancelled"); };
        signal.addEventListener("abort", abort, { once: true });
        record.abortCleanup = () => signal.removeEventListener("abort", abort);
      }
      void exit.then(async ({ code }) => {
        if (record.timeout) clearTimeout(record.timeout);
        record.abortCleanup?.();
        if (record.public.state === "running" || record.public.state === "stopping") record.public.state = code === 0 ? "completed" : "failed";
        record.public.exitCode = code;
        record.public.outputTruncated = output.truncated;
        await lease.release().catch(() => undefined);
        this.pruneManagedHistory();
      });
    }
    return { record };
  }

  private async waitForeground(action: RepositoryProcessAction, recipe: RepositoryProcessRecipe, record: ManagedRecord, signal?: AbortSignal): Promise<RepositoryRuntimeResult> {
    let terminal: ManagedRepositoryProcess["state"] | undefined;
    const timeout = setTimeout(() => { terminal = "timed_out"; record.child.kill("SIGTERM"); }, recipe.timeoutMs);
    const abort = (): void => { terminal = "cancelled"; record.child.kill("SIGTERM"); };
    signal?.addEventListener("abort", abort, { once: true });
    const { code } = await record.exit;
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    const output = record.output.text();
    if (terminal === "timed_out") return { status: "timed_out", summary: `${action} exceeded its verified timeout and was terminated.`, exitCode: code, output, outputTruncated: record.output.truncated };
    if (terminal === "cancelled") return { status: "cancelled", summary: `${action} was cancelled and its exact child was terminated.`, exitCode: code, output, outputTruncated: record.output.truncated };
    return code === 0
      ? { status: "completed", summary: `${action} completed through the verified repository runtime.`, exitCode: code, output, outputTruncated: record.output.truncated }
      : { status: "failed", summary: untrustedSummary(output || `${action} exited with code ${code}.`), exitCode: code, output, outputTruncated: record.output.truncated };
  }

  private async waitForHealth(record: ManagedRecord, web: RepositoryWebRecipe, signal: AbortSignal | undefined, effectGuard: RuntimeEffectGuard): Promise<{ healthy: boolean; detail: string }> {
    const deadline = Date.now() + web.healthTimeoutMs;
    let last = "Health probe did not succeed before its deadline.";
    while (Date.now() < deadline) {
      if (signal?.aborted) return { healthy: false, detail: "Web launch was cancelled before health verification." };
      if (record.child.exitCode !== null) return { healthy: false, detail: "Managed web process exited before health verification." };
      const guard = await effectGuard.check("launch_web_app", this.verified.canonicalRepositoryRoot);
      if (!guard.allowed) return { healthy: false, detail: guard.reason };
      const controller = new AbortController();
      const remaining = Math.max(1, deadline - Date.now());
      const timer = setTimeout(() => controller.abort(), remaining);
      const relay = (): void => controller.abort();
      signal?.addEventListener("abort", relay, { once: true });
      try {
        const result = await this.healthProbe.probe(web.healthUrl, controller.signal);
        last = result.detail;
        if (result.healthy) return result;
      } catch (error) { last = (error as Error).message; }
      finally { clearTimeout(timer); signal?.removeEventListener("abort", relay); }
      await delay(Math.min(web.healthIntervalMs, Math.max(0, deadline - Date.now())));
    }
    return { healthy: false, detail: last };
  }

  private async stopManaged(recipe: RepositoryStopRecipe, requestedId: string | undefined, effectGuard: RuntimeEffectGuard): Promise<RepositoryRuntimeResult> {
    const admission = await effectGuard.check("stop_managed_run", this.verified.canonicalRepositoryRoot);
    if (!admission.allowed) return { status: "blocked", summary: untrustedSummary(admission.reason) };
    const eligible = [...this.managed.values()].filter((record) => record.public.state === "running" && recipe.managedActions.includes(record.public.action));
    let record: ManagedRecord | undefined;
    if (requestedId) {
      record = this.managed.get(requestedId);
      if (!record || record.public.state !== "running" || !recipe.managedActions.includes(record.public.action)) return { status: "blocked", summary: "Requested managed process identity is unknown, stale, or outside the stop recipe." };
    } else {
      if (eligible.length === 0) return { status: "unavailable", summary: "No eligible managed Run process is active." };
      if (eligible.length > 1) return { status: "blocked", summary: "More than one managed Run process is active; an exact opaque identity is required." };
      record = eligible[0];
    }
    const finalGuard = await effectGuard.check("stop_managed_run", this.verified.canonicalRepositoryRoot);
    if (!finalGuard.allowed) return { status: "blocked", summary: untrustedSummary(finalGuard.reason) };
    await this.terminateRecord(record, recipe.gracefulTimeoutMs, recipe.forceTimeoutMs, "completed");
    return {
      status: record.public.state === "completed" ? "completed" : "failed",
      summary: record.public.state === "completed" ? "The exact managed child was stopped." : "The exact managed child did not stop within the bounded termination window.",
      managedProcessId: record.public.id,
      pid: record.public.pid,
      exitCode: record.public.exitCode,
      output: record.output.text(),
      outputTruncated: record.output.truncated
    };
  }

  private async terminateRecord(record: ManagedRecord, gracefulMs: number, forceMs: number, terminal: ManagedRepositoryProcess["state"]): Promise<void> {
    if (record.public.state !== "running" && record.public.state !== "stopping") return;
    record.public.state = "stopping";
    record.child.kill("SIGTERM");
    if (!await settledWithin(record.exit, gracefulMs)) {
      record.child.kill("SIGKILL");
      if (!await settledWithin(record.exit, forceMs)) {
        record.public.state = "failed";
        return;
      }
    }
    record.public.state = terminal;
  }

  private pruneManagedHistory(): void {
    const settled = [...this.managed.values()].filter((record) => record.public.state !== "running" && record.public.state !== "stopping");
    for (const record of settled.slice(0, Math.max(0, settled.length - 64))) this.managed.delete(record.public.id);
  }
}

async function settledWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise.then(() => true), new Promise<boolean>((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
