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
  const controls: { forged: boolean; afterProbe?: () => Promise<void> | void; alter?: (value: ReturnType<typeof result>) => unknown; hold?: boolean; routeStatus?: number } = { forged: false };
  const calls: { path: string; bearer: boolean; payload?: unknown }[] = [];
  const gateway = createInstanceGateway({ token, identity, onStop: () => { throw Error("Stop is outside this read-only client"); }, onEditorTarget: async (selection: unknown) => {
    calls.at(-1)!.payload = selection;
    if (controls.afterProbe) await controls.afterProbe();
    const value = result(); return controls.alter ? controls.alter(value) : value;
  } });
  let origin: string;
  const server = createServer(async (req, res) => {
    calls.push({ path: req.url ?? "", bearer: Boolean(req.headers.authorization) });
    assert.equal(req.url, "/instance/v1/editor-target"); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.origin, undefined);
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
