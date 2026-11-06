/** Host admission and non-passing evidence for the pinned baseline scanner. */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { createDurableAbortControl } from "../../packages/control-plane/src/execution-cancellation.ts";
import { createRepositoryRecipeEvidence } from "../../apps/windows-companion/src/repository-runtime-broker.ts";
import { pipelineDependencies } from "./repository-pipeline.mjs";
import { shieldActions, shieldEngineVersion, shieldIndexPrefix, validateShieldRequest, scannerPath, shieldReservedPath, pypiIdentity, validateCargoComponent, shieldCycloneDxComponent, shieldArtifactReferenceKey, isPinnedRequirementsPath, npmLicenseDeclaration, npmVersion } from "./shield-scanner-engine.mjs";
import { spdxLicenseMembership, validateNpmArchiveObservation } from "./shield-scanner-engine.mjs";
import { evaluateShieldExceptions } from "./shield-exception-ledger.mjs";
import { resolveShieldIndexWitness } from "./shield-index-inputs.mjs";
import { resolveShieldHistoryWitness } from "./shield-history-inputs.mjs";

const sha = b => createHash("sha256").update(b).digest("hex");
const engineUrl = new URL("./shield-scanner-engine.mjs", import.meta.url);
const empty = summary => ({ status: "incomplete", summary, effectDisposition: "not_started" });
export const shieldFixturePins = fixtures => fixtures.map(f => ({ id: f.id, kind: f.kind, manifestSha256: f.manifestSha256, contentSha256: f.contentSha256, feedVersion: f.feedVersion, toolName: f.toolName, toolVersion: f.toolVersion, expiresAt: f.expiresAt })).sort((a, b) => a.id.localeCompare(b.id));
const pins=shieldFixturePins;
/** A failed findings gate may retain an authenticated incomplete observation.
 * This never converts a failed native process or a partial scan to completion. */
export function shieldReceiptEvidence(factory) {
  return {
    issue: factory.issue.bind(factory),
    issueRepositoryRecipeEvidence: factory.issueRepositoryRecipeEvidence.bind(factory),
    forResult(definition, result, target) {
      const decision=result.data?.shieldExceptionEvaluation, envelope=result.data?.receiptEvidenceEnvelope;
      if(decision!==undefined||envelope?.evidence?.toolVersions?.shieldExceptions!==undefined){if(!decision||decision.action!==definition.action||decision.targetSnapshotId!==target?.id||decision.completeness!=="incomplete"||decision.gateEligible!==false||envelope?.evidence?.toolVersions?.shieldExceptions!==`sha256:${sha(JSON.stringify(decision))}`)return undefined;}
      if (result.status !== "failed" || !shieldActions.includes(definition.action)) return factory.forResult(definition, result, target);
      const report = result.data?.shieldReport;
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
export async function validateShieldRecipe({ recipe, repositoryRoot, action, resolveFixtures, resolveIndexInputs, resolveHistoryInputs, now = Date.now }) {
  if (!shieldActions.includes(action)) return undefined;
  if (recipe.cwd !== "." || recipe.workspaceMode === "temporary-build" || recipe.args.length !== 2 || await realpath(recipe.executable) !== await realpath(process.execPath) || Object.keys(recipe.environment).some(k => k !== "NODE_ENV") || recipe.environment.NODE_ENV !== "test") throw Error("Shield requires the pinned Node scanner, two literal inputs, test environment and read-only workspace.");
  return validateShieldBundle({inputFiles:recipe.inputFiles,enginePath:recipe.args[0],requestPath:recipe.args[1],repositoryRoot,action,resolveFixtures,resolveIndexInputs,resolveHistoryInputs,now});
}

export async function validateShieldBundle({inputFiles,enginePath,requestPath,repositoryRoot,action,resolveFixtures,resolveIndexInputs,resolveHistoryInputs,additionalFiles=[],now=Date.now}) {
  // Node interprets a leading dash as an option before opening its entrypoint.
  // A file containing the right engine bytes named '-e' must never turn the
  // second literal filename into JavaScript evaluated by Node.
  if (typeof enginePath !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*\.mjs$/.test(enginePath)) throw Error("Shield requires one literal .mjs entrypoint path without Node options.");
  enginePath=scannerPath(enginePath);requestPath=scannerPath(requestPath);
  if ([enginePath, requestPath, ...additionalFiles].some(path => shieldReservedPath(path))) throw Error("Scanner control files cannot use reserved index aliases.");
  const inputs = new Map(inputFiles.map(f => [f.path, f])), engineSha256 = sha(await readFile(engineUrl));
  if (enginePath === requestPath || inputs.get(enginePath)?.sha256 !== engineSha256 || !inputs.has(requestPath)) throw Error("Shield requires the exact shipped scanner bytes and a reviewed request input.");
  const reader = new NodeFileDigestReader({ maxFileBytes: 128 * 1024 });
  const r = await reader.read(repositoryRoot, requestPath); let request;
  try { if (r.digest !== `sha256:${inputs.get(requestPath).sha256}`) throw Error("Shield request changed."); request = validateShieldRequest(JSON.parse(r.bytes.toString("utf8"))); } finally { r.bytes.fill(0); }
  if (request.action !== action) throw Error("Shield request action does not match the exact grant.");
  if ([request.scanner.path, request.advisory?.path].some(path => shieldReservedPath(path))) throw Error("Scanner feeds cannot use reserved index aliases.");
  const declared = [...additionalFiles.map(scannerPath), enginePath, requestPath, request.scanner.path, ...(request.advisory ? [request.advisory.path] : []), ...request.files.map(f => f.path)];
  if (new Set(declared).size !== declared.length || inputs.size !== declared.length || declared.some(p => !inputs.has(p))) throw Error("Shield requires precisely the reviewed engine, request, feeds and scanned inputs.");
  for (const f of [...request.files, request.scanner, ...(request.advisory ? [request.advisory] : [])]) if (inputs.get(f.path)?.sha256 !== f.sha256 || f.size !== undefined && inputs.get(f.path)?.size !== f.size) throw Error("Shield input witnesses do not match the exact request.");
  if (typeof resolveFixtures !== "function") throw Error("Shield requires installed signed scanner feeds.");
  const fixtures = await resolveFixtures({ scannerFixtureIds: [request.scanner.id], advisoryFixtureIds: request.advisory ? [request.advisory.id] : [], observedAt: new Date(now()) });
  for (const [kind, f] of [["scanner", request.scanner], ...(request.advisory ? [["advisory", request.advisory]] : [])]) {
    const actual = fixtures.find(a => a.id === f.id && a.kind === kind);
    if (!actual || actual.contentSha256 !== f.sha256 || actual.toolName !== "switchyard-baseline-scanner" || actual.toolVersion !== "1") throw Error("Shield feed bytes or exact scanner version do not match installed trust.");
  }
  const indexWitness = await resolveShieldIndexWitness(request, resolveIndexInputs),historyWitness=await resolveShieldHistoryWitness(request,resolveHistoryInputs);
  return { engine: shieldEngineVersion, engineSha256, requestSha256: sha(JSON.stringify(request)), request, feeds: pins(fixtures), scope: "reviewed-inputs", repositoryScopeVerified: false, completeShieldGateAvailable: false, ...(indexWitness ? { indexWitness } : {}),...(historyWitness?{historyWitness}:{}) };
}

export function parseShieldScannerReport(output,shield,action) {
  if(typeof output!=="string"||Buffer.byteLength(output)>480*1024)throw Error("Invalid bounded Shield report.");
  const report=JSON.parse(output),exact=(v,fields)=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join()===fields.slice().sort().join(),digest=v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v),id=v=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
  const required={shield_change_scan:["secrets","pii","security_defects"],shield_codebase_audit:["secrets","history","insecure_paths","permissions","infrastructure"],shield_supply_chain:["vulnerabilities","licenses","provenance","sbom"],release_shield:["secrets","pii","security_defects","history","insecure_paths","permissions","infrastructure","vulnerabilities","licenses","provenance","sbom","isolation"]}[action];
  if(!required||!exact(report,["schema","version","engine","action","scope","requestSha256","scanner","advisory","outcome","completeness","coverage","gaps","inventory","findings","sbom","cycloneDx"])||report.schema!=="switchyard-shield-findings/v1"||report.version!==1||report.engine!==shield.engine||report.action!==action||report.requestSha256!==shield.requestSha256||report.scope!=="reviewed-inputs"||report.completeness!=="incomplete"||JSON.stringify(report.scanner)!==JSON.stringify(shield.request.scanner)||JSON.stringify(report.advisory)!==JSON.stringify(shield.request.advisory))throw Error("Shield report is not the exact pinned incomplete-scope result.");
  const allowedGaps=new Set(["repository_scope_unverified","binary_or_non_utf8_input","finding_limit","unsupported_dependency_ecosystem","invalid_npm_lock","unsupported_npm_lock","unsupported_npm_package","workspace_source_unverified","advisory_severity_unassessed","advisory_package_coverage","license_metadata","license_policy","license_choice_not_selected","package_source_or_integrity","git_history_not_scanned","git_history_partially_scanned","source_permissions_not_witnessed","publisher_provenance_not_verified","host_isolation_requires_attestation","advisory_feed_missing","npm_lock_missing","dependency_manifest_missing","unsupported_python_requirements","python_environment_not_resolved","unsupported_cargo_lock","cargo_resolution_not_performed","package_artifact_not_verified","artifact_contents_not_inspected","npm_archive_identity_not_verified"]);
  if(!Array.isArray(report.gaps)||report.gaps.length>32||new Set(report.gaps).size!==report.gaps.length||!report.gaps.includes("repository_scope_unverified")||report.gaps.some(g=>!allowedGaps.has(g)))throw Error("Invalid Shield coverage gaps.");
  const files=new Map(shield.request.files.map(f=>[f.path,f]));
  if(!Array.isArray(report.inventory)||report.inventory.length!==files.size||new Set(report.inventory.map(f=>f.path)).size!==files.size||report.inventory.some(f=>!exact(f,["path","sha256","bytes",...(files.get(f.path)?.source?["source"]:[])])||!files.has(f.path)||files.get(f.path).sha256!==f.sha256||files.get(f.path).size!==f.bytes||JSON.stringify(f.source)!==JSON.stringify(files.get(f.path).source)))throw Error("Shield report source inventory changed.");
  if(!Array.isArray(report.findings)||report.findings.length>512||new Set(report.findings.map(f=>f.fingerprint)).size!==report.findings.length||report.findings.some(f=>!exact(f,["ruleId","dimension","severity","path","line","fingerprint"])||!id(f.ruleId)||!required.includes(f.dimension)||(!["low","medium","high","critical"].includes(f.severity)&&!(f.severity==="unknown"&&f.dimension==="vulnerabilities"))||!files.has(f.path)||!digest(f.fingerprint)||(f.line===null?!["vulnerabilities","licenses"].includes(f.dimension)&&!(f.dimension==="provenance"&&["artifact.integrity-mismatch","artifact.identity-mismatch"].includes(f.ruleId)):!Number.isSafeInteger(f.line)||f.line<1||f.line>files.get(f.path).size+1))||report.outcome!==(report.findings.length?"failed":"incomplete"))throw Error("Invalid exact Shield findings.");
  if(!Array.isArray(report.coverage)||report.coverage.length!==required.length||new Set(report.coverage.map(c=>c.dimension)).size!==required.length||report.coverage.some(c=>!exact(c,["dimension","status","rules","findings"])||!required.includes(c.dimension)||c.status!=="incomplete"||!Array.isArray(c.rules)||c.rules.length>32||new Set(c.rules).size!==c.rules.length||c.rules.some(r=>!id(r))||c.findings!==report.findings.filter(f=>f.dimension===c.dimension).length))throw Error("Invalid Shield coverage matrix.");
  if(!exact(report.sbom,["schema","components"])||report.sbom.schema!=="switchyard-lock-inventory/v2"||!Array.isArray(report.sbom.components)||report.sbom.components.length>4096)throw Error("Invalid Shield dependency inventory.");
  const componentKeys = new Set(), artifactReferences = new Map((shield.request.packageArtifacts ?? []).map(row => [shieldArtifactReferenceKey(row), row])), observedArtifacts = new Set();
  if (artifactReferences.size && !report.gaps.includes("artifact_contents_not_inspected")) throw Error("Artifact byte comparisons cannot attest archive contents.");
  for(const component of report.sbom.components){
    if(!component||!files.has(component.lockPath??component.requirementsPath))throw Error("Dependency inventory is outside its witnessed manifest.");
    let key;
    if(component.ecosystem==="PyPI"){
      if(!exact(component,["ecosystem","name","version","requirementsPath","declaredSha256",...(Object.hasOwn(component,"artifact")?["artifact"]:[])])||!isPinnedRequirementsPath(component.requirementsPath)||pypiIdentity(component.name,component.version).name!==component.name||!Array.isArray(component.declaredSha256)||component.declaredSha256.length>64||component.declaredSha256.some(value=>!digest(value))||new Set(component.declaredSha256).size!==component.declaredSha256.length||component.declaredSha256.join()!==component.declaredSha256.slice().sort().join())throw Error("Invalid exact Python requirement inventory.");
      const referenceKey = shieldArtifactReferenceKey(component), reference = artifactReferences.get(referenceKey);
      if (reference) {
        const a = component.artifact, file = files.get(reference.path);
        if (!exact(a, ["path", "sha256", "size", "algorithm", "acceptedSha256", "status"]) || a.path !== reference.path || a.sha256 !== file?.sha256 || a.size !== file?.size || a.algorithm !== "sha256"
          || JSON.stringify(a.acceptedSha256) !== JSON.stringify(component.declaredSha256)
          || a.status !== (!component.declaredSha256.length ? "unsupported-integrity" : component.declaredSha256.includes(a.sha256) ? "matched" : "mismatched")) throw Error("Python artifact observation differs from its exact reviewed bytes and declared alternatives.");
        if (a.status !== "matched" && !report.gaps.includes("package_artifact_not_verified")) throw Error("Unmatched Python artifacts must retain their coverage gap.");
        if (a.status === "mismatched") {
          const fingerprint = sha(`artifact.integrity-mismatch\0PyPI\0${component.requirementsPath}\0${files.get(component.requirementsPath).sha256}\0${component.name}\0${component.version}\0${a.path}\0${a.sha256}`);
          if (!report.findings.some(f => f.ruleId === "artifact.integrity-mismatch" && f.dimension === "provenance" && f.severity === "high" && f.path === component.requirementsPath && f.line === null && f.fingerprint === fingerprint) && !(report.findings.length === 512 && report.gaps.includes("finding_limit"))) throw Error("A mismatched Python artifact cannot lose its failed integrity finding.");
        }
        observedArtifacts.add(referenceKey);
      } else if (Object.hasOwn(component, "artifact") || !report.gaps.includes("package_artifact_not_verified")) throw Error("Unreviewed Python artifacts cannot claim verified bytes.");
      key="PyPI\0"+component.requirementsPath+"\0"+component.name;
    }else if(component.ecosystem==="Cargo"){
      validateCargoComponent(component);key=JSON.stringify(["Cargo",component.lockPath,component.name,component.version,component.sourceSha256]);
      const reference = artifactReferences.get(key);
      if (reference) {
        const a = component.artifact, file = files.get(reference.path);
        if (!a || a.path !== reference.path || a.sha256 !== file?.sha256 || a.size !== file?.size) throw Error("Cargo artifact observation differs from its exact reviewed bytes.");
        if (a.status === "mismatched") {
          if (!report.gaps.includes("package_artifact_not_verified")) throw Error("Unmatched Cargo artifacts must retain their coverage gap.");
          const fingerprint = sha(`artifact.integrity-mismatch\0Cargo\0${component.lockPath}\0${files.get(component.lockPath).sha256}\0${component.name}\0${component.version}\0${component.sourceSha256}\0${a.path}\0${a.sha256}`);
          if (!report.findings.some(f => f.ruleId === "artifact.integrity-mismatch" && f.dimension === "provenance" && f.severity === "high" && f.path === component.lockPath && f.line === null && f.fingerprint === fingerprint) && !(report.findings.length === 512 && report.gaps.includes("finding_limit"))) throw Error("A mismatched Cargo artifact cannot lose its failed integrity finding.");
        }
        observedArtifacts.add(key);
      } else if (Object.hasOwn(component, "artifact") || !report.gaps.includes("package_artifact_not_verified")) throw Error("Unreviewed Cargo artifacts cannot claim verified bytes.");
    }else if(component.ecosystem==="npm"){
      const name=value=>typeof value==="string"&&![".",".."].includes(value)&&/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]{1,128}$/.test(value);
      if(!exact(component,["ecosystem","name","installedAs","version","location","lockPath","license","integritySha256",...(Object.hasOwn(component,"workspace")?["workspace"]:[]),...(Object.hasOwn(component,"artifact")?["artifact"]:[])])||!name(component.name)||!name(component.installedAs)||!npmVersion(component.version)||component.license!==null&&npmLicenseDeclaration(component.license)?.expression!==component.license||component.integritySha256!==null&&!digest(component.integritySha256))throw Error("Invalid exact npm inventory.");
      scannerPath(component.location); const parts=component.location.split("/"),index=parts.lastIndexOf("node_modules");
      if ((!component.license || !spdxLicenseMembership(component.license).listed) && !report.gaps.includes("license_metadata")) throw Error("Missing or unlisted license identifiers must retain their metadata gap.");
      if(component.lockPath.split("/").at(-1)!=="package-lock.json"||parts.includes(".git")||index<0||parts.slice(index+1).join("/")!==component.installedAs)throw Error("Invalid exact npm installation location.");
      if(Object.hasOwn(component,"workspace")){if(!exact(component.workspace,["path","lockMetadataSha256"])||!digest(component.workspace.lockMetadataSha256))throw Error("Invalid exact workspace metadata.");scannerPath(component.workspace.path);if(component.workspace.path.split("/").some(part=>part==="node_modules"||part===".git"))throw Error("Invalid workspace source path.");}
      const referenceKey = JSON.stringify([component.lockPath, component.location]), reference = artifactReferences.get(referenceKey);
      if (reference) {
        const a = component.artifact, file = files.get(reference.path), hash512 = v => typeof v === "string" && /^[a-f0-9]{128}$/.test(v);
        if (component.workspace || !exact(a, ["path", "sha256", "size", "observedSha512", "algorithm", "expectedSha512", "status", "archive"]) || a.path !== reference.path || a.sha256 !== file?.sha256 || a.size !== file?.size || a.algorithm !== "sha512" || !hash512(a.observedSha512)
          || a.expectedSha512 !== null && (!hash512(a.expectedSha512) || component.integritySha256 !== sha("sha512-" + Buffer.from(a.expectedSha512, "hex").toString("base64")))
          || a.status !== (a.expectedSha512 === null ? "unsupported-integrity" : a.expectedSha512 === a.observedSha512 ? "matched" : "mismatched")) throw Error("Artifact observation differs from its exact reviewed reference and integrity declaration.");
        validateNpmArchiveObservation(a.archive, component.name, component.version);
        if (a.archive.status !== "matched" && !report.gaps.includes("npm_archive_identity_not_verified")) throw Error("Unverified npm archive identity must retain its coverage gap.");
        if (a.archive.status === "mismatched") {
          const fingerprint = sha(["artifact.identity-mismatch", component.lockPath, files.get(component.lockPath).sha256, component.location, a.path, a.sha256, a.archive.manifestSha256].join("\0"));
          if (!report.findings.some(f => f.ruleId === "artifact.identity-mismatch" && f.dimension === "provenance" && f.severity === "high" && f.path === component.lockPath && f.line === null && f.fingerprint === fingerprint) && !(report.findings.length === 512 && report.gaps.includes("finding_limit"))) throw Error("A mismatched archive identity cannot lose its failed finding.");
        }
        if (a.status !== "matched" && !report.gaps.includes("package_artifact_not_verified")) throw Error("Unmatched artifacts must retain their explicit coverage gap.");
        if (a.status === "mismatched") {
          const fingerprint = sha(`artifact.integrity-mismatch\0${component.lockPath}\0${files.get(component.lockPath).sha256}\0${component.location}\0${a.path}\0${a.sha256}`);
          if (!report.findings.some(f => f.ruleId === "artifact.integrity-mismatch" && f.dimension === "provenance" && f.severity === "high" && f.path === component.lockPath && f.line === null && f.fingerprint === fingerprint) && !(report.findings.length === 512 && report.gaps.includes("finding_limit"))) throw Error("A mismatched artifact cannot lose its failed integrity finding.");
        }
        observedArtifacts.add(referenceKey);
      } else if (Object.hasOwn(component, "artifact") || !report.gaps.includes("package_artifact_not_verified")) throw Error("Unreviewed package artifacts cannot claim verified bytes.");
      key="npm\0"+component.lockPath+"\0"+component.location;
    }else throw Error("Unsupported dependency inventory ecosystem.");
    if(componentKeys.has(key))throw Error("Duplicate dependency inventory location.");componentKeys.add(key);
  }
  if (observedArtifacts.size !== artifactReferences.size) throw Error("A reviewed artifact observation is missing.");
  if(required.includes("sbom")){
    const bom=report.cycloneDx;
    if(JSON.stringify(bom?.components)!==JSON.stringify(report.sbom.components.map(shieldCycloneDxComponent)))throw Error("BOM components differ from the exact validated dependency inventory.");
    if(!exact(bom,["bomFormat","specVersion","version","metadata","components","compositions"])||bom.bomFormat!=="CycloneDX"||bom.specVersion!=="1.6"||bom.version!==1||!Array.isArray(bom.components)||bom.components.length!==report.sbom.components.length||JSON.stringify(bom.compositions)!==JSON.stringify([{aggregate:"unknown"}])||!Array.isArray(bom.metadata?.properties)||!["repository-scope","dependency-graph","publisher-provenance"].every((name,index)=>bom.metadata.properties.some(p=>p.name==="switchyard:"+name&&p.value===["unverified","not-collected","not-verified"][index])))throw Error("Invalid explicitly incomplete Shield BOM.");
  }else if(report.cycloneDx!==null)throw Error("This Shield action does not attest an SBOM.");
  return report;
}

export function shieldDependencies(options) {
  const { runtime, review, target, receiptEvidence, now, resolveScannerFixtures, resolveShieldExceptions } = options;
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
      const report = parseShieldScannerReport(result.output,shield,request.action);
      // This engine cannot attest full repository scope/history or broad security
      // coverage. Never upgrade its baseline results into a passing Shield gate.
      const fixtures = await resolveCurrent(); if (!(await guard()).allowed || control.signal.aborted) throw Error("Shield authority changed before evidence issuance.");
      const shieldExceptionEvaluation=await evaluateShieldExceptions(resolveShieldExceptions,{action:request.action,targetSnapshotId:target.id,scannerSourceSha256:shield.engineSha256,findings:report.findings},now());
      const createdAt = new Date(now()).toISOString(), expiresAt = new Date(Math.min(now() + 300000, ...fixtures.map(f => Date.parse(f.expiresAt)),shieldExceptionEvaluation?.expiresAt?Date.parse(shieldExceptionEvaluation.expiresAt):Infinity)).toISOString();
      const binding = { manifestSha256: review.manifestSha256, helperSha256: shield.engineSha256, helperVersion: shieldEngineVersion, resultSha256: sha(result.output), toolVersions: { node: process.versions.node, repositoryExecutable: `sha256:${review.executableIdentity.sha256}`, scanner: shieldEngineVersion, scannerSource: `sha256:${shield.engineSha256}`, scannerRequest: `sha256:${shield.requestSha256}`, ...Object.fromEntries(fixtures.map(f => [`fixture:${f.kind}:${f.id}`, `manifest=sha256:${f.manifestSha256};content=sha256:${f.contentSha256};feed=${f.feedVersion};tool=${f.toolName}@${f.toolVersion}`])) }, scannerFixtureIds: [shield.request.scanner.id], advisoryFixtureIds: shield.request.advisory ? [shield.request.advisory.id] : [], coverage: report.coverage.map(c => ({ dimension: c.dimension, status: "unavailable", fixtureId: shield.request.scanner.id })), policyVersion: request.target.policyVersion, createdAt, expiresAt };
      if(shield.historyWitness)binding.toolVersions.gitHistoryInputs=`sha256:${sha(JSON.stringify(shield.historyWitness))}`;
      if(shield.indexWitness)binding.toolVersions.gitIndexInputs=`sha256:${sha(JSON.stringify(shield.indexWitness))}`;
      if(shieldExceptionEvaluation)binding.toolVersions.shieldExceptions=`sha256:${sha(JSON.stringify(shieldExceptionEvaluation))}`;
      // Authenticate the incomplete observation and report hash. The separate
      // command receipt records findings as failed; no completion proof is issued.
      const evidence = createRepositoryRecipeEvidence(request, result, binding, now()), receiptEvidenceEnvelope = receiptEvidence.issueRepositoryRecipeEvidence(evidence, request, binding);
      return { status: report.outcome === "failed"&&!shieldExceptionEvaluation?.allFindingsExcepted ? "failed" : "incomplete", summary: shieldExceptionEvaluation?.allFindingsExcepted?"Exact findings have current reviewed exceptions; mandatory Shield coverage remains incomplete.":report.outcome === "failed" ? "Shield found baseline security or policy findings. Full repository coverage remains incomplete." : "The pinned baseline scanner ran; full repository scope and required coverage remain incomplete.", effectDisposition: result.effectDisposition, data: { shieldReport: report, receiptEvidenceEnvelope,...(shieldExceptionEvaluation?{shieldExceptionEvaluation}:{}) } };
    } catch { return { status: "incomplete", summary: "Shield could not verify its original scanner, signed feeds or exact report. No passing gate was issued.", effectDisposition: result?.effectDisposition ?? "not_started" }; }
    finally { control.dispose(); }
  } };
}
