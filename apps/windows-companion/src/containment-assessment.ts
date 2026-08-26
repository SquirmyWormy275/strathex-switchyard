import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import type {
  ContainmentAssessmentEffectPort,
  ContainmentAssessmentRequest,
  ContainmentAssessmentResult,
  ContainmentAssessmentStep,
  ContainmentFinding
} from "../../../packages/control-plane/src/containment-incidents.ts";
import type { LocalGitResult, LocalGitRunner } from "./mediated-git.ts";
import { SpawnLocalGitRunner } from "./mediated-git.ts";

const secretPattern = "(api[_-]?key|password|passwd|secret|token|credential|authorization)[[:space:]]*[:=]";
const maximumPaths = 256;
const requestKeys = ["egressAllowed", "externalId", "fenceEpoch", "incidentId", "operationId", "repositoryRoot", "revealSecretValues", "schema", "step", "version"] as const;

/**
 * Read-only, no-egress assessment for a contained repository. It deliberately
 * returns path/digest evidence only: matching file contents and Git diagnostics
 * never cross this boundary. A missing match in stale remote-tracking refs is
 * unknown, never proof that a remote was clean.
 */
export class InstalledLocalContainmentAssessmentPort implements ContainmentAssessmentEffectPort {
  constructor(private readonly git: LocalGitRunner = new SpawnLocalGitRunner()) {}

  execute(input: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult> {
    const request = validateRequest(input);
    if (request.step === "working_tree") return this.workingTree(request);
    return this.history(request, request.step);
  }

  /** Re-observation repeats only bounded, read-only local Git queries. */
  observe(input: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult | undefined> {
    return this.execute(input);
  }

  private async workingTree(request: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult> {
    let tracked: LocalGitResult;
    let untracked: LocalGitResult;
    try {
      tracked = await this.git.run(["diff", "--name-only", "-z", "--no-ext-diff", "HEAD", "--"], { cwd: request.repositoryRoot });
      if (tracked.exitCode !== 0) return unknown(request, "The contained working-tree path inventory is unavailable.");
      untracked = await this.git.run(["ls-files", "--others", "--exclude-standard", "-z", "--"], { cwd: request.repositoryRoot });
      if (untracked.exitCode !== 0) return unknown(request, "The contained untracked-file inventory is unavailable.");
    } catch {
      return unknown(request, "The fixed local Git inspection boundary is unavailable.");
    }
    let paths: readonly string[];
    try { paths = uniquePaths([...nulPaths(tracked.stdout), ...nulPaths(untracked.stdout)]); }
    catch { return unknown(request, "The contained working-tree path inventory is unsafe or exceeds its bound."); }
    if (!paths.length) return clean(request, "No changed or untracked path requires containment exposure review.");
    let scan: LocalGitResult;
    try {
      scan = await this.git.run(["grep", "--no-index", "-I", "-l", "-z", "-E", secretPattern, "--", ...paths], { cwd: request.repositoryRoot });
    } catch {
      return unknown(request, "The fixed local secret-pattern assessment is unavailable.");
    }
    if (scan.exitCode === 1) return clean(request, `No credential-shaped value was detected in ${paths.length} changed path(s).`);
    if (scan.exitCode !== 0) return unknown(request, "The contained secret-pattern assessment did not complete.");
    let matched: readonly string[];
    try {
      matched = uniquePaths(nulPaths(scan.stdout));
      if (!matched.length || matched.some((path) => !paths.some((candidate) => samePath(candidate, path)))) throw new Error("outside changed set");
    } catch { return unknown(request, "The contained secret-pattern result was malformed or outside the changed-path set."); }
    return exposed(request, matched, `Credential-shaped content was detected in ${matched.length} changed path(s); values were redacted before journaling.`);
  }

  private async history(request: ContainmentAssessmentRequest, step: Extract<ContainmentAssessmentStep, "history" | "remote">): Promise<ContainmentAssessmentResult> {
    let result: LocalGitResult;
    try {
      result = await this.git.run([
        "log",
        step === "history" ? "--all" : "--remotes",
        "--format=",
        "--name-only",
        "-z",
        `-G${secretPattern}`,
        "--",
        "."
      ], { cwd: request.repositoryRoot });
    } catch {
      return unknown(request, `The fixed local ${step === "history" ? "history" : "remote-tracking"} assessment boundary is unavailable.`);
    }
    if (result.exitCode !== 0) return unknown(request, `The contained ${step === "history" ? "history" : "remote-tracking"} assessment did not complete.`);
    let paths: readonly string[];
    try { paths = uniquePaths(nulPaths(result.stdout)); }
    catch { return unknown(request, `The contained ${step === "history" ? "history" : "remote-tracking"} path evidence is unsafe or exceeds its bound.`); }
    if (paths.length) return exposed(request, paths, `Credential-shaped content is reachable from ${step === "history" ? "local Git history" : "a locally observed remote-tracking ref"} in ${paths.length} path(s); values were not retained.`);
    if (step === "remote") return unknown(request, "No exposure is visible in local remote-tracking refs, but their network freshness is not proven while containment blocks egress.");
    return clean(request, "No credential-shaped content was found in locally reachable Git history.");
  }
}

function validateRequest(value: ContainmentAssessmentRequest): ContainmentAssessmentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...requestKeys].sort().join(",")
    || value.schema !== "sxsy-b122.containment-assessment-request" || value.version !== 1
    || !/^containment-incident:[a-f0-9]{64}$/.test(value.incidentId)
    || !/^containment-assessment:[a-f0-9]{64}$/.test(value.operationId)
    || !/^containment-assessment:[a-f0-9]{64}$/.test(value.externalId)
    || !Number.isSafeInteger(value.fenceEpoch) || value.fenceEpoch < 1
    || !["working_tree", "history", "remote"].includes(value.step)
    || value.egressAllowed !== false || value.revealSecretValues !== false
    || typeof value.repositoryRoot !== "string" || !isAbsolute(value.repositoryRoot) || value.repositoryRoot.length > 4_096 || /[\r\n\0]/.test(value.repositoryRoot)) {
    throw new Error("The local containment assessment request is invalid or not fail-closed.");
  }
  return { ...value, repositoryRoot: resolve(value.repositoryRoot) };
}

function base(request: ContainmentAssessmentRequest) {
  return {
    schema: "sxsy-b122.containment-assessment-result" as const,
    version: 1 as const,
    incidentId: request.incidentId,
    repositoryRoot: request.repositoryRoot,
    fenceEpoch: request.fenceEpoch,
    step: request.step,
    operationId: request.operationId,
    externalId: request.externalId,
    effectDisposition: "committed" as const
  };
}

function clean(request: ContainmentAssessmentRequest, summary: string): ContainmentAssessmentResult {
  return { ...base(request), status: "passed", exposure: "none", summary, findings: [] };
}

function unknown(request: ContainmentAssessmentRequest, summary: string): ContainmentAssessmentResult {
  return { ...base(request), status: "incomplete", exposure: "unknown", summary, findings: [] };
}

function exposed(request: ContainmentAssessmentRequest, paths: readonly string[], summary: string): ContainmentAssessmentResult {
  const findings: ContainmentFinding[] = paths.map((relativePath) => ({
    // The assessment operation ID carries the durable generation.  A later
    // scan finding at the same path must never be satisfiable by a receipt
    // issued for an earlier repository image.
    id: `containment-finding:${createHash("sha256").update(`${request.operationId}:${relativePath.toLowerCase()}`).digest("hex")}`,
    relativePath,
    credentialRelated: true
  }));
  return { ...base(request), status: "failed", exposure: "found", summary, findings };
}

function nulPaths(value: string): readonly string[] {
  if (Buffer.byteLength(value, "utf8") > 64 * 1024) throw new Error("path output bound");
  const items = value.split("\0");
  if (items.at(-1) === "") items.pop();
  if (items.length > maximumPaths) throw new Error("path count bound");
  return items.map(exactRelativePath);
}

function uniquePaths(values: readonly string[]): readonly string[] {
  if (values.length > maximumPaths) throw new Error("path count bound");
  const result = new Map<string, string>();
  for (const value of values) result.set(value.toLowerCase(), value);
  return [...result.values()].sort((left, right) => left.localeCompare(right));
}

function exactRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.length > 2_048 || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
    || /[\r\n\0]/.test(normalized)) throw new Error("unsafe path");
  return normalized;
}

function samePath(left: string, right: string): boolean { return left.replaceAll("\\", "/").toLowerCase() === right.replaceAll("\\", "/").toLowerCase(); }
