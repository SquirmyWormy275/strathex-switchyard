/** Validate CI proof claims only. This cannot create a token, grant trust or accept a guest/account. */
import assert from "node:assert/strict";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
/** Retain the bounded child diagnostic through the coordinator's privacy projection. */
export function storageBrokerFailureEvidence(value) {
  if (!object(value) || value.schema !== "switchyard-storage-broker-protocol-proof/v1" || value.success !== false) return undefined;
  const fields = ["schema", "success", "errorCategory", "nativeCode", "errorHResult", "nativeExchangeChecks", "failedCheckPhase", "restrictedHostPhase", "restrictedHostCreatorPrivileges", "restrictedHostHistoricalFilterFlags", "restrictedHostHistoricalFilterBytes", "restrictedHostTokenRead"];
  const result = Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]));
  const child = value.restrictedHostChildExit;
  const types = { waitResult: "uint", exitCode: "uint", resultAvailable: "boolean", childReportedSuccess: "boolean", ownerReportedSuccess: "boolean", completedChecks: "count", failedPhase: "label", failureCategory: "label" };
  if (object(child) && Object.hasOwn(child, "waitResult") && Object.hasOwn(child, "resultAvailable") && Object.entries(child).every(([key, item]) => Object.hasOwn(types, key) && (types[key] === "boolean" ? typeof item === "boolean" : types[key] === "label" ? item === null || typeof item === "string" && /^[A-Za-z0-9-]{1,80}$/.test(item) : Number.isSafeInteger(item) && item >= 0 && item <= (types[key] === "count" ? 8 : 0xffffffff)))) result.restrictedHostChildExit = structuredClone(child);
  const events = value.restrictedHostApplicationEvents, modules = ["node.exe", "ntdll.dll", "kernel32.dll", "kernelbase.dll", "user32.dll", "gdi32.dll", "gdi32full.dll", "ucrtbase.dll", "advapi32.dll", "crypt32.dll", "wintrust.dll", "ws2_32.dll", "bcrypt.dll", "sechost.dll", "unrecognized"];
  if (object(events) && Object.keys(events).sort().join() === "entries,handlesClosedVerified,queryStatus,schema" && events.schema === "switchyard-restricted-child-application-events/v1" && ["completed", "unavailable"].includes(events.queryStatus) && typeof events.handlesClosedVerified === "boolean" && (events.queryStatus !== "completed" || events.handlesClosedVerified) && Array.isArray(events.entries) && events.entries.length <= 4 && (events.queryStatus !== "unavailable" || events.entries.length === 0) && events.entries.every(entry => object(entry) && Object.keys(entry).sort().join() === "eventId,exceptionCode,module" && entry.eventId === 1000 && (entry.exceptionCode === null || typeof entry.exceptionCode === "string" && /^[a-f0-9]{8}$/.test(entry.exceptionCode)) && modules.includes(entry.module))) result.restrictedHostApplicationEvents = structuredClone(events);
  const access = value.restrictedHostUserObjectAccess;
  if (object(access) && Object.keys(access).sort().join() === "desktopError,desktopOpened,handlesClosedVerified,namespaceRestoredVerified,schema,stationError,stationOpened" && access.schema === "switchyard-restricted-user-object-access/v1" && access.handlesClosedVerified === true && access.namespaceRestoredVerified === true && ["station", "desktop"].every(kind => typeof access[kind + "Opened"] === "boolean" && Number.isSafeInteger(access[kind + "Error"]) && access[kind + "Error"] >= 0 && access[kind + "Error"] <= 0xffff && access[kind + "Opened"] === (access[kind + "Error"] === 0))) result.restrictedHostUserObjectAccess = structuredClone(access);
  const namespaces = value.restrictedHostNamespaceAccess, scopes = ["global", "session", "restricted-session"], masks = ["query-traverse", "directory-operations", "all"];
  if (object(namespaces) && Object.keys(namespaces).sort().join() === "entries,handlesClosedVerified,queryStatus,schema" && namespaces.schema === "switchyard-restricted-namespace-access/v1" && namespaces.handlesClosedVerified === true && ["completed", "unavailable"].includes(namespaces.queryStatus) && Array.isArray(namespaces.entries) && namespaces.entries.length === (namespaces.queryStatus === "completed" ? 9 : 0) && namespaces.entries.every((entry, i) => object(entry) && Object.keys(entry).sort().join() === "access,creatorStatus,restrictedStatus,scope" && entry.scope === scopes[Math.floor(i / 3)] && entry.access === masks[i % 3] && [entry.creatorStatus, entry.restrictedStatus].every(status => Number.isInteger(status) && status >= 0 && status <= 0xffffffff))) result.restrictedHostNamespaceAccess = structuredClone(namespaces);
  return result;
}
const verified = ["privateDesktopClosedVerified", "success", "primaryTokenVerified", "sameUserVerified", "mediumIntegrityVerified", "administratorsDenyOnlyVerified", "volumePrivilegeAbsentVerified", "onlyTraversePrivilegeAssignedVerified", "tokenRecheckedAfterExit", "treeExitVerified", "creatorQuotaRestoredVerified", "restrictingSidListVerified"];
export function verifyRestrictedOwnerReport(result) {
  assert.equal(result?.success, true); const proof = result.nativeRestrictedHostProof;
  assert.ok(object(proof));
  const fields = ["schema", ...verified, "processCreationApi", "consoleCreationMode", "startupDesktop", "interactiveDesktopInherited", "creatorPrivileges", "restrictingSidCount", "historicalFilteredFlags", "historicalFilterBytes", "hostOwnerChecks", "hostOwner", "ordinaryUserAccountAccepted", "guestLaunched", "accountCreated"];
  assert.deepEqual(Object.keys(proof).sort(), fields.sort());
  assert.equal(proof.schema, "switchyard-restricted-host-process-proof/v1");
  for (const key of verified) assert.equal(proof[key], true);
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
