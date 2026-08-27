/**
 * Concrete local-only runtime pieces for the B122 companion.  They deliberately
 * use structured child-process calls rather than a shell: callers cannot turn a
 * repository field, path, or repository document into executable syntax.
 */
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { AdapterResult, DispatchRequest, ExecutionBroker, ManagedSession, ProviderSessionAdapter, TargetSnapshot, TestEnvironmentBroker, ContextPackage } from "./control-plane.ts";
import { captureTargetSnapshot, redact } from "./control-plane.ts";
import { assignments, handlerFor, type HandlerName } from "../../../packages/protocol/src/b122.ts";

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = (value: Buffer | string): string => value.toString().replace(/\r\n/g, "\n").trim();

export interface ReviewApproval { id: string; action: string; targetDigest: string; issuedAt: number; expiresAt: number; actor: string; }
export function createReviewApproval(action: string, target: TargetSnapshot, actor: string, ttlMs = 5 * 60_000): ReviewApproval {
  const issuedAt = Date.now(); return { id: randomUUID(), action, targetDigest: target.digest, issuedAt, expiresAt: issuedAt + ttlMs, actor };
}
export function validateReviewApproval(approval: ReviewApproval | undefined, action: string, target: TargetSnapshot, now = Date.now()): string | undefined {
  if (!approval) return "Explicit local review is required before this consequential action.";
  if (approval.action !== action || approval.targetDigest !== target.digest) return "The review approval does not match the exact action and target.";
  if (approval.expiresAt <= now || approval.issuedAt > now) return "The review approval is expired or not yet valid.";
  return undefined;
}

async function run(program: string, args: readonly string[], cwd: string, environment?: Record<string, string>, inheritEnvironment = true): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(program, [...args], { cwd, shell: false, windowsHide: true, env: inheritEnvironment ? { ...process.env, ...environment } : environment });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += text(chunk); }); child.stderr.on("data", (chunk: Buffer) => { stderr += text(chunk); });
    child.once("error", fail); child.once("close", (code) => done({ code: code ?? -1, stdout, stderr }));
  });
}
async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await run("git", args, root); if (result.code !== 0) throw new Error(redact(result.stderr || `git ${args[0]} failed`)); return result.stdout;
}
const lineList = (value: string): string[] => value ? value.split("\n").filter(Boolean).sort() : [];

/** Captures the full live repository state used for target equality checks. */
export async function captureLiveTargetSnapshot(directory: string, policyVersion = "local-v1"): Promise<TargetSnapshot> {
  const gitRoot = await git(directory, ["rev-parse", "--show-toplevel"]);
  const remote = await git(gitRoot, ["remote", "get-url", "origin"]).catch(() => "");
  const branch = await git(gitRoot, ["branch", "--show-current"]);
  const upstream = await git(gitRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(() => undefined);
  const head = await git(gitRoot, ["rev-parse", "HEAD"]);
  const indexTree = await git(gitRoot, ["write-tree"]);
  const tracked = [
    ...lineList(await git(gitRoot, ["status", "--porcelain=v1", "--untracked-files=no"])),
    `worktree-diff:${hash(await git(gitRoot, ["diff", "--no-ext-diff", "--binary", "--", "."]))}`,
    `index-diff:${hash(await git(gitRoot, ["diff", "--cached", "--no-ext-diff", "--binary", "--", "."]))}`
  ];
  const untrackedNames = lineList(await git(gitRoot, ["ls-files", "--others", "--exclude-standard"]));
  const untracked = await Promise.all(untrackedNames.map(async (path) => `${path}:${await git(gitRoot, ["hash-object", "--", path])}`));
  const submodules = lineList(await git(gitRoot, ["submodule", "status", "--recursive"]));
  return captureTargetSnapshot({ gitRoot, remote, branch, upstream, head, indexTree, tracked, untracked, submodules, policyVersion,
    toolFingerprint: await git(gitRoot, ["--version"]), environmentFingerprint: `${process.platform}:${process.arch}:${process.version}` });
}

export interface RepositoryPolicy { allowedRoots: readonly string[]; directMain: "deny" | "reviewed"; push: "deny" | "reviewed"; }
export const defaultRepositoryPolicy = (root: string): RepositoryPolicy => ({ allowedRoots: [resolve(root)], directMain: "deny", push: "reviewed" });

/** Canonicalizes and contains every local filesystem address before it is touched. */
export class FilesystemBroker {
  private readonly policy: RepositoryPolicy;
  constructor(policy: RepositoryPolicy) { this.policy = policy; }
  async canonical(path: string): Promise<string> {
    const candidate = resolve(path); let probe = candidate; const suffix: string[] = [];
    let existing: string;
    while (true) {
      try { existing = join(await realpath(probe), ...suffix); break; } catch {
        const parent = dirname(probe); if (parent === probe) { existing = candidate; break; } suffix.unshift(basename(probe)); probe = parent;
      }
    }
    const allowed = await Promise.all(this.policy.allowedRoots.map(async (root) => realpath(root).catch(() => resolve(root))));
    const normalized = (value: string): string => process.platform === "win32" ? value.toLowerCase() : value;
    const inside = (value: string, root: string): boolean => normalized(value) === normalized(root) || normalized(value).startsWith(`${normalized(root)}${sep}`);
    if (!allowed.some((root) => inside(existing, root))) throw new Error("Path is outside the configured workspace allowlist.");
    return existing;
  }
  async read(path: string): Promise<string> { return readFile(await this.canonical(path), "utf8"); }
  async write(path: string, contents: string): Promise<void> { const canonical = await this.canonical(path); await mkdir(dirname(canonical), { recursive: true }); await writeFile(canonical, contents, { encoding: "utf8", mode: 0o600 }); }
}

export interface GitStatus { branch: string; head: string; porcelain: readonly string[]; diff: string; }
/**
 * Legacy read-only repository helper retained for compatibility tests.  Its
 * mutation entry points are intentionally retired: the candidate companion
 * uses LocalMediatedGitHandler behind the durable policy/containment broker
 * so no direct caller can commit, push, or merge around a private index,
 * target guard, confirmation, or fence.
 */
export class LocalRepositoryBroker {
  private readonly root: string; private readonly policy: RepositoryPolicy;
  constructor(root: string, policy: RepositoryPolicy = defaultRepositoryPolicy(root)) { this.root = root; this.policy = policy; }
  private async rootFor(target: TargetSnapshot): Promise<string> { const root = await new FilesystemBroker(this.policy).canonical(target.gitRoot); const expected = await realpath(resolve(this.root)).catch(() => resolve(this.root)); if (root !== expected) throw new Error("The target repository does not match this broker."); return root; }
  async status(target: TargetSnapshot): Promise<GitStatus> {
    const root = await this.rootFor(target);
    const unstaged = await git(root, ["diff", "--no-ext-diff", "--", "."]);
    const staged = await git(root, ["diff", "--cached", "--no-ext-diff", "--", "."]);
    return { branch: await git(root, ["branch", "--show-current"]), head: await git(root, ["rev-parse", "HEAD"]), porcelain: lineList(await git(root, ["status", "--porcelain=v1"])), diff: `${unstaged}\n${staged}` };
  }
  async revalidate(target: TargetSnapshot): Promise<string | undefined> { const current = await captureLiveTargetSnapshot(target.gitRoot, target.policyVersion); return current.digest === target.digest ? undefined : "Live repository state no longer matches the protected TargetSnapshot."; }
  private async mutationGuard(action: string, target: TargetSnapshot, approval: ReviewApproval | undefined): Promise<string | undefined> {
    const stale = await this.revalidate(target);
    return stale ?? validateReviewApproval(approval, action, target);
  }
  async commit(target: TargetSnapshot, message: string, approval?: ReviewApproval): Promise<AdapterResult> {
    void target; void message; void approval;
    return { outcome: "blocked", detail: "Legacy direct Git commit is retired. Use the durable mediated Git handler with a reviewed confirmation, task-owned paths, private index, and containment fence." };
  }
  async push(target: TargetSnapshot, approval?: ReviewApproval): Promise<AdapterResult> {
    void target; void approval;
    return { outcome: "blocked", detail: "Legacy direct Git push is retired. Network Git routes require the candidate broker and their separate acceptance gates." };
  }
  async merge(target: TargetSnapshot, source: string, approval?: ReviewApproval): Promise<AdapterResult> {
    void target; void source; void approval;
    return { outcome: "blocked", detail: "Legacy direct Git merge is retired. Merge and Direct Main remain high-consequence candidate broker actions." };
  }
}

export interface TestRecipe { command: string; args: readonly string[]; environment?: Record<string, string>; productionDenyPatterns: readonly RegExp[]; }
/** Runs only an explicit repository recipe and rejects production-looking configuration. */
export class LocalTestEnvironmentBroker implements TestEnvironmentBroker {
  private readonly recipe?: TestRecipe;
  constructor(recipe?: TestRecipe) { this.recipe = recipe; }
  async prepare(_target: TargetSnapshot): Promise<{ available: boolean; environment?: Record<string, string>; reason?: string }> {
    if (!this.recipe) return { available: false, reason: "No declared isolated test recipe is configured." };
    const environment = { SXSY_TEST_MODE: "1", SXSY_NETWORK: "deny", ...(this.recipe.environment ?? {}) };
    if (Object.values(environment).some((value) => this.recipe!.productionDenyPatterns.some((pattern) => pattern.test(value)))) return { available: false, reason: "The test recipe contains a denied production-like endpoint or credential." };
    return { available: true, environment };
  }
  async run(target: TargetSnapshot): Promise<AdapterResult> {
    const prepared = await this.prepare(target); if (!prepared.available) return { outcome: "unavailable", detail: prepared.reason! };
    const hostKeys = ["PATH", "PATHEXT", "SystemRoot", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE"];
    const hostEnvironment = Object.fromEntries(hostKeys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
    const result = await run(this.recipe!.command, this.recipe!.args, target.gitRoot, { ...hostEnvironment, ...prepared.environment }, false);
    return result.code === 0 ? { outcome: "passed", detail: redact(result.stdout || "Isolated local gate passed.") } : { outcome: "failed", detail: redact(result.stderr || result.stdout) };
  }
}

export class LocalProcessProviderAdapter implements ProviderSessionAdapter {
  readonly version = "local-process-v1"; readonly calls: string[] = [];
  readonly provider: "claude" | "codex" | "generic"; private readonly sessions: readonly ManagedSession[];
  constructor(provider: "claude" | "codex" | "generic", sessions: readonly ManagedSession[]) { this.provider = provider; this.sessions = sessions; }
  async discover(): Promise<ManagedSession[]> { this.calls.push("discover"); return this.sessions.map((session) => ({ ...session, plannedFiles: [...session.plannedFiles] })); }
  async focus(sessionId: string): Promise<AdapterResult> { this.calls.push(`focus:${sessionId}`); return this.sessions.some((item) => item.id === sessionId) ? { outcome: "passed", detail: "Local managed-session focus acknowledged." } : { outcome: "unavailable", detail: "Managed session was not found." }; }
  async pause(sessionId: string): Promise<AdapterResult> { this.calls.push(`pause:${sessionId}`); return this.sessions.some((item) => item.id === sessionId) ? { outcome: "passed", detail: "Local simulated provider pause acknowledged." } : { outcome: "unavailable", detail: "Managed session was not found." }; }
  async injectContext(sessionId: string, packet: ContextPackage): Promise<AdapterResult> { this.calls.push(`inject:${sessionId}:${packet.digest}`); return this.sessions.some((item) => item.id === sessionId) ? { outcome: "passed", detail: "Local simulated provider accepted target-bound context." } : { outcome: "unavailable", detail: "Managed session was not found." }; }
}

export interface SandboxLease { id: string; root: string; quarantine: boolean; createdAt: number; }
/** Software containment that is crash-recoverable: all temporary copies live under a single lease root. */
export class LocalSandboxBroker {
  private readonly baseDirectory: string;
  constructor(baseDirectory: string) { this.baseDirectory = baseDirectory; }
  async create(target: TargetSnapshot, quarantine = false): Promise<SandboxLease> { const root = await mkdtemp(join(this.baseDirectory, quarantine ? "quarantine-" : "sandbox-")); await cp(target.gitRoot, join(root, basename(target.gitRoot)), { recursive: true, filter: (source) => !source.split(sep).includes(".git") }); return { id: randomUUID(), root, quarantine, createdAt: Date.now() }; }
  async release(lease: SandboxLease, approval: ReviewApproval | undefined, target: TargetSnapshot): Promise<AdapterResult> { const denial = validateReviewApproval(approval, "SANDBOX:release", target); if (denial) return { outcome: "blocked", detail: denial }; await rm(lease.root, { recursive: true, force: true }); return { outcome: "passed", detail: "Reviewed sandbox lease was removed." }; }
  async reconcile(): Promise<readonly string[]> { await mkdir(this.baseDirectory, { recursive: true }); return (await readdir(this.baseDirectory)).filter((entry) => entry.startsWith("sandbox-") || entry.startsWith("quarantine-")); }
}

/**
 * The raw-token legacy IPC API was removed.  Use `authenticated-pipe.ts`,
 * which carries the candidate CompanionRequest contract over a bounded,
 * sealed-token local pipe.  Keeping the tombstone makes accidental imports
 * fail visibly instead of reintroducing a plaintext bearer-token server.
 */
export const legacyRawIpcRetired = true as const;

export interface ConcreteHandler {
  readonly name: HandlerName;
  execute(target: TargetSnapshot, request: DispatchRequest): Promise<AdapterResult>;
}

/** Secret material is resolved only at the point of use; receipts retain the reference, never the value. */
export class LocalCredentialBroker {
  private readonly references: Readonly<Record<string, string>>;
  constructor(references: Readonly<Record<string, string>> = {}) { this.references = { ...references }; }
  acquire(reference: string): { reference: string; value?: string; available: boolean; reason?: string } {
    const value = this.references[reference]; return value ? { reference, value, available: true } : { reference, available: false, reason: "Credential reference is unavailable." };
  }
  audit(reference: string): string { return `credential-ref:${reference}`; }
}

export interface NetworkRequest { domain: string; operation: string; body?: string; timeoutMs?: number; credentialReference?: string; }
export interface NetworkTransport { send(request: NetworkRequest, credential?: string): Promise<{ status: number; body: string }>; }
/** Explicit-domain local network policy with injected deterministic transport for tests. */
export class LocalNetworkBroker {
  private readonly allowed: ReadonlySet<string>; private readonly transport: NetworkTransport; private readonly credentials: LocalCredentialBroker;
  constructor(allowed: ReadonlySet<string>, transport: NetworkTransport, credentials = new LocalCredentialBroker()) { this.allowed = allowed; this.transport = transport; this.credentials = credentials; }
  async request(request: NetworkRequest): Promise<AdapterResult> {
    if (!this.allowed.has(request.domain)) return { outcome: "blocked", detail: "Network domain is not permitted by the local policy." };
    const credential = request.credentialReference ? this.credentials.acquire(request.credentialReference) : undefined;
    if (credential && !credential.available) return { outcome: "unavailable", detail: credential.reason! };
    const timeoutMs = Math.max(1, Math.min(request.timeoutMs ?? 10_000, 60_000)); let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Network request timed out.")), timeoutMs); });
    try { const response = await Promise.race([this.transport.send(request, credential?.value), timed]); return response.status >= 200 && response.status < 300 ? { outcome: "passed", detail: `Network ${request.operation} completed for ${request.domain}.` } : { outcome: "failed", detail: `Network ${request.operation} returned HTTP ${response.status}.` }; }
    catch (error) { return { outcome: "failed", detail: redact((error as Error).message) }; }
    finally { if (timer) clearTimeout(timer); }
  }
}

export interface ProcessPolicy { readonly executable: string; readonly argumentPattern: RegExp; readonly timeoutMs?: number; readonly outputLimit?: number; }
/** Allowlisted process supervisor with bounded output and cancellation/timeout containment. */
export class LocalProcessBroker {
  private readonly policies: readonly ProcessPolicy[];
  constructor(policies: readonly ProcessPolicy[]) { this.policies = policies; }
  async execute(program: string, args: readonly string[], cwd: string): Promise<AdapterResult> {
    const policy = this.policies.find((item) => item.executable === program && args.every((arg) => item.argumentPattern.test(arg)));
    if (!policy) return { outcome: "blocked", detail: "Process executable or arguments are not allowlisted." };
    const limit = policy.outputLimit ?? 32_768; const timeoutMs = policy.timeoutMs ?? 30_000;
    return new Promise((resolveResult) => {
      // Never give a brokered subprocess ambient credentials.  An executable
      // that needs a secret must receive an opaque broker lease through an
      // explicitly reviewed host adapter, not inherit the companion process.
      const inherited = ["PATH", "PATHEXT", "SystemRoot", "ComSpec", "TEMP", "TMP", "USERPROFILE"];
      const environment = Object.fromEntries(inherited.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
      const child = spawn(program, [...args], { cwd, shell: false, windowsHide: true, env: environment }); let output = ""; let timedOut = false;
      const collect = (chunk: Buffer): void => { if (output.length < limit) output += chunk.toString().slice(0, limit - output.length); };
      child.stdout.on("data", collect); child.stderr.on("data", collect);
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      child.once("error", (error) => { clearTimeout(timer); resolveResult({ outcome: "failed", detail: redact(error.message) }); });
      child.once("close", (code) => { clearTimeout(timer); resolveResult(timedOut ? { outcome: "blocked", detail: "Managed process exceeded its timeout and was cancelled." } : code === 0 ? { outcome: "passed", detail: redact(output || "Managed process completed.") } : { outcome: "failed", detail: redact(output || `Managed process exited ${code}.`) }); });
    });
  }
}

/** Pinned scanner fixtures require exact digest and freshness before they can inform a gate. */
export class ScannerFeedBroker {
  private readonly pinnedDigest: string; private readonly maxAgeMs: number;
  constructor(pinnedDigest: string, maxAgeMs = 24 * 60 * 60_000) { this.pinnedDigest = pinnedDigest; this.maxAgeMs = maxAgeMs; }
  ingest(contents: string, createdAt: number, now = Date.now()): AdapterResult {
    if (hash(contents) !== this.pinnedDigest) return { outcome: "blocked", detail: "Scanner feed signature or pinned digest does not match." };
    if (createdAt + this.maxAgeMs < now) return { outcome: "unavailable", detail: "Scanner feed is stale." };
    return { outcome: "passed", detail: "Pinned scanner feed is fresh and available." };
  }
}

export interface RawHidPacket { readonly deviceId: string; readonly epoch: string; readonly packet: Uint8Array; }
/** Software Raw-HID loopback with explicit reconnect epochs; hardware adapters implement the same event surface. */
export class RawHidLoopbackTransport {
  private readonly listeners = new Set<(packet: RawHidPacket) => void>(); private readonly epochs = new Map<string, string>();
  connect(deviceId: string): string { const epoch = randomUUID(); this.epochs.set(deviceId, epoch); return epoch; }
  disconnect(deviceId: string, epoch: string): boolean { if (this.epochs.get(deviceId) !== epoch) return false; this.epochs.delete(deviceId); return true; }
  onPacket(listener: (packet: RawHidPacket) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  send(deviceId: string, epoch: string, packet: Uint8Array): boolean { if (this.epochs.get(deviceId) !== epoch) return false; const frame = { deviceId, epoch, packet: new Uint8Array(packet) }; for (const listener of this.listeners) listener(frame); return true; }
}

/**
 * Concrete execution dispatcher.  Each settled chord gets a separately named
 * entry; a missing entry is a startup error rather than a generic route.
 */
export class LocalControlExecutionBroker implements ExecutionBroker {
  private readonly repository: LocalRepositoryBroker; private readonly tests: LocalTestEnvironmentBroker; private readonly provider?: ProviderSessionAdapter;
  private handlers?: ReadonlyMap<HandlerName, ConcreteHandler>;
  constructor(repository: LocalRepositoryBroker, tests: LocalTestEnvironmentBroker, provider?: ProviderSessionAdapter) { this.repository = repository; this.tests = tests; this.provider = provider; }
  private async agent(action: string, target: TargetSnapshot, request: DispatchRequest): Promise<AdapterResult> {
    if (!this.provider || !request.sessionId) return { outcome: "unavailable", detail: "No local managed-provider adapter is available for this agent control." };
    if (action === "REANCHOR:normal") return this.provider.pause(request.sessionId);
    if (action === "FIND_BLOCKED_AGENT:normal" || action === "FIND_FINISHED_AGENT:normal") return this.provider.focus(request.sessionId);
    const packet = { id: randomUUID(), target, task: action, planRevision: "local-control-v1", decisions: [], documentation: [], references: [], digest: hash({ action, target: target.digest }) };
    return this.provider.injectContext(request.sessionId, packet);
  }
  private unavailable(name: HandlerName): AdapterResult { return { outcome: "unavailable", detail: `${name} validated the selected session and target, created a durable operation, and invoked no unavailable desktop/provider adapter.` }; }
  private async status(target: TargetSnapshot): Promise<AdapterResult> { const state = await this.repository.status(target); return { outcome: "passed", detail: `Branch ${state.branch}, ${state.porcelain.length} worktree changes.` }; }
  private async scan(target: TargetSnapshot): Promise<AdapterResult> { const state = await this.repository.status(target); const matches = state.diff.match(/(?:api[_-]?key|password|secret|token)\s*[:=]/gi) ?? []; return matches.length ? { outcome: "failed", detail: `Local secret-pattern scan found ${matches.length} potential match(es).` } : { outcome: "passed", detail: "Local tracked-diff secret-pattern scan found no matches." }; }
  private catalog(): ReadonlyMap<HandlerName, ConcreteHandler> {
    const named = (action: string, execute: (target: TargetSnapshot, request: DispatchRequest) => Promise<AdapterResult>): ConcreteHandler => ({ name: `b122.${action}` as HandlerName, execute });
    const agent = (action: string) => named(action, (target, request) => this.agent(action, target, request));
    const unavailable = (action: string) => named(action, async () => this.unavailable(`b122.${action}` as HandlerName));
    const entries: ConcreteHandler[] = [
      agent("REANCHOR:normal"), agent("PROOF:normal"), agent("PROOF:shift"), agent("OPTION_PROVIDER:normal"), agent("OPTION_PROVIDER:shift"), agent("PLAN_EXPANDER:normal"), agent("PLAN_APPROVAL:normal"), agent("HANDOFF:normal"), agent("HANDOFF:shift"),
      unavailable("HANDOFF:alt"), unavailable("HANDOFF:shift_alt"), agent("FIND_BLOCKED_AGENT:normal"), unavailable("FIND_BLOCKED_AGENT:shift"), agent("FIND_FINISHED_AGENT:normal"), unavailable("FIND_FINISHED_AGENT:shift"), agent("AUTHORITY_REFRESH:normal"), agent("AUTHORITY_REFRESH:shift"), agent("COUNCIL:normal"), unavailable("COUNCIL:shift"), agent("COUNCIL:alt"),
      unavailable("CLAUDE:normal"), unavailable("CLAUDE:shift"), agent("CLAUDE:alt"), unavailable("CHATGPT:normal"), unavailable("CHATGPT:shift"), agent("CHATGPT:alt"), unavailable("VSCODE:normal"), unavailable("VSCODE:shift"), unavailable("TERMINAL:normal"), unavailable("TERMINAL:shift"),
      named("COMMIT:normal", (target, request) => this.repository.commit(target, typeof (request as { commitMessage?: unknown }).commitMessage === "string" ? (request as { commitMessage: string }).commitMessage : "", (request as { reviewApproval?: ReviewApproval }).reviewApproval)), named("COMMIT:shift", (target, request) => this.repository.push(target, (request as { reviewApproval?: ReviewApproval }).reviewApproval)), unavailable("COMMIT:alt"), unavailable("COMMIT:shift_alt"),
      unavailable("GITHUB:normal"), unavailable("GITHUB:shift"), unavailable("GITHUB:alt"), unavailable("GITHUB:shift_alt"), unavailable("COMPOUND:normal"), unavailable("COMPOUND:shift"), unavailable("COMPOUND:alt"), unavailable("COMPOUND:shift_alt"),
      unavailable("RUN:normal"), unavailable("RUN:shift"), unavailable("RUN:alt"), unavailable("RUN:shift_alt"), unavailable("VOICE:normal"), unavailable("VOICE:shift"), unavailable("VOICE:alt"), unavailable("VOICE:shift_alt"),
      named("PIPELINE:normal", (target) => this.status(target)), named("PIPELINE:shift", (target) => this.tests.run(target)), unavailable("PIPELINE:alt"), named("PIPELINE:shift_alt", (target) => this.tests.run(target)), unavailable("PIPELINE:ctrl_shift_alt"),
      named("SHIELD:normal", (target) => this.scan(target)), named("SHIELD:shift", (target) => this.scan(target)), unavailable("SHIELD:alt"), unavailable("SHIELD:shift_alt"), unavailable("SHIELD:ctrl_shift_alt"),
      unavailable("SANDBOX:normal"), unavailable("SANDBOX:shift"), unavailable("SANDBOX:alt"), unavailable("SANDBOX:shift_alt"), unavailable("SANDBOX:ctrl_shift_alt")
    ];
    const map = new Map(entries.map((item) => [item.name, item]));
    for (const assignment of assignments) if (!map.has(assignment.handler)) throw new Error(`No concrete handler is registered for ${assignment.handler}.`);
    return map;
  }
  async execute(action: string, target: TargetSnapshot, request: DispatchRequest): Promise<AdapterResult> {
    const [control, modifier] = action.split(":"); const handler = handlerFor(control as Parameters<typeof handlerFor>[0], modifier as Parameters<typeof handlerFor>[1]);
    const catalog = this.handlers ?? (this.handlers = this.catalog()); const concrete = catalog.get(handler);
    if (!concrete) return { outcome: "blocked", detail: `No named concrete handler is registered for ${handler}.` };
    return concrete.execute(target, request);
  }
}
