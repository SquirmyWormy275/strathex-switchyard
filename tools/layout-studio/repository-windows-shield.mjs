/** Windows guest attestation for the same pinned baseline scanner as Linux. */
import { createHash } from "node:crypto";
import { createRepositoryRecipeEvidence } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { validateShieldBundle, parseShieldScannerReport, shieldFixturePins } from "./repository-shield.mjs";
import { readAttestedWindowsReport } from "./repository-windows-pipeline.mjs";
import { shieldActions, shieldEngineVersion } from "./shield-scanner-engine.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export async function validateWindowsShield({ loaded, repositoryRoot, action, resolveFixtures, now = Date.now }) {
  if (!shieldActions.includes(action)) return undefined;
  const recipe = loaded.recipe, script = /^\{INPUT_ROOT\}[\\/](.+\.mjs)$/.exec(recipe.arguments[0]);
  if (recipe.workingRoot !== "input" || recipe.workingDirectory !== "." || !script || recipe.arguments.length !== 2 || recipe.artifacts.length || Object.keys(recipe.environment).length !== 1 || recipe.environment.NODE_ENV !== "test") throw Error("Windows Shield requires the exact pinned scanner, read-only input cwd, two literal arguments and test environment.");
  return validateShieldBundle({ inputFiles: loaded.manifest.inputFiles, enginePath: script[1].replaceAll("\\", "/"), requestPath: recipe.arguments[1].replaceAll("\\", "/"), repositoryRoot, action, additionalFiles: [loaded.manifest.catalogPath], resolveFixtures, now });
}

export async function attestWindowsShield({ store, compartment, stateDirectory, review, request, result, receiptEvidence, resolveScannerFixtures, guard, now }) {
  const incomplete = () => ({ status: "incomplete", effectDisposition: "committed", summary: "The original Windows scanner ran without a freshly verified exact Shield observation; preserve its result and do not replay it." });
  if (!shieldActions.includes(request.action) || review.action !== request.action || review.operationId !== request.operationId || !review.shield) return incomplete();
  if (result.status !== "completed") return { status: result.status, summary: result.summary };
  try {
    const shield = review.shield;
    const currentFixtures = async () => {
      if (typeof resolveScannerFixtures !== "function") throw Error("Signed Shield feeds are unavailable.");
      const fixtures = await resolveScannerFixtures({ scannerFixtureIds: [shield.request.scanner.id], advisoryFixtureIds: shield.request.advisory ? [shield.request.advisory.id] : [], observedAt: new Date(now()) });
      if (JSON.stringify(shieldFixturePins(fixtures)) !== JSON.stringify(shield.feeds)) throw Error("The reviewed Windows Shield feeds changed."); return fixtures;
    };
    await currentFixtures();
    const output = await readAttestedWindowsReport({ store, compartment, stateDirectory, review, request, result, guard });
    if (Buffer.byteLength(output) > 480 * 1024) throw Error("The scanner report exceeds its bound.");
    const report = parseShieldScannerReport(output, shield, request.action), fixtures = await currentFixtures(), observedAt = new Date(now());
    if (!Number.isFinite(observedAt.getTime())) throw Error("The Shield evidence clock is invalid.");
    const binding = { manifestSha256: review.manifestSha256, helperSha256: review.executableIdentity.helperSha256, helperVersion: "switchyard-windows-sandbox-guest/v1", resultSha256: sha(output), toolVersions: {
      guest: "switchyard-windows-sandbox-guest/v1", node: "24.14.0", nodeRuntime: `sha256:${review.executableIdentity.recipeRuntime.sha256}`, catalog: `sha256:${review.catalogSha256}`, guestResultManifest: `sha256:${result.resultManifestSha256}`, scanner: shieldEngineVersion, scannerSource: `sha256:${shield.engineSha256}`, scannerRequest: `sha256:${shield.requestSha256}`,
      ...Object.fromEntries(fixtures.map(f => [`fixture:${f.kind}:${f.id}`, `manifest=sha256:${f.manifestSha256};content=sha256:${f.contentSha256};feed=${f.feedVersion};tool=${f.toolName}@${f.toolVersion}`]))
    }, scannerFixtureIds: [shield.request.scanner.id], advisoryFixtureIds: shield.request.advisory ? [shield.request.advisory.id] : [], coverage: report.coverage.map(c => ({ dimension: c.dimension, status: "unavailable", fixtureId: shield.request.scanner.id })), policyVersion: request.target.policyVersion, createdAt: observedAt.toISOString(), expiresAt: new Date(Math.min(observedAt.getTime() + 300000, ...fixtures.map(f => Date.parse(f.expiresAt)))).toISOString() };
    await guard();
    const typed = createRepositoryRecipeEvidence(request, { status: "completed", summary: "Verified pinned Windows scanner observation", exitCode: 0, output, outputTruncated: false }, binding, now()), receiptEvidenceEnvelope = receiptEvidence.issueRepositoryRecipeEvidence(typed, request, binding);
    return { status: report.outcome === "failed" ? "failed" : "incomplete", effectDisposition: "committed", summary: report.outcome === "failed" ? "The pinned Windows baseline scanner found security or policy findings; full repository coverage remains incomplete." : "The pinned Windows baseline scanner ran; required repository scope and coverage remain incomplete.", data: { shieldReport: report, receiptEvidenceEnvelope } };
  } catch { return incomplete(); }
}
