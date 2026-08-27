/**
 * Converts only host-validated Windows Sandbox recipe artifacts into the
 * authenticated receipt envelope consumed by the durable dispatcher.
 * Repository stdout, workspace JSON, and bridge payloads never reach the
 * issuer directly.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { BrokerOutcome, ExecutionRequest, IsolationRequest } from "../../../packages/control-plane/src/brokers.ts";
import type { RepositoryRuntimeAction, RepositoryRuntimeResult } from "./repository-runtime.ts";
import {
  createRepositoryRecipeEvidence,
  repositoryRuntimeExecutionRecipe,
  type RepositoryRecipeCoverage,
  type SandboxRepositoryRecipeRunner
} from "./repository-runtime-broker.ts";
import type { HostReceiptEvidenceIssuer } from "./receipt-evidence.ts";
import type { SandboxInstallationPin } from "./sandbox-installation.ts";
import type { ScannerFixtureResolver, VerifiedScannerFixture } from "./scanner-fixtures.ts";

const evidenceFile = "b122-recipe-evidence.json";
const evidenceLimit = 256 * 1024;
const receiptLifetimeMs = 5 * 60_000;
const digestPattern = /^[a-f0-9]{64}$/;
const supportedActions = new Set<RepositoryRuntimeAction>([
  "pipeline_local_gate",
  "pipeline_clean_reproduction",
  "shield_change_scan",
  "shield_codebase_audit",
  "shield_supply_chain",
  "release_shield"
]);

export interface SandboxInstallationResolver {
  resolve(repositoryRoot: string): Promise<SandboxInstallationPin>;
}

export interface HostValidatedRepositoryRecipeRunnerOptions {
  readonly stateDirectory: string;
  readonly clock?: () => Date;
  readonly scannerFixtures?: ScannerFixtureResolver;
}

/**
 * The inner runtime owns Windows Sandbox. This wrapper accepts a success only
 * when the exact copied evidence bytes still match the host's in-memory output
 * manifest and the post-run installation pin remains unchanged.
 */
export class HostValidatedRepositoryRecipeRunner implements SandboxRepositoryRecipeRunner {
  private readonly inner: SandboxRepositoryRecipeRunner;
  private readonly installations: SandboxInstallationResolver;
  private readonly issuer: HostReceiptEvidenceIssuer;
  private readonly stateDirectory: string;
  private readonly clock: () => Date;
  private readonly scannerFixtures?: ScannerFixtureResolver;

  constructor(
    inner: SandboxRepositoryRecipeRunner,
    installations: SandboxInstallationResolver,
    issuer: HostReceiptEvidenceIssuer,
    options: HostValidatedRepositoryRecipeRunnerOptions
  ) {
    if (!boundedAbsolute(options.stateDirectory)) throw new Error("Repository recipe evidence requires one fixed absolute host state directory.");
    this.inner = inner;
    this.installations = installations;
    this.issuer = issuer;
    this.stateDirectory = resolve(options.stateDirectory);
    this.clock = options.clock ?? (() => new Date());
    this.scannerFixtures = options.scannerFixtures;
  }

  async runRecipe(request: IsolationRequest, recipeId: string): Promise<BrokerOutcome> {
    const action = request.action as RepositoryRuntimeAction;
    if (!supportedActions.has(action) || recipeId !== action) {
      return { status: "blocked", summary: "Host recipe evidence rejected an unsupported or mismatched recipe identity.", effectDisposition: "not_started" };
    }
    const outcome = await this.inner.runRecipe(request, recipeId);
    if (outcome.status !== "completed") return outcome;
    if (!request.effectGuard) return incomplete("Repository validation completed without a final dispatch-bound effect guard.");

    try {
      const pin = await this.installations.resolve(request.target.repositoryRoot);
      const sandbox = parseSandboxOutcome(outcome);
      if (sandbox.recipeCatalogSha256 !== pin.catalogSha256 || sandbox.sandboxHelperSha256 !== pin.helperSha256) {
        return incomplete("Repository validation completed against a sandbox installation that no longer matches its host pin.");
      }
      const stateRoot = await concreteDirectory(this.stateDirectory, "host state");
      const resultRoot = await concreteDirectory(sandbox.resultRoot, "validated result");
      if (!inside(stateRoot, resultRoot)) return incomplete("Repository validation output is outside the fixed host state boundary.");

      const catalog = await readCatalogRecipe(pin, action);
      const evidencePath = resolve(resultRoot, evidenceFile);
      if (!inside(resultRoot, evidencePath)) return incomplete("Repository recipe evidence escaped the validated output boundary.");
      const metadata = await lstat(evidencePath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > evidenceLimit) {
        return incomplete("Repository recipe evidence is absent, linked, empty, or oversized.");
      }
      const canonicalEvidencePath = await realpath(evidencePath);
      if (!inside(resultRoot, canonicalEvidencePath)) return incomplete("Repository recipe evidence resolves outside the validated output boundary.");
      const evidenceBytes = await readFile(canonicalEvidencePath);
      const copied = sandbox.validatedOutputs.filter((entry) => normalizedRelative(entry.path) === evidenceFile);
      if (copied.length !== 1 || copied[0]!.size !== evidenceBytes.byteLength || copied[0]!.sha256 !== sha256(evidenceBytes)) {
        return incomplete("Repository recipe evidence changed after Windows Sandbox validation.");
      }
      const report = parseTypedRecipeReport(evidenceBytes, action);
      if (catalog.configurationSha256 !== report.configurationSha256 || catalog.runnerSha256 !== report.helperSha256) {
        return incomplete("Repository recipe evidence does not match the exact reviewed catalog and typed configuration.");
      }

      const needsScanner = action.startsWith("shield_") || action === "release_shield";
      const needsAdvisory = action === "shield_supply_chain" || action === "release_shield";
      if ((needsScanner && report.scannerFixtureIds.length === 0) || (needsAdvisory && report.advisoryFixtureIds.length === 0)) {
        return incomplete("Repository validation did not name every required signed scanner/advisory fixture.");
      }

      const current = await request.effectGuard.assertCurrent({
        action: request.action,
        operationId: request.operationId,
        target: request.target,
        ...(request.session ? { session: request.session } : {}),
        ...(request.authority ? { authority: request.authority } : {})
      });
      if (!current.allowed) return incomplete(current.reason);

      const observedAt = this.clock();
      if (!Number.isFinite(observedAt.getTime())) return incomplete("The host evidence clock is invalid.");
      let verifiedFixtures: readonly VerifiedScannerFixture[] = [];
      if (needsScanner || needsAdvisory) {
        if (!this.scannerFixtures) return incomplete("No host-owned signed scanner/advisory fixture registry is installed.");
        verifiedFixtures = await this.scannerFixtures.resolve({
          scannerFixtureIds: report.scannerFixtureIds,
          advisoryFixtureIds: report.advisoryFixtureIds,
          observedAt
        });
        if (verifiedFixtures.length !== report.scannerFixtureIds.length + report.advisoryFixtureIds.length) {
          return incomplete("Signed scanner/advisory fixture resolution was incomplete or ambiguous.");
        }
      }
      const executionRequest: ExecutionRequest = {
        action: request.action,
        operationId: request.operationId,
        target: request.target,
        ...(request.session ? { session: request.session } : {}),
        ...(request.authority ? { authority: request.authority } : {}),
        ...(request.permit ? { permit: request.permit } : {}),
        ...(request.executionControl ? { executionControl: request.executionControl } : {}),
        effectGuard: request.effectGuard,
        recipe: repositoryRuntimeExecutionRecipe(action, request.target)
      };
      const runtimeResult: RepositoryRuntimeResult = {
        status: report.outcome === "completed" ? "completed" : "failed",
        summary: "The fixed repository recipe helper produced a host-validated typed result.",
        exitCode: report.exitCode,
        output: canonicalOutputBinding(report.output),
        outputTruncated: report.output.truncated
      };
      const binding = {
        manifestSha256: pin.catalogSha256,
        helperSha256: report.helperSha256,
        helperVersion: "sxsy-b122-repository-runner-v1",
        resultSha256: sandbox.resultManifestSha256,
        toolVersions: {
          repositoryRunner: `sha256:${report.helperSha256}`,
          recipeTool: `sha256:${report.toolSha256}`,
          typedRecipeConfiguration: `sha256:${report.configurationSha256}`,
          sandboxHelper: `sha256:${pin.helperSha256}`,
          ...fixtureVersionBindings(verifiedFixtures)
        },
        scannerFixtureIds: report.scannerFixtureIds,
        advisoryFixtureIds: report.advisoryFixtureIds,
        coverage: report.coverage,
        policyVersion: request.target.policyVersion,
        createdAt: observedAt.toISOString(),
        expiresAt: new Date(Math.min(observedAt.getTime() + receiptLifetimeMs, ...verifiedFixtures.map((item) => Date.parse(item.expiresAt)))).toISOString()
      } as const;
      const typed = createRepositoryRecipeEvidence(executionRequest, runtimeResult, binding, observedAt.getTime());
      const receiptEvidenceEnvelope = this.issuer.issueRepositoryRecipeEvidence(typed, executionRequest, binding);
      const status = typed.completeness === "complete" && typed.outcome === "passed" ? "completed" as const : "incomplete" as const;
      return {
        status,
        summary: status === "completed"
          ? "The Windows Sandbox recipe completed with exact host-authenticated evidence."
          : "The Windows Sandbox recipe ran, but one or more required evidence dimensions are unavailable.",
        data: { ...(outcome.data ?? {}), receiptEvidenceEnvelope }
      };
    } catch {
      return incomplete("Repository validation completed, but its exact host evidence could not be verified or authenticated.");
    }
  }
}

interface ParsedSandboxOutcome {
  readonly resultRoot: string;
  readonly resultManifestSha256: string;
  readonly recipeCatalogSha256: string;
  readonly sandboxHelperSha256: string;
  readonly validatedOutputs: readonly Readonly<{ path: string; size: number; sha256: string }>[];
}

function parseSandboxOutcome(outcome: BrokerOutcome): ParsedSandboxOutcome {
  const value = outcome.data;
  if (!record(value) || value.backend !== "windows-sandbox" || value.enforced !== true
    || typeof value.resultRoot !== "string" || !boundedAbsolute(value.resultRoot)
    || typeof value.resultManifestSha256 !== "string" || !digestPattern.test(value.resultManifestSha256)
    || typeof value.recipeCatalogSha256 !== "string" || !digestPattern.test(value.recipeCatalogSha256)
    || typeof value.sandboxHelperSha256 !== "string" || !digestPattern.test(value.sandboxHelperSha256)
    || !Array.isArray(value.validatedOutputs) || value.validatedOutputs.length < 1 || value.validatedOutputs.length > 256) {
    throw new Error("Windows Sandbox outcome omitted its trusted result binding.");
  }
  const validatedOutputs = value.validatedOutputs.map((entry) => {
    if (!record(entry) || !exact(entry, ["path", "size", "sha256"])
      || typeof entry.path !== "string" || normalizedRelative(entry.path) !== entry.path.replaceAll("\\", "/")
      || !Number.isSafeInteger(entry.size) || (entry.size as number) < 0
      || typeof entry.sha256 !== "string" || !digestPattern.test(entry.sha256)) throw new Error("Windows Sandbox validated output binding is malformed.");
    return { path: entry.path, size: entry.size as number, sha256: entry.sha256 };
  });
  if (new Set(validatedOutputs.map((entry) => normalizedRelative(entry.path))).size !== validatedOutputs.length) throw new Error("Windows Sandbox validated output binding is ambiguous.");
  return {
    resultRoot: value.resultRoot,
    resultManifestSha256: value.resultManifestSha256,
    recipeCatalogSha256: value.recipeCatalogSha256,
    sandboxHelperSha256: value.sandboxHelperSha256,
    validatedOutputs
  };
}

interface CatalogRecipeAttestation { readonly runnerSha256: string; readonly configurationSha256: string; }

async function readCatalogRecipe(pin: SandboxInstallationPin, action: RepositoryRuntimeAction): Promise<CatalogRecipeAttestation> {
  const bytes = await readFile(pin.catalogPath);
  if (bytes.byteLength <= 0 || bytes.byteLength > evidenceLimit || sha256(bytes) !== pin.catalogSha256) throw new Error("The sandbox catalog changed after host validation.");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("The sandbox catalog is malformed."); }
  if (!record(value) || !exact(value, ["schema", "version", "recipes"]) || value.schema !== "sxsy-b122.windows-sandbox-catalog" || value.version !== 1 || !Array.isArray(value.recipes)) throw new Error("The sandbox catalog schema is invalid.");
  const matches = value.recipes.filter((entry) => record(entry) && entry.id === action);
  if (matches.length !== 1) throw new Error("The sandbox catalog does not contain one exact repository recipe.");
  const recipe = matches[0]!;
  if (!exact(recipe, ["id", "executable", "executableSha256", "arguments", "workingRoot", "workingDirectory", "environment", "timeoutMs", "maxOutputBytes", "artifacts"])
    || typeof recipe.executableSha256 !== "string" || !digestPattern.test(recipe.executableSha256)
    || !Array.isArray(recipe.arguments) || recipe.arguments.length !== 5
    || recipe.arguments[0] !== "--recipe" || recipe.arguments[1] !== action || recipe.arguments[2] !== "{INPUT_ROOT}" || recipe.arguments[3] !== "{WORK_ROOT}"
    || typeof recipe.arguments[4] !== "string" || !digestPattern.test(recipe.arguments[4]) || /^0{64}$/.test(recipe.arguments[4])
    || !Array.isArray(recipe.artifacts) || recipe.artifacts.length !== 1 || recipe.artifacts[0] !== evidenceFile) throw new Error("The sandbox catalog recipe is not the exact typed evidence plan.");
  return { runnerSha256: recipe.executableSha256, configurationSha256: recipe.arguments[4] };
}

interface TypedRecipeReport {
  readonly configurationSha256: string;
  readonly helperSha256: string;
  readonly toolSha256: string;
  readonly outcome: "completed" | "incomplete" | "failed" | "timed_out";
  readonly exitCode: number;
  readonly output: Readonly<{ stdoutSha256: string; stdoutBytes: number; stderrSha256: string; stderrBytes: number; truncated: boolean }>;
  readonly coverage: readonly RepositoryRecipeCoverage[];
  readonly scannerFixtureIds: readonly string[];
  readonly advisoryFixtureIds: readonly string[];
  readonly unavailableDimensions: readonly string[];
}

function parseTypedRecipeReport(bytes: Uint8Array, action: RepositoryRuntimeAction): TypedRecipeReport {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("Typed recipe evidence is not JSON."); }
  const keys = ["schema", "version", "recipeId", "configurationSha256", "helperSha256", "toolSha256", "outcome", "exitCode", "output", "coverage", "scannerFixtureIds", "advisoryFixtureIds", "unavailableDimensions"];
  if (!record(value) || !exact(value, keys) || value.schema !== "sxsy-b122.typed-recipe-result" || value.version !== 1 || value.recipeId !== action
    || typeof value.configurationSha256 !== "string" || !digestPattern.test(value.configurationSha256)
    || typeof value.helperSha256 !== "string" || !digestPattern.test(value.helperSha256)
    || typeof value.toolSha256 !== "string" || !digestPattern.test(value.toolSha256)
    || !["completed", "incomplete", "failed", "timed_out"].includes(String(value.outcome))
    || !Number.isSafeInteger(value.exitCode) || (value.exitCode as number) < 0 || (value.exitCode as number) > 0x7fffffff
    || !record(value.output) || !exact(value.output, ["stdoutSha256", "stdoutBytes", "stderrSha256", "stderrBytes", "truncated"])
    || typeof value.output.stdoutSha256 !== "string" || !digestPattern.test(value.output.stdoutSha256)
    || typeof value.output.stderrSha256 !== "string" || !digestPattern.test(value.output.stderrSha256)
    || !boundedBytes(value.output.stdoutBytes) || !boundedBytes(value.output.stderrBytes) || typeof value.output.truncated !== "boolean") throw new Error("Typed recipe evidence does not use the exact bounded schema.");
  const coverage = parseCoverage(value.coverage);
  const scannerFixtureIds = stringList(value.scannerFixtureIds, "scanner fixture");
  const advisoryFixtureIds = stringList(value.advisoryFixtureIds, "advisory fixture");
  const unavailableDimensions = stringList(value.unavailableDimensions, "unavailable dimension");
  return {
    configurationSha256: value.configurationSha256,
    helperSha256: value.helperSha256,
    toolSha256: value.toolSha256,
    outcome: value.outcome as TypedRecipeReport["outcome"],
    exitCode: value.exitCode as number,
    output: {
      stdoutSha256: value.output.stdoutSha256,
      stdoutBytes: value.output.stdoutBytes as number,
      stderrSha256: value.output.stderrSha256,
      stderrBytes: value.output.stderrBytes as number,
      truncated: value.output.truncated
    },
    coverage,
    scannerFixtureIds,
    advisoryFixtureIds,
    unavailableDimensions
  };
}

function parseCoverage(value: unknown): readonly RepositoryRecipeCoverage[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("Typed recipe coverage is unbounded.");
  const result = value.map((entry) => {
    if (!record(entry) || !exact(entry, ["dimension", "status", "fixtureId"]) || entry.status !== "covered"
      || !boundedText(entry.dimension, 128) || !boundedText(entry.fixtureId, 256)) throw new Error("Typed recipe coverage entry is malformed.");
    return { dimension: entry.dimension, status: "covered" as const, fixtureId: entry.fixtureId };
  });
  if (new Set(result.map((entry) => entry.dimension)).size !== result.length) throw new Error("Typed recipe coverage is ambiguous.");
  return result;
}

function stringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some((entry) => !boundedText(entry, 256))) throw new Error(`Typed recipe ${label} list is malformed.`);
  const result = value as string[];
  if (new Set(result).size !== result.length) throw new Error(`Typed recipe ${label} list contains duplicates.`);
  return [...result];
}

function canonicalOutputBinding(output: TypedRecipeReport["output"]): string {
  return JSON.stringify({
    stdoutSha256: output.stdoutSha256,
    stdoutBytes: output.stdoutBytes,
    stderrSha256: output.stderrSha256,
    stderrBytes: output.stderrBytes,
    truncated: output.truncated
  });
}

function fixtureVersionBindings(fixtures: readonly VerifiedScannerFixture[]): Readonly<Record<string, string>> {
  return Object.fromEntries([...fixtures].sort((left, right) => left.id.localeCompare(right.id)).map((item) => [
    `fixture:${item.kind}:${item.id}`,
    `manifest=sha256:${item.manifestSha256};content=sha256:${item.contentSha256};feed=${item.feedVersion};tool=${item.toolName}@${item.toolVersion};generated=${item.generatedAt};expires=${item.expiresAt}`
  ]));
}

function incomplete(summary: string): BrokerOutcome { return { status: "incomplete", summary, effectDisposition: "not_started" }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function boundedAbsolute(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !/[\0\r\n]/.test(value) && isAbsolute(value); }
function boundedText(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\0\r\n]/.test(value); }
function boundedBytes(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1024 * 1024; }
function normalizedRelative(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Validated output path is unsafe.");
  return normalized;
}
function inside(root: string, candidate: string): boolean { const value = relative(root, candidate); return value !== "" && value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value); }
async function concreteDirectory(path: string, label: string): Promise<string> {
  if (!boundedAbsolute(path)) throw new Error(`${label} directory is not a bounded absolute path.`);
  const requested = await lstat(path);
  if (!requested.isDirectory() || requested.isSymbolicLink()) throw new Error(`${label} directory is absent or linked.`);
  const canonical = await realpath(path);
  const metadata = await lstat(canonical);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`${label} directory is absent or linked.`);
  return canonical;
}
