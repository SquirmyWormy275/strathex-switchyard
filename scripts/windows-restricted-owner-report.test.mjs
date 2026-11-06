import test from "node:test";
import assert from "node:assert/strict";
import { verifyRestrictedOwnerReport, storageBrokerFailureEvidence, parseNodeRngImports, verifyNodeRngImports } from "./windows-restricted-owner-report.mjs";
test("fixed Node imports retain only known method presence and exact image hash, never a runtime branch claim", () => {
  const text = "Dump of file C:\\NEVER_RETAIN\\node.exe\n\n  bcrypt.dll\n     2A BCryptGenRandom\n  ADVAPI32.dll\n     10 CryptAcquireContextW\n     11 CryptGenRandom\n     12 CryptReleaseContext\n     13 UnrelatedSecretMethod\n  Summary\n";
  const value = parseNodeRngImports(text, "a".repeat(64));
  assert.deepEqual(value.imports, { BCryptGenRandom: true, CryptAcquireContextW: true, CryptGenRandom: true, CryptReleaseContext: true });
  assert.equal(value.runtimeBranchVerified, false); assert.equal(value.nodeStartupAccepted, false); assert.equal(JSON.stringify(value).includes("NEVER_RETAIN"), false);
  const copy = verifyNodeRngImports(value, "a".repeat(64)); copy.imports.BCryptGenRandom = false; assert.equal(value.imports.BCryptGenRandom, true);
  assert.deepEqual(parseNodeRngImports("Dump of file node.exe\n  KERNEL32.dll\n    1 GetProcAddress\n  Summary\n", "a".repeat(64)).imports, { BCryptGenRandom: false, CryptAcquireContextW: false, CryptGenRandom: false, CryptReleaseContext: false });
  for (const bad of ["", text.replace("Summary", "truncated"), text.replace("bcrypt.dll", "foreign.dll"), text + "\0", "x".repeat(1048577)]) assert.throws(() => parseNodeRngImports(bad, "a".repeat(64)));
  for (const extra of [{ nodeStartupAccepted: true }, { runtimeBranchVerified: true }, { nodeSha256: "b".repeat(64) }, { path: "NEVER_RETAIN" }, { imports: { ...value.imports, extra: true } }, { imports: { ...value.imports, CryptGenRandom: 1 } }]) assert.throws(() => verifyNodeRngImports({ ...value, ...extra }, "a".repeat(64)));
});
function stdio() { return { schema: "switchyard-restricted-child-stdio/v1", standardHandles: 3, inheritanceRestricted: true, stdinEof: true, stdoutBytes: 0, stderrBytes: 0, outputBounded: true, handlesClosedVerified: true, drainsCompleted: true, stderr: { category: "empty", function: null, code: null, sourceFile: null, sourceLine: null } }; }
test("restricted child preserves only closed state-lock failure evidence", () => {
  const stateLockFailure = { schema: "switchyard-state-lock-failure/v1", kind: "child-exit", phase: "worker-startup", progress: "not-observed", exitCode: 3221225794, signal: null, spawnCode: null };
  const child = { waitResult: 0, exitCode: 2, resultAvailable: true, stateLockFailure };
  const report = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostChildExit: child };
  assert.deepEqual(storageBrokerFailureEvidence(report).restrictedHostChildExit, child);
  assert.equal(storageBrokerFailureEvidence({ ...report, restrictedHostChildExit: { ...child, stateLockFailure: null } }).restrictedHostChildExit.stateLockFailure, null);
  for (const extra of [{ raw: "NEVER_RETAIN" }, { kind: "NEVER_RETAIN" }, { exitCode: 4294967296 }]) {
    const result = storageBrokerFailureEvidence({ ...report, restrictedHostChildExit: { ...child, stateLockFailure: { ...stateLockFailure, ...extra } } });
    assert.equal(result.restrictedHostChildExit, undefined); assert.equal(JSON.stringify(result).includes("NEVER_RETAIN"), false);
  }
});
function sample() { return { success: true, nativeRestrictedHostProof: {
  standardIo: stdio(),
  selfTokenQueryAccessVerified: true,
  selfTokenQueryAcl: ["cold-probe", "node-owner"].map(scope => ({ schema: "switchyard-child-self-query-acl/v1", scope, status: "verified", grantedMask: 8, changeRequested: true, beforeAclSha256: "a".repeat(64), afterAclSha256: "b".repeat(64), originalAcesPreserved: true, exactQueryEntryVerified: true, tokenRestrictionsRechecked: true, handlesClosedVerified: true, buffersClearedVerified: true })),
  schema: "switchyard-restricted-host-process-proof/v1", success: true, processCreationApi: "CreateProcessAsUserW", consoleCreationMode: "detached-process", startupDesktop: "owned-noninteractive", interactiveDesktopInherited: false, privateDesktopClosedVerified: true, creatorPrivileges: { quotaAssigned: true, quotaEnabled: false, assignPrimaryAssigned: false, assignPrimaryEnabled: false, impersonateAssigned: true, impersonateEnabled: true }, creatorQuotaRestoredVerified: true, restrictingSidListVerified: true, restrictingSidCount: 4, primaryTokenVerified: true, sameUserVerified: true, mediumIntegrityVerified: true, administratorsDenyOnlyVerified: true, volumePrivilegeAbsentVerified: true, onlyTraversePrivilegeAssignedVerified: true, historicalFilteredFlags: [false, false, false], historicalFilterBytes: [1, 1, 1], tokenRecheckedAfterExit: true, treeExitVerified: true, hostOwnerChecks: 8,
  hostOwner: { schema: "switchyard-native-broker-owner-proof/v1", success: true, checks: Array.from({ length: 8 }, (_, i) => "synthetic independently verified boundary " + i), nativeExitVerified: true, fixtureRemoved: true, ordinaryUserToken: false, guestLaunched: false, setupRequested: false, accountCreated: false }, ordinaryUserAccountAccepted: false, guestLaunched: false, accountCreated: false
} }; }
test("a self-query ACL correction cannot accept broader access, missing original restrictions, replayed hashes or incomplete mutation evidence", () => {
  assert.equal(verifyRestrictedOwnerReport(sample()).selfTokenQueryAccessVerified, true);
  for (const mutate of [p => { p.selfTokenQueryAccessVerified = false; }, p => { delete p.selfTokenQueryAcl; }, p => { p.selfTokenQueryAcl.pop(); }, p => { p.selfTokenQueryAcl[1].scope = "cold-probe"; }, p => { p.selfTokenQueryAcl[0].grantedMask = 10; }, p => { p.selfTokenQueryAcl[0].status = "apply-requested"; }, p => { p.selfTokenQueryAcl[0].beforeAclSha256 = null; }, p => { p.selfTokenQueryAcl[0].afterAclSha256 = "a".repeat(64); }, p => { p.selfTokenQueryAcl[0].changeRequested = false; }, p => { p.selfTokenQueryAcl[0].sid = "NEVER_RETAIN"; }, ...["originalAcesPreserved", "exactQueryEntryVerified", "tokenRestrictionsRechecked", "handlesClosedVerified", "buffersClearedVerified"].map(k => p => { p.selfTokenQueryAcl[0][k] = false; })]) {
    const value = sample(); mutate(value.nativeRestrictedHostProof); assert.throws(() => verifyRestrictedOwnerReport(value));
  }
  const idempotent = sample(); idempotent.nativeRestrictedHostProof.selfTokenQueryAcl[1].changeRequested = false; idempotent.nativeRestrictedHostProof.selfTokenQueryAcl[1].beforeAclSha256 = "b".repeat(64); assert.ok(verifyRestrictedOwnerReport(idempotent));
  for (const status of ["reserved", "apply-requested", "readback"]) {
    const row = { ...sample().nativeRestrictedHostProof.selfTokenQueryAcl[0], status, afterAclSha256: null, originalAcesPreserved: false, exactQueryEntryVerified: false, tokenRestrictionsRechecked: false, handlesClosedVerified: false };
    const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostSelfTokenQueryAcl: [row] };
    assert.deepEqual(storageBrokerFailureEvidence(input).restrictedHostSelfTokenQueryAcl, [row]); assert.throws(() => verifyRestrictedOwnerReport(input));
    for (const changes of [{ grantedMask: 0x1fffff }, { sid: "NEVER_RETAIN" }, { status: "NEVER_RETAIN" }, { beforeAclSha256: "NEVER_RETAIN" }]) {
      const projected = storageBrokerFailureEvidence({ ...input, restrictedHostSelfTokenQueryAcl: [{ ...row, ...changes }] }); assert.equal(projected.restrictedHostSelfTokenQueryAcl, undefined); assert.equal(JSON.stringify(projected).includes("NEVER_RETAIN"), false);
    }
  }
});
test("child standard output evidence accepts only closed fixed diagnostics, with no path or account disclosure", () => {
  const pipes = { ...stdio(), stderrBytes: 120, stderr: { category: "assertion", function: "uv_pipe_open", code: "EINVAL", sourceFile: "node.cc", sourceLine: 1128 } };
  const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostStdio: pipes, restrictedHostChildExit: { waitResult: 0, exitCode: 134, resultAvailable: false } };
  const projected = storageBrokerFailureEvidence(input); assert.deepEqual(projected.restrictedHostStdio, pipes); assert.equal(projected.success, false); assert.equal(projected.restrictedHostChildExit.exitCode, 134);
  projected.restrictedHostStdio.stderr.code = null; assert.equal(pipes.stderr.code, "EINVAL");
  for (const mutate of [s => { s.raw = "NEVER_RETAIN"; }, s => { s.stderr.sourceFile = "C:/NEVER_RETAIN/node.cc"; }, s => { s.stderr.sourceFile = "NEVER_RETAIN.cc"; }, s => { s.stderr.sourceFile = null; }, s => { s.stderr.sourceLine = null; }, s => { s.stderr.sourceLine = 0; }, s => { s.stderr.sourceLine = 100000; }, s => { s.stderr.sourceLine = 1.5; }, s => { s.stderr.category = "javascript"; }, s => { s.stderr.path = "NEVER_RETAIN"; }, s => { s.stderr.category = "NEVER_RETAIN"; }, s => { s.stderr.function = "NEVER_RETAIN"; }, s => { s.stderr.code = "NEVER_RETAIN"; }, s => { s.standardHandles = 4; }, s => { s.stdoutBytes = -1; }, s => { s.stderrBytes = 1.5; }, s => { s.stderrBytes = Number.MAX_SAFE_INTEGER + 1; }, s => { s.stderrBytes = 0; }, s => { s.outputBounded = false; }, s => { s.schema = "untrusted"; }, ...["inheritanceRestricted", "stdinEof", "handlesClosedVerified", "drainsCompleted"].map(key => s => { s[key] = false; })]) {
    const invalid = structuredClone(pipes); mutate(invalid); const result = storageBrokerFailureEvidence({ ...input, restrictedHostStdio: invalid }); assert.equal(result.restrictedHostStdio, undefined); assert.equal(JSON.stringify(result).includes("NEVER_RETAIN"), false); assert.equal(result.restrictedHostChildExit.exitCode, 134);
  }
  const exceeded = { ...pipes, stderrBytes: 8193, outputBounded: false }; assert.deepEqual(storageBrokerFailureEvidence({ ...input, restrictedHostStdio: exceeded }).restrictedHostStdio, exceeded);
});
test("restricted owner success requires exact standard handle isolation, bounded output and independently closed pipes", () => {
  assert.equal(verifyRestrictedOwnerReport(sample()).standardIo.handlesClosedVerified, true);
  for (const mutate of [p => { delete p.standardIo; }, p => { p.standardIo.stderrBytes = 1; }, p => { p.standardIo.stdoutBytes = 65537; p.standardIo.outputBounded = false; }, p => { p.standardIo.stderr.function = "uv_thread_create"; }, ...["inheritanceRestricted", "stdinEof", "handlesClosedVerified", "drainsCompleted"].map(key => p => { p.standardIo[key] = false; })]) {
    const result = sample(); mutate(result.nativeRestrictedHostProof); assert.throws(() => verifyRestrictedOwnerReport(result));
  }
});
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

test("random-source diagnostics retain only fixed API statuses and verified handle/buffer cleanup", () => {
  const random = { schema: "switchyard-restricted-random-access/v1", handlesClosedVerified: true, buffersClearedVerified: true, entries: [
    { token: "restricted", systemStatus: 0xc0000022, providerOpenStatus: 0xc0000022, providerStatus: null, providerCloseStatus: null },
    { token: "creator", systemStatus: 0, providerOpenStatus: 0, providerStatus: 0, providerCloseStatus: 0 }
  ] };
  const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostRandomAccess: random };
  const projected = storageBrokerFailureEvidence(input); assert.deepEqual(projected.restrictedHostRandomAccess, random); assert.equal(projected.success, false);
  projected.restrictedHostRandomAccess.entries[0].systemStatus = 0; assert.equal(random.entries[0].systemStatus, 0xc0000022);
  for (const mutate of [r => { r.buffer = "NEVER_RETAIN"; }, r => { r.entries[0].sid = "NEVER_RETAIN"; }, r => { r.entries.reverse(); }, r => { r.entries[0].providerStatus = 0; }, r => { r.entries[1].providerCloseStatus = 1; }, r => { r.entries[1].systemStatus = -1; }, r => { r.entries[1].systemStatus = 0x100000000; }, r => { r.entries[1].providerOpenStatus = 0.5; }, r => { r.handlesClosedVerified = false; }, r => { r.buffersClearedVerified = false; }, r => { r.entries.pop(); }]) {
    const invalid = structuredClone(random); mutate(invalid); const result = storageBrokerFailureEvidence({ ...input, restrictedHostRandomAccess: invalid }); assert.equal(result.restrictedHostRandomAccess, undefined); assert.equal(JSON.stringify(result).includes("NEVER_RETAIN"), false);
  }
});

test("cold-child environment observations retain only exact OS-match flags and counts, never values or a startup acceptance",()=>{
  const environment={schema:"switchyard-restricted-child-environment/v1",entryCount:22,systemRootPresent:true,systemRootMatchesWindows:true,windirPresent:true,windirMatchesWindows:true,openSslConfigPresent:false,openSslModulesPresent:false,nodeOptionsPresent:false};
  const input={schema:"switchyard-storage-broker-protocol-proof/v1",success:false,restrictedHostEnvironment:environment,restrictedHostChildExit:{waitResult:0,exitCode:134,resultAvailable:false}};
  const result=storageBrokerFailureEvidence(input);assert.deepEqual(result.restrictedHostEnvironment,environment);result.restrictedHostEnvironment.entryCount=1;assert.equal(environment.entryCount,22);assert.throws(()=>verifyRestrictedOwnerReport(input));
  for(const changed of [{secret:"NEVER_RETAIN"},{systemRoot:"C:/NEVER_RETAIN"},{entryCount:0},{entryCount:65},{entryCount:1.5},{systemRootPresent:false},{windirPresent:false},{nodeOptionsPresent:"false"},{schema:"foreign"}]){const projected=storageBrokerFailureEvidence({...input,restrictedHostEnvironment:{...environment,...changed}});assert.equal(projected.restrictedHostEnvironment,undefined);assert.equal(JSON.stringify(projected).includes("NEVER_RETAIN"),false);assert.equal(projected.restrictedHostChildExit.exitCode,134);}
  const absent={...environment,systemRootPresent:false,systemRootMatchesWindows:false,windirPresent:false,windirMatchesWindows:false};assert.deepEqual(storageBrokerFailureEvidence({...input,restrictedHostEnvironment:absent}).restrictedHostEnvironment,absent);
});

test("suspended child token security preserves only ordered classified ACEs and read/cleanup statuses, never raw identities or access grants", () => {
  const row = { schema: "switchyard-child-token-security/v1", scope: "cold-probe", stage: "complete", error: 0, ownerClass: "administrators", daclPresent: true, nullDacl: false, daclProtected: false, entries: [{ kind: "allow", flags: 0, mask: 0x1fffff, principal: "logon" }, { kind: "deny", flags: 16, mask: 8, principal: "administrators" }], handlesClosedVerified: true, buffersClearedVerified: true };
  const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostTokenObjectSecurity: [row, { ...structuredClone(row), scope: "node-owner" }], restrictedHostChildExit: { waitResult: 0, exitCode: 134, resultAvailable: false } };
  assert.deepEqual(storageBrokerFailureEvidence(input).restrictedHostTokenObjectSecurity, input.restrictedHostTokenObjectSecurity); assert.throws(() => verifyRestrictedOwnerReport(input));
  const copy = storageBrokerFailureEvidence(input); copy.restrictedHostTokenObjectSecurity[0].entries[0].mask = 0; assert.equal(row.entries[0].mask, 0x1fffff);
  for (const stage of ["open", "read", "parse"]) {
    const entry = { ...row, stage, error: stage === "parse" ? 0 : 5, ownerClass: null, daclPresent: null, nullDacl: null, daclProtected: null, entries: [] };
    assert.deepEqual(storageBrokerFailureEvidence({ ...input, restrictedHostTokenObjectSecurity: [entry] }).restrictedHostTokenObjectSecurity, [entry]);
  }
  for (const present of [true, false]) { const entry = { ...row, daclPresent: present, nullDacl: true, entries: [] }; assert.deepEqual(storageBrokerFailureEvidence({ ...input, restrictedHostTokenObjectSecurity: [entry] }).restrictedHostTokenObjectSecurity, [entry]); }
  for (const mutate of [
    r => { r.sid = "NEVER_RETAIN"; }, r => { r.schema = "unknown"; }, r => { r.scope = "node-owner"; }, r => { r.stage = "granted"; }, r => { r.error = 5; }, r => { r.error = 0x100000000; }, r => { r.ownerClass = "NEVER_RETAIN"; }, r => { r.daclPresent = false; }, r => { r.nullDacl = true; }, r => { r.daclProtected = 1; }, r => { r.handlesClosedVerified = false; }, r => { r.buffersClearedVerified = false; }, r => { r.entries = new Array(65).fill(r.entries[0]); }, r => { r.entries[0].sid = "NEVER_RETAIN"; }, r => { r.entries[0].principal = "absent"; }, r => { r.entries[0].kind = "grant"; }, r => { r.entries[0].mask = -1; }, r => { r.entries[0].mask = 0x100000000; }, r => { r.entries[0].flags = 256; }, r => { r.entries[0].flags = 1.5; }, r => { r.stage = "read"; }
  ]) {
    const value = structuredClone(row); mutate(value); const result = storageBrokerFailureEvidence({ ...input, restrictedHostTokenObjectSecurity: [value] });
    assert.equal(result.restrictedHostTokenObjectSecurity, undefined); assert.equal(JSON.stringify(result).includes("NEVER_RETAIN"), false); assert.equal(result.restrictedHostChildExit.exitCode, 134);
  }
  for (const entries of [{}, [row, row], [row, { ...row, scope: "node-owner" }, row]]) assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostTokenObjectSecurity: entries }).restrictedHostTokenObjectSecurity, undefined);
});

test("a cold restricted RNG report requires exact primary-token, process, pipe and buffer witnesses without accepting Node startup", () => {
  const cold = { schema: "switchyard-cold-restricted-random/v4", executableSha256: "d".repeat(64), waitResult: 0, exitCode: 0, reportValid: true,
    report: { systemStatus: 0xc0000022, providerOpenStatus: 0xc0000022, providerStatus: null, providerCloseStatus: null, handlesClosedVerified: true, buffersClearedVerified: true, firstApi: "legacy-cryptoapi", legacy: { providerOpened: false, providerOpenError: 5, generated: null, generateError: null, providerCloseError: null, handlesClosedVerified: true, buffersClearedVerified: true } },
    primaryTokenVerified: true, tokenRecheckedAfterExit: true, treeExitVerified: true, processHandlesClosedVerified: true, creatorQuotaRestoredVerified: true, standardIo: stdio(), nodeStartupAccepted: false };
  cold.report.enhancedProvider = { providerOpened: true, providerOpenError: 0, generated: true, generateError: 0, providerCloseError: 0, handlesClosedVerified: true, buffersClearedVerified: true };
  cold.report.providerLookups = { user: { succeeded: true, error: 0, providerClass: "enhanced", bufferClearedVerified: true }, machine: { succeeded: false, error: 5, providerClass: null, bufferClearedVerified: true } };
  cold.report.selfTokenAccess = Object.fromEntries(["query", "queryDuplicate", "queryDuplicateImpersonate"].map(key => [key, { opened: true, error: 0, closeError: 0, handlesClosedVerified: true }]));
  const input = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostColdRandom: cold, restrictedHostChildExit: { waitResult: 0, exitCode: 134, resultAvailable: false } };
  const projected = storageBrokerFailureEvidence(input); assert.deepEqual(projected.restrictedHostColdRandom, cold); assert.equal(projected.success, false); assert.throws(() => verifyRestrictedOwnerReport(input));
  projected.restrictedHostColdRandom.report.systemStatus = 0; assert.equal(cold.report.systemStatus, 0xc0000022);
  for (const mutate of [c => { c.path = "NEVER_RETAIN"; }, c => { c.report.entropy = "NEVER_RETAIN"; }, c => { c.report = null; }, c => { c.reportValid = false; }, c => { c.exitCode = 1; }, c => { c.waitResult = 258; }, c => { c.exitCode = -1; }, c => { c.executableSha256 = "NEVER_RETAIN"; }, c => { c.nodeStartupAccepted = true; }, c => { c.report.providerStatus = 0; }, c => { c.report.systemStatus = 0x100000000; }, c => { c.report.systemStatus = 0.5; }, c => { c.report.handlesClosedVerified = false; }, c => { c.report.buffersClearedVerified = false; }, c => { c.standardIo.handlesClosedVerified = false; }, ...["primaryTokenVerified", "tokenRecheckedAfterExit", "treeExitVerified", "processHandlesClosedVerified", "creatorQuotaRestoredVerified"].map(key => c => { c[key] = false; })]) {
    const invalid = structuredClone(cold); mutate(invalid); const result = storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: invalid }); assert.equal(result.restrictedHostColdRandom, undefined); assert.equal(JSON.stringify(result).includes("NEVER_RETAIN"), false); assert.equal(result.restrictedHostChildExit.exitCode, 134);
  }
  for (const change of [{ waitResult: 258, exitCode: null, reportValid: false, report: null }, { exitCode: 134, reportValid: false, report: null }, { report: { ...cold.report, systemStatus: 0, providerOpenStatus: 0, providerStatus: 0, providerCloseStatus: 0 } }]) {
    const value = { ...cold, ...change }; assert.deepEqual(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value }).restrictedHostColdRandom, value);
  }
  for (const mutate of [c => { c.schema = "switchyard-cold-restricted-random/v1"; }, c => { c.report.firstApi = "bcrypt"; }, c => { c.report.legacy.entropy = "NEVER_RETAIN"; }, c => { c.report.legacy.providerOpened = true; }, c => { c.report.legacy.generated = false; }, c => { c.report.legacy.generateError = 0; }, c => { c.report.legacy.providerOpenError = -1; }, c => { c.report.legacy.providerCloseError = 0; }, c => { c.report.legacy.handlesClosedVerified = false; }, c => { c.report.legacy.buffersClearedVerified = false; }]) {
    const invalid = structuredClone(cold); mutate(invalid); assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: invalid }).restrictedHostColdRandom, undefined);
  }
  for (const generated of [true, false]) {
    const value = structuredClone(cold); value.report.legacy = { providerOpened: true, providerOpenError: 0, generated, generateError: generated ? 0 : 0x80090020, providerCloseError: 0, handlesClosedVerified: true, buffersClearedVerified: true };
    assert.deepEqual(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value }).restrictedHostColdRandom, value);
    value.report.legacy.providerCloseError = 1; assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value }).restrictedHostColdRandom, undefined);
  }
  for (const mutate of [c => { c.report.enhancedProvider.generated = null; }, c => { c.report.enhancedProvider.providerCloseError = 1; }, c => { c.report.enhancedProvider.buffersClearedVerified = false; }, c => { c.report.providerLookups.user.rawName = "NEVER_RETAIN"; }, c => { c.report.providerLookups.user.providerClass = "NEVER_RETAIN"; }, c => { c.report.providerLookups.user.error = 5; }, c => { c.report.providerLookups.machine.providerClass = "base"; }, c => { c.report.providerLookups.machine.bufferClearedVerified = false; }, c => { c.report.providerLookups.machine.error = -1; }, c => { c.report.providerLookups.extra = {}; }]) {
    const invalid = structuredClone(cold); mutate(invalid); assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: invalid }).restrictedHostColdRandom, undefined);
  }
  for (const key of ["query", "queryDuplicate", "queryDuplicateImpersonate"]) {
    for (const error of [0, 5, 0xffffffff]) {
      const value = structuredClone(cold); value.report.selfTokenAccess[key] = { opened: false, error, closeError: null, handlesClosedVerified: true };
      assert.deepEqual(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value }).restrictedHostColdRandom, value);
      value.report.selfTokenAccess[key].closeError = 0;
      assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value }).restrictedHostColdRandom, undefined);
    }
    for (const change of [{ opened: 1 }, { error: 5 }, { error: -1 }, { error: 0.5 }, { error: 0x100000000 }, { closeError: null }, { closeError: 5 }, { handlesClosedVerified: false }, { token: "NEVER_RETAIN" }]) {
      const value = structuredClone(cold); Object.assign(value.report.selfTokenAccess[key], change);
      const projected = storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value });
      assert.equal(projected.restrictedHostColdRandom, undefined); assert.equal(JSON.stringify(projected).includes("NEVER_RETAIN"), false); assert.equal(projected.restrictedHostChildExit.exitCode, 134);
    }
    const missing = structuredClone(cold); delete missing.report.selfTokenAccess[key];
    assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: missing }).restrictedHostColdRandom, undefined);
  }
  for (const mutate of [c => { c.schema = "switchyard-cold-restricted-random/v3"; }, c => { delete c.report.selfTokenAccess; }, c => { c.report.selfTokenAccess.extra = {}; }, c => { c.report.selfTokenAccess = []; }]) {
    const value = structuredClone(cold); mutate(value); assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value }).restrictedHostColdRandom, undefined);
  }
});
