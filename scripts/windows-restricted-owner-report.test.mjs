import test from "node:test";
import assert from "node:assert/strict";
import { verifyRestrictedOwnerReport, storageBrokerFailureEvidence } from "./windows-restricted-owner-report.mjs";
function sample() { return { success: true, nativeRestrictedHostProof: {
  schema: "switchyard-restricted-host-process-proof/v1", success: true, processCreationApi: "CreateProcessAsUserW", consoleCreationMode: "detached-process", startupDesktop: "owned-noninteractive", interactiveDesktopInherited: false, privateDesktopClosedVerified: true, creatorPrivileges: { quotaAssigned: true, quotaEnabled: false, assignPrimaryAssigned: false, assignPrimaryEnabled: false, impersonateAssigned: true, impersonateEnabled: true }, creatorQuotaRestoredVerified: true, restrictingSidListVerified: true, restrictingSidCount: 4, primaryTokenVerified: true, sameUserVerified: true, mediumIntegrityVerified: true, administratorsDenyOnlyVerified: true, volumePrivilegeAbsentVerified: true, onlyTraversePrivilegeAssignedVerified: true, historicalFilteredFlags: [false, false, false], historicalFilterBytes: [1, 1, 1], tokenRecheckedAfterExit: true, treeExitVerified: true, hostOwnerChecks: 8,
  hostOwner: { schema: "switchyard-native-broker-owner-proof/v1", success: true, checks: Array.from({ length: 8 }, (_, i) => "synthetic independently verified boundary " + i), nativeExitVerified: true, fixtureRemoved: true, ordinaryUserToken: false, guestLaunched: false, setupRequested: false, accountCreated: false }, ordinaryUserAccountAccepted: false, guestLaunched: false, accountCreated: false
} }; }
test("the actual coordinator projection retains bounded failed-child evidence and excludes private paths or arbitrary fields", () => {
  const child = { waitResult: 0, exitCode: 2, resultAvailable: true, childReportedSuccess: false, ownerReportedSuccess: false, completedChecks: 0, failedPhase: "private-state-initialize", failureCategory: "Error" };
  const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostPhase: "bounded-owner-journey", restrictedHostChildExit: child, privatePath: "NEVER_RETAIN" };
  const result = storageBrokerFailureEvidence(input); assert.deepEqual(result.restrictedHostChildExit, child); assert.equal(JSON.stringify(result).includes("NEVER_RETAIN"), false);
  result.restrictedHostChildExit.exitCode = 99; assert.equal(child.exitCode, 2);
  for (const invalid of [{ ...child, stateDirectory: "NEVER_RETAIN" }, { ...child, failedPhase: "/NEVER_RETAIN" }, { ...child, completedChecks: 9 }, { ...child, waitResult: -1 }, { ...child, exitCode: 1.5 }, { ...child, resultAvailable: "true" }]) assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostChildExit: invalid }).restrictedHostChildExit, undefined);
  assert.deepEqual(storageBrokerFailureEvidence({ schema: input.schema, success: false, restrictedHostChildExit: { waitResult: 258, resultAvailable: false } }).restrictedHostChildExit, { waitResult: 258, resultAvailable: false });
  for (const invalid of [null, [], { ...input, success: true }, { ...input, schema: "untrusted" }]) assert.equal(storageBrokerFailureEvidence(invalid), undefined);
});
test("restricted-owner acceptance requires the private desktop startup and its confirmed retirement", () => {
  for (const change of [proof => { proof.consoleCreationMode = "no-window"; }, proof => { delete proof.consoleCreationMode; }, proof => { proof.startupDesktop = "interactive-default"; }, proof => { proof.interactiveDesktopInherited = true; }, proof => { proof.privateDesktopClosedVerified = false; }, proof => { delete proof.privateDesktopClosedVerified; }]) {
    const result = sample(); change(result.nativeRestrictedHostProof); assert.throws(() => verifyRestrictedOwnerReport(result));
  }
});
test("application-event projection retains only exact fixed diagnostic fields and never upgrades failure or leaks XML, paths, PID or account data", () => {
  const events = { schema: "switchyard-restricted-child-application-events/v1", queryStatus: "completed", handlesClosedVerified: true, entries: [{ eventId: 1000, exceptionCode: "c0000142", module: "user32.dll" }] };
  const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostChildExit: { waitResult: 0, exitCode: 3221225794, resultAvailable: false }, restrictedHostApplicationEvents: events };
  const result = storageBrokerFailureEvidence(input); assert.deepEqual(result.restrictedHostApplicationEvents, events); assert.equal(result.success, false); assert.equal(result.restrictedHostChildExit.exitCode, 3221225794);
  result.restrictedHostApplicationEvents.entries[0].module = "unrecognized"; assert.equal(events.entries[0].module, "user32.dll");
  for (const mutate of [e => { e.xml = "NEVER_RETAIN"; }, e => { e.entries[0].module = "C:/NEVER_RETAIN/user32.dll"; }, e => { e.entries[0].module = "NEVER_RETAIN.dll"; }, e => { e.entries[0].pid = 1; }, e => { e.entries[0].exceptionCode = "NEVER_RETAIN"; }, e => { e.entries[0].eventId = 1001; }, e => { e.entries.push(...Array.from({ length: 4 }, () => ({ ...e.entries[0] }))); }, e => { e.handlesClosedVerified = false; }, e => { e.queryStatus = "unavailable"; }, e => { e.schema = "untrusted"; }]) {
    const invalid = structuredClone(events); mutate(invalid); const projected = storageBrokerFailureEvidence({ ...input, restrictedHostApplicationEvents: invalid }); assert.equal(projected.restrictedHostApplicationEvents, undefined); assert.equal(JSON.stringify(projected).includes("NEVER_RETAIN"), false); assert.equal(projected.restrictedHostChildExit.exitCode, 3221225794);
  }
  const unavailable = { ...events, queryStatus: "unavailable", handlesClosedVerified: false, entries: [] }; assert.deepEqual(storageBrokerFailureEvidence({ ...input, restrictedHostApplicationEvents: unavailable }).restrictedHostApplicationEvents, unavailable);
});
test("historical filter metadata is observational while every actual token, privilege, exit and owner boundary remains mandatory", () => {
  const result = sample(); assert.equal(verifyRestrictedOwnerReport(result), result.nativeRestrictedHostProof); result.nativeRestrictedHostProof.historicalFilteredFlags = [true, false, true]; result.nativeRestrictedHostProof.historicalFilterBytes = [4, 1, 4]; assert.equal(verifyRestrictedOwnerReport(result), result.nativeRestrictedHostProof);
  for (const key of ["success", "primaryTokenVerified", "sameUserVerified", "mediumIntegrityVerified", "administratorsDenyOnlyVerified", "volumePrivilegeAbsentVerified", "onlyTraversePrivilegeAssignedVerified", "tokenRecheckedAfterExit", "treeExitVerified", "creatorQuotaRestoredVerified", "restrictingSidListVerified"]) { const result = sample(); result.nativeRestrictedHostProof[key] = false; assert.throws(() => verifyRestrictedOwnerReport(result)); }
});
test("private USER object diagnostics retain bounded access results without leaking names or replacing child acceptance", () => {
  const access = { schema: "switchyard-restricted-user-object-access/v1", stationOpened: true, stationError: 0, desktopOpened: false, desktopError: 5, handlesClosedVerified: true, namespaceRestoredVerified: true };
  const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostUserObjectAccess: access, restrictedHostChildExit: { waitResult: 0, exitCode: 3221225794, resultAvailable: false } };
  const projected = storageBrokerFailureEvidence(input); assert.deepEqual(projected.restrictedHostUserObjectAccess, access); assert.equal(projected.success, false); projected.restrictedHostUserObjectAccess.desktopError = 2; assert.equal(access.desktopError, 5);
  for (const extra of [{ name: "NEVER_RETAIN" }, { stationError: 5 }, { desktopError: 0 }, { desktopError: -1 }, { desktopError: 1.5 }, { desktopError: 65536 }, { desktopOpened: "false" }, { handlesClosedVerified: false }, { namespaceRestoredVerified: false }, { schema: "untrusted" }]) {
    const result = storageBrokerFailureEvidence({ ...input, restrictedHostUserObjectAccess: { ...access, ...extra } }); assert.equal(result.restrictedHostUserObjectAccess, undefined); assert.equal(JSON.stringify(result).includes("NEVER_RETAIN"), false); assert.equal(result.restrictedHostChildExit.exitCode, 3221225794);
  }
  assert.throws(() => verifyRestrictedOwnerReport(input));
});
test("missing/unclosed fields, wrong API, incomplete witnesses and account/guest or elevated fallback claims refuse acceptance", () => {
  for (const mutate of [r => { r.success = false; }, r => { delete r.nativeRestrictedHostProof.onlyTraversePrivilegeAssignedVerified; }, r => { r.nativeRestrictedHostProof.elevatedFallback = true; }, r => { r.nativeRestrictedHostProof.processCreationApi = "CreateProcessW"; }, r => { r.nativeRestrictedHostProof.restrictingSidCount = 3; }, r => { r.nativeRestrictedHostProof.historicalFilteredFlags = [false, false]; }, r => { r.nativeRestrictedHostProof.historicalFilteredFlags = [false, 0, false]; }, r => { delete r.nativeRestrictedHostProof.historicalFilterBytes; }, r => { r.nativeRestrictedHostProof.historicalFilterBytes = [1, 1]; }, r => { r.nativeRestrictedHostProof.historicalFilterBytes = [1, 2, 4]; }, r => { r.nativeRestrictedHostProof.historicalFilterBytes = [1, 4, "1"]; }, r => { r.nativeRestrictedHostProof.creatorPrivileges.quotaAssigned = false; }, r => { r.nativeRestrictedHostProof.creatorPrivileges.secret = "NEVER_COPY"; }, ...["ordinaryUserAccountAccepted", "guestLaunched", "accountCreated"].map(key => r => { r.nativeRestrictedHostProof[key] = true; })]) { const result = sample(); mutate(result); assert.throws(() => verifyRestrictedOwnerReport(result)); }
});
test("incomplete inner owner/cleanup evidence cannot be upgraded by successful outer token claims", () => {
  for (const mutate of [o => { o.checks.pop(); }, o => { o.nativeExitVerified = false; }, o => { o.fixtureRemoved = false; }, o => { o.ordinaryUserToken = true; }, o => { o.setupRequested = true; }, o => { o.guestLaunched = true; }]) { const result = sample(); mutate(result.nativeRestrictedHostProof.hostOwner); assert.throws(() => verifyRestrictedOwnerReport(result)); }
});

test("namespace access diagnostics retain only the complete closed matrix, without paths or any upgrade of child acceptance", () => {
  const access = { schema: "switchyard-restricted-namespace-access/v1", queryStatus: "completed", handlesClosedVerified: true,
    entries: ["global", "session", "restricted-session"].flatMap(scope => ["query-traverse", "directory-operations", "all"].map(access => ({ scope, access, creatorStatus: 0, restrictedStatus: 0xc0000022 }))) };
  const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostNamespaceAccess: access };
  const result = storageBrokerFailureEvidence(input); assert.deepEqual(result.restrictedHostNamespaceAccess, access); assert.equal(result.success, false);
  result.restrictedHostNamespaceAccess.entries[0].creatorStatus = 1; assert.equal(access.entries[0].creatorStatus, 0);
  for (const mutate of [a => { a.path = "NEVER_RETAIN"; }, a => { a.entries[0].session = "NEVER_RETAIN"; }, a => { a.entries[0].scope = "NEVER_RETAIN"; }, a => { a.entries[0].access = "unrecognized"; }, a => { a.entries[0].creatorStatus = -1; }, a => { a.entries[0].restrictedStatus = 0x100000000; }, a => { a.entries[0].restrictedStatus = 0.5; }, a => { a.entries[0].restrictedStatus = "0"; }, a => { a.entries.reverse(); }, a => { a.entries.pop(); }, a => { a.entries.push(a.entries[0]); }, a => { a.handlesClosedVerified = false; }, a => { a.queryStatus = "unavailable"; }]) {
    const invalid = structuredClone(access); mutate(invalid); const projection = storageBrokerFailureEvidence({ ...input, restrictedHostNamespaceAccess: invalid });
    assert.equal(projection.restrictedHostNamespaceAccess, undefined); assert.equal(JSON.stringify(projection).includes("NEVER_RETAIN"), false); assert.equal(projection.success, false);
  }
  const unavailable = { ...access, queryStatus: "unavailable", entries: [] }; assert.deepEqual(storageBrokerFailureEvidence({ ...input, restrictedHostNamespaceAccess: unavailable }).restrictedHostNamespaceAccess, unavailable);
  assert.throws(() => verifyRestrictedOwnerReport(input));
});
