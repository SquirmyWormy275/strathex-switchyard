/** Own a detached, immutable exchange image before any writable-volume handoff. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, mkdir, readdir, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { privateDirectory, directoryIdentity } from "./private-fs.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { scopeHash } from "./confirmations.mjs";

const schema = "switchyard-windows-bounded-image/v1", virtualBytes = 64 * 1024 * 1024, backingBytes = virtualBytes + 512;
const defaultHelper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url));
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identity = value => ({ device: value.dev.toString(), inode: value.ino.toString() });
const same = (a, b) => a?.device === b?.device && a?.inode === b?.inode;
const validIdentity = value => value && Object.keys(value).sort().join() === "device,inode" && [value.device, value.inode].every(part => typeof part === "string" && /^[0-9]{1,32}$/.test(part));
const proofFields = ["schema", "operationId", "stagingIdentity", "imageIdentity", "imageFilename", "virtualBytes", "backingBytes", "filesystem", "imageSha256", "footerSha256", "nativeHeaderVerified", "privateAclReadbackVerified", "attached", "exchangeQuotaEnforced", "sandboxEnforced"].sort().join();

export function createWindowsExchangeImages({ store, stateDirectory, helper = defaultHelper, helperSha256, platform = process.platform,
  command = (exe, args, options) => runRuntimeCommand(exe, args, { ...options, windowsHelper: helper }),
  guardianStopped = scope => runtimeGuardianStopped(scope, { windowsHelper: helper }),
  consumerStopped = async () => false, isActive = async () => true, now = Date.now } = {}) {
  if (!digest(helperSha256)) throw Error("Pin the trusted native helper before creating an exchange image.");
  const resources = new Map(), generations = new Map(), seen = new Set(); let closed = false;
  const get = async (c, id) => (await store.snapshot(c)).repositoryWindowsImages?.find(row => row.operationId === id);
  const update = (c, id, action, fn) => store.update(c, action, state => { const row = state.repositoryWindowsImages?.find(row => row.operationId === id); if (!row) throw Error("The protected exchange-image ownership record changed."); return fn(row); });
  const lock = (c, fn) => store.withResourceLock("repository-execution", scopeHash([schema, stateDirectory, c]), fn);
  async function ownedResource(c, id, fn) {
    if ([...resources.values()].some(row => row.compartment === c)) throw Error("Wait for this workspace's exact image command; no replacement was started.");
    const key = `${c}:${id}`, resource = { compartment: c, controller: new AbortController(), clients: new Set(), done: null };
    resources.set(key, resource); seen.add(c);
    resource.done = Promise.resolve().then(() => fn(resource)).finally(async () => {
      const stopped = await Promise.all([...resource.clients].map(client => client.stop().catch(() => false)));
      if (stopped.every(Boolean) && resources.get(key) === resource) resources.delete(key);
    });
    return resource.done;
  }
  async function verifyDirectory(c, row) {
    if (row.schema !== schema || row.path !== join(stateDirectory, c, `disk-${row.operationId}`) || !same(identity(await directoryIdentity(row.path)), row.stagingIdentity)) throw Error("Preserve an unfamiliar or replaced exchange-image directory.");
  }
  async function verifyImage(c, row, signal) {
    await verifyDirectory(c, row);
    const entries = await readdir(row.path);
    if (entries.length !== 1 || entries[0] !== "exchange.vhd" || !row.proof) throw Error("Preserve an unfamiliar, missing or unconfirmed original exchange image.");
    const path = join(row.path, "exchange.vhd"), file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await file.stat({ bigint: true }), named = await lstat(path, { bigint: true });
      if (!before.isFile() || !named.isFile() || named.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(backingBytes) || !same(identity(before), identity(named)) || !same(identity(before), row.proof.imageIdentity)) throw Error("The exact original exchange image identity or capacity changed; preserve it.");
      const hash = createHash("sha256"), footerHash = createHash("sha256"), chunk = Buffer.alloc(65536); let total = 0;
      while (total < backingBytes) {
        if (signal?.aborted) throw Error("This image observation was stopped.");
        const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, backingBytes - total), total);
        if (!bytesRead) throw Error("The exact exchange image was truncated; preserve it.");
        hash.update(chunk.subarray(0, bytesRead)); if (total + bytesRead > virtualBytes) footerHash.update(chunk.subarray(Math.max(0, virtualBytes - total), bytesRead)); total += bytesRead;
      }
      const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
      if (after.size !== before.size || after.nlink !== 1n || current.nlink !== 1n || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || current.isSymbolicLink() || !same(identity(before), identity(current)) || hash.digest("hex") !== row.proof.imageSha256 || footerHash.digest("hex") !== row.proof.footerSha256) throw Error("The exact detached exchange image bytes changed; preserve it.");
      await verifyDirectory(c, row);
    } finally { await file.close(); }
  }
  function validateProof(proof, row) {
    if (!proof || Object.keys(proof).sort().join() !== proofFields || proof.schema !== schema || proof.operationId !== row.operationId || !validIdentity(proof.imageIdentity) || !validIdentity(proof.stagingIdentity) || !same(proof.stagingIdentity, row.stagingIdentity)
      || proof.imageFilename !== "exchange.vhd" || proof.virtualBytes !== virtualBytes || proof.backingBytes !== backingBytes || proof.filesystem !== "FAT16" || !digest(proof.imageSha256) || !digest(proof.footerSha256)
      || proof.nativeHeaderVerified !== true || proof.privateAclReadbackVerified !== true || proof.attached !== false || proof.exchangeQuotaEnforced !== false || proof.sandboxEnforced !== false) throw Error("The exact detached native image proof did not verify.");
    if (row.proof && scopeHash(proof) !== scopeHash(row.proof)) throw Error("The original detached image proof changed; preserve it.");
  }
  async function native(c, row, inspect, resource, beforeAck) {
    const request = { schema, operationId: row.operationId, stagingRoot: row.path, stagingIdentity: row.stagingIdentity,
      ...(inspect ? { imageIdentity: row.proof.imageIdentity, expectedImageSha256: row.proof.imageSha256 } : {}) };
    const result = await runOwnedNativeCommand({ executable: helper, args: [inspect ? "--inspect-bounded-exchange-image" : "--create-bounded-exchange-image"], expectedExecutableSha256: helperSha256,
      cwd: row.path, env: {}, text: JSON.stringify(request), resource, signal: resource.controller.signal, timeout: 60000, maxOutputBytes: 4096, captureStderrBytes: 512, command, guardianStopped,
      onReady: async scope => { await beforeAck(); await update(c, row.operationId, "windows-image-native-ready", current => {
        if (current.ownedRuntime && current.stoppedVerified !== true) throw Error("The previous image command exit is unknown; preserve its exact owner.");
        if (current.ownedRuntime) current.priorStoppedRuntimes = [...(current.priorStoppedRuntimes ?? []), current.ownedRuntime].slice(-8);
        current.ownedRuntime = scope; current.stoppedVerified = false; current.lastNativeKind = inspect ? "inspect" : "create";
      }); await beforeAck(); },
      onStopped: async scope => { if (!await guardianStopped(scope)) throw Error("The exact native image command exit is unconfirmed."); await update(c, row.operationId, "windows-image-native-exit", current => {
        if (current.ownedRuntime && current.ownedRuntime.id !== scope.id) {
          if (current.stoppedVerified !== true) throw Error("The protected native image command owner changed.");
          current.priorStoppedRuntimes = [...(current.priorStoppedRuntimes ?? []), current.ownedRuntime].slice(-8); current.ownedRuntime = scope;
        }
        current.ownedRuntime ??= scope; current.stoppedVerified = true;
      }); }
    });
    if (result.status !== "completed" || result.exitCode !== 0) {
      const diagnostic = /^Native bounded exchange image failed at ([a-z-]+); Win32=([0-9]+); detail=([a-z0-9-]+)\./.exec(result.stderr ?? "");
      if (diagnostic) await update(c, row.operationId, "windows-image-native-diagnostic", current => { current.failure = { phase: diagnostic[1], win32: Number(diagnostic[2]), detail: diagnostic[3] }; });
      throw Error("The exact native image command did not verify; preserve its existing data.");
    }
    const proof = JSON.parse(result.stdout); validateProof(proof, row); return proof;
  }
  async function cleanup(c, id) {
    const initial = await get(c, id); if (!initial?.cleanupPending) return { cleaned: true };
    return ownedResource(c, id, resource => lock(c, async lease => {
      const row = await get(c, id); if (!row?.cleanupPending) return { cleaned: true };
      if (row.schema !== schema || row.path !== join(stateDirectory, c, `disk-${id}`)) throw Error("Preserve an unfamiliar protected image path.");
      if (row.ownedRuntime ? !await guardianStopped(row.ownedRuntime) : row.status !== "not-started") return { cleaned: false, reason: "native-image-owner-unconfirmed" };
      if (!await consumerStopped(c, id)) return { cleaned: false, reason: "image-consumer-exit-unconfirmed" };
      try { await directoryIdentity(row.path); } catch (error) { if (error.code !== "ENOENT") throw error; await update(c, id, "windows-image-removal-observed", current => { current.cleanupPending = false; }); return { cleaned: true }; }
      await verifyDirectory(c, row);
      if ((await readdir(row.path)).length) {
        await verifyImage(c, row, resource.controller.signal);
        await native(c, row, true, resource, async () => { lease.assert(); if (!await consumerStopped(c, id)) throw Error("The image consumer exit changed."); });
        await verifyImage(c, row, resource.controller.signal);
        await update(c, id, "windows-image-cleanup-started", current => { current.cleanupStarted = true; });
        if (!await consumerStopped(c, id)) throw Error("The image consumer exit changed before removal.");
        await unlink(join(row.path, "exchange.vhd"));
      } else if (row.proof && row.cleanupStarted !== true) throw Error("The original image disappeared before cleanup; preserve its directory.");
      await rmdir(row.path); await update(c, id, "windows-image-cleaned", current => { current.cleanupPending = false; }); return { cleaned: true };
    }));
  }
  async function recover(c) {
    seen.add(c); let cleanupPending = false;
    for (const row of (await store.snapshot(c)).repositoryWindowsImages ?? []) {
      if (!row.cleanupPending) continue;
      if (resources.has(`${c}:${row.operationId}`)) { cleanupPending = true; continue; }
      await lock(c, async () => {
        const current = await get(c, row.operationId);
        if (!current.ownedRuntime && current.status === "reserved") await update(c, row.operationId, "windows-image-no-ack", value => { value.status = "not-started"; value.stoppedVerified = true; });
        else if (current.ownedRuntime && await guardianStopped(current.ownedRuntime)) await update(c, row.operationId, "windows-image-exit-observed", value => { value.stoppedVerified = true; });
      });
      try { if (!(await cleanup(c, row.operationId)).cleaned) cleanupPending = true; } catch { cleanupPending = true; }
    }
    return { cleanupPending };
  }
  async function stopCompartment(c) {
    generations.set(c, (generations.get(c) ?? 0) + 1); const active = [...resources.values()].filter(row => row.compartment === c); active.forEach(row => row.controller.abort());
    await Promise.allSettled(active.map(row => row.done)); const stops = await Promise.all(active.flatMap(row => [...row.clients].map(client => client.stop().catch(() => false))));
    for (const [key, row] of resources) if (active.includes(row) && [...row.clients].every(client => client.closed)) resources.delete(key);
    const recovery = await recover(c), rows = (await store.snapshot(c)).repositoryWindowsImages ?? [];
    return { stopped: stops.every(Boolean) && rows.every(row => row.stoppedVerified === true), ...recovery };
  }
  return {
    async prepare(c, context, authorize) {
      context = structuredClone(context);
      if (platform !== "win32" || !context || Object.keys(context).sort().join() !== "operationId,provider,scopeDigest" || !uuid(context.operationId) || !digest(context.scopeDigest) || !["codex", "claude-code"].includes(context.provider) || typeof authorize !== "function") throw Error("Create only an exact reviewed Windows operation's detached image; paths, capacities and commands are not accepted.");
      const id = context.operationId, generation = generations.get(c) ?? 0;
      const check = async () => { if (closed || generation !== (generations.get(c) ?? 0) || !await isActive(c)) throw Error("This image request was stopped or its workspace changed."); const row = await get(c, id); if (row && (row.scopeDigest !== context.scopeDigest || row.provider !== context.provider)) throw Error("The protected image review scope changed."); await store.authorize(c, { provider: context.provider }); await authorize(); };
      return ownedResource(c, id, resource => lock(c, async lease => {
        let reserved = false; const current = async () => { lease.assert(); await check(); };
        try {
          await current(); const all = (await store.snapshot(c)).repositoryWindowsImages ?? [];
          if (all.some(row => row.operationId === id || row.cleanupPending)) throw Error("Reconcile the existing owned image before reserving this workspace's next 64 MiB image; no replay was attempted.");
          await privateDirectory(join(stateDirectory, c)); const path = join(stateDirectory, c, `disk-${id}`); await mkdir(path, { mode: 0o700 }); const stagingIdentity = identity(await directoryIdentity(path));
          try { await store.update(c, "windows-image-reserve", state => { const rows = state.repositoryWindowsImages ?? []; if (rows.some(row => row.operationId === id || row.cleanupPending)) throw Error("The image inventory changed."); state.repositoryWindowsImages = [...rows.slice(-16), { schema, ...context, path, stagingIdentity, status: "reserved", stoppedVerified: false, cleanupPending: true, at: now() }]; }); reserved = true; }
          catch (error) { if (same(identity(await directoryIdentity(path)), stagingIdentity) && !(await readdir(path)).length) await rmdir(path); throw error; }
          const row = await get(c, id), proof = await native(c, row, false, resource, current);
          await update(c, id, "windows-image-observed", value => { value.proof = proof; value.status = "image-observed"; });
          await verifyImage(c, { ...row, proof }, resource.controller.signal);
          await current(); await update(c, id, "windows-image-ready", value => { value.status = "detached"; });
          return { operationId: id, path: join(path, "exchange.vhd"), imageIdentity: proof.imageIdentity, initialImageSha256: proof.imageSha256, virtualBytes, backingBytes, attached: false, exchangeQuotaEnforced: false, sandboxEnforced: false,
            assertCurrent: () => ownedResource(c, id, next => lock(c, async held => { await check(); const latest = await get(c, id); if (latest.cleanupStarted || scopeHash(latest.proof) !== scopeHash(proof)) throw Error("The original image has entered cleanup or its protected proof changed."); await verifyImage(c, latest, next.controller.signal); await native(c, latest, true, next, async () => { held.assert(); await check(); }); await check(); })),
            release: async () => { if (!(await cleanup(c, id)).cleaned) throw Error("Image cleanup awaits independently verified native and consumer exit."); } };
        } catch (error) { if (reserved) await update(c, id, "windows-image-unconfirmed", row => { row.status = row.ownedRuntime ? "outcome-unconfirmed" : "not-started"; if (!row.ownedRuntime) row.stoppedVerified = true; }).catch(() => {}); throw error; }
      }));
    },
    cleanup, recover, stopCompartment,
    async list(c) { return ((await store.snapshot(c)).repositoryWindowsImages ?? []).map(row => ({ operationId: row.operationId, status: row.status, stoppedVerified: row.stoppedVerified === true, cleanupPending: row.cleanupPending, virtualBytes, exchangeQuotaEnforced: false })); },
    async close() { closed = true; const results = await Promise.all([...seen].map(stopCompartment)); if (results.some(result => !result.stopped)) throw Error("An exact image guardian still has unknown exit; its image was preserved."); }
  };
}
