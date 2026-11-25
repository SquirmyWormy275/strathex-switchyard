/** Host attestation of a completed reviewed Windows guest pipeline; never executes a command. */
import { basename, join, relative } from "node:path";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { InMemoryTestEnvironmentBroker } from "../../packages/control-plane/src/brokers.ts";
import { createRepositoryRecipeEvidence } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { directoryIdentity } from "./private-fs.mjs";
import { scopeHash } from "./confirmations.mjs";
import { windowsPipelineActions } from "./repository-execution-actions.mjs";

const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const identifier = v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const exact = (v, fields) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === fields.slice().sort().join();
const dimensions = action => ["correctness", ...(action === "pipeline_clean_reproduction" ? ["reproduction"] : []), "isolation", "production_data", "ambient_credentials"];
function report(bytes, action) {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), required = dimensions(action);
  if (!exact(value, ["schema", "version", "coverage", "scannerFixtureIds", "advisoryFixtureIds"]) || value.schema !== "sxsy-b122.windows-repository-recipe-result" || value.version !== 1 || !Array.isArray(value.coverage) || value.coverage.length !== required.length) throw Error("The Windows pipeline needs its exact typed report.");
  const seen = new Set();
  for (const entry of value.coverage) {
    if (!exact(entry, ["dimension", "status", "fixtureId"]) || !required.includes(entry.dimension) || seen.has(entry.dimension) || !["covered", "unavailable"].includes(entry.status) || !identifier(entry.fixtureId)) throw Error("The Windows pipeline coverage is absent or ambiguous."); seen.add(entry.dimension);
  }
  const ids = [];
  for (const values of [value.scannerFixtureIds, value.advisoryFixtureIds]) { if (!Array.isArray(values) || values.length > 32 || values.some(v => !identifier(v))) throw Error("The Windows pipeline fixture inventory is unbounded."); ids.push(...values); }
  if (new Set(ids).size !== ids.length) throw Error("The Windows pipeline fixture identities are duplicated or cross-kind.");
  return value;
}
export function windowsPipelineDependencies(policy, review, target) {
  const metadata = new InMemoryTestEnvironmentBroker(policy);
  const recipe = { version: "switchyard-reviewed-windows-pipeline/v1", repositoryRoot: review.repositoryRoot, gates: [{ name: review.action, executable: review.recipe.executable, args: review.recipe.arguments, timeoutMs: review.recipe.timeoutMs }], productionHostPatterns: ["prod", "localhost", "127.0.0.1", "::1"], allowedDevelopmentHosts: [], environmentAllowlist: [] };
  return { recipes: { forTarget: actual => actual.id === target.id ? recipe : undefined }, testEnvironment: { prepare: async request => {
    const result = await metadata.prepare(request); if (!result.environment) return result;
    // Metadata does not modify the reviewed guest environment or map host data.
    return { ...result, environment: { ...result.environment, environment: { NODE_ENV: "test", SXSY_TEST_MODE: "1", SXSY_NETWORK: "deny" } } };
  } } };
}
/** Read only the exact already-exited native result's authenticated output bytes. */
export async function readAttestedWindowsReport({store,compartment,stateDirectory,review,request,result,guard}) {
    await guard(); const native = (await store.snapshot(compartment)).repositoryWindowsRuns?.find(row => row.operationId === request.operationId);
    if (!native || native.nativeExitVerified !== true || native.scopeDigest !== review.scopeDigest || native.action !== request.action || scopeHash(native.result) !== scopeHash(result) || result.programExitCode !== 0 || result.diagnosticRoot || !Array.isArray(result.validatedOutputs) || result.validatedOutputs.length > 256 || !digest(result.resultManifestSha256) || result.recipeCatalogSha256 !== review.catalogSha256 || result.sandboxHelperSha256 !== review.executableIdentity.helperSha256) throw Error("The original Windows guest exit, catalog, helper or result did not verify.");
    const parent = join(stateDirectory, "windows", compartment, "results", request.operationId), root = result.resultRoot;
    if (typeof root !== "string" || relative(parent, root) !== basename(root) || !/^sandbox-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(basename(root))) throw Error("The original Windows report directory changed.");
    const records = result.validatedOutputs.filter(file => file.path === "process.stdout.txt"), before = await directoryIdentity(root);
    if (records.length !== 1 || !digest(records[0].sha256) || !Number.isSafeInteger(records[0].size) || records[0].size < 1 || records[0].size > review.recipe.maxOutputBytes) throw Error("The Windows pipeline report is absent, oversized or ambiguous.");
    const read = await new NodeFileDigestReader({ maxFileBytes: 524288 }).read(root, "process.stdout.txt"); let output;
    try { if (read.bytes.length !== records[0].size || read.digest !== `sha256:${records[0].sha256}`) throw Error("The original report bytes changed after validated extraction."); output = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes); } finally { read.bytes.fill(0); }
    const after = await directoryIdentity(root); if (before.dev !== after.dev || before.ino !== after.ino) throw Error("The report directory changed during inspection.");
    return output;
}

export async function attestWindowsPipeline({ store, compartment, stateDirectory, review, request, result, receiptEvidence, resolveScannerFixtures, guard, now }) {
  const incomplete = summary => ({ status: "incomplete", effectDisposition: "committed", summary });
  if (!windowsPipelineActions.includes(request.action) || request.action !== review.action || request.operationId !== review.operationId) return incomplete("The Windows pipeline result has no exact reviewed action/operation binding.");
  if (result.status !== "completed") return { status: result.status, summary: result.summary };
  try {
    const output=await readAttestedWindowsReport({store,compartment,stateDirectory,review,request,result,guard}),parsed=report(Buffer.from(output,"utf8"),request.action);
    const observedAt = new Date(now()); if (!Number.isFinite(observedAt.getTime())) throw Error("The Windows pipeline evidence clock is invalid.");
    const requested = [...parsed.scannerFixtureIds.map(id => [id, "scanner"]), ...parsed.advisoryFixtureIds.map(id => [id, "advisory"])];
    if (requested.length && typeof resolveScannerFixtures !== "function") throw Error("Signed fixtures are unavailable for this Windows pipeline.");
    const fixtures = requested.length ? await resolveScannerFixtures({ scannerFixtureIds: parsed.scannerFixtureIds, advisoryFixtureIds: parsed.advisoryFixtureIds, observedAt }) : [];
    if (fixtures.length !== requested.length || requested.some(([id, kind]) => fixtures.filter(f => f.id === id && f.kind === kind && digest(f.manifestSha256) && digest(f.contentSha256) && Date.parse(f.expiresAt) > now()).length !== 1)) throw Error("Fresh exact Windows pipeline fixtures did not verify.");
    const binding = { manifestSha256: review.manifestSha256, helperSha256: review.executableIdentity.helperSha256, helperVersion: "switchyard-windows-sandbox-guest/v1", resultSha256: result.resultManifestSha256, toolVersions: { guest: "switchyard-windows-sandbox-guest/v1", node: "24.14.0", catalog: `sha256:${review.catalogSha256}`, ...Object.fromEntries(fixtures.map(f => [`fixture:${f.kind}:${f.id}`, `manifest=sha256:${f.manifestSha256};content=sha256:${f.contentSha256};feed=${f.feedVersion};tool=${f.toolName}@${f.toolVersion}`])) }, scannerFixtureIds: parsed.scannerFixtureIds, advisoryFixtureIds: parsed.advisoryFixtureIds, coverage: parsed.coverage, policyVersion: request.target.policyVersion, createdAt: observedAt.toISOString(), expiresAt: new Date(Math.min(observedAt.getTime() + 300000, ...fixtures.map(f => Date.parse(f.expiresAt)))).toISOString() };
    await guard();
    const typed = createRepositoryRecipeEvidence(request, { status: "completed", summary: "Verified Windows guest result", exitCode: 0, output, outputTruncated: false }, binding, now());
    const receiptEvidenceEnvelope = receiptEvidence.issueRepositoryRecipeEvidence(typed, request, binding), complete = typed.outcome === "passed" && typed.completeness === "complete";
    return { status: complete ? "completed" : "incomplete", effectDisposition: "committed", summary: complete ? "The exact Windows guest pipeline completed with host-authenticated evidence." : "The Windows guest program ran, but required pipeline evidence remains incomplete.", data: { receiptEvidenceEnvelope } };
  } catch { return incomplete("The Windows guest program ran without freshly verified exact pipeline evidence; preserve its original result and do not replay it."); }
}
