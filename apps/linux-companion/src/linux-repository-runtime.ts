import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { OperationControllerObservation } from "../../../packages/control-plane/src/runtime.ts";
import type { BrokerOutcome, ExecutionRequest, IsolationRequest } from "../../../packages/control-plane/src/brokers.ts";
import type {
  RepositoryExecutionRootLease,
  RepositoryExecutionRootProvider,
  RepositoryProcessObservationRequest,
  RepositoryProcessRecoveryScope,
  RepositoryProcessStartRequest,
  RepositoryProcessSupervisor,
  RepositorySupervisedProcess,
  RepositoryRuntimeAction
} from "../../windows-companion/src/repository-runtime.ts";
import { createRepositoryRecipeEvidence, repositoryRuntimeExecutionRecipe, type RepositoryRecipeCoverage, type SandboxRepositoryRecipeRunner } from "../../windows-companion/src/repository-runtime-broker.ts";
import type { HostReceiptEvidenceIssuer } from "../../windows-companion/src/receipt-evidence.ts";
import type { DurableRepositoryRuntimeRegistry } from "../../windows-companion/src/runtime-registry.ts";
import type { ScannerFixtureResolver, VerifiedScannerFixture } from "../../windows-companion/src/scanner-fixtures.ts";

const bwrapPath = "/usr/bin/bwrap";
const maximumDisposableEntries = 100_000;
const maximumDisposableBytes = 2 * 1024 * 1024 * 1024;
const maximumDisposableCopyMs = 120_000;
const isolatedActions = new Set(["pipeline_local_gate", "pipeline_clean_reproduction", "shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"]);
const coverageByAction: Readonly<Record<string, readonly string[]>> = {
  pipeline_local_gate: ["correctness", "isolation", "production_data", "ambient_credentials"],
  pipeline_clean_reproduction: ["correctness", "reproduction", "isolation", "production_data", "ambient_credentials"],
  shield_change_scan: ["secrets", "pii", "security_defects"],
  shield_codebase_audit: ["secrets", "history", "insecure_paths", "permissions", "infrastructure"],
  shield_supply_chain: ["vulnerabilities", "licenses", "provenance", "sbom"],
  release_shield: ["secrets", "pii", "security_defects", "history", "insecure_paths", "permissions", "infrastructure", "vulnerabilities", "licenses", "provenance", "sbom", "isolation"]
};

/** Private, disposable repository copies used only by recipes that explicitly require them. */
export class LinuxDisposableExecutionRootProvider implements RepositoryExecutionRootProvider {
  private readonly root: string;
  constructor(stateDirectory: string) { this.root = resolve(stateDirectory, "repository-execution-roots"); }

  async prepare(input: Parameters<RepositoryExecutionRootProvider["prepare"]>[0]): Promise<RepositoryExecutionRootLease> {
    const repositoryRoot = await realpath(input.repositoryRoot);
    if (input.isolation === "repository") return { root: repositoryRoot, isolation: "repository", release: async () => undefined };
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(this.root);
    const token = `${createHash("sha256").update(repositoryRoot).digest("hex").slice(0, 24)}-${randomUUID()}`;
    const staging = join(canonicalRoot, `.staging-${token}`);
    const destination = join(canonicalRoot, token);
    let entries = 0; let bytes = 0; const deadline = Date.now() + maximumDisposableCopyMs;
    try {
      await cp(repositoryRoot, staging, {
        recursive: true,
        force: false,
        errorOnExist: true,
        verbatimSymlinks: true,
        filter: async (source) => {
          if (Date.now() > deadline) throw new Error("The disposable repository copy exceeded its time budget.");
          const suffix = relative(repositoryRoot, source);
          if (suffix === ".git" || suffix.startsWith(`.git${process.platform === "win32" ? "\\" : "/"}`)) return false;
          const metadata = await lstat(source);
          if (metadata.isSymbolicLink()) throw new Error("Disposable repository copies refuse symbolic links.");
          entries += 1; if (metadata.isFile()) bytes += metadata.size;
          if (entries > maximumDisposableEntries || bytes > maximumDisposableBytes) throw new Error("The disposable repository copy exceeded its file or byte budget.");
          return true;
        }
      });
      await rename(staging, destination);
      const canonical = await realpath(destination);
      if (!inside(canonicalRoot, canonical) || canonical === repositoryRoot) throw new Error("The Linux disposable execution root escaped its private state boundary.");
      return {
        root: canonical,
        isolation: "disposable",
        protections: { productionData: "denied", ambientCredentials: "denied" },
        release: async () => { if (inside(canonicalRoot, canonical)) await rm(canonical, { recursive: true, force: true }); }
      };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      await rm(destination, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
}

/** Wraps security and pipeline recipes in a deny-network Bubblewrap namespace. */
export class LinuxBubblewrapRepositoryProcessSupervisor implements RepositoryProcessSupervisor {
  constructor(private readonly inner: RepositoryProcessSupervisor) {}
  recover(scope: RepositoryProcessRecoveryScope): Promise<readonly RepositorySupervisedProcess[]> { return this.inner.recover(scope); }
  observeOperation(request: RepositoryProcessObservationRequest): Promise<OperationControllerObservation> { return this.inner.observeOperation(request); }

  async start(request: RepositoryProcessStartRequest): Promise<RepositorySupervisedProcess> {
    if (!isolatedActions.has(request.action)) return this.inner.start(request);
    if (!request.executionRoot || !request.isolation) throw new Error("The Linux sandboxed repository recipe has no exact execution-root binding.");
    const repositoryRoot = await realpath(request.repositoryRoot);
    const executionRoot = await realpath(request.executionRoot);
    const cwd = await realpath(request.cwd);
    if (!inside(executionRoot, cwd)) throw new Error("The Linux sandboxed recipe cwd escaped its execution root.");
    if (request.isolation === "disposable" ? executionRoot === repositoryRoot : executionRoot !== repositoryRoot) throw new Error("The Linux sandboxed recipe received a mismatched isolation root.");
    const executable = await realpath(request.executable);
    if (createHash("sha256").update(await readFile(executable)).digest("hex") !== request.executableSha256.toLowerCase()) throw new Error("The Linux sandboxed recipe executable changed before namespace launch.");
    const mappedCwd = mappedPath(executionRoot, cwd);
    const systemExecutable = ["/usr/", "/bin/", "/lib/", "/lib64/"].some((prefix) => executable.startsWith(prefix));
    const mappedExecutable = inside(executionRoot, executable) ? mappedPath(executionRoot, executable) : systemExecutable ? executable : "/b122-tool";
    const executableBind = mappedExecutable === "/b122-tool" ? ["--ro-bind", executable, mappedExecutable] : [];
    const mount = request.isolation === "disposable" ? "--bind" : "--ro-bind";
    const environment = Object.entries(request.environment).sort(([left], [right]) => left.localeCompare(right)).flatMap(([name, value]) => ["--setenv", name, value]);
    const args = [
      "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup-try", "--unshare-net",
      "--die-with-parent", "--new-session", "--clearenv", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin", "--ro-bind", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64", "--ro-bind", "/etc", "/etc",
      mount, executionRoot, "/workspace", ...executableBind, "--chdir", mappedCwd, ...environment, mappedExecutable, ...request.args
    ];
    const bwrap = await realpath(bwrapPath);
    if (bwrap !== bwrapPath || !(await lstat(bwrap)).isFile()) throw new Error("The fixed Linux Bubblewrap executable is unavailable.");
    return this.inner.start({
      ...request,
      executable: bwrap,
      executableSha256: createHash("sha256").update(await readFile(bwrap)).digest("hex"),
      args,
      cwd: executionRoot,
      environment: { PATH: "/usr/bin:/bin" }
    });
  }
}

interface LinuxRecipeReport {
  readonly schema: "sxsy-b122.linux-repository-recipe-result";
  readonly version: 1;
  readonly coverage: readonly RepositoryRecipeCoverage[];
  readonly scannerFixtureIds: readonly string[];
  readonly advisoryFixtureIds: readonly string[];
}

/** Converts only Bubblewrap-executed, pinned-manifest typed reports into authenticated host receipts. */
export class LinuxHostValidatedRepositoryRecipeRunner implements SandboxRepositoryRecipeRunner {
  constructor(
    private readonly runtimes: DurableRepositoryRuntimeRegistry,
    private readonly issuer: HostReceiptEvidenceIssuer,
    private readonly scannerFixtures: ScannerFixtureResolver,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async runRecipe(request: IsolationRequest, recipeId: string): Promise<BrokerOutcome> {
    if (!isolatedActions.has(request.action) || recipeId !== request.action || !request.effectGuard) return incomplete("Linux repository validation requires one supported exact recipe and final effect guard.");
    const action = request.action as RepositoryRuntimeAction;
    const currentGuard = {
      check: async () => request.effectGuard!.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) })
    };
    let result;
    try {
      const runtime = await this.runtimes.resolve(request.target.repositoryRoot);
      result = await runtime.execute(action, { operationId: request.operationId, targetSnapshotId: request.target.id, ...(request.session ? { sessionId: request.session.id } : {}), ...(request.authority ? { authorityId: request.authority.id } : {}), effectGuard: currentGuard });
    } catch { return { status: "unavailable", summary: "No unchanged host-attested Linux repository runtime is available for the exact target.", effectDisposition: "not_started" }; }
    if (result.status !== "completed") return { status: result.status, summary: result.summary, effectDisposition: result.effectDisposition };
    let report: LinuxRecipeReport;
    try { report = parseReport(result.output, action); }
    catch { return incomplete("The Bubblewrap recipe completed without one exact typed Linux evidence report."); }
    const observedAt = this.clock();
    if (!Number.isFinite(observedAt.getTime())) return incomplete("The Linux repository evidence clock is invalid.");
    let fixtures: readonly VerifiedScannerFixture[];
    try { fixtures = await this.scannerFixtures.resolve({ scannerFixtureIds: report.scannerFixtureIds, advisoryFixtureIds: report.advisoryFixtureIds, observedAt }); }
    catch { return incomplete("The Linux repository recipe named a missing, expired, revoked, or invalid signed scanner fixture."); }
    const securityAction = action.startsWith("shield_") || action === "release_shield";
    const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
    if (securityAction && report.coverage.some((entry) => entry.status === "covered" && (!entry.fixtureId || !fixtureIds.has(entry.fixtureId)))) return incomplete("Linux Shield coverage was not bound to a verified signed scanner or advisory fixture.");
    const pin = (await this.runtimes.list()).filter((candidate) => candidate.status === "active" && samePath(candidate.canonicalRepositoryRoot, request.target.repositoryRoot));
    if (pin.length !== 1) return incomplete("The Linux repository runtime pin became absent or ambiguous before evidence issuance.");
    const bwrap = await realpath(bwrapPath).catch(() => "");
    if (bwrap !== bwrapPath) return incomplete("The fixed Bubblewrap helper identity changed before evidence issuance.");
    const helperSha256 = createHash("sha256").update(await readFile(bwrap)).digest("hex");
    const createdAt = observedAt.toISOString();
    const expiresAt = new Date(Math.min(observedAt.getTime() + 5 * 60_000, ...fixtures.map((fixture) => Date.parse(fixture.expiresAt)))).toISOString();
    const executionRequest: ExecutionRequest = { action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}), ...(request.permit ? { permit: request.permit } : {}), ...(request.executionControl ? { executionControl: request.executionControl } : {}), effectGuard: request.effectGuard, recipe: repositoryRuntimeExecutionRecipe(action, request.target) };
    const binding = {
      manifestSha256: pin[0]!.expectedSha256,
      helperSha256,
      helperVersion: "bubblewrap-deny-network-v1",
      resultSha256: createHash("sha256").update(result.output ?? "").digest("hex"),
      toolVersions: { bubblewrap: `sha256:${helperSha256}`, ...fixtureVersions(fixtures) },
      scannerFixtureIds: report.scannerFixtureIds,
      advisoryFixtureIds: report.advisoryFixtureIds,
      coverage: report.coverage,
      policyVersion: request.target.policyVersion,
      createdAt,
      expiresAt
    } as const;
    try {
      await currentGuard.check();
      const typed = createRepositoryRecipeEvidence(executionRequest, result, binding, observedAt.getTime());
      const receiptEvidenceEnvelope = this.issuer.issueRepositoryRecipeEvidence(typed, executionRequest, binding);
      const complete = typed.outcome === "passed" && typed.completeness === "complete";
      return { status: complete ? "completed" : "incomplete", summary: complete ? "The Linux Bubblewrap recipe completed with exact host-authenticated evidence." : "The Linux Bubblewrap recipe ran, but required evidence remains incomplete.", effectDisposition: result.effectDisposition, data: { receiptEvidenceEnvelope } };
    } catch { return incomplete("The Linux repository result could not be converted into exact authenticated host evidence."); }
  }
}

function parseReport(output: string | undefined, action: string): LinuxRecipeReport {
  const value: unknown = JSON.parse(output ?? "");
  if (!record(value) || !exactKeys(value, ["schema", "version", "coverage", "scannerFixtureIds", "advisoryFixtureIds"])
    || value.schema !== "sxsy-b122.linux-repository-recipe-result" || value.version !== 1 || !Array.isArray(value.coverage)) throw new Error("invalid report");
  const required = coverageByAction[action] ?? [];
  const coverage = value.coverage.map((entry) => {
    if (!record(entry) || !exactKeys(entry, ["dimension", "status", "fixtureId"]) || typeof entry.dimension !== "string" || !required.includes(entry.dimension)
      || (entry.status !== "covered" && entry.status !== "unavailable") || typeof entry.fixtureId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(entry.fixtureId)) throw new Error("invalid coverage");
    return { dimension: entry.dimension, status: entry.status, fixtureId: entry.fixtureId } as RepositoryRecipeCoverage;
  });
  if (coverage.length !== required.length || new Set(coverage.map((entry) => entry.dimension)).size !== required.length) throw new Error("incomplete coverage dimensions");
  const scannerFixtureIds = identifiers(value.scannerFixtureIds); const advisoryFixtureIds = identifiers(value.advisoryFixtureIds);
  if (scannerFixtureIds.some((id) => advisoryFixtureIds.includes(id))) throw new Error("ambiguous fixtures");
  return { schema: value.schema, version: 1, coverage, scannerFixtureIds, advisoryFixtureIds };
}

function identifiers(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some((item) => typeof item !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(item)) || new Set(value).size !== value.length) throw new Error("invalid fixture list");
  return value as string[];
}
function fixtureVersions(fixtures: readonly VerifiedScannerFixture[]): Readonly<Record<string, string>> { return Object.fromEntries(fixtures.map((fixture) => [`fixture:${fixture.kind}:${fixture.id}`, `manifest=sha256:${fixture.manifestSha256};content=sha256:${fixture.contentSha256};feed=${fixture.feedVersion};tool=${fixture.toolName}@${fixture.toolVersion}`])); }
function incomplete(summary: string): BrokerOutcome { return { status: "incomplete", summary, effectDisposition: "not_started" }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function samePath(left: string, right: string): boolean { return resolve(left) === resolve(right); }

function mappedPath(root: string, candidate: string): string {
  const suffix = relative(root, candidate).replaceAll("\\", "/");
  return suffix ? `/workspace/${suffix}` : "/workspace";
}
function inside(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix === "" || suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix);
}
