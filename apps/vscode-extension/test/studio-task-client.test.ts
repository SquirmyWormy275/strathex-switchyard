import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioTaskClient } from "../src/studio-task-client.ts";
// @ts-expect-error Exercise the actual shipped JavaScript instance protocol.
import { createInstanceGateway } from "../../../tools/layout-studio/instance.mjs";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sy-editor-client-")), endpointPath = join(root, "endpoint.json"), token = "s".repeat(43), identity = { id: randomUUID(), build: "a".repeat(64) };
  const selected = { compartment: "personal", ownerRequestId: randomUUID(), loadRequestId: randomUUID() };
  const target = { schema: "switchyard-codex-editor-target/v1", ownerRequestId: selected.ownerRequestId, loadRequestId: selected.loadRequestId, taskId: randomUUID(), sessionId: randomUUID(), repositoryRoot: "/exact repository", repositoryIdentity: { device: "1", inode: "2" }, accountFingerprint: "b".repeat(64), permissions: "read-only/on-request", endpoint: { socketPath: "/tmp/exact-private-socket", socketDevice: "1", socketInode: "3", peerPid: 1234, peerBirth: "456", peerExecutableSha256: "c".repeat(64) } };
  const result = () => ({ target, targetDigest: createHash("sha256").update(JSON.stringify(target)).digest("hex"), metadataObserved: true, nativeLoadAcknowledged: true, nativeTaskLoaded: false, authorityGranted: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false });
  const controls: { forged: boolean; afterProbe?: () => Promise<void> | void; alter?: (value: ReturnType<typeof result>) => unknown; alterAuthorization?: (value: any) => unknown; alterConnection?: (value: any) => unknown; alterChoices?: (value: any) => unknown; hold?: boolean; routeStatus?: number } = { forged: false };
  const calls: { path: string; bearer: boolean; payload?: unknown }[] = [];
  const gateway = createInstanceGateway({ token, identity, onStop: () => { throw Error("Stop is outside this read-only client"); }, onEditorChoices: async (selection: { repositoryRoot: string }) => {
    calls.at(-1)!.payload = selection; if (controls.afterProbe) await controls.afterProbe();
    const value = { schema: "switchyard-editor-task-choices/v1", compartment: selected.compartment, repositoryRoot: selection.repositoryRoot, choices: [{ ownerRequestId: selected.ownerRequestId, loadRequestId: selected.loadRequestId, taskId: target.taskId, label: "Review parser", loadedAt: 42 }], complete: true, nativeObserved: false, authorityGranted: false, freshReviewRequired: true };
    return controls.alterChoices ? controls.alterChoices(value) : value;
  }, onEditorTarget: async (selection: unknown) => {
    calls.at(-1)!.payload = selection;
    if (controls.afterProbe) await controls.afterProbe();
    const value = result(); return controls.alter ? controls.alter(value) : value;
  }, onEditorAuthorization: async (action: string, input: any) => {
    calls.at(-1)!.payload = input; if (controls.afterProbe) await controls.afterProbe();
    const { compartment, token: _token, permit: _permit, ...selection } = input;
    const scopeSelection = { ownerRequestId: selection.ownerRequestId, loadRequestId: selection.loadRequestId, requestId: selection.requestId, editorId: selection.editorId };
    if (action === "return-target") { const value = result(); return controls.alter ? controls.alter(value) : value; }
    const at = Date.now();
    const value: any = action === "review" ? { status: "requires-confirmation", selection, target, confirmation: { token: randomUUID(), record: { id: randomUUID(), action: "launch_codex_editor", sessionId: target.sessionId, targetSnapshotId: createHash("sha256").update(JSON.stringify(["switchyard-editor-launch/v1", compartment, scopeSelection])).digest("hex"), scopeDigest: "f".repeat(64), reason: "Review this exact synthetic editor.", reauthenticated: false, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + 300000).toISOString() } }, terminalLaunchAuthorized: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false }
      : { ...selection, status: action === "issue" ? "issued" : "consumed", terminalLaunchAuthorized: action === "consume", terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false, targetDigest: result().targetDigest, expiresAt: Date.now() + 30000, ...(action === "issue" ? { permit: randomUUID() } : { target }) };
    return controls.alterAuthorization ? controls.alterAuthorization(value) : value;
  }, onEditorConnection: async (action: string, input: any) => {
    calls.at(-1)!.payload = input; if (controls.afterProbe) await controls.afterProbe();
    const { compartment: _compartment, peer: _peer, ...selection } = input;
    const flags = { terminalLaunched: false, ideAttached: false, authorityGranted: false, completionVerified: false };
    const result = ["stop", "recover"].includes(action) ? { ...selection, status: "stopped", protocolAcknowledgementRecorded: true, stoppedVerified: true, ...flags }
      : { requestId: selection.requestId, status: action === "open" ? "ready" : "acknowledged", peerVerified: action !== "open", protocolAcknowledged: action !== "open", ...flags, ...(action === "open" ? { duplicatePrevented: false, endpoint: { socketPath: "/tmp/synthetic-editor-connection/s", socketDevice: "1", socketInode: "2" } } : {}) };
    const value = { schema: "switchyard-editor-connection-result/v1", action, selection, result };
    return controls.alterConnection ? controls.alterConnection(value) : value;
  } });
  let origin: string;
  const server = createServer(async (req, res) => {
    calls.push({ path: req.url ?? "", bearer: Boolean(req.headers.authorization) });
    assert.ok(["/instance/v1/editor-choices", "/instance/v1/editor-target", "/instance/v1/editor-review", "/instance/v1/editor-issue", "/instance/v1/editor-consume", "/instance/v1/editor-return-target", ...["open", "pin-peer", "observe", "stop", "recover"].map(action => "/instance/v1/editor-connection-"+action)].includes(req.url!)); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.origin, undefined);
    if (controls.hold) return;
    if (controls.forged) { res.end(JSON.stringify({ status: "ready" })); return; }
    await gateway(req, res, origin);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
  const endpoint = { schema: "switchyard-active-endpoint/v1", instance: identity, pid: process.pid, url: origin + "/#access=" + token };
  await writeFile(endpointPath, JSON.stringify(endpoint), { mode: 0o600 });
  const client = new StudioTaskClient({ endpointPath });
  t.after(async () => { client.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await rm(root, { recursive: true }); });
  return { root, endpointPath, endpoint, client, selected, controls, calls, target };
}

test("editor client authenticates the shipped instance protocol and retains exact metadata without promoting it to authority", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t), result = await f.client.editorTarget(f.selected);
  assert.deepEqual(result.target, f.target); assert.equal(result.authorityGranted, false); assert.equal(result.ideAttached, false); assert.equal(result.terminalLaunched, false);
  assert.deepEqual(f.calls.map(row => [row.path, row.bearer]), [["/instance/v1/editor-target", false]]); assert.deepEqual(f.calls[0].payload, f.selected);
  for (const value of [result, result.target, result.target.endpoint, result.target.repositoryIdentity]) assert.ok(Object.isFrozen(value));
  const choices = await f.client.editorChoices(f.target.repositoryRoot);
  assert.equal(choices.repositoryRoot, f.target.repositoryRoot); assert.equal(choices.compartment, f.selected.compartment);
  assert.deepEqual(choices.choices, [{ ownerRequestId: f.selected.ownerRequestId, loadRequestId: f.selected.loadRequestId, taskId: f.target.taskId, label: "Review parser", loadedAt: 42 }]);
  assert.equal(choices.freshReviewRequired, true); assert.equal(choices.nativeObserved, false); assert.equal(choices.authorityGranted, false);
  assert.deepEqual(f.calls.at(-1)!.payload, { repositoryRoot: f.target.repositoryRoot });
  for (const value of [choices, choices.choices, choices.choices[0]]) assert.ok(Object.isFrozen(value));
  for (const value of [f.target.sessionId, f.target.accountFingerprint]) assert.equal(JSON.stringify(choices).includes(value), false);

});
test("an unauthenticated or changed saved instance never receives the API bearer or returns trusted metadata", { skip: process.platform !== "linux" }, async t => {
  for (const drift of ["forged", "file", "selection"]) {
    const f = await fixture(t), original = { ...f.selected };
    if (drift === "forged") f.controls.forged = true;
    if (drift === "file") f.controls.afterProbe = () => writeFile(f.endpointPath, JSON.stringify({ ...f.endpoint, pid: process.pid + 1 }));
    if (drift === "selection") {
      f.controls.afterProbe = () => { f.selected.ownerRequestId = randomUUID(); };
      assert.equal((await f.client.editorTarget(f.selected)).target.ownerRequestId, original.ownerRequestId); assert.deepEqual(f.calls[0].payload, original);
    } else { await assert.rejects(f.client.editorTarget(f.selected)); assert.equal(f.calls.some(row => row.bearer), false); }
  }
});
test("a source response cannot substitute owner, task scope, endpoint, digest or capability claims", { skip: process.platform !== "linux" }, async t => {
  for (const alter of [
    (v: any) => ({ ...v, authorityGranted: true }), (v: any) => ({ ...v, terminalLaunched: true }), (v: any) => ({ ...v, nativeTaskLoaded: true }),
    (v: any) => ({ ...v, targetDigest: "d".repeat(64) }), (v: any) => ({ ...v, prompt: "never" }),
    (v: any) => { v.target.ownerRequestId = randomUUID(); return v; },
    (v: any) => { v.target.endpoint.socketPath = "wss://foreign.invalid"; return v; },
    (v: any) => { v.target.permissions = "danger-full-access"; return v; },
    (v: any) => { v.target.endpoint.peerBirth = 1234; return v; }
  ]) { const f = await fixture(t); f.controls.alter = alter; await assert.rejects(f.client.editorTarget(f.selected)); }
});
test("private endpoint permissions, symlinks, remote URLs and unrelated request fields refuse before network access", { skip: process.platform !== "linux" }, async t => {
  for (const drift of ["mode", "link", "remote", "fields"]) {
    const f = await fixture(t);
    if (drift === "mode") await chmod(f.endpointPath, 0o644);
    if (drift === "link") { const saved = join(f.root, "saved.json"); await writeFile(saved, JSON.stringify(f.endpoint), { mode: 0o600 }); await rm(f.endpointPath); await symlink(saved, f.endpointPath); }
    if (drift === "remote") await writeFile(f.endpointPath, JSON.stringify({ ...f.endpoint, url: "https://foreign.invalid/#access=" + "s".repeat(43) }));
    await assert.rejects(f.client.editorTarget(drift === "fields" ? { ...f.selected, prompt: "never" } as any : f.selected)); assert.equal(f.calls.length, 0);
  }
});
test("client shutdown cancels an in-flight proof and cannot disclose a bearer or reopen", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t); f.controls.hold = true;
  const pending = f.client.editorTarget(f.selected), rejected = assert.rejects(pending);
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  f.client.close(); await rejected; await assert.rejects(f.client.editorTarget(f.selected)); assert.equal(f.calls.some(row => row.bearer), false);
});
test("signed editor authorization validates exact reviews and consumed permissions while retaining false native-effect claims", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() };
  const review = await f.client.reviewEditor(selected); assert.deepEqual(review.target, f.target); assert.equal(review.terminalLaunchAuthorized, false);
  const issued = await f.client.issueEditor({ ...selected, token: review.confirmation.token }); assert.equal(issued.terminalLaunchAuthorized, false); assert.ok(issued.permit);
  const consumed = await f.client.consumeEditor({ ...selected, permit: issued.permit }); assert.equal(consumed.terminalLaunchAuthorized, true); assert.equal(consumed.terminalLaunched, false); assert.equal(consumed.ideAttached, false); assert.deepEqual(consumed.target, f.target);
  for (const value of [review, review.selection, review.confirmation, review.confirmation.record, issued, consumed, consumed.target]) assert.ok(Object.isFrozen(value));
  assert.deepEqual(f.calls.map(row => row.path), ["/instance/v1/editor-review", "/instance/v1/editor-issue", "/instance/v1/editor-consume"]); assert.equal(f.calls.some(row => row.bearer), false); assert.equal(JSON.stringify(f.calls).includes("s".repeat(43)), false);
});
test("signed replies cannot substitute review domain, editor identity, expiry, target or native effect claims", { skip: process.platform !== "linux" }, async t => {
  for (const [method, mutate] of [
    ["reviewEditor", (v: any) => { v.selection.editorId = randomUUID(); }], ["reviewEditor", (v: any) => { v.confirmation.record.action = "load_codex_task"; }], ["reviewEditor", (v: any) => { v.confirmation.record.targetSnapshotId = "a".repeat(64); }], ["reviewEditor", (v: any) => { v.confirmation.record.expiresAt = new Date(Date.now() - 1).toISOString(); }], ["reviewEditor", (v: any) => { v.confirmation.record.reauthenticated = true; }],
    ["issueEditor", (v: any) => { v.permit = "latest"; }], ["issueEditor", (v: any) => { v.expiresAt = Date.now() - 1; }], ["issueEditor", (v: any) => { v.terminalLaunchAuthorized = true; }], ["issueEditor", (v: any) => { v.editorId = randomUUID(); }],
    ["consumeEditor", (v: any) => { v.target.accountFingerprint = "e".repeat(64); }], ["consumeEditor", (v: any) => { v.target.endpoint.socketPath = "/foreign"; }], ["consumeEditor", (v: any) => { v.terminalLaunched = true; }], ["consumeEditor", (v: any) => { v.ideAttached = true; }], ["consumeEditor", (v: any) => { v.duplicatePrevented = true; }], ["consumeEditor", (v: any) => { v.expiresAt = Date.now() + 31000; }]
  ] as const) {
    const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID(), ...(method === "issueEditor" ? { token: randomUUID() } : method === "consumeEditor" ? { permit: randomUUID() } : {}) };
    f.controls.alterAuthorization = value => { mutate(value); return value; };
    await assert.rejects(f.client[method](selected as any));
  }
});
test("authorization transport rejects unsigned or changed-instance replies, copies selected IDs and accepts only non-authorizing replay metadata", { skip: process.platform !== "linux" }, async t => {
  for (const drift of ["forged", "endpoint", "selection", "duplicate"]) {
    const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID(), permit: randomUUID() }, original = { ...selected };
    if (drift === "forged") f.controls.forged = true;
    if (drift === "endpoint") f.controls.afterProbe = () => writeFile(f.endpointPath, JSON.stringify({ ...f.endpoint, pid: process.pid + 1 }));
    if (drift === "selection") f.controls.afterProbe = () => { selected.editorId = randomUUID(); };
    if (drift === "duplicate") f.controls.alterAuthorization = value => { const { target: _t, targetDigest: _d, expiresAt: _e, ...base } = value; return { ...base, duplicatePrevented: true, terminalLaunchAuthorized: false }; };
    if (["forged", "endpoint"].includes(drift)) await assert.rejects(f.client.consumeEditor(selected));
    else { const value = await f.client.consumeEditor(selected); assert.equal(value.editorId, original.editorId); assert.equal(value.terminalLaunchAuthorized, drift !== "duplicate"); }
    assert.equal(f.calls.some(row => row.bearer), false);
  }
});

test("signed return transport binds all four editor identities and refuses extra fields or promoted authority", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() };
  const result = await f.client.returnEditorTarget(selected);
  assert.deepEqual(f.calls.map(row => row.path), ["/instance/v1/editor-return-target"]); assert.deepEqual(f.calls[0].payload, selected);
  assert.deepEqual(result.target, f.target); assert.equal(result.authorityGranted, false); assert.ok(Object.isFrozen(result.target));
  for (const extra of [{ permit: randomUUID() }, { token: randomUUID() }, { prompt: "never" }, { editorId: undefined }]) await assert.rejects(f.client.returnEditorTarget({ ...selected, ...extra } as any));
  assert.equal(f.calls.length, 1);
  f.controls.alter = v => ({ ...v, authorityGranted: true }); await assert.rejects(f.client.returnEditorTarget(selected));
  assert.equal(f.calls.some(row => row.bearer), false);
});


test("signed connection client binds all five operations and keeps historical cleanup distinct from current acknowledgement", { skip: process.platform !== "linux" }, async t => {
  const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() }, peer = { pid: 123, birth: "456", executable: "/synthetic/codex", executableSha256: "a".repeat(64) };
  const opened = await f.client.openEditorConnection(selected); assert.ok("endpoint" in opened); assert.ok(Object.isFrozen(opened.endpoint)); assert.equal(opened.protocolAcknowledged, false);
  const pinned = await f.client.pinEditorPeer({ ...selected, peer }); assert.equal(pinned.protocolAcknowledged, true); assert.equal(pinned.ideAttached, false);
  const observed = await f.client.observeEditorConnection(selected); assert.ok(Object.isFrozen(observed));
  for (const stopped of [await f.client.stopEditorConnection(selected), await f.client.recoverEditorConnection(selected)]) { assert.equal(stopped.stoppedVerified, true); assert.equal(stopped.protocolAcknowledgementRecorded, true); assert.equal("protocolAcknowledged" in stopped, false); }
  assert.deepEqual(f.calls.map(c => c.path), ["open", "pin-peer", "observe", "stop", "recover"].map(a => "/instance/v1/editor-connection-"+a)); assert.equal(f.calls.some(c => c.bearer), false);
  assert.deepEqual(f.calls[1].payload, { ...selected, peer }); assert.ok(Object.isFrozen((f.calls[1].payload as any).peer));
});
test("connection client rejects substituted signed identities, endpoint fields and unsupported authority claims", { skip: process.platform !== "linux" }, async t => {
  for (const mutate of [
    (v: any) => { v.action = "recover"; }, (v: any) => { v.selection.editorId = randomUUID(); }, (v: any) => { v.result.requestId = randomUUID(); },
    (v: any) => { v.result.ideAttached = true; }, (v: any) => { v.result.endpoint.socketPath = "/tmp/../foreign"; }, (v: any) => { v.result.endpoint.token = "PRIVATE"; },
    (v: any) => { v.result.duplicatePrevented = true; }, (v: any) => { v.result.protocolAcknowledged = true; }, (v: any) => { v.result.command = "never"; }
  ]) {
    const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() }; f.controls.alterConnection = value => { mutate(value); return value; }; await assert.rejects(f.client.openEditorConnection(selected)); assert.equal(f.calls.length, 1);
  }
  const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() };
  for (const extra of [{ command: "never" }, { permit: randomUUID() }, { requestId: "latest" }]) await assert.rejects(f.client.openEditorConnection({ ...selected, ...extra } as any));
  for (const peer of [{ pid: 1, birth: "2", executable: "/x", executableSha256: "a".repeat(64), command: "never" }, { pid: 1, birth: "2", executable: "/tmp/../x", executableSha256: "a".repeat(64) }]) await assert.rejects(f.client.pinEditorPeer({ ...selected, peer }));
  assert.equal(f.calls.length, 0);
});
test("connection response loss or replacement never retries opening and duplicate metadata yields no endpoint", { skip: process.platform !== "linux" }, async t => {
  for (const drift of ["forged", "instance", "duplicate", "cancel"]) {
    const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() };
    if (drift === "forged") f.controls.forged = true;
    if (drift === "instance") f.controls.afterProbe = () => writeFile(f.endpointPath, JSON.stringify({ ...f.endpoint, pid: process.pid + 1 }));
    if (drift === "cancel") f.controls.afterProbe = () => f.client.close();
    if (drift === "duplicate") f.controls.alterConnection = v => ({ ...v, result: { ...v.selection, status: "ready", protocolAcknowledgementRecorded: false, stoppedVerified: false, terminalLaunched: false, ideAttached: false, authorityGranted: false, completionVerified: false, duplicatePrevented: true } });
    if (drift === "duplicate") { const value = await f.client.openEditorConnection(selected); assert.equal(value.duplicatePrevented, true); assert.equal("endpoint" in value, false); }
    else await assert.rejects(f.client.openEditorConnection(selected));
    assert.equal(f.calls.length, 1);
  }
});
