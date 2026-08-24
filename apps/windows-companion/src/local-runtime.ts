/**
 * Concrete local-only runtime pieces for the B122 companion.  They deliberately
 * use structured child-process calls rather than a shell: callers cannot turn a
 * repository field, path, or repository document into executable syntax.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createServer, connect, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { AdapterResult, DispatchRequest, ExecutionBroker, ManagedSession, ProviderSessionAdapter, TargetSnapshot, TestEnvironmentBroker, ContextPackage } from "./control-plane.ts";
import { captureTargetSnapshot, redact } from "./control-plane.ts";

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
/** Real local Git mediation.  It never invokes a shell and revalidates state just before a mutation. */
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
    const denial = await this.mutationGuard("COMMIT:normal", target, approval); if (denial) return { outcome: "blocked", detail: denial };
    if (!message.trim()) return { outcome: "blocked", detail: "A non-empty reviewed commit message is required." };
    if (!target.branch || target.branch === "main" || target.branch === "master") return { outcome: "blocked", detail: "Local commits require an isolated feature branch; the broker will not commit on a default or detached branch." };
    const root = await this.rootFor(target); const result = await run("git", ["commit", "-m", message], root);
    return result.code === 0 ? { outcome: "passed", detail: "Local commit completed after exact-target revalidation.", externalReference: await git(root, ["rev-parse", "HEAD"]) } : { outcome: "failed", detail: redact(result.stderr || result.stdout) };
  }
  async push(target: TargetSnapshot, approval?: ReviewApproval): Promise<AdapterResult> {
    if (this.policy.push !== "reviewed") return { outcome: "blocked", detail: "Policy forbids network push." };
    if (!target.branch || target.branch === "main" || target.branch === "master") return { outcome: "blocked", detail: "PR upsert requires an isolated feature branch; the broker will not push a default or detached branch." };
    const denial = await this.mutationGuard("COMMIT:shift", target, approval); if (denial) return { outcome: "blocked", detail: denial };
    const root = await this.rootFor(target); const result = await run("git", ["push"], root);
    return result.code === 0 ? { outcome: "passed", detail: "Push completed after explicit review.", externalReference: "git-push" } : { outcome: "failed", detail: redact(result.stderr || result.stdout) };
  }
  async merge(target: TargetSnapshot, source: string, approval?: ReviewApproval): Promise<AdapterResult> {
    if (this.policy.directMain !== "reviewed" || target.branch === "main") return { outcome: "blocked", detail: "Direct-main merge is prohibited by the local policy." };
    if (!/^[A-Za-z0-9._/-]+$/.test(source)) return { outcome: "blocked", detail: "The requested merge source is not a valid ref name." };
    const denial = await this.mutationGuard("COMMIT:alt", target, approval); if (denial) return { outcome: "blocked", detail: denial };
    const result = await run("git", ["merge", "--no-ff", "--no-edit", source], await this.rootFor(target));
    return result.code === 0 ? { outcome: "passed", detail: "Reviewed merge completed." } : { outcome: "failed", detail: redact(result.stderr || result.stdout) };
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

interface IpcEnvelope { token: string; id: string; method: string; params?: unknown; }
export interface IpcResponse { id: string; ok: boolean; result?: unknown; error?: string; }
export interface CompanionConfiguration { stateDirectory: string; ipcPath: string; token: string; startup: "manual" | "login"; }
export async function createCompanionConfiguration(stateDirectory: string): Promise<CompanionConfiguration> { await mkdir(stateDirectory, { recursive: true }); const path = join(stateDirectory, "config.json"); try { return JSON.parse(await readFile(path, "utf8")) as CompanionConfiguration; } catch { const config = { stateDirectory, ipcPath: process.platform === "win32" ? `\\\\.\\pipe\\sxsy-b122-${hash(stateDirectory).slice(0, 16)}` : join(stateDirectory, "companion.sock"), token: randomBytes(32).toString("hex"), startup: "manual" as const }; await writeFile(path, JSON.stringify(config), { mode: 0o600 }); return config; } }
/** Authenticated local IPC with newline-framed JSON.  No TCP listener is ever opened. */
export class CompanionIpcServer {
  private server?: Server;
  private readonly configuration: CompanionConfiguration; private readonly handle: (method: string, params: unknown) => Promise<unknown>;
  constructor(configuration: CompanionConfiguration, handle: (method: string, params: unknown) => Promise<unknown>) { this.configuration = configuration; this.handle = handle; }
  async start(): Promise<void> { if (process.platform !== "win32") await unlink(this.configuration.ipcPath).catch(() => undefined); this.server = createServer((socket) => this.accept(socket)); await new Promise<void>((done, fail) => { this.server!.once("error", fail); this.server!.listen(this.configuration.ipcPath, done); }); }
  private accept(socket: Socket): void { let pending = ""; socket.on("data", async (chunk) => { pending += chunk.toString(); let line: string | undefined; while ((line = pending.indexOf("\n") >= 0 ? pending.slice(0, pending.indexOf("\n")) : undefined) !== undefined) { pending = pending.slice(line.length + 1); let response: IpcResponse; try { const request = JSON.parse(line) as IpcEnvelope; if (request.token !== this.configuration.token) throw new Error("IPC authentication failed."); response = { id: request.id, ok: true, result: await this.handle(request.method, request.params) }; } catch (error) { response = { id: "unknown", ok: false, error: redact((error as Error).message) }; } socket.write(`${JSON.stringify(response)}\n`); } }); }
  async stop(): Promise<void> { if (this.server) await new Promise<void>((done, fail) => this.server!.close((error) => error ? fail(error) : done())); if (process.platform !== "win32") await unlink(this.configuration.ipcPath).catch(() => undefined); }
}
export async function callCompanion(configuration: CompanionConfiguration, method: string, params?: unknown): Promise<IpcResponse> { return new Promise((done, fail) => { const socket = connect(configuration.ipcPath); let data = ""; socket.once("error", fail); socket.on("data", (chunk) => { data += chunk.toString(); if (data.includes("\n")) { socket.end(); done(JSON.parse(data) as IpcResponse); } }); socket.once("connect", () => socket.write(`${JSON.stringify({ token: configuration.token, id: randomUUID(), method, params })}\n`)); }); }

/** Concrete execution dispatcher for safe local commands. Unsupported host UI and proprietary calls stay explicit. */
export class LocalControlExecutionBroker implements ExecutionBroker {
  private readonly repository: LocalRepositoryBroker; private readonly tests: LocalTestEnvironmentBroker; private readonly provider?: ProviderSessionAdapter;
  constructor(repository: LocalRepositoryBroker, tests: LocalTestEnvironmentBroker, provider?: ProviderSessionAdapter) { this.repository = repository; this.tests = tests; this.provider = provider; }
  private async agent(action: string, target: TargetSnapshot, request: DispatchRequest): Promise<AdapterResult> {
    if (!this.provider || !request.sessionId) return { outcome: "unavailable", detail: "No local managed-provider adapter is available for this agent control." };
    if (action === "REANCHOR:normal") return this.provider.pause(request.sessionId);
    if (action === "FIND_BLOCKED_AGENT:normal" || action === "FIND_FINISHED_AGENT:normal") return this.provider.focus(request.sessionId);
    const packet = { id: randomUUID(), target, task: action, planRevision: "local-control-v1", decisions: [], documentation: [], references: [], digest: hash({ action, target: target.digest }) };
    return this.provider.injectContext(request.sessionId, packet);
  }
  async execute(action: string, target: TargetSnapshot, request: DispatchRequest): Promise<AdapterResult> {
    if (["REANCHOR:normal", "PROOF:normal", "PROOF:shift", "OPTION_PROVIDER:normal", "OPTION_PROVIDER:shift", "PLAN_EXPANDER:normal", "PLAN_APPROVAL:normal", "HANDOFF:normal", "HANDOFF:shift", "FIND_BLOCKED_AGENT:normal", "FIND_FINISHED_AGENT:normal", "AUTHORITY_REFRESH:normal", "AUTHORITY_REFRESH:shift", "COUNCIL:normal", "COUNCIL:alt"].includes(action)) return this.agent(action, target, request);
    if (action === "PIPELINE:shift" || action === "PIPELINE:shift_alt") return this.tests.run(target);
    if (action === "PIPELINE:normal") { const status = await this.repository.status(target); return { outcome: "passed", detail: `Branch ${status.branch}, ${status.porcelain.length} worktree changes.` }; }
    if (action === "SHIELD:normal" || action === "SHIELD:shift") { const status = await this.repository.status(target); const suspicious = status.diff.match(/(?:api[_-]?key|password|secret|token)\s*[:=]/gi) ?? []; return suspicious.length ? { outcome: "failed", detail: `Local secret-pattern scan found ${suspicious.length} potential match(es).` } : { outcome: "passed", detail: "Local tracked-diff secret-pattern scan found no matches." }; }
    if (action === "COMMIT:normal") return this.repository.commit(target, typeof (request as { commitMessage?: unknown }).commitMessage === "string" ? (request as { commitMessage: string }).commitMessage : "", (request as { reviewApproval?: ReviewApproval }).reviewApproval);
    if (action === "COMMIT:shift") return this.repository.push(target, (request as { reviewApproval?: ReviewApproval }).reviewApproval);
    return { outcome: "unavailable", detail: `No local implementation is configured for ${action}; provider/UI/network automation remains unavailable.` };
  }
}
