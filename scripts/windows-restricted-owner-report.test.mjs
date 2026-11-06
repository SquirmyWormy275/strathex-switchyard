import test from "node:test";
import assert from "node:assert/strict";
import { verifyRestrictedOwnerReport, storageBrokerFailureEvidence, parseNodeRngImports, verifyNodeRngImports } from "./windows-restricted-owner-report.mjs";
import { createWindowsOwnerProbeObservation } from "./windows-owner-probe-observation.mjs";
import { verifyNativeSetupImage } from "./windows-setup-image.mjs";

function setupImage() {
  const bytes = Buffer.alloc(4096), u16 = (offset, value) => bytes.writeUInt16LE(value, offset), u32 = (offset, value) => bytes.writeUInt32LE(value, offset);
  u16(0, 0x5a4d); u32(0x3c, 0x80); u32(0x80, 0x4550); u16(0x84, 0x8664); u16(0x86, 1); u16(0x94, 0xf0); u16(0x98, 0x20b); u32(0x98 + 108, 16); u16(0x98 + 68, 2);
  u32(0x188 + 12, 0x1000); u32(0x188 + 16, 0x800); u32(0x188 + 20, 0x200);
  for (const [index, value, size] of [[1, 0x1200, 60], [10, 0x1100, 80], [13, 0x1300, 96]]) { u32(0x98 + 112 + index * 8, value); u32(0x98 + 116 + index * 8, size); }
  u32(0x300, 80); u16(0x300 + 78, 0x800);
  u32(0x400 + 12, 0x1400); u32(0x414 + 12, 0x1420);
  u32(0x500, 1); u32(0x504, 0x1440); u32(0x520, 1); u32(0x524, 0x1460);
  for (const [offset, name] of [[0x600, "KERNEL32.dll"], [0x620, "ADVAPI32.dll"], [0x640, "SHELL32.dll"], [0x660, "ole32.dll"]]) bytes.write(name + "\0", offset);
  return bytes;
}

test("native setup PE proof preserves System32 loading and requires deferred shell/COM imports without loading a DLL", () => {
  assert.deepEqual(verifyNativeSetupImage(setupImage()), { imageSubsystem: "windows-gui", dependentLoadFlags: 0x800, deferredUiImportsVerified: true, runtimeModuleIsolationVerified: false });
  const changes = [
    b => b.writeUInt16LE(0x14c, 0x84), b => b.writeUInt16LE(0x10b, 0x98), b => b.writeUInt16LE(0, 0x300 + 78),
    b => b.writeUInt16LE(3, 0x98 + 68), b => b.writeUInt16LE(0, 0x98 + 68),
    b => b.writeUInt32LE(0xfffffff0, 0x3c), b => b.writeUInt16LE(32, 0x86), b => b.writeUInt32LE(13, 0x98 + 108),
    b => b.writeUInt32LE(0x90000000, 0x400 + 12), b => b.writeUInt32LE(16385, 0x98 + 116 + 13 * 8),
    b => b.writeUInt32LE(2, 0x500), b => b.writeUInt32LE(0, 0x98 + 112 + 13 * 8),
    b => b.writeUInt32LE(64, 0x98 + 116 + 13 * 8), b => b.writeUInt32LE(0x1440, 0x524),
    b => b.write("SHELL32.dll\0", 0x600), b => b.write("USER32.dll\0", 0x600), b => b.write("GDI32.dll\0", 0x600),
    b => b.write("../private.dll\0", 0x640), b => b.fill(0x61, 0x640, 0x640 + 81), b => b.writeUInt32LE(0, 0x500 + 4),
    b => b.writeUInt32LE(0xfffffff0, 0x188 + 20),
    b => { b.writeUInt16LE(2, 0x86); b.copy(b, 0x1b0, 0x188, 0x1b0); }
  ];
  for (const change of changes) { const bytes = setupImage(); change(bytes); assert.throws(() => verifyNativeSetupImage(bytes)); }
  for (const value of [null, {}, Buffer.alloc(100), setupImage().subarray(0, 600), Buffer.alloc(16 * 1024 * 1024 + 1)]) assert.throws(() => verifyNativeSetupImage(value));
});

test("probe observation delegates original arguments, callbacks and result without accepting native work", async () => {
  const observation = createWindowsOwnerProbeObservation(), calls = [], child = {}, frame = {}, result = {}, argument = {}, options = {
    env: { PATH: "NEVER_RETAIN" }, inputText: "NEVER_RETAIN", signal: new AbortController().signal,
    onGuardianChild: value => { assert.equal(value, child); calls.push("child"); },
    onGuardianReady: async value => { assert.equal(value, frame); await Promise.resolve(); calls.push("persisted"); },
  };
  const command = observation.command(async (executable, args, actual) => {
    assert.equal(executable, "NEVER_RETAIN"); assert.equal(args, argument);
    for (const key of ["env", "inputText", "signal"]) assert.equal(actual[key], options[key]);
    actual.onGuardianChild(child); await actual.onGuardianReady(frame); calls.push("original-command"); return result;
  });
  const original = { identity: async value => { assert.equal(value, argument); return command("NEVER_RETAIN", argument, options); }, reconcile: async () => ({ stopped: true }), probeExchange: async () => result, close() { return this.reconcile(); } };
  const native = observation.native(original);
  assert.equal(await native.identity(argument), result); assert.equal(await native.probeExchange(), result);
  assert.deepEqual(await native.close(), { stopped: true });
  assert.deepEqual(calls, ["child", "persisted", "original-command"]); assert.equal(observation.failurePhase, null);
});

test("probe observation retains original exceptions and projects only fixed operation and lifecycle labels", async () => {
  for (const stage of ["startup", "created", "ready", "committed"]) {
    const observation = createWindowsOwnerProbeObservation(), error = Object.assign(new Error("Runtime worker exit could not be fully verified. Preserve its staging/recovery state."), { privatePath: "NEVER_RETAIN" });
    const command = observation.command(async (_exe, _args, options) => {
      if (stage !== "startup") options.onGuardianChild({ privatePath: "NEVER_RETAIN" });
      if (["ready", "committed"].includes(stage)) await options.onGuardianReady({ privatePath: "NEVER_RETAIN" });
      throw error;
    });
    const native = observation.native({ identity: () => command("NEVER_RETAIN", [], { onGuardianReady: async () => { if (stage === "ready") throw error; } }) });
    await assert.rejects(native.identity(), value => value === error);
    assert.equal(observation.failurePhase, `probe-identity-${stage}-worker-exit`);
    const report = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostChildExit: { waitResult: 0, resultAvailable: true, failedPhase: observation.failurePhase } };
    assert.equal(storageBrokerFailureEvidence(report).restrictedHostChildExit.failedPhase, observation.failurePhase);
    assert.equal(JSON.stringify(report).includes("NEVER_RETAIN"), false);
  }
  for (const method of ["reconcile", "identity", "probeExchange"]) {
    const observation = createWindowsOwnerProbeObservation(), error = Object.assign(new Error("NEVER_RETAIN"), { code: "NEVER_RETAIN" });
    const native = observation.native({ [method]: async () => { throw error; } });
    await assert.rejects(native[method](), value => value === error);
    assert.match(observation.failurePhase, /^probe-(?:reconcile|identity|capability)-return-refused$/);
  }
});

test("structured-result refusal records only bounded worker exit and byte count without upgrading acceptance", async () => {
  for (const [result, suffix] of [
    [{ exitCode: 0, stdout: "" }, "-code0-bytes0"],
    [{ exitCode: 3221225794, stdout: "" }, "-code3221225794-bytes0"],
    [{ exitCode: 2, stdout: "NEVER_RETAIN", stderr: "NEVER_RETAIN" }, "-code2-bytes12"],
    [{ exitCode: 4294967296, stdout: "" }, ""], [{ exitCode: -1, stdout: "" }, ""],
    [{ exitCode: "NEVER_RETAIN", stdout: "" }, ""], [{ exitCode: 0, stdout: "x".repeat(16385) }, ""],
    [{ exitCode: 0, stdout: "é".repeat(8193) }, ""], [{ exitCode: 0, stdout: {} }, ""]
  ]) {
    const observation = createWindowsOwnerProbeObservation(), original = Error("The fixed Windows storage helper returned no bounded structured result.");
    const command = observation.command(async () => result);
    const native = observation.native({ identity: async () => { assert.equal(await command("NEVER_RETAIN", [], {}), result); throw original; } });
    await assert.rejects(native.identity(), error => error === original);
    assert.equal(observation.failurePhase, "probe-identity-return-structured-result" + suffix);
    assert.ok(observation.failurePhase.length <= 80); assert.equal(observation.failurePhase.includes("NEVER_RETAIN"), false);
    const child = { waitResult: 0, resultAvailable: true, failedPhase: observation.failurePhase };
    assert.deepEqual(storageBrokerFailureEvidence({ schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostChildExit: child }).restrictedHostChildExit, child);
  }
  const observation = createWindowsOwnerProbeObservation(); let calls = 0;
  const command = observation.command(async () => ++calls === 1 ? { exitCode: 2, stdout: "stale" } : {});
  const native = observation.native({ identity: async () => { await command("test", [], {}); await command("test", [], {}); throw Error("The fixed Windows storage helper returned no bounded structured result."); } });
  await assert.rejects(native.identity());
  assert.equal(observation.failurePhase, "probe-identity-return-structured-result", "A later result cannot borrow earlier command metadata.");
});

test("managed startup phases reach bounded owner evidence without conferring readiness or copying unknown details", async () => {
  for (const [runtimeStartupFailure, suffix] of [
    [{ phase: "job-create", nativeCode: 5 }, "native-job-create-code5"],
    [{ phase: "job-create", nativeCode: 5, selfTokenQuery: null }, "native-job-create-code5"],
    [{ phase: "job-create", nativeCode: 5, selfTokenQuery: { opened: false, error: 5, closeError: null, handlesClosedVerified: true } }, "native-job-create-code5-qdenied"],
    [{ phase: "job-create", nativeCode: 5, selfTokenQuery: { opened: false, error: 0xffffffff, closeError: null, handlesClosedVerified: true } }, "native-job-create-code5-qfailed"],
    [{ phase: "job-create", nativeCode: 5, selfTokenQuery: { opened: true, error: 0, closeError: 0, handlesClosedVerified: true } }, "native-job-create-code5-qopen"],
    [{ phase: "job-create", nativeCode: 5, selfTokenQuery: { opened: true, error: 0, closeError: 5, handlesClosedVerified: false } }, "native-job-create-code5-qclose"],
    [{ phase: "job-create", nativeCode: 5, selfTokenQuery: { opened: true, error: 0, closeError: 0, handlesClosedVerified: true, raw: "NEVER_RETAIN" } }, "refused"],
    [{ phase: "job-configure", nativeCode: 0xffffffff }, "native-job-configure-code4294967295"],
    [{ phase: "self-birth", nativeCode: null }, "native-self-birth"],
    [{ phase: "self-birth", nativeCode: null, raw: "NEVER_RETAIN" }, "refused"],
  ]) {
    const observation = createWindowsOwnerProbeObservation(), error = Object.assign(new Error("NEVER_RETAIN"), { runtimeStartupFailure });
    const native = observation.native({ identity: async () => { throw error; } });
    await assert.rejects(native.identity(), value => value === error);
    assert.equal(observation.failurePhase, "probe-identity-return-" + suffix);
    const child = { waitResult: 0, resultAvailable: true, failedPhase: observation.failurePhase };
    const projected = storageBrokerFailureEvidence({ schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostChildExit: child });
    assert.deepEqual(projected.restrictedHostChildExit, child); assert.equal(JSON.stringify(projected).includes("NEVER_RETAIN"), false);
  }
});

test("worker-start observations preserve the original failure and exclude paths, output and unknown stages", async () => {
  for (const [runtimeWorkerStartFailure, suffix] of [
    [{ phase: "process-create", nativeCode: 5 }, "worker-process-create-code5"],
    [{ phase: "worker-birth", nativeCode: 6 }, "worker-worker-birth-code6"],
    [{ phase: "environment-block", nativeCode: null }, "worker-environment-block"],
    [{ phase: "environment-block", nativeCode: 5 }, "refused"],
    [{ phase: "NEVER_RETAIN", nativeCode: null }, "refused"],
    [{ phase: "process-create", nativeCode: 5, path: "NEVER_RETAIN" }, "refused"]
  ]) {
    const observation = createWindowsOwnerProbeObservation(), error = Object.assign(Error("NEVER_RETAIN"), { runtimeWorkerStartFailure });
    const command = observation.command(async (_exe, _args, options) => { options.onGuardianChild({}); await options.onGuardianReady({}); throw error; });
    const native = observation.native({ identity: () => command("NEVER_RETAIN", [], {}) });
    await assert.rejects(native.identity(), actual => actual === error);
    assert.equal(observation.failurePhase, "probe-identity-committed-" + suffix);
    const child = { waitResult: 0, resultAvailable: true, failedPhase: observation.failurePhase };
    assert.deepEqual(storageBrokerFailureEvidence({ schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostChildExit: child }).restrictedHostChildExit, child);
    assert.equal(observation.failurePhase.includes("NEVER_RETAIN"), false);
  }
});

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
  descendantSelfQueryAcl: [{ sequence: 1, role: "guardian", status: "verified", originalJobVerified: true, liveBirthVerified: true, pinnedImageVerified: true, processHandleClosedVerified: true,
    query: { schema: "switchyard-child-self-query-acl/v1", scope: "descendant-guardian", status: "verified", grantedMask: 8, changeRequested: true, beforeAclSha256: "a".repeat(64), afterAclSha256: "b".repeat(64), originalAcesPreserved: true, exactQueryEntryVerified: true, tokenRestrictionsRechecked: true, handlesClosedVerified: true, buffersClearedVerified: true } }],
  selfTokenQueryAccessVerified: true,
  selfTokenQueryAcl: ["cold-probe", "node-owner"].map(scope => ({ schema: "switchyard-child-self-query-acl/v1", scope, status: "verified", grantedMask: 8, changeRequested: true, beforeAclSha256: "a".repeat(64), afterAclSha256: "b".repeat(64), originalAcesPreserved: true, exactQueryEntryVerified: true, tokenRestrictionsRechecked: true, handlesClosedVerified: true, buffersClearedVerified: true })),
  schema: "switchyard-restricted-host-process-proof/v1", success: true, processCreationApi: "CreateProcessAsUserW", consoleCreationMode: "detached-process", startupDesktop: "owned-noninteractive", interactiveDesktopInherited: false, privateDesktopClosedVerified: true, creatorPrivileges: { quotaAssigned: true, quotaEnabled: false, assignPrimaryAssigned: false, assignPrimaryEnabled: false, impersonateAssigned: true, impersonateEnabled: true }, creatorQuotaRestoredVerified: true, restrictingSidListVerified: true, restrictingSidCount: 4, primaryTokenVerified: true, sameUserVerified: true, mediumIntegrityVerified: true, administratorsDenyOnlyVerified: true, volumePrivilegeAbsentVerified: true, onlyTraversePrivilegeAssignedVerified: true, historicalFilteredFlags: [false, false, false], historicalFilterBytes: [1, 1, 1], tokenRecheckedAfterExit: true, treeExitVerified: true, hostOwnerChecks: 8,
  hostOwner: { schema: "switchyard-native-broker-owner-proof/v1", success: true, checks: Array.from({ length: 8 }, (_, i) => "synthetic independently verified boundary " + i), nativeExitVerified: true, fixtureRemoved: true, ordinaryUserToken: false, guestLaunched: false, setupRequested: false, accountCreated: false }, ordinaryUserAccountAccepted: false, guestLaunched: false, accountCreated: false
} }; }
test("descendant QUERY evidence preserves the original two scopes and refuses missing identity, broader access and incomplete readback", () => {
  for (const mutate of [p => { delete p.descendantSelfQueryAcl; }, p => { p.descendantSelfQueryAcl = []; }, p => { p.descendantSelfQueryAcl[0].sequence = 2; }, p => { p.descendantSelfQueryAcl[0].role = "unowned"; },
    p => { p.descendantSelfQueryAcl[0].status = "reserved"; }, p => { p.descendantSelfQueryAcl[0].query = null; }, p => { p.descendantSelfQueryAcl[0].query.grantedMask = 10; },
    p => { p.descendantSelfQueryAcl[0].query.scope = "cold-probe"; }, p => { p.descendantSelfQueryAcl[0].query.exactQueryEntryVerified = false; },
    ...["originalJobVerified", "liveBirthVerified", "pinnedImageVerified", "processHandleClosedVerified"].map(key => p => { p.descendantSelfQueryAcl[0][key] = false; })]) {
    const value = sample(); mutate(value.nativeRestrictedHostProof); assert.throws(() => verifyRestrictedOwnerReport(value));
  }
  const value = sample(), rows = value.nativeRestrictedHostProof.descendantSelfQueryAcl;
  for (const role of ["worker", "status"]) rows.push({ ...structuredClone(rows[0]), sequence: rows.length + 1, role, query: { ...rows[0].query, scope: "descendant-" + role } });
  assert.equal(verifyRestrictedOwnerReport(value).selfTokenQueryAcl.length, 2);
  const failure = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostDescendantSelfQueryAcl: rows };
  assert.deepEqual(storageBrokerFailureEvidence(failure).restrictedHostDescendantSelfQueryAcl, rows);
  for (const change of [{ privatePath: "NEVER_RETAIN" }, { sequence: 2 }, { role: "arbitrary" }, { query: { ...rows[0].query, grantedMask: 10 } }]) {
    assert.equal(storageBrokerFailureEvidence({ ...failure, restrictedHostDescendantSelfQueryAcl: [{ ...rows[0], ...change }] }).restrictedHostDescendantSelfQueryAcl, undefined);
  }
});
test("the native report preserves all final status observations and refuses an extra worker or a 69th registration", () => {
  const value = sample(), template = value.nativeRestrictedHostProof.descendantSelfQueryAcl[0];
  const rows = Array.from({ length: 68 }, (_, index) => ({ ...structuredClone(template), sequence: index + 1, role: "status", query: { ...template.query, scope: "descendant-status" } }));
  value.nativeRestrictedHostProof.descendantSelfQueryAcl = rows;
  assert.equal(verifyRestrictedOwnerReport(value).descendantSelfQueryAcl.length, 68);
  const failure = { schema: "switchyard-storage-broker-protocol-proof/v1", success: false, restrictedHostDescendantSelfQueryAcl: rows };
  assert.equal(storageBrokerFailureEvidence(failure).restrictedHostDescendantSelfQueryAcl.length, 68);
  for (let index = 64; index < 68; index++) for (const role of ["worker", "guardian"]) {
    const changed = structuredClone(value); changed.nativeRestrictedHostProof.descendantSelfQueryAcl[index].role = role;
    changed.nativeRestrictedHostProof.descendantSelfQueryAcl[index].query.scope = "descendant-" + role;
    assert.throws(() => verifyRestrictedOwnerReport(changed));
    assert.equal(storageBrokerFailureEvidence({ ...failure, restrictedHostDescendantSelfQueryAcl: changed.nativeRestrictedHostProof.descendantSelfQueryAcl }).restrictedHostDescendantSelfQueryAcl, undefined);
  }
  rows.push({ ...structuredClone(rows[0]), sequence: 69 });
  assert.throws(() => verifyRestrictedOwnerReport(value)); assert.equal(storageBrokerFailureEvidence(failure).restrictedHostDescendantSelfQueryAcl, undefined);
});
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
  const cold = { schema: "switchyard-cold-restricted-random/v5", executableSha256: "d".repeat(64), waitResult: 0, exitCode: 0, reportValid: true,
    report: { systemStatus: 0xc0000022, providerOpenStatus: 0xc0000022, providerStatus: null, providerCloseStatus: null, handlesClosedVerified: true, buffersClearedVerified: true, firstApi: "legacy-cryptoapi", legacy: { providerOpened: false, providerOpenError: 5, generated: null, generateError: null, providerCloseError: null, handlesClosedVerified: true, buffersClearedVerified: true } },
    primaryTokenVerified: true, tokenRecheckedAfterExit: true, treeExitVerified: true, processHandlesClosedVerified: true, creatorQuotaRestoredVerified: true, standardIo: stdio(), nodeStartupAccepted: false };
  cold.report.enhancedProvider = { providerOpened: true, providerOpenError: 0, generated: true, generateError: 0, providerCloseError: 0, handlesClosedVerified: true, buffersClearedVerified: true };
  cold.report.providerLookups = { user: { succeeded: true, error: 0, providerClass: "enhanced", bufferClearedVerified: true }, machine: { succeeded: false, error: 5, providerClass: null, bufferClearedVerified: true } };
  cold.report.selfTokenAccess = Object.fromEntries(["query", "queryDuplicate", "queryDuplicateImpersonate"].map(key => [key, { opened: true, error: 0, closeError: 0, handlesClosedVerified: true }]));
  cold.report.emptyJobs = Object.fromEntries(["anonymous", "local", "global"].map(key => [key, { opened: true, createError: 0, createdNew: true, querySucceeded: true, queryError: 0, activeProcesses: 0, closeError: 0, handlesClosedVerified: true }]));
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
  for (const key of ["anonymous", "local", "global"]) {
    const denied = { opened: false, createError: 5, createdNew: false, querySucceeded: null, queryError: null, activeProcesses: null, closeError: null, handlesClosedVerified: true };
    const collision = { ...denied, opened: true, createError: 183, closeError: 0 };
    const queryFailed = { ...cold.report.emptyJobs[key], querySucceeded: false, queryError: 5, activeProcesses: null };
    for (const row of [denied, { ...denied, createError: 0xffffffff }, queryFailed, ...(key === "anonymous" ? [] : [collision])]) {
      const value = structuredClone(cold); value.report.emptyJobs[key] = row;
      const projected = storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value });
      assert.deepEqual(projected.restrictedHostColdRandom, value); assert.equal(projected.success, false); assert.throws(() => verifyRestrictedOwnerReport(projected));
    }
    for (const row of [
      ...[{ opened: 1 }, { createdNew: 1 }, { createError: 5 }, { createError: -1 }, { createError: 0x100000000 }, { createError: 0.5 }, { createdNew: false }, { querySucceeded: 1 }, { querySucceeded: false }, { queryError: 5 }, { activeProcesses: 1 }, { activeProcesses: null }, { closeError: null }, { closeError: 5 }, { handlesClosedVerified: false }, { name: "NEVER_RETAIN" }].map(change => ({ ...cold.report.emptyJobs[key], ...change })),
      ...[{ createError: 0 }, { createError: 183 }, { createdNew: true }, { querySucceeded: false }, { queryError: 0 }, { activeProcesses: 0 }, { closeError: 0 }, { handlesClosedVerified: false }].map(change => ({ ...denied, ...change })),
      ...[{ queryError: 0 }, { queryError: -1 }, { activeProcesses: 0 }].map(change => ({ ...queryFailed, ...change })),
      ...(key === "anonymous" ? [collision] : [{ ...collision, querySucceeded: true, queryError: 0, activeProcesses: 0 }, { ...collision, createError: 0 }])
    ]) {
      const value = structuredClone(cold); value.report.emptyJobs[key] = row;
      const projected = storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value });
      assert.equal(projected.restrictedHostColdRandom, undefined); assert.equal(JSON.stringify(projected).includes("NEVER_RETAIN"), false); assert.equal(projected.restrictedHostChildExit.exitCode, 134);
    }
    const missing = structuredClone(cold); delete missing.report.emptyJobs[key];
    assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: missing }).restrictedHostColdRandom, undefined);
  }
  for (const mutate of [c => { c.schema = "switchyard-cold-restricted-random/v4"; }, c => { delete c.report.emptyJobs; }, c => { c.report.emptyJobs.extra = {}; }, c => { c.report.emptyJobs = []; }]) {
    const value = structuredClone(cold); mutate(value); assert.equal(storageBrokerFailureEvidence({ ...input, restrictedHostColdRandom: value }).restrictedHostColdRandom, undefined);
  }
  const unmodified = structuredClone(cold);
  unmodified.report.selfTokenAccess = Object.fromEntries(["query", "queryDuplicate", "queryDuplicateImpersonate"].map(key => [key, { opened: false, error: 5, closeError: null, handlesClosedVerified: true }]));
  for (const key of ["local", "global"]) unmodified.report.emptyJobs[key] = { opened: false, createError: 5, createdNew: false, querySucceeded: null, queryError: null, activeProcesses: null, closeError: null, handlesClosedVerified: true };
  const pair = { ...input, restrictedHostUnmodifiedColdRandom: unmodified }, observed = storageBrokerFailureEvidence(pair);
  assert.deepEqual(observed.restrictedHostColdRandom, cold); assert.deepEqual(observed.restrictedHostUnmodifiedColdRandom, unmodified); assert.equal(observed.success, false); assert.throws(() => verifyRestrictedOwnerReport(observed));
  observed.restrictedHostUnmodifiedColdRandom.report.selfTokenAccess.query.error = 1; assert.equal(unmodified.report.selfTokenAccess.query.error, 5);
  for (const mutate of [c => { c.nodeStartupAccepted = true; }, c => { c.raw = "NEVER_RETAIN"; }, c => { c.report.emptyJobs.local.handlesClosedVerified = false; }, c => { c.primaryTokenVerified = false; }, c => { c.report.selfTokenAccess.query.closeError = 0; }, c => { c.treeExitVerified = false; }]) {
    const bad = structuredClone(unmodified); mutate(bad); const projected = storageBrokerFailureEvidence({ ...pair, restrictedHostUnmodifiedColdRandom: bad });
    assert.equal(projected.restrictedHostUnmodifiedColdRandom, undefined); assert.deepEqual(projected.restrictedHostColdRandom, cold); assert.equal(JSON.stringify(projected).includes("NEVER_RETAIN"), false);
  }
  const partial = storageBrokerFailureEvidence({ ...pair, restrictedHostColdRandom: null }); assert.equal(partial.restrictedHostColdRandom, undefined); assert.deepEqual(partial.restrictedHostUnmodifiedColdRandom, unmodified);

});

test('CI console comparison retains bounded partial evidence and never substitutes for the original Node owner',()=>{
 const observations=['no-window','detached'].map(mode=>({schema:'switchyard-lease-console-probe/v1',mode,executableSha256:'a'.repeat(64),stage:'retired',waitResult:0,exitCode:mode==='detached'?2:3221225794,entryObserved:mode==='detached',primaryTokenVerified:true,tokenRecheckedAfterExit:true,treeExitVerified:true,processHandlesClosedVerified:true,creatorQuotaRestoredVerified:true,queryAcl:{...sample().nativeRestrictedHostProof.selfTokenQueryAcl[0],scope:'lease-'+mode},standardIo:mode==='detached'?{...stdio(),stderrBytes:14,stderr:{category:'unclassified',function:null,code:null,sourceFile:null,sourceLine:null}}:stdio()}));
 const source={schema:'switchyard-storage-broker-protocol-proof/v1',success:false,restrictedHostLeaseConsoles:observations};
 assert.deepEqual(storageBrokerFailureEvidence(source).restrictedHostLeaseConsoles,observations);assert.throws(()=>verifyRestrictedOwnerReport(source));
 for(const change of [{raw:'NEVER_RETAIN'},{mode:'unrestricted'},{stage:'untrusted'},{waitResult:-1},{waitResult:8},{entryObserved:true},{entryObserved:'yes'},{treeExitVerified:false},{queryAcl:{...observations[0].queryAcl,grantedMask:10}},{queryAcl:{...observations[0].queryAcl,scope:'node-owner'}},{standardIo:null},{executableSha256:'NEVER_RETAIN'}]){const r=storageBrokerFailureEvidence({...source,restrictedHostLeaseConsoles:[{...observations[0],...change},observations[1]]});assert.equal(r.restrictedHostLeaseConsoles,undefined);assert.equal(JSON.stringify(r).includes('NEVER_RETAIN'),false);}
 const partial={...observations[0],stage:'reserved',waitResult:null,exitCode:null,queryAcl:null,standardIo:null,entryObserved:false,primaryTokenVerified:false,tokenRecheckedAfterExit:false,treeExitVerified:false,processHandlesClosedVerified:false,creatorQuotaRestoredVerified:false};assert.deepEqual(storageBrokerFailureEvidence({...source,restrictedHostLeaseConsoles:[partial]}).restrictedHostLeaseConsoles,[partial]);
 assert.equal(storageBrokerFailureEvidence({...source,restrictedHostLeaseConsoles:[observations[1],observations[0]]}).restrictedHostLeaseConsoles,undefined);
 assert.equal(storageBrokerFailureEvidence({...source,restrictedHostLeaseConsoles:[...observations,observations[1]]}).restrictedHostLeaseConsoles,undefined);
 const gui = observations.map(row => ({ ...row, schema: 'switchyard-lease-console-probe/v2', imageSubsystem: 'windows-gui' }));
 assert.deepEqual(storageBrokerFailureEvidence({...source, restrictedHostLeaseConsoles:gui}).restrictedHostLeaseConsoles,gui);
 assert.throws(()=>verifyRestrictedOwnerReport({...source, restrictedHostLeaseConsoles:gui}));
 for(const change of [{imageSubsystem:'windows-console'},{imageSubsystem:undefined},{imageSubsystem:'NEVER_RETAIN'},{schema:'switchyard-lease-console-probe/v1'},{schema:'switchyard-lease-console-probe/v3'}]) {
   const rejected=storageBrokerFailureEvidence({...source,restrictedHostLeaseConsoles:[{...gui[0],...change},gui[1]]});
   assert.equal(rejected.restrictedHostLeaseConsoles,undefined);assert.equal(JSON.stringify(rejected).includes('NEVER_RETAIN'),false);
 }
});
