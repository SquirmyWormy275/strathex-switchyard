import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioInstanceTransport } from "../src/studio-instance-transport.ts";
import { StudioWindowsTaskClient,windowsEditorBinding,windowsEditorPeer } from "../src/studio-windows-task-client.ts";
// File reads below are explicit native endpoint-reader doubles in owned fixtures.
// @ts-expect-error Exercise the actual shipped JavaScript instance protocol.
import { createInstanceGateway } from "../../../tools/layout-studio/instance.mjs";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sy-editor-client-")), endpointPath = join(root, "endpoint.json"), token = "s".repeat(43), identity = { id: randomUUID(), build: "a".repeat(64) };
  const selected = { compartment: "personal", ownerRequestId: randomUUID(), loadRequestId: randomUUID() };
  const target = { schema: "switchyard-codex-editor-target/v1", ownerRequestId: selected.ownerRequestId, loadRequestId: selected.loadRequestId, taskId: randomUUID(), sessionId: randomUUID(), repositoryRoot: "C:\\exact repository", repositoryIdentity: { device: "0", inode: "9007199254740993" }, accountFingerprint: "b".repeat(64), permissions: "read-only/on-request", endpoint: { schema: "switchyard-windows-codex-stdio-binding/v1", scope: {schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:1233,birth:"638000000000000001",containment:"windows-job"}, peerPid: 1234, peerBirth: "133000000000000001", peerExecutableSha256: "c".repeat(64) } };
  const result = () => ({ target, targetDigest: createHash("sha256").update(JSON.stringify(target)).digest("hex"), metadataObserved: true, nativeLoadAcknowledged: true, nativeTaskLoaded: false, authorityGranted: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false });
  const controls: { forged: boolean; afterProbe?: () => Promise<void> | void; alter?: (value: ReturnType<typeof result>) => unknown; alterAuthorization?: (value: any) => unknown; alterConnection?: (value: any) => unknown; alterChoices?: (value: any) => unknown; alterProjects?: (value: any) => unknown; hold?: boolean; routeStatus?: number; readerUnavailable?: boolean } = { forged: false };
  const calls: { path: string; bearer: boolean; payload?: unknown }[] = [];
  const gateway = createInstanceGateway({ token, identity, onStop: () => { throw Error("Stop is outside this read-only client"); }, onEditorProjects: async (selection: unknown) => {
    calls.at(-1)!.payload = selection; if (controls.afterProbe) await controls.afterProbe();
    const value = { schema: "switchyard-editor-project-choices/v1", compartment: selected.compartment, projects: [{ repositoryRoot: target.repositoryRoot, taskCount: 1 }], complete: true, nativeObserved: false, authorityGranted: false, freshReviewRequired: true };
    return controls.alterProjects ? controls.alterProjects(value) : value;
  }, onEditorChoices: async (selection: { repositoryRoot: string }) => {
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
      : { requestId: selection.requestId, status: action === "open" ? "ready" : "acknowledged", peerVerified: action !== "open", protocolAcknowledged: action !== "open", ...flags, ...(action === "open" ? { duplicatePrevented: false, endpoint: { url: "ws://127.0.0.1:43179/", authToken: "s".repeat(43) } } : {}) };
    const value = { schema: "switchyard-editor-connection-result/v1", action, selection, result };
    return controls.alterConnection ? controls.alterConnection(value) : value;
  } });
  let origin: string;
  const server = createServer(async (req, res) => {
    calls.push({ path: req.url ?? "", bearer: Boolean(req.headers.authorization) });
    assert.ok(["/instance/v1/editor-projects", "/instance/v1/editor-choices", "/instance/v1/editor-target", "/instance/v1/editor-review", "/instance/v1/editor-issue", "/instance/v1/editor-consume", "/instance/v1/editor-return-target", ...["open", "pin-peer", "observe", "stop", "recover"].map(action => "/instance/v1/editor-connection-"+action)].includes(req.url!)); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.origin, undefined);
    if (controls.hold) return;
    if (controls.forged) { res.end(JSON.stringify({ status: "ready" })); return; }
    await gateway(req, res, origin);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
  const endpoint = { schema: "switchyard-active-endpoint/v1", instance: identity, pid: process.pid, url: origin + "/#access=" + token };
  await writeFile(endpointPath, JSON.stringify(endpoint), { mode: 0o600 });
  const client = new StudioWindowsTaskClient({ readEndpoint: async () => { if (controls.readerUnavailable) throw Error("native endpoint observation unavailable"); return readFile(endpointPath, "utf8"); }, assertCurrent: async () => {} });
  t.after(async () => { client.close(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await rm(root, { recursive: true }); });
  return { root, endpointPath, endpoint, client, selected, controls, calls, target };
}

test("Windows editor client authenticates the shipped instance protocol and retains exact metadata without promoting it to authority", async t => {
  const f = await fixture(t), result = await f.client.editorTarget(f.selected);
  assert.deepEqual(result.target, f.target); assert.equal(result.authorityGranted, false); assert.equal(result.ideAttached, false); assert.equal(result.terminalLaunched, false);
  assert.deepEqual(f.calls.map(row => [row.path, row.bearer]), [["/instance/v1/editor-target", false]]); assert.deepEqual(f.calls[0].payload, f.selected);
  for (const value of [result, result.target, result.target.endpoint, result.target.repositoryIdentity]) assert.ok(Object.isFrozen(value));
  const projects = await f.client.editorProjects();
  assert.deepEqual(projects.projects, [{ repositoryRoot: f.target.repositoryRoot, taskCount: 1 }]);
  assert.equal(projects.authorityGranted, false); assert.equal(projects.nativeObserved, false); assert.equal(projects.freshReviewRequired, true);
  assert.ok(Object.isFrozen(projects) && Object.isFrozen(projects.projects) && Object.isFrozen(projects.projects[0]));
  const choices = await f.client.editorChoices(f.target.repositoryRoot);
  assert.equal(choices.repositoryRoot, f.target.repositoryRoot); assert.equal(choices.compartment, f.selected.compartment);
  assert.deepEqual(choices.choices, [{ ownerRequestId: f.selected.ownerRequestId, loadRequestId: f.selected.loadRequestId, taskId: f.target.taskId, label: "Review parser", loadedAt: 42 }]);
  assert.equal(choices.freshReviewRequired, true); assert.equal(choices.nativeObserved, false); assert.equal(choices.authorityGranted, false);
  assert.deepEqual(f.calls.at(-1)!.payload, { repositoryRoot: f.target.repositoryRoot });
  for (const value of [choices, choices.choices, choices.choices[0]]) assert.ok(Object.isFrozen(value));
  for (const value of [f.target.sessionId, f.target.accountFingerprint]) assert.equal(JSON.stringify(choices).includes(value), false);

});
test("an unauthenticated or changed saved instance never receives the API bearer or returns trusted metadata", async t => {
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
test("a source response cannot substitute owner, task scope, endpoint, digest or capability claims", async t => {
  for (const alter of [
    (v: any) => ({ ...v, authorityGranted: true }), (v: any) => ({ ...v, terminalLaunched: true }), (v: any) => ({ ...v, nativeTaskLoaded: true }),
    (v: any) => ({ ...v, targetDigest: "d".repeat(64) }), (v: any) => ({ ...v, prompt: "never" }),
    (v: any) => { v.target.ownerRequestId = randomUUID(); return v; },
    (v: any) => { v.target.endpoint.socketPath = "wss://foreign.invalid"; return v; },
    (v: any) => { v.target.permissions = "danger-full-access"; return v; },
    (v: any) => { v.target.endpoint.peerBirth = 1234; return v; }
  ]) { const f = await fixture(t); f.controls.alter = alter; await assert.rejects(f.client.editorTarget(f.selected)); }
});
test("unavailable native reader, remote endpoint and unrelated input refuse before any HTTP request",async t=>{
  for(const drift of ["reader","remote","fields","bound"]){const f=await fixture(t);
    if(drift==="reader")f.controls.readerUnavailable=true;
    if(drift==="remote")await writeFile(f.endpointPath,JSON.stringify({...f.endpoint,url:"https://foreign.invalid/#access="+"s".repeat(43)}));
    if(drift==="bound")await writeFile(f.endpointPath,"x".repeat(4097));
    await assert.rejects(f.client.editorTarget(drift==="fields"?{...f.selected,prompt:"never"} as any:f.selected));assert.equal(f.calls.length,0);
  }
});
test("client shutdown cancels an in-flight proof and cannot disclose a bearer or reopen", async t => {
  const f = await fixture(t); f.controls.hold = true;
  const pending = f.client.editorTarget(f.selected), rejected = assert.rejects(pending);
  while (!f.calls.length) await new Promise(resolve => setImmediate(resolve));
  f.client.close(); await rejected; await assert.rejects(f.client.editorTarget(f.selected)); assert.equal(f.calls.some(row => row.bearer), false);
});
test("signed editor authorization validates exact reviews and consumed permissions while retaining false native-effect claims", async t => {
  const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() };
  const review = await f.client.reviewEditor(selected); assert.deepEqual(review.target, f.target); assert.equal(review.terminalLaunchAuthorized, false);
  const issued = await f.client.issueEditor({ ...selected, token: review.confirmation.token }); assert.equal(issued.terminalLaunchAuthorized, false); assert.ok(issued.permit);
  const consumed = await f.client.consumeEditor({ ...selected, permit: issued.permit }); assert.equal(consumed.terminalLaunchAuthorized, true); assert.equal(consumed.terminalLaunched, false); assert.equal(consumed.ideAttached, false); assert.deepEqual(consumed.target, f.target);
  for (const value of [review, review.selection, review.confirmation, review.confirmation.record, issued, consumed, consumed.target]) assert.ok(Object.isFrozen(value));
  assert.deepEqual(f.calls.map(row => row.path), ["/instance/v1/editor-review", "/instance/v1/editor-issue", "/instance/v1/editor-consume"]); assert.equal(f.calls.some(row => row.bearer), false); assert.equal(JSON.stringify(f.calls).includes("s".repeat(43)), false);
});
test("signed replies cannot substitute review domain, editor identity, expiry, target or native effect claims", async t => {
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
test("authorization transport rejects unsigned or changed-instance replies, copies selected IDs and accepts only non-authorizing replay metadata", async t => {
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

test("signed return transport binds all four editor identities and refuses extra fields or promoted authority", async t => {
  const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() };
  const result = await f.client.returnEditorTarget(selected);
  assert.deepEqual(f.calls.map(row => row.path), ["/instance/v1/editor-return-target"]); assert.deepEqual(f.calls[0].payload, selected);
  assert.deepEqual(result.target, f.target); assert.equal(result.authorityGranted, false); assert.ok(Object.isFrozen(result.target));
  for (const extra of [{ permit: randomUUID() }, { token: randomUUID() }, { prompt: "never" }, { editorId: undefined }]) await assert.rejects(f.client.returnEditorTarget({ ...selected, ...extra } as any));
  assert.equal(f.calls.length, 1);
  f.controls.alter = v => ({ ...v, authorityGranted: true }); await assert.rejects(f.client.returnEditorTarget(selected));
  assert.equal(f.calls.some(row => row.bearer), false);
});


test("signed connection client binds all five operations and keeps historical cleanup distinct from current acknowledgement", async t => {
  const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() }, peer = { processId:123,expectedBirth:"133000000000000003",image:{path:"C:\\Synthetic\\codex.exe",sha256:"a".repeat(64),device:"0",inode:"9007199254740993",size:"512"} };
  const opened = await f.client.openEditorConnection(selected); assert.ok("endpoint" in opened); assert.ok(Object.isFrozen(opened.endpoint)); assert.equal(opened.protocolAcknowledged, false);
  const pinned = await f.client.pinEditorPeer({ ...selected, peer }); assert.equal(pinned.protocolAcknowledged, true); assert.equal(pinned.ideAttached, false);
  const observed = await f.client.observeEditorConnection(selected); assert.ok(Object.isFrozen(observed));
  for (const stopped of [await f.client.stopEditorConnection(selected), await f.client.recoverEditorConnection(selected)]) { assert.equal(stopped.stoppedVerified, true); assert.equal(stopped.protocolAcknowledgementRecorded, true); assert.equal("protocolAcknowledged" in stopped, false); }
  assert.deepEqual(f.calls.map(c => c.path), ["open", "pin-peer", "observe", "stop", "recover"].map(a => "/instance/v1/editor-connection-"+a)); assert.equal(f.calls.some(c => c.bearer), false);
  assert.deepEqual(f.calls[1].payload, { ...selected, peer }); assert.ok(Object.isFrozen((f.calls[1].payload as any).peer));
});
test("connection client rejects substituted signed identities, endpoint fields and unsupported authority claims", async t => {
  for (const mutate of [
    (v: any) => { v.action = "recover"; }, (v: any) => { v.selection.editorId = randomUUID(); }, (v: any) => { v.result.requestId = randomUUID(); },
    (v: any) => { v.result.ideAttached = true; }, (v: any) => { v.result.endpoint.url = "ws://localhost:43179/"; }, (v: any) => { v.result.endpoint.token = "PRIVATE"; },
    (v: any) => { v.result.duplicatePrevented = true; }, (v: any) => { v.result.protocolAcknowledged = true; }, (v: any) => { v.result.command = "never"; }
  ]) {
    const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() }; f.controls.alterConnection = value => { mutate(value); return value; }; await assert.rejects(f.client.openEditorConnection(selected)); assert.equal(f.calls.length, 1);
  }
  const f = await fixture(t), selected = { ...f.selected, requestId: randomUUID(), editorId: randomUUID() };
  for (const extra of [{ command: "never" }, { permit: randomUUID() }, { requestId: "latest" }]) await assert.rejects(f.client.openEditorConnection({ ...selected, ...extra } as any));
  for (const peer of [{ pid: 1, birth: "2", executable: "/x", executableSha256: "a".repeat(64), command: "never" }, { pid: 1, birth: "2", executable: "/tmp/../x", executableSha256: "a".repeat(64) }]) await assert.rejects(f.client.pinEditorPeer({ ...selected, peer: peer as any }));
  assert.equal(f.calls.length, 0);
});
test("connection response loss or replacement never retries opening and duplicate metadata yields no endpoint", async t => {
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

test("Windows bindings and peers preserve 64-bit strings and reject widened or mixed coordinates",()=>{
 const scope={schema:"switchyard-runtime-command/v1",id:randomUUID(),guardianPid:500,birth:"638000000000000001",containment:"windows-job"};
 const binding={schema:"switchyard-windows-codex-stdio-binding/v1",scope,peerPid:501,peerBirth:"133000000000000001",peerExecutableSha256:"a".repeat(64)};
 const checked=windowsEditorBinding(binding);assert.deepEqual(checked,binding);assert(Object.isFrozen(checked.scope));scope.birth="changed";assert.equal(checked.scope.birth,"638000000000000001");
 for(const patch of [{peerPid:500},{peerBirth:1},{peerBirth:"18446744073709551616"},{scope:{...checked.scope,containment:"owned-linux-session"}},{scope:{...checked.scope,id:"00000000-0000-0000-0000-000000000000"}},{socketPath:"/foreign"}])assert.throws(()=>windowsEditorBinding({...checked,...patch}));
 const peer={processId:600,expectedBirth:"133000000000000003",image:{path:"C:\\Synthetic\\codex.exe",sha256:"b".repeat(64),device:"0",inode:"9007199254740993",size:"512"}};
 assert.deepEqual(windowsEditorPeer(peer),peer);
 for(const patch of [{expectedBirth:null},{expectedBirth:"01"},{processId:2147483648},{image:{...peer.image,device:"4294967296"}},{image:{...peer.image,inode:9007199254740992}},{image:{...peer.image,size:"536870913"}},{image:{...peer.image,path:"C:\\NUL.exe"}},{pid:600}])assert.throws(()=>windowsEditorPeer({...peer,...patch}));
});

test("signed project choices refuse malformed inventories, substituted projects and unsafe requests before granting any authority", async t => {
  const f = await fixture(t);
  for (const root of ["relative", "C:\\repo\\..\\other", "C:\\repo\n", "C:\\" + "x".repeat(4097), null]) {
    const before = f.calls.length; await assert.rejects(f.client.editorChoices(root as string)); assert.equal(f.calls.length, before);
  }
  for (const alter of [
    (v: any) => ({ ...v, repositoryRoot: "C:\\foreign" }), (v: any) => ({ ...v, complete: false }),
    (v: any) => ({ ...v, authorityGranted: true }), (v: any) => ({ ...v, nativeObserved: true }),
    (v: any) => ({ ...v, freshReviewRequired: false }), (v: any) => ({ ...v, token: "never" }),
    (v: any) => ({ ...v, choices: [...v.choices, ...v.choices] }),
    (v: any) => ({ ...v, choices: [{ ...v.choices[0], sessionId: randomUUID() }] }),
    (v: any) => ({ ...v, choices: [{ ...v.choices[0], label: "unsafe\nlabel" }] }),
    (v: any) => ({ ...v, choices: [{ ...v.choices[0], taskId: "00000000-0000-0000-0000-000000000000" }] }),
    (v: any) => ({ ...v, choices: [{ ...v.choices[0], loadedAt: -1 }] })
  ]) { f.controls.alterChoices = alter; await assert.rejects(f.client.editorChoices(f.target.repositoryRoot)); }
  f.controls.alterChoices = undefined;
  const longRoot = "C:\\" + "p".repeat(3000); assert.equal((await f.client.editorChoices(longRoot)).repositoryRoot, longRoot);
  const transport = new StudioInstanceTransport({ readEndpoint: () => readFile(f.endpointPath, "utf8"), assertCurrent() {} }); t.after(() => transport.close());
  for (const selection of [{ repositoryRoot: f.target.repositoryRoot, compartment: "other" }, { repositoryRoot: f.target.repositoryRoot, prompt: "never" }, { repositoryRoot: "x".repeat(4097) }]) await assert.rejects(transport.exchange("editorChoices", selection));
  f.controls.forged = true; await assert.rejects(f.client.editorChoices(f.target.repositoryRoot)); f.controls.forged = false;
  f.controls.afterProbe = () => writeFile(f.endpointPath, JSON.stringify({ ...f.endpoint, pid: process.pid + 1 }));
  await assert.rejects(f.client.editorChoices(f.target.repositoryRoot));
  assert.equal(f.calls.some(row => row.bearer), false);
});


test("signed project inventory refuses malformed paths, counts, scope substitution and endpoint replacement", async t => {
  const f = await fixture(t);
  for (const alter of [
    (v: any) => ({ ...v, complete: false }), (v: any) => ({ ...v, authorityGranted: true }),
    (v: any) => ({ ...v, nativeObserved: true }), (v: any) => ({ ...v, freshReviewRequired: false }),
    (v: any) => ({ ...v, credential: "never" }), (v: any) => ({ ...v, projects: [...v.projects, ...v.projects] }),
    ...[0, -1, 65, 1.5, "1"].map(taskCount => (v: any) => ({ ...v, projects: [{ ...v.projects[0], taskCount }] })),
    ...["relative", "C:\\repo\\..\\other", "C:\\repo\n", "C:\\" + "x".repeat(4097)].map(repositoryRoot => (v: any) => ({ ...v, projects: [{ repositoryRoot, taskCount: 1 }] })),
    (v: any) => ({ ...v, projects: [{ ...v.projects[0], taskCount: 64 }, { repositoryRoot: "C:\\other", taskCount: 1 }] }),
    (v: any) => ({ ...v, projects: Array.from({ length: 8 }, (_, i) => ({ repositoryRoot: "C:\\" + i + "x".repeat(3100), taskCount: 1 })) })
  ]) { f.controls.alterProjects = alter; await assert.rejects(f.client.editorProjects()); }
  f.controls.alterProjects = undefined;
  const transport = new StudioInstanceTransport({ readEndpoint: () => readFile(f.endpointPath, "utf8"), assertCurrent() {} }); t.after(() => transport.close());
  for (const selection of [{ compartment: "personal" }, { repositoryRoot: f.target.repositoryRoot }, { prompt: "never" }, [], null]) await assert.rejects(transport.exchange("editorProjects", selection));
  f.controls.forged = true; await assert.rejects(f.client.editorProjects()); f.controls.forged = false;
  f.controls.afterProbe = () => writeFile(f.endpointPath, JSON.stringify({ ...f.endpoint, pid: process.pid + 1 }));
  await assert.rejects(f.client.editorProjects()); assert.equal(f.calls.some(row => row.bearer), false);
});
