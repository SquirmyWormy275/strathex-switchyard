/** Validate CI proof claims only. This cannot create a token, grant trust or accept a guest/account. */
import assert from "node:assert/strict";
import { stateLockFailureEvidence } from "../tools/layout-studio/keyless-lease-pool.mjs";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const hashOrNull = value => value === null || typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function validSelfQueryAcl(value, complete = false, scopes = ["cold-probe", "node-owner"]) {
  const flags = ["originalAcesPreserved", "exactQueryEntryVerified", "tokenRestrictionsRechecked", "handlesClosedVerified", "buffersClearedVerified"];
  return Array.isArray(value) && value.length <= scopes.length && (!complete || value.length === scopes.length) && value.every((r, i) => object(r)
    && Object.keys(r).sort().join() === ["schema", "scope", "status", "grantedMask", "changeRequested", "beforeAclSha256", "afterAclSha256", ...flags].sort().join()
    && r.schema === "switchyard-child-self-query-acl/v1" && r.scope === scopes[i]
    && ["reserved", "apply-requested", "readback", "verified"].includes(r.status) && r.grantedMask === 8 && typeof r.changeRequested === "boolean"
    && hashOrNull(r.beforeAclSha256) && hashOrNull(r.afterAclSha256) && flags.every(k => typeof r[k] === "boolean")
    && (!complete || r.status === "verified" && flags.every(k => r[k] === true) && r.beforeAclSha256 !== null && r.afterAclSha256 !== null
      && r.changeRequested === (r.beforeAclSha256 !== r.afterAclSha256)));
}
const rngImports = { BCryptGenRandom: "bcrypt.dll", CryptAcquireContextW: "advapi32.dll", CryptGenRandom: "advapi32.dll", CryptReleaseContext: "advapi32.dll" };
/** Static imports are observations, not proof of the runtime OpenSSL branch. */
export function parseNodeRngImports(text, nodeSha256) {
  assert.equal(typeof text, "string"); assert.ok(Buffer.byteLength(text) > 0 && Buffer.byteLength(text) <= 1048576);
  assert.match(nodeSha256, /^[a-f0-9]{64}$/); assert.ok(!text.includes("\0") && /^\s*Dump of file .+$/m.test(text) && /^\s*Summary\s*$/m.test(text));
  let dll = null; const imports = Object.fromEntries(Object.keys(rngImports).map(name => [name, false]));
  for (const line of text.split(/\r?\n/)) {
    const module = /^\s+([A-Za-z0-9_.-]+\.dll)\s*$/.exec(line); if (module) { dll = module[1].toLowerCase(); continue; }
    const entry = /^\s+[A-Fa-f0-9]{1,8}\s+(BCryptGenRandom|CryptAcquireContextW|CryptGenRandom|CryptReleaseContext)\s*$/.exec(line);
    if (entry) { assert.equal(dll, rngImports[entry[1]], "The observed RNG import belongs to an unexpected module."); imports[entry[1]] = true; }
  }
  return { schema: "switchyard-node-rng-imports/v1", nodeSha256, tool: "dumpbin-imports", imports, runtimeBranchVerified: false, nodeStartupAccepted: false };
}
export function verifyNodeRngImports(value, nodeSha256) {
  assert.ok(object(value)); assert.deepEqual(Object.keys(value).sort(), ["schema", "nodeSha256", "tool", "imports", "runtimeBranchVerified", "nodeStartupAccepted"].sort());
  assert.match(nodeSha256, /^[a-f0-9]{64}$/); assert.equal(value.schema, "switchyard-node-rng-imports/v1"); assert.equal(value.nodeSha256, nodeSha256); assert.equal(value.tool, "dumpbin-imports");
  assert.ok(object(value.imports)); assert.deepEqual(Object.keys(value.imports).sort(), Object.keys(rngImports).sort()); assert.ok(Object.values(value.imports).every(flag => typeof flag === "boolean"));
  assert.equal(value.runtimeBranchVerified, false); assert.equal(value.nodeStartupAccepted, false); return structuredClone(value);
}
const stdioFields = ["schema", "standardHandles", "inheritanceRestricted", "stdinEof", "stdoutBytes", "stderrBytes", "outputBounded", "handlesClosedVerified", "drainsCompleted", "stderr"].sort();
function validStdio(value) {
  if (!object(value) || Object.keys(value).sort().join() !== stdioFields.join() || value.schema !== "switchyard-restricted-child-stdio/v1" || value.standardHandles !== 3) return false;
  if (!["inheritanceRestricted", "stdinEof", "handlesClosedVerified", "drainsCompleted"].every(key => value[key] === true)) return false;
  if (![value.stdoutBytes, value.stderrBytes].every(count => Number.isSafeInteger(count) && count >= 0) || value.outputBounded !== (value.stdoutBytes <= 65536 && value.stderrBytes <= 8192)) return false;
  const error = value.stderr;
  if (!object(error) || Object.keys(error).sort().join() !== "category,code,function,sourceFile,sourceLine" || !["empty", "assertion", "node-native", "javascript", "unclassified"].includes(error.category)) return false;
  const sources = ["node.cc", "node_main.cc", "node_platform.cc", "node_errors.cc", "node_api.cc", "node_file.cc", "node_process_methods.cc", "node_process_object.cc", "env.cc", "env-inl.h", "util.cc", "util.h", "util-inl.h", "crypto_util.cc"];
  if (!(error.sourceFile === null && error.sourceLine === null) && !(error.category === "assertion" && sources.includes(error.sourceFile) && Number.isInteger(error.sourceLine) && error.sourceLine >= 1 && error.sourceLine <= 99999)) return false;
  if ((error.category === "empty") !== (value.stderrBytes === 0) || error.category === "empty" && (error.function !== null || error.code !== null)) return false;
  return [null, "uv_thread_create", "uv_os_get_passwd", "uv_loop_init", "uv_tty_init", "uv_pipe_init", "uv_pipe_open", "uv_guess_handle", "uv_disable_stdio_inheritance", "uv_signal_init", "uv_mutex_init", "ncrypto::CSPRNG"].includes(error.function) && [null, "UV_UNKNOWN", "EACCES", "EPERM", "EBADF", "EINVAL", "ENOENT", "ENOMEM"].includes(error.code);
}
/** Retain the bounded child diagnostic through the coordinator's privacy projection. */
export function storageBrokerFailureEvidence(value) {
  if (!object(value) || value.schema !== "switchyard-storage-broker-protocol-proof/v1" || value.success !== false) return undefined;
  const fields = ["schema", "success", "errorCategory", "nativeCode", "errorHResult", "nativeExchangeChecks", "failedCheckPhase", "restrictedHostPhase", "restrictedHostCreatorPrivileges", "restrictedHostHistoricalFilterFlags", "restrictedHostHistoricalFilterBytes", "restrictedHostTokenRead"];
  const result = Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]));
  if (validSelfQueryAcl(value.restrictedHostSelfTokenQueryAcl)) result.restrictedHostSelfTokenQueryAcl = structuredClone(value.restrictedHostSelfTokenQueryAcl);
  const consoles = value.restrictedHostLeaseConsoles;
  const flags = ["entryObserved", "primaryTokenVerified", "tokenRecheckedAfterExit", "treeExitVerified", "processHandlesClosedVerified", "creatorQuotaRestoredVerified"];
  const uintOrNull = x => x === null || Number.isSafeInteger(x) && x >= 0 && x <= 0xffffffff;
  if (Array.isArray(consoles) && consoles.length <= 2 && consoles.every((r,i) => object(r)
      && Object.keys(r).sort().join() === ["schema", "mode", "executableSha256", "stage", "waitResult", "exitCode", "queryAcl", "standardIo", ...(r.schema === "switchyard-lease-console-probe/v2" ? ["imageSubsystem"] : []), ...flags].sort().join()
      && (r.schema === "switchyard-lease-console-probe/v1" || r.schema === "switchyard-lease-console-probe/v2" && r.imageSubsystem === "windows-gui") && r.mode === ["no-window", "detached"][i] && typeof r.executableSha256 === "string" && /^[a-f0-9]{64}$/.test(r.executableSha256)
      && ["reserved", "created-suspended", "token-verified", "query-verified", "resumed", "exited", "retired"].includes(r.stage) && uintOrNull(r.waitResult) && uintOrNull(r.exitCode)
      && flags.every(k => typeof r[k] === "boolean") && (r.queryAcl === null || validSelfQueryAcl([r.queryAcl], false, ["lease-" + r.mode]))
      && (r.standardIo === null || validStdio(r.standardIo))
      && (!r.entryObserved || r.standardIo?.stderrBytes >= 14 && r.standardIo.stderr.category !== "empty")
      && (r.stage !== "retired" || flags.filter(k=>k!=="entryObserved").every(k=>r[k]) && [0,258].includes(r.waitResult) && (r.waitResult === 0 ? r.exitCode !== null : r.exitCode === null) && r.standardIo?.outputBounded === true && validSelfQueryAcl([r.queryAcl], true, ["lease-"+r.mode])))) result.restrictedHostLeaseConsoles = structuredClone(consoles);
  const child = value.restrictedHostChildExit;
  const types = { waitResult: "uint", exitCode: "uint", resultAvailable: "boolean", childReportedSuccess: "boolean", ownerReportedSuccess: "boolean", completedChecks: "count", failedPhase: "label", failureCategory: "label", stateLockFailure: "state-lock" };
  if (object(child) && Object.hasOwn(child, "waitResult") && Object.hasOwn(child, "resultAvailable") && Object.entries(child).every(([key, item]) => Object.hasOwn(types, key) && (types[key] === "state-lock" ? item === null || !!stateLockFailureEvidence(item) : types[key] === "boolean" ? typeof item === "boolean" : types[key] === "label" ? item === null || typeof item === "string" && /^[A-Za-z0-9-]{1,80}$/.test(item) : Number.isSafeInteger(item) && item >= 0 && item <= (types[key] === "count" ? 8 : 0xffffffff)))) result.restrictedHostChildExit = structuredClone(child);
  const events = value.restrictedHostApplicationEvents, modules = ["node.exe", "ntdll.dll", "kernel32.dll", "kernelbase.dll", "user32.dll", "gdi32.dll", "gdi32full.dll", "ucrtbase.dll", "advapi32.dll", "crypt32.dll", "wintrust.dll", "ws2_32.dll", "bcrypt.dll", "sechost.dll", "unrecognized"];
  if (object(events) && Object.keys(events).sort().join() === "entries,handlesClosedVerified,queryStatus,schema" && events.schema === "switchyard-restricted-child-application-events/v1" && ["completed", "unavailable"].includes(events.queryStatus) && typeof events.handlesClosedVerified === "boolean" && (events.queryStatus !== "completed" || events.handlesClosedVerified) && Array.isArray(events.entries) && events.entries.length <= 4 && (events.queryStatus !== "unavailable" || events.entries.length === 0) && events.entries.every(entry => object(entry) && Object.keys(entry).sort().join() === "eventId,exceptionCode,module" && entry.eventId === 1000 && (entry.exceptionCode === null || typeof entry.exceptionCode === "string" && /^[a-f0-9]{8}$/.test(entry.exceptionCode)) && modules.includes(entry.module))) result.restrictedHostApplicationEvents = structuredClone(events);
  const access = value.restrictedHostUserObjectAccess;
  if (object(access) && Object.keys(access).sort().join() === "desktopError,desktopOpened,handlesClosedVerified,namespaceRestoredVerified,schema,stationError,stationOpened" && access.schema === "switchyard-restricted-user-object-access/v1" && access.handlesClosedVerified === true && access.namespaceRestoredVerified === true && ["station", "desktop"].every(kind => typeof access[kind + "Opened"] === "boolean" && Number.isSafeInteger(access[kind + "Error"]) && access[kind + "Error"] >= 0 && access[kind + "Error"] <= 0xffff && access[kind + "Opened"] === (access[kind + "Error"] === 0))) result.restrictedHostUserObjectAccess = structuredClone(access);
  const namespaces = value.restrictedHostNamespaceAccess, scopes = ["global", "session", "restricted-session"], masks = ["query-traverse", "directory-operations", "all"];
  if (object(namespaces) && Object.keys(namespaces).sort().join() === "entries,handlesClosedVerified,queryStatus,schema" && namespaces.schema === "switchyard-restricted-namespace-access/v1" && namespaces.handlesClosedVerified === true && ["completed", "unavailable"].includes(namespaces.queryStatus) && Array.isArray(namespaces.entries) && namespaces.entries.length === (namespaces.queryStatus === "completed" ? 9 : 0) && namespaces.entries.every((entry, i) => object(entry) && Object.keys(entry).sort().join() === "access,creatorStatus,restrictedStatus,scope" && entry.scope === scopes[Math.floor(i / 3)] && entry.access === masks[i % 3] && [entry.creatorStatus, entry.restrictedStatus].every(status => Number.isInteger(status) && status >= 0 && status <= 0xffffffff))) result.restrictedHostNamespaceAccess = structuredClone(namespaces);
  const random = value.restrictedHostRandomAccess;
  const uint = number => Number.isInteger(number) && number >= 0 && number <= 0xffffffff;
  const security = value.restrictedHostTokenObjectSecurity;
  const principals = ["current-user", "system", "administrators", "everyone", "authenticated-users", "users", "logon", "other"];
  if (Array.isArray(security) && security.length <= 2 && security.every((entry, i) => object(entry)
      && Object.keys(entry).sort().join() === "buffersClearedVerified,daclPresent,daclProtected,entries,error,handlesClosedVerified,nullDacl,ownerClass,schema,scope,stage"
      && entry.schema === "switchyard-child-token-security/v1" && entry.scope === ["cold-probe", "node-owner"][i]
      && ["open", "read", "parse", "complete"].includes(entry.stage) && uint(entry.error) && entry.handlesClosedVerified === true && entry.buffersClearedVerified === true
      && Array.isArray(entry.entries) && entry.entries.length <= 64
      && (entry.stage === "complete" ? entry.error === 0 && [...principals, "absent"].includes(entry.ownerClass) && [entry.daclPresent, entry.nullDacl, entry.daclProtected].every(flag => typeof flag === "boolean")
        && (entry.daclPresent || entry.nullDacl) && (!entry.nullDacl || entry.entries.length === 0)
        && entry.entries.every(ace => object(ace) && Object.keys(ace).sort().join() === "flags,kind,mask,principal" && ["allow", "deny", "other"].includes(ace.kind) && Number.isInteger(ace.flags) && ace.flags >= 0 && ace.flags <= 255 && uint(ace.mask) && principals.includes(ace.principal))
        : entry.ownerClass === null && entry.daclPresent === null && entry.nullDacl === null && entry.daclProtected === null && entry.entries.length === 0))) result.restrictedHostTokenObjectSecurity = structuredClone(security);
  if (object(random) && Object.keys(random).sort().join() === "buffersClearedVerified,entries,handlesClosedVerified,schema" && random.schema === "switchyard-restricted-random-access/v1" && random.handlesClosedVerified === true && random.buffersClearedVerified === true && Array.isArray(random.entries) && random.entries.length === 2 && random.entries.every((entry, i) => object(entry) && Object.keys(entry).sort().join() === "providerCloseStatus,providerOpenStatus,providerStatus,systemStatus,token" && entry.token === ["restricted", "creator"][i] && uint(entry.systemStatus) && uint(entry.providerOpenStatus) && (entry.providerOpenStatus === 0 ? uint(entry.providerStatus) && entry.providerCloseStatus === 0 : entry.providerStatus === null && entry.providerCloseStatus === null))) result.restrictedHostRandomAccess = structuredClone(random);
  if (validStdio(value.restrictedHostStdio)) result.restrictedHostStdio = structuredClone(value.restrictedHostStdio);
  const environment = value.restrictedHostEnvironment, environmentFlags = ["systemRootPresent", "systemRootMatchesWindows", "windirPresent", "windirMatchesWindows", "openSslConfigPresent", "openSslModulesPresent", "nodeOptionsPresent"];
  if (object(environment) && Object.keys(environment).sort().join() === ["schema", "entryCount", ...environmentFlags].sort().join() && environment.schema === "switchyard-restricted-child-environment/v1" && Number.isInteger(environment.entryCount) && environment.entryCount >= 1 && environment.entryCount <= 64 && environmentFlags.every(key => typeof environment[key] === "boolean") && (!environment.systemRootMatchesWindows || environment.systemRootPresent) && (!environment.windirMatchesWindows || environment.windirPresent)) result.restrictedHostEnvironment = structuredClone(environment);
  const cold = value.restrictedHostColdRandom;
  const coldVerified = ["primaryTokenVerified", "tokenRecheckedAfterExit", "treeExitVerified", "processHandlesClosedVerified", "creatorQuotaRestoredVerified"];
  if (object(cold) && Object.keys(cold).sort().join() === ["schema", "executableSha256", "waitResult", "exitCode", "reportValid", "report", "standardIo", "nodeStartupAccepted", ...coldVerified].sort().join()
      && cold.schema === "switchyard-cold-restricted-random/v4" && typeof cold.executableSha256 === "string" && /^[a-f0-9]{64}$/.test(cold.executableSha256)
      && coldVerified.every(key => cold[key] === true) && cold.nodeStartupAccepted === false && validStdio(cold.standardIo) && cold.standardIo.outputBounded
      && (cold.waitResult === 0 ? uint(cold.exitCode) : cold.waitResult === 258 && cold.exitCode === null) && typeof cold.reportValid === "boolean") {
    const r = cold.report;
    const validLegacy = legacy => object(legacy) && Object.keys(legacy).sort().join() === "buffersClearedVerified,generateError,generated,handlesClosedVerified,providerCloseError,providerOpenError,providerOpened"
      && legacy.handlesClosedVerified === true && legacy.buffersClearedVerified === true && typeof legacy.providerOpened === "boolean" && uint(legacy.providerOpenError)
      && (legacy.providerOpened ? legacy.providerOpenError === 0 && typeof legacy.generated === "boolean" && uint(legacy.generateError) && (!legacy.generated || legacy.generateError === 0) && legacy.providerCloseError === 0 : legacy.generated === null && legacy.generateError === null && legacy.providerCloseError === null);
    const lookup = value => object(value) && Object.keys(value).sort().join() === "bufferClearedVerified,error,providerClass,succeeded" && typeof value.succeeded === "boolean" && uint(value.error) && value.bufferClearedVerified === true && (value.succeeded ? value.error === 0 && ["other", "enhanced", "strong", "base"].includes(value.providerClass) : value.providerClass === null);
    const tokenAccess = value => object(value) && Object.keys(value).sort().join() === "closeError,error,handlesClosedVerified,opened" && typeof value.opened === "boolean" && uint(value.error) && value.handlesClosedVerified === true && (value.opened ? value.error === 0 && value.closeError === 0 : value.closeError === null);
    const valid = object(r) && Object.keys(r).sort().join() === "buffersClearedVerified,enhancedProvider,firstApi,handlesClosedVerified,legacy,providerCloseStatus,providerLookups,providerOpenStatus,providerStatus,selfTokenAccess,systemStatus"
      && r.firstApi === "legacy-cryptoapi" && validLegacy(r.legacy) && validLegacy(r.enhancedProvider)
      && object(r.providerLookups) && Object.keys(r.providerLookups).sort().join() === "machine,user" && lookup(r.providerLookups.user) && lookup(r.providerLookups.machine)
      && object(r.selfTokenAccess) && Object.keys(r.selfTokenAccess).sort().join() === "query,queryDuplicate,queryDuplicateImpersonate" && Object.values(r.selfTokenAccess).every(tokenAccess)
      && r.handlesClosedVerified === true && r.buffersClearedVerified === true && uint(r.systemStatus) && uint(r.providerOpenStatus)
      && (r.providerOpenStatus === 0 ? uint(r.providerStatus) && r.providerCloseStatus === 0 : r.providerStatus === null && r.providerCloseStatus === null);
    if (cold.reportValid ? cold.waitResult === 0 && cold.exitCode === 0 && valid : r === null) result.restrictedHostColdRandom = structuredClone(cold);
  }
  return result;
}
const verified = ["selfTokenQueryAccessVerified", "privateDesktopClosedVerified", "success", "primaryTokenVerified", "sameUserVerified", "mediumIntegrityVerified", "administratorsDenyOnlyVerified", "volumePrivilegeAbsentVerified", "onlyTraversePrivilegeAssignedVerified", "tokenRecheckedAfterExit", "treeExitVerified", "creatorQuotaRestoredVerified", "restrictingSidListVerified"];
export function verifyRestrictedOwnerReport(result) {
  assert.equal(result?.success, true); const proof = result.nativeRestrictedHostProof;
  assert.ok(object(proof));
  const fields = ["schema", ...verified, "selfTokenQueryAcl", "processCreationApi", "consoleCreationMode", "standardIo", "startupDesktop", "interactiveDesktopInherited", "creatorPrivileges", "restrictingSidCount", "historicalFilteredFlags", "historicalFilterBytes", "hostOwnerChecks", "hostOwner", "ordinaryUserAccountAccepted", "guestLaunched", "accountCreated"];
  assert.deepEqual(Object.keys(proof).sort(), fields.sort());
  assert.equal(proof.schema, "switchyard-restricted-host-process-proof/v1");
  for (const key of verified) assert.equal(proof[key], true);
  assert.ok(validSelfQueryAcl(proof.selfTokenQueryAcl, true));
  assert.ok(validStdio(proof.standardIo)); assert.equal(proof.standardIo.outputBounded, true);
  assert.equal(proof.processCreationApi, "CreateProcessAsUserW"); assert.equal(proof.consoleCreationMode, "detached-process"); assert.equal(proof.startupDesktop, "owned-noninteractive"); assert.equal(proof.interactiveDesktopInherited, false); assert.equal(proof.restrictingSidCount, 4); assert.equal(proof.hostOwnerChecks, 8);
  for (const key of ["ordinaryUserAccountAccepted", "guestLaunched", "accountCreated"]) assert.equal(proof[key], false);
  assert.ok(Array.isArray(proof.historicalFilteredFlags)); assert.equal(proof.historicalFilteredFlags.length, 3); assert.ok(proof.historicalFilteredFlags.every(value => typeof value === "boolean"));
  assert.ok(Array.isArray(proof.historicalFilterBytes)); assert.equal(proof.historicalFilterBytes.length, 3); assert.ok(proof.historicalFilterBytes.every(value => value === 1 || value === 4));
  const privileges = proof.creatorPrivileges;
  assert.ok(object(privileges)); assert.deepEqual(Object.keys(privileges).sort(), ["quotaAssigned", "quotaEnabled", "assignPrimaryAssigned", "assignPrimaryEnabled", "impersonateAssigned", "impersonateEnabled"].sort()); assert.ok(Object.values(privileges).every(value => typeof value === "boolean")); assert.equal(privileges.quotaAssigned, true);
  const owner = proof.hostOwner; assert.ok(object(owner)); assert.equal(owner.schema, "switchyard-native-broker-owner-proof/v1"); assert.equal(owner.success, true); assert.ok(Array.isArray(owner.checks)); assert.equal(owner.checks.length, 8); assert.ok(owner.checks.every(value => typeof value === "string" && value.length > 0 && value.length <= 512));
  for (const key of ["nativeExitVerified", "fixtureRemoved"]) assert.equal(owner[key], true);
  for (const key of ["ordinaryUserToken", "guestLaunched", "setupRequested", "accountCreated"]) assert.equal(owner[key], false);
  return proof;
}
