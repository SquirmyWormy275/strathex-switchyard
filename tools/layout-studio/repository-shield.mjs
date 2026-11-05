/** Host admission and non-passing evidence for the pinned baseline scanner. */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { createDurableAbortControl } from "../../packages/control-plane/src/execution-cancellation.ts";
import { createRepositoryRecipeEvidence } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { pipelineDependencies } from "./repository-pipeline.mjs";
import { shieldActions, shieldEngineVersion, validateShieldRequest, scannerPath } from "./shield-scanner-engine.mjs";

const sha = b => createHash("sha256").update(b).digest("hex");
const engineUrl = new URL("./shield-scanner-engine.mjs", import.meta.url);
const empty = summary => ({ status: "incomplete", summary, effectDisposition: "not_started" });
const pins = fixtures => fixtures.map(f => ({ id: f.id, kind: f.kind, manifestSha256: f.manifestSha256, contentSha256: f.contentSha256, feedVersion: f.feedVersion, toolName: f.toolName, toolVersion: f.toolVersion, expiresAt: f.expiresAt })).sort((a, b) => a.id.localeCompare(b.id));
/** A failed findings gate may retain an authenticated incomplete observation.
 * This never converts a failed native process or a partial scan to completion. */
export function shieldReceiptEvidence(factory) {
  return {
    issue: factory.issue.bind(factory),
    issueRepositoryRecipeEvidence: factory.issueRepositoryRecipeEvidence.bind(factory),
    forResult(definition, result, target) {
      if (result.status !== "failed" || !shieldActions.includes(definition.action)) return factory.forResult(definition, result, target);
      const report = result.data?.shieldReport, envelope = result.data?.receiptEvidenceEnvelope;
      if (!report || report.schema !== "switchyard-shield-findings/v1" || report.action !== definition.action || report.engine !== shieldEngineVersion || report.outcome !== "failed" || report.completeness !== "incomplete" || !Array.isArray(report.findings) || !report.findings.length || report.findings.length > 512 || envelope?.producer !== "repository-runtime" || envelope.outcome !== "incomplete" || envelope.completeness !== "incomplete") return undefined;
      const reportDigest = sha(JSON.stringify(report));
      if (reportDigest !== envelope.evidence?.resultSha256 || reportDigest !== envelope.evidence?.outputSha256) return undefined;
      // The existing verifier authenticates action, operation, target, policy,
      // versions, expiry and HMAC. Only the observation is incomplete; dispatch
      // keeps the real failed command status for its separate protected receipt.
      const verified = factory.forResult(definition, { ...result, status: "incomplete" }, target);
      return verified ? { ...verified, evidenceCompleteness: "incomplete" } : undefined;
    }
  };
}
export async function validateShieldRecipe({ recipe, repositoryRoot, action, resolveFixtures, now = Date.now }) {
  if (!shieldActions.includes(action)) return undefined;
  if (recipe.cwd !== "." || recipe.workspaceMode === "temporary-build" || recipe.args.length !== 2 || await realpath(recipe.executable) !== await realpath(process.execPath) || Object.keys(recipe.environment).some(k => k !== "NODE_ENV") || recipe.environment.NODE_ENV !== "test") throw Error("Shield requires the pinned Node scanner, two literal inputs, test environment and read-only workspace.");
  // Node interprets a leading dash as an option before opening its entrypoint.
  // A file containing the right engine bytes named '-e' must never turn the
  // second literal filename into JavaScript evaluated by Node.
  if (typeof recipe.args[0] !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*\.mjs$/.test(recipe.args[0])) throw Error("Shield requires one literal .mjs entrypoint path without Node options.");
  const enginePath = scannerPath(recipe.args[0]), requestPath = scannerPath(recipe.args[1]), inputs = new Map(recipe.inputFiles.map(f => [f.path, f])), engineSha256 = sha(await readFile(engineUrl));
  if (enginePath === requestPath || inputs.get(enginePath)?.sha256 !== engineSha256 || !inputs.has(requestPath)) throw Error("Shield requires the exact shipped scanner bytes and a reviewed request input.");
  const reader = new NodeFileDigestReader({ maxFileBytes: 128 * 1024 });
  const r = await reader.read(repositoryRoot, requestPath); let request;
  try { if (r.digest !== `sha256:${inputs.get(requestPath).sha256}`) throw Error("Shield request changed."); request = validateShieldRequest(JSON.parse(r.bytes.toString("utf8"))); } finally { r.bytes.fill(0); }
  if (request.action !== action) throw Error("Shield request action does not match the exact grant.");
  const declared = [enginePath, requestPath, request.scanner.path, ...(request.advisory ? [request.advisory.path] : []), ...request.files.map(f => f.path)];
  if (new Set(declared).size !== declared.length || inputs.size !== declared.length || declared.some(p => !inputs.has(p))) throw Error("Shield requires precisely the reviewed engine, request, feeds and scanned inputs.");
  for (const f of [...request.files, request.scanner, ...(request.advisory ? [request.advisory] : [])]) if (inputs.get(f.path)?.sha256 !== f.sha256 || f.size !== undefined && inputs.get(f.path)?.size !== f.size) throw Error("Shield input witnesses do not match the exact request.");
  if (typeof resolveFixtures !== "function") throw Error("Shield requires installed signed scanner feeds.");
  const fixtures = await resolveFixtures({ scannerFixtureIds: [request.scanner.id], advisoryFixtureIds: request.advisory ? [request.advisory.id] : [], observedAt: new Date(now()) });
  for (const [kind, f] of [["scanner", request.scanner], ...(request.advisory ? [["advisory", request.advisory]] : [])]) {
    const actual = fixtures.find(a => a.id === f.id && a.kind === kind);
    if (!actual || actual.contentSha256 !== f.sha256 || actual.toolName !== "switchyard-baseline-scanner" || actual.toolVersion !== "1") throw Error("Shield feed bytes or exact scanner version do not match installed trust.");
  }
  return { engine: shieldEngineVersion, engineSha256, requestSha256: sha(JSON.stringify(request)), request, feeds: pins(fixtures), scope: "reviewed-inputs", repositoryScopeVerified: false, completeShieldGateAvailable: false };
}

export function shieldDependencies(options) {
  const { runtime, review, target, receiptEvidence, now, resolveScannerFixtures } = options;
  const metadata = pipelineDependencies(options), shield = review.shield;
  return { ...metadata, execute: async request => {
    if (!shield || request.action !== review.action || request.target.id !== target.id || !request.effectGuard) return empty("Shield requires its exact pinned scanner review and current effect authority.");
    const guard = async () => request.effectGuard.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
    const resolveCurrent = async () => {
      const result = await resolveScannerFixtures({ scannerFixtureIds: [shield.request.scanner.id], advisoryFixtureIds: shield.request.advisory ? [shield.request.advisory.id] : [], observedAt: new Date(now()) });
      if (JSON.stringify(pins(result)) !== JSON.stringify(shield.feeds)) throw Error("Reviewed Shield feeds changed."); return result;
    };
    const control = await createDurableAbortControl(request.executionControl, { fallbackDeadline: request.permit?.expiresAt });
    let result;
    try {
      if (control.signal.aborted || !(await guard()).allowed) return empty("Shield authority expired before execution.");
      await resolveCurrent();
      result = await runtime.execute(request.action, { operationId: request.operationId, targetSnapshotId: request.target.id, ...(request.session ? { sessionId: request.session.id } : {}), ...(request.authority ? { authorityId: request.authority.id } : {}), signal: control.signal, effectGuard: { check: guard } });
      if (result.status !== "completed") return { status: result.status, summary: result.summary, effectDisposition: result.effectDisposition };
      if (result.outputTruncated || Buffer.byteLength(result.output ?? "") > 480 * 1024) throw Error("Shield output was truncated.");
      const report = JSON.parse(result.output ?? "");
      if (report.schema !== "switchyard-shield-findings/v1" || report.version !== 1 || report.engine !== shield.engine || report.action !== request.action || report.requestSha256 !== shield.requestSha256 || report.scope !== "reviewed-inputs" || report.completeness !== "incomplete" || !["failed", "incomplete"].includes(report.outcome) || !Array.isArray(report.gaps) || !report.gaps.includes("repository_scope_unverified") || !Array.isArray(report.findings) || report.findings.length > 512 || !Array.isArray(report.coverage) || report.coverage.some(c => c.status !== "incomplete")) throw Error("Shield report is not the exact pinned incomplete-scope result.");
      // This engine cannot attest full repository scope/history or broad security
      // coverage. Never upgrade its baseline results into a passing Shield gate.
      const fixtures = await resolveCurrent(); if (!(await guard()).allowed || control.signal.aborted) throw Error("Shield authority changed before evidence issuance.");
      const createdAt = new Date(now()).toISOString(), expiresAt = new Date(Math.min(now() + 300000, ...fixtures.map(f => Date.parse(f.expiresAt)))).toISOString();
      const binding = { manifestSha256: review.manifestSha256, helperSha256: shield.engineSha256, helperVersion: shieldEngineVersion, resultSha256: sha(result.output), toolVersions: { node: process.versions.node, repositoryExecutable: `sha256:${review.executableIdentity.sha256}`, scanner: shieldEngineVersion, scannerSource: `sha256:${shield.engineSha256}`, scannerRequest: `sha256:${shield.requestSha256}`, ...Object.fromEntries(fixtures.map(f => [`fixture:${f.kind}:${f.id}`, `manifest=sha256:${f.manifestSha256};content=sha256:${f.contentSha256};feed=${f.feedVersion};tool=${f.toolName}@${f.toolVersion}`])) }, scannerFixtureIds: [shield.request.scanner.id], advisoryFixtureIds: shield.request.advisory ? [shield.request.advisory.id] : [], coverage: report.coverage.map(c => ({ dimension: c.dimension, status: "unavailable", fixtureId: shield.request.scanner.id })), policyVersion: request.target.policyVersion, createdAt, expiresAt };
      // Authenticate the incomplete observation and report hash. The separate
      // command receipt records findings as failed; no completion proof is issued.
      const evidence = createRepositoryRecipeEvidence(request, result, binding, now()), receiptEvidenceEnvelope = receiptEvidence.issueRepositoryRecipeEvidence(evidence, request, binding);
      return { status: report.outcome === "failed" ? "failed" : "incomplete", summary: report.outcome === "failed" ? "Shield found baseline security or policy findings. Full repository coverage remains incomplete." : "The pinned baseline scanner ran; full repository scope and required coverage remain incomplete.", effectDisposition: result.effectDisposition, data: { shieldReport: report, receiptEvidenceEnvelope } };
    } catch { return { status: "incomplete", summary: "Shield could not verify its original scanner, signed feeds or exact report. No passing gate was issued.", effectDisposition: result?.effectDisposition ?? "not_started" }; }
    finally { control.dispose(); }
  } };
}
