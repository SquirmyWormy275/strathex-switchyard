import { randomUUID } from "node:crypto";
import type { AuthorityGrant, ManagedSession, TargetSnapshot } from "./contracts.ts";
import type { CommandAction } from "./command-catalog.ts";
import type { ContainmentChannel } from "./containment.ts";
import type { ExecutionControl } from "./execution-control.ts";
import type { ChildOperationSaga } from "./operations.ts";
import { redactRecord, untrustedSummary } from "./redaction.ts";
import type { PermitBinding, PolicyPermit } from "./policy.ts";
import { validateRecipe, type RepositoryRecipe } from "./recipes.ts";

export type BrokerStatus = "running" | "completed" | "failed" | "unavailable" | "blocked" | "incomplete" | "cancelled" | "timed_out";
export interface BrokerOutcome {
  readonly status: BrokerStatus;
  readonly summary: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface BrokerInvocation {
  readonly action: CommandAction;
  readonly operationId: string;
  readonly target: TargetSnapshot;
  readonly session?: ManagedSession;
  readonly authority?: AuthorityGrant;
  readonly permit?: PolicyPermit;
  /** Cooperative deadline/cancellation; real adapters must observe it before each external effect. */
  readonly executionControl?: ExecutionControl;
  /** Present only for a scoped composite dispatch; broker handlers must settle or leave it ambiguous. */
  readonly childSaga?: ChildOperationSaga;
  /**
   * A host-owned final barrier.  Durable admission checks the target before a
   * saga begins; a concrete broker checks this again immediately before its
   * own effect so a stale snapshot cannot cross a delayed handler boundary.
   */
  readonly effectGuard?: EffectGuard;
}

export interface PermitVerifier {
  verifyPermit(permit: PolicyPermit | undefined, binding: PermitBinding): boolean;
}

export interface ContainmentGuard {
  check(repositoryRoot: string, channel: ContainmentChannel): MaybePromise<{ readonly allowed: boolean; readonly reason: string }>;
}

export interface EffectGuard {
  assertCurrent(input: Readonly<{
    action: CommandAction;
    operationId: string;
    target: TargetSnapshot;
    session?: ManagedSession;
    authority?: AuthorityGrant;
  }>): MaybePromise<{ readonly allowed: boolean; readonly reason: string }>;
}

type MaybePromise<T> = T | Promise<T>;

async function permitted(policy: PermitVerifier, invocation: BrokerInvocation): Promise<BrokerOutcome | undefined> {
  if (invocation.executionControl && Date.parse(invocation.executionControl.deadline) <= Date.now()) {
    return { status: "timed_out", summary: "Broker refused an invocation whose durable deadline has already elapsed." };
  }
  if (invocation.executionControl && await invocation.executionControl.isCancellationRequested()) {
    return { status: "cancelled", summary: "Broker refused an invocation after durable cancellation was requested." };
  }
  if (!policy.verifyPermit(invocation.permit, {
    action: invocation.action,
    operationId: invocation.operationId,
    targetSnapshotId: invocation.target.id,
    ...(invocation.session ? { sessionId: invocation.session.id } : {}),
    ...(invocation.authority ? { authorityId: invocation.authority.id } : {})
  })) {
    return { status: "blocked", summary: "Broker denied an absent, expired, forged, or mismatched policy permit." };
  }
  if (invocation.effectGuard) {
    const result = await invocation.effectGuard.assertCurrent({
      action: invocation.action,
      operationId: invocation.operationId,
      target: invocation.target,
      ...(invocation.session ? { session: invocation.session } : {}),
      ...(invocation.authority ? { authority: invocation.authority } : {})
    });
    if (!result.allowed) return { status: "incomplete", summary: result.reason };
  }
  return undefined;
}

async function fenced(containment: ContainmentGuard | undefined, invocation: BrokerInvocation, channel: ContainmentChannel): Promise<BrokerOutcome | undefined> {
  const result = containment ? await containment.check(invocation.target.repositoryRoot, channel) : undefined;
  return result && !result.allowed ? { status: "blocked", summary: result.reason } : undefined;
}

function redacted(outcome: BrokerOutcome): BrokerOutcome {
  return {
    ...outcome,
    summary: untrustedSummary(outcome.summary),
    data: outcome.data ? redactRecord(outcome.data) : undefined
  };
}

export interface ExecutionRecipe {
  readonly id: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
}

export interface ExecutionRequest extends BrokerInvocation {
  readonly recipe: ExecutionRecipe;
}

/** Runtime boundary for an allowlisted structured executor. */
export interface ExecutionBroker { execute(request: ExecutionRequest): Promise<BrokerOutcome>; }

export type ExecutionHandler = (request: ExecutionRequest) => MaybePromise<BrokerOutcome>;

/**
 * A deliberately non-shell execution broker. It only invokes test/local
 * handlers that were registered by the trusted host; it never calls a shell
 * or inherits environment credentials on its own.
 */
export class InMemoryExecutionBroker {
  private readonly handlers = new Map<string, ExecutionHandler>();
  private readonly policy: PermitVerifier;
  private readonly containment?: ContainmentGuard;

  constructor(policy: PermitVerifier, containment?: ContainmentGuard) {
    this.policy = policy;
    this.containment = containment;
  }

  register(recipeId: string, handler: ExecutionHandler): void {
    this.handlers.set(recipeId, handler);
  }

  async execute(request: ExecutionRequest): Promise<BrokerOutcome> {
    const denial = await permitted(this.policy, request);
    if (denial) return denial;
    const fence = await fenced(this.containment, request, "execution");
    if (fence) return fence;
    const validation = validateExecutionRecipe(request);
    if (validation) return validation;
    const handler = this.handlers.get(request.recipe.id);
    if (!handler) return { status: "unavailable", summary: `No trusted execution handler is registered for recipe ${request.recipe.id}.` };
    return redacted(await handler(request));
  }
}

function validateExecutionRecipe(request: ExecutionRequest): BrokerOutcome | undefined {
  const unknownRequest = request as unknown as Readonly<Record<string, unknown>>;
  if ("shell" in unknownRequest || "command" in unknownRequest) {
    return { status: "blocked", summary: "Execution broker accepts structured executable/args only; shell command strings are forbidden." };
  }
  const recipe = request.recipe;
  if (!recipe.id || !recipe.executable || /[\r\n\0;]/.test(recipe.executable)) {
    return { status: "blocked", summary: "Execution recipe has an invalid executable." };
  }
  if (recipe.args.some((arg) => /[\r\n\0]/.test(arg))) {
    return { status: "blocked", summary: "Execution recipe contains an unsafe argument." };
  }
  if (normalisePath(recipe.workingDirectory) !== normalisePath(request.target.repositoryRoot)) {
    return { status: "blocked", summary: "Execution recipe working directory does not match the verified target root." };
  }
  return undefined;
}

function normalisePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export type GitMutation =
  | { readonly kind: "local_commit"; readonly paths: readonly string[]; readonly message: string }
  | { readonly kind: "pr_upsert"; readonly headBranch: string; readonly baseBranch: string }
  | { readonly kind: "merge_pr"; readonly pullRequest: number; readonly head: string; readonly baseBranch: string }
  | { readonly kind: "direct_main"; readonly branch: string; readonly validationReceiptId: string };

export interface GitRequest extends BrokerInvocation {
  readonly mutation: GitMutation;
}
/** Runtime boundary for a reviewed, typed Git mutation broker. */
export interface GitBroker { execute(request: GitRequest): Promise<BrokerOutcome>; }
export type GitHandler = (request: GitRequest) => MaybePromise<BrokerOutcome>;

const actionForGitMutation: Readonly<Record<GitMutation["kind"], CommandAction>> = {
  local_commit: "local_commit",
  pr_upsert: "pr_upsert",
  merge_pr: "pr_merge",
  direct_main: "direct_main"
};

/** Typed Git mediation with no `git` subprocess, force option, or implicit push. */
export class InMemoryGitBroker {
  private readonly handlers = new Map<GitMutation["kind"], GitHandler>();
  private readonly policy: PermitVerifier;
  private readonly containment?: ContainmentGuard;

  constructor(policy: PermitVerifier, containment?: ContainmentGuard) {
    this.policy = policy;
    this.containment = containment;
  }

  register(kind: GitMutation["kind"], handler: GitHandler): void {
    this.handlers.set(kind, handler);
  }

  async execute(request: GitRequest): Promise<BrokerOutcome> {
    const denial = await permitted(this.policy, request);
    if (denial) return denial;
    const unknownMutation = request.mutation as unknown as Readonly<Record<string, unknown>>;
    if ("force" in unknownMutation || "forceWithLease" in unknownMutation) {
      return { status: "blocked", summary: "Force-push semantics are never accepted by the B122 Git broker." };
    }
    if (actionForGitMutation[request.mutation.kind] !== request.action) {
      return { status: "blocked", summary: "Git mutation kind does not match the policy-authorized command action." };
    }
    if (!validGitMutation(request.mutation)) return { status: "blocked", summary: "Git request omits an exact branch, head, receipt, or owned path requirement." };
    const ownership = validateLocalCommitOwnership(request);
    if (ownership) return { status: "blocked", summary: ownership };
    // Containment includes a local commit: it must not be used as an escape
    // route when an incident fence was activated after policy admission.
    const fence = await fenced(this.containment, request, "git");
    if (fence) return fence;
    const handler = this.handlers.get(request.mutation.kind);
    if (!handler) return { status: "unavailable", summary: `No trusted Git adapter is registered for ${request.mutation.kind}.` };
    return redacted(await handler(request));
  }
}

function validGitMutation(mutation: GitMutation): boolean {
  switch (mutation.kind) {
    case "local_commit": return mutation.paths.length > 0 && !!mutation.message.trim();
    case "pr_upsert": return !!mutation.headBranch && !!mutation.baseBranch;
    case "merge_pr": return mutation.pullRequest > 0 && !!mutation.head && !!mutation.baseBranch;
    case "direct_main": return !!mutation.branch && !!mutation.validationReceiptId;
  }
}

function validateLocalCommitOwnership(request: GitRequest): string | undefined {
  if (request.mutation.kind !== "local_commit") return undefined;
  const { session, authority, mutation } = request;
  if (!session?.taskId?.trim()) return "Local commit requires a selected task-owned mediated session.";
  if (!authority?.taskId || authority.taskId !== session.taskId || authority.planRevision !== session.planRevision) {
    return "Local commit authority does not match the selected task and plan revision.";
  }
  const allowed = new Set<string>();
  for (const path of session.plannedFiles) {
    const normalized = canonicalRepositoryPath(path);
    if (!normalized) return "The session has an invalid task-owned path grant.";
    allowed.add(normalized);
  }
  if (allowed.size === 0) return "Local commit requires at least one task-owned path grant.";
  const requested = new Set<string>();
  for (const path of mutation.paths) {
    const normalized = canonicalRepositoryPath(path);
    if (!normalized) return "Local commit contains an unsafe repository-relative path.";
    if (requested.has(normalized)) return "Local commit repeats a repository path after canonicalization.";
    if (!allowed.has(normalized)) return "Local commit requested a path outside the selected task-owned grant.";
    requested.add(normalized);
  }
  return undefined;
}

/** Reject absolute, traversal, Git-internal, and platform-aliasing paths. */
export function canonicalRepositoryPath(value: string): string | undefined {
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/.test(value)) return undefined;
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (/^(?:[A-Za-z]:)?\//.test(normalized)) return undefined;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return undefined;
  if (parts[0]?.toLowerCase() === ".git") return undefined;
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export interface CredentialRegistration {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly actions: readonly CommandAction[];
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  /** Kept private by the broker and never returned through a lease. */
  readonly material: string;
}
export interface CredentialRequest extends BrokerInvocation { readonly scope: string; }
export interface CredentialLease {
  readonly id: string;
  readonly credentialId: string;
  readonly handle: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}
export interface CredentialOutcome extends BrokerOutcome { readonly lease?: CredentialLease; }
export interface CredentialBroker { acquire(request: CredentialRequest): Promise<CredentialOutcome>; }

/** Supplies opaque, action-scoped leases rather than raw credentials. */
export class InMemoryCredentialBroker {
  private readonly credentials = new Map<string, CredentialRegistration>();
  private readonly policy: PermitVerifier;
  private readonly containment?: ContainmentGuard;

  constructor(policy: PermitVerifier, containment?: ContainmentGuard) {
    this.policy = policy;
    this.containment = containment;
  }

  register(credential: CredentialRegistration): void {
    this.credentials.set(credential.id, credential);
  }

  async acquire(request: CredentialRequest): Promise<CredentialOutcome> {
    const denial = await permitted(this.policy, request);
    if (denial) return denial;
    const fence = await fenced(this.containment, request, "credential");
    if (fence) return fence;
    const credential = [...this.credentials.values()].find((candidate) =>
      candidate.repositoryRoot === request.target.repositoryRoot
      && candidate.actions.includes(request.action)
      && candidate.scopes.includes(request.scope)
      && new Date(candidate.expiresAt).getTime() > Date.now());
    if (!credential) return { status: "unavailable", summary: "No current credential is scoped to this repository, action, and requested capability." };
    const lease: CredentialLease = {
      id: randomUUID(),
      credentialId: credential.id,
      handle: `credential-lease:${randomUUID()}`,
      scopes: [request.scope],
      expiresAt: credential.expiresAt
    };
    return { status: "completed", summary: "Issued an opaque scoped credential lease.", lease, data: { credentialId: credential.id, scope: request.scope, expiresAt: credential.expiresAt } };
  }
}

export interface NetworkRequest extends BrokerInvocation {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly url: string;
  readonly allowedHosts: readonly string[];
}
export interface NetworkResponse { readonly statusCode: number; readonly body: string; }
export interface NetworkOutcome extends BrokerOutcome { readonly response?: NetworkResponse; }
export interface NetworkBroker { request(request: NetworkRequest): Promise<NetworkOutcome>; }

/** No-fetch network mock. It is allowlisted and test-addressable only. */
export class InMemoryNetworkBroker {
  private readonly responses = new Map<string, NetworkResponse>();
  private readonly policy: PermitVerifier;
  private readonly containment?: ContainmentGuard;

  constructor(policy: PermitVerifier, containment?: ContainmentGuard) {
    this.policy = policy;
    this.containment = containment;
  }

  respond(method: NetworkRequest["method"], url: string, response: NetworkResponse): void {
    this.responses.set(`${method}:${url}`, response);
  }

  async request(request: NetworkRequest): Promise<NetworkOutcome> {
    const denial = await permitted(this.policy, request);
    if (denial) return denial;
    const fence = await fenced(this.containment, request, "network");
    if (fence) return fence;
    const parsed = safeUrl(request.url);
    if (!parsed) return { status: "blocked", summary: "Network broker rejected an invalid URL." };
    const host = parsed.hostname.toLowerCase();
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if ((parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) || !request.allowedHosts.map((item) => item.toLowerCase()).includes(host)) {
      return { status: "blocked", summary: "Network broker rejected a non-allowlisted or unsafe URL." };
    }
    const response = this.responses.get(`${request.method}:${request.url}`);
    if (!response) return { status: "unavailable", summary: "No trusted local response is registered for this network request." };
    return { status: "completed", summary: "Completed an allowlisted in-memory network exchange.", response: { ...response, body: untrustedSummary(response.body) }, data: { statusCode: response.statusCode } };
  }
}

function safeUrl(value: string): URL | undefined {
  try { return new URL(value); } catch { return undefined; }
}

export interface TestEnvironmentRequest extends BrokerInvocation {
  readonly recipe: RepositoryRecipe;
  readonly sourceEnvironment: Readonly<Record<string, string | undefined>>;
}
export interface TestEnvironment {
  readonly id: string;
  readonly tempRoot: string;
  readonly databaseName: string;
  readonly egress: "deny";
  readonly environment: Readonly<Record<string, string>>;
}
export interface TestEnvironmentOutcome extends BrokerOutcome { readonly environment?: TestEnvironment; }
export interface TestEnvironmentBroker { prepare(request: TestEnvironmentRequest): Promise<TestEnvironmentOutcome>; }

/** Allocates metadata-only disposable test environments; it never opens a database or inherits process.env. */
export class InMemoryTestEnvironmentBroker {
  private nextId = 1;
  private readonly policy: PermitVerifier;
  private readonly containment?: ContainmentGuard;

  constructor(policy: PermitVerifier, containment?: ContainmentGuard) {
    this.policy = policy;
    this.containment = containment;
  }

  async prepare(request: TestEnvironmentRequest): Promise<TestEnvironmentOutcome> {
    const denial = await permitted(this.policy, request);
    if (denial) return denial;
    const fence = await fenced(this.containment, request, "test_environment");
    if (fence) return fence;
    const validation = validateRecipe(request.recipe);
    if (!validation.valid) return { status: "unavailable", summary: `Test recipe is incomplete: ${validation.errors.join(" ")}` };
    if (normalisePath(request.recipe.repositoryRoot) !== normalisePath(request.target.repositoryRoot)) {
      return { status: "blocked", summary: "Test recipe repository does not match the verified target." };
    }
    const production = findProductionInput(request.sourceEnvironment, request.recipe.productionHostPatterns);
    if (production) return { status: "blocked", summary: "Test environment rejected a production host, DSN, or production-mode input." };
    const id = `test-${this.nextId++}`;
    const environment: Record<string, string> = { NODE_ENV: "test", SXSY_TEST_DATABASE: `sxsy_test_${id}` };
    for (const key of request.recipe.environmentAllowlist) {
      const value = request.sourceEnvironment[key];
      if (value !== undefined && !sensitiveName(key)) environment[key] = value;
    }
    const testEnvironment: TestEnvironment = {
      id,
      tempRoot: `${request.target.repositoryRoot.replace(/[\\/]$/, "")}/.sxsy-test/${id}`,
      databaseName: `sxsy_test_${id}`,
      egress: "deny",
      environment
    };
    // No network or credential lease is allocated here. An explicit broker must
    // request one after this safe, deny-egress environment exists.
    return { status: "completed", summary: "Prepared a disposable, deny-egress test environment descriptor.", environment: testEnvironment };
  }
}

function findProductionInput(environment: Readonly<Record<string, string | undefined>>, patterns: readonly string[]): boolean {
  return Object.entries(environment).some(([key, value]) => {
    if (!value) return /^(NODE_ENV|APP_ENV)$/i.test(key) && /production/i.test(value ?? "");
    const lowered = value.toLowerCase();
    return (/^(NODE_ENV|APP_ENV)$/i.test(key) && lowered === "production")
      || patterns.some((pattern) => lowered.includes(pattern.toLowerCase()));
  });
}

function sensitiveName(key: string): boolean {
  return /(password|secret|token|credential|api[_-]?key)/i.test(key);
}

export interface IsolationRequest extends BrokerInvocation {
  readonly profile: "full_sandbox" | "rebuild_full_sandbox" | "quarantine";
}
export interface IsolationRuntime { start(request: IsolationRequest): Promise<BrokerOutcome>; }

/** Safe default: a `.venv` is not represented as a full sandbox or quarantine. */
export class UnavailableIsolationRuntime implements IsolationRuntime {
  private readonly policy: PermitVerifier;
  private readonly containment?: ContainmentGuard;
  constructor(policy: PermitVerifier, containment?: ContainmentGuard) { this.policy = policy; this.containment = containment; }
  async start(request: IsolationRequest): Promise<BrokerOutcome> {
    const denial = await permitted(this.policy, request);
    if (denial) return denial;
    const fence = await fenced(this.containment, request, "isolation");
    if (fence) return fence;
    return { status: "unavailable", summary: `${request.profile} has no proven isolation backend; refusing to claim enforcement.` };
  }
}

/** Explicit test harness only; its result says simulated and never claims host isolation. */
export class InMemoryIsolationRuntime implements IsolationRuntime {
  private readonly policy: PermitVerifier;
  private readonly containment?: ContainmentGuard;
  constructor(policy: PermitVerifier, containment?: ContainmentGuard) { this.policy = policy; this.containment = containment; }
  async start(request: IsolationRequest): Promise<BrokerOutcome> {
    const denial = await permitted(this.policy, request);
    if (denial) return denial;
    const fence = await fenced(this.containment, request, "isolation");
    if (fence) return fence;
    return { status: "completed", summary: `Simulated ${request.profile} in the test harness; no host enforcement claim is made.`, data: { simulated: true, profile: request.profile } };
  }
}

export interface AutomationRequest extends BrokerInvocation {
  readonly testEnvironment?: TestEnvironment;
}
export interface AutomationBroker { execute(request: AutomationRequest): Promise<BrokerOutcome>; }
export type AutomationHandler = (request: AutomationRequest) => MaybePromise<BrokerOutcome>;

/** Models provider/Compound automation but has no external adapter unless one is explicitly registered. */
export class InMemoryAutomationBroker {
  private readonly handlers = new Map<CommandAction, AutomationHandler>();
  private readonly policy: PermitVerifier;
  private readonly containment?: ContainmentGuard;

  constructor(policy: PermitVerifier, containment?: ContainmentGuard) {
    this.policy = policy;
    this.containment = containment;
  }

  register(action: CommandAction, handler: AutomationHandler): void {
    this.handlers.set(action, handler);
  }

  async execute(request: AutomationRequest): Promise<BrokerOutcome> {
    const denial = await permitted(this.policy, request);
    if (denial) return denial;
    // All automated routes are fenced.  A non-LFG workflow must not become a
    // containment bypass merely because it was classified as local learning.
    const fence = await fenced(this.containment, request, "automation");
    if (fence) return fence;
    const handler = this.handlers.get(request.action);
    if (!handler) return { status: "unavailable", summary: `No trusted automation adapter is registered for ${request.action}; no prompt or workflow was submitted.` };
    return redacted(await handler(request));
  }
}
