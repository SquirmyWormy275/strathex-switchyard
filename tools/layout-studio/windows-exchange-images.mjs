/** Own exact Windows exchange image/volume lifecycles; no VM execution grant. */
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
const volumeSchema = "switchyard-windows-bounded-volume/v1";
const defaultHelper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url));
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const identity = value => ({ device: value.dev.toString(), inode: value.ino.toString() });
const same = (a, b) => a?.device === b?.device && a?.inode === b?.inode;
const validIdentity = value => value && Object.keys(value).sort().join() === "device,inode" && [value.device, value.inode].every(part => typeof part === "string" && /^[0-9]{1,32}$/.test(part));
const volumeName = value => typeof value === "string" && value.length === 49 && value.slice(0, 11).toLowerCase() === "\\\\?\\volume{" && value.endsWith("}\\") && uuid(value.slice(11, 47).toLowerCase());
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
  const consumerLock = (c, id, fn) => store.withResourceLock("repository-execution", scopeHash([volumeSchema, "consumer", c, id]), fn);
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
  async function ownedCommand(c, row, kind, request, resource, beforeAck) {
    const volume = kind.startsWith("volume-"), mode = volume ? "--bounded-exchange-volume" : kind === "inspect" ? "--inspect-bounded-exchange-image" : "--create-bounded-exchange-image";
    const result = await runOwnedNativeCommand({ executable: helper, args: [mode], expectedExecutableSha256: helperSha256,
      cwd: row.path, env: {}, text: JSON.stringify(request), resource, signal: resource.controller.signal, timeout: 60000, maxOutputBytes: 4096, captureStderrBytes: 512, command, guardianStopped,
      onReady: async scope => { await beforeAck(); await update(c, row.operationId, "windows-image-native-ready", current => {
        if (current.ownedRuntime && current.stoppedVerified !== true) throw Error("The previous image command exit is unknown; preserve its exact owner.");
        if (current.ownedRuntime) current.priorStoppedRuntimes = [...(current.priorStoppedRuntimes ?? []), current.ownedRuntime].slice(-8);
        current.ownedRuntime = scope; current.stoppedVerified = false; current.lastNativeKind = kind;
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
      const diagnostic = /^Native bounded (?:exchange image|volume) failed at ([a-z-]+); Win32=([0-9]+); detail=([a-z0-9-]+)\./.exec(result.stderr ?? "");
      if (diagnostic) await update(c, row.operationId, "windows-image-native-diagnostic", current => { current.failure = { kind, phase: diagnostic[1], win32: Number(diagnostic[2]), detail: diagnostic[3] }; });
      throw Error(`The exact native ${volume ? "volume" : "image"} command did not verify; preserve its existing data.`);
    }
    return JSON.parse(result.stdout);
  }
  async function native(c, row, inspect, resource, beforeAck) {
    const request = { schema, operationId: row.operationId, stagingRoot: row.path, stagingIdentity: row.stagingIdentity,
      ...(inspect ? { imageIdentity: row.proof.imageIdentity, expectedImageSha256: row.proof.imageSha256 } : {}) };
    const proof = await ownedCommand(c, row, inspect ? "inspect" : "create", request, resource, beforeAck); validateProof(proof, row); return proof;
  }
  async function mutableImage(c, row, footer = false) {
    await verifyDirectory(c, row); const path = join(row.path, "exchange.vhd"), stat = await lstat(path, { bigint: true });
    const names = await readdir(row.path), expected = footer ? ["exchange.vhd"] : ["exchange.vhd", "mount"];
    if (names.length !== expected.length || names.some(name => !expected.includes(name))) throw Error("Preserve unfamiliar or missing writable-volume entries.");
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size !== BigInt(backingBytes) || !same(identity(stat), row.proof?.imageIdentity)) throw Error("The original writable image identity or fixed capacity changed; preserve it.");
    if (!footer) return;
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await file.stat({ bigint: true }); if (!same(identity(before), identity(stat)) || before.size !== BigInt(backingBytes)) throw Error("The original writable image changed during footer observation.");
      const bytes = Buffer.alloc(512); let total = 0; while (total < 512) { const { bytesRead } = await file.read(bytes, total, 512 - total, virtualBytes + total); if (!bytesRead) throw Error("The original writable image footer was truncated."); total += bytesRead; }
      const after = await file.stat({ bigint: true }), named = await lstat(path, { bigint: true });
      if (!same(identity(before), identity(named)) || named.isSymbolicLink() || after.nlink !== 1n || named.nlink !== 1n || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || sha256(bytes) !== row.proof.footerSha256) throw Error("The original writable image footer changed; preserve it.");
    } finally { await file.close(); }
  }
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  async function nativeVolume(c, row, action, resource, beforeAck) {
    const request = { schema: volumeSchema, action, operationId: row.operationId, stagingRoot: row.path, stagingIdentity: row.stagingIdentity,
      imageIdentity: row.proof.imageIdentity, mountIdentity: row.volume.mountIdentity, footerSha256: row.proof.footerSha256,
      ...(action === "attach" ? { initialImageSha256: row.proof.imageSha256 } : {}) };
    const proof = await ownedCommand(c, row, `volume-${action}`, request, resource, beforeAck);
    const fields = ["schema", "action", "operationId", "stagingIdentity", "imageIdentity", "mountIdentity", "volume", "mounted", "attached", "detachedVerified", "virtualBytes", "backingBytes", "volumeBytes", "exchangeQuotaEnforced", "sandboxEnforced"];
    if (!proof || Object.keys(proof).sort().join() !== fields.sort().join() || proof.schema !== volumeSchema || proof.action !== action || proof.operationId !== row.operationId
      || !validIdentity(proof.stagingIdentity) || !validIdentity(proof.imageIdentity) || !validIdentity(proof.mountIdentity) || !same(proof.stagingIdentity, row.stagingIdentity) || !same(proof.imageIdentity, row.proof.imageIdentity) || !same(proof.mountIdentity, row.volume.mountIdentity)
      || typeof proof.attached !== "boolean" || typeof proof.mounted !== "boolean" || proof.detachedVerified !== (!proof.attached && !proof.mounted) || proof.exchangeQuotaEnforced !== (proof.attached && proof.mounted) || proof.sandboxEnforced !== false
      || proof.virtualBytes !== virtualBytes || proof.backingBytes !== backingBytes || !Number.isSafeInteger(proof.volumeBytes) || proof.volumeBytes < 0 || proof.volumeBytes > 63 * 1024 * 1024
      || proof.mounted && (!proof.attached || proof.volumeBytes === 0 || !volumeName(proof.volume))
      || proof.volume !== null && !volumeName(proof.volume)
      || row.volume.volumeGuid && proof.volume !== null && proof.volume.toLowerCase() !== row.volume.volumeGuid.toLowerCase()) throw Error("The exact owned writable-volume observation did not verify.");
    await update(c, row.operationId, "windows-volume-observed", current => { current.volume.proof = proof; current.volume.volumeGuid ??= proof.volume; current.volume.detachedVerified = proof.detachedVerified; });
    return proof;
  }
  async function cleanVolume(c, row, resource, lease) {
    const names = await readdir(row.path); if (names.some(name => !["exchange.vhd", "mount"].includes(name))) throw Error("Preserve unfamiliar entries beside the owned writable volume.");
    if (!row.cleanupStarted) {
      if (!names.includes("exchange.vhd") || !names.includes("mount")) throw Error("The original writable volume entries disappeared; preserve their ownership.");
      await mutableImage(c, row);
      const beforeAck = async () => { lease.assert(); if (!await consumerStopped(c, row.operationId)) throw Error("The exact guest consumer exit remains unconfirmed."); };
      const observed = await nativeVolume(c, row, "inspect", resource, beforeAck);
      if (!observed.detachedVerified) { const detached = await nativeVolume(c, await get(c, row.operationId), "detach", resource, beforeAck); if (!detached.detachedVerified) throw Error("The original writable volume detach remains unconfirmed."); }
      await update(c, row.operationId, "windows-volume-cleanup-started", current => { current.cleanupStarted = true; });
    } else if (!row.volume.detachedVerified) throw Error("Preserve a writable image without its original independent detach proof.");
    const mount = join(row.path, "mount");
    if (names.includes("mount")) { if (!same(identity(await directoryIdentity(mount)), row.volume.mountIdentity) || (await readdir(mount)).length) throw Error("Preserve a replaced or nonempty original mount folder."); await rmdir(mount); }
    if (names.includes("exchange.vhd")) { await mutableImage(c, row, true); if (!await consumerStopped(c, row.operationId)) throw Error("The guest consumer exit changed before image removal."); await unlink(join(row.path, "exchange.vhd")); }
    await rmdir(row.path); await update(c, row.operationId, "windows-volume-cleaned", current => { current.cleanupPending = false; current.volume.cleanedAt = now(); }); return { cleaned: true };
  }
  async function assertVolume(c, id, check) {
    return ownedResource(c, id, resource => lock(c, async lease => {
      await check(); const row = await get(c, id);
      if (!row.volume || row.cleanupStarted || !row.cleanupPending) throw Error("This writable volume has no current original ownership lease.");
      await mutableImage(c, row);
      const proof = await nativeVolume(c, row, "inspect", resource, async () => { lease.assert(); await check(); });
      if (!proof.exchangeQuotaEnforced || !proof.mounted || !proof.attached) throw Error("The exact bounded writable volume is not currently mounted.");
      await check(); return proof;
    }));
  }
  async function createVolume(c, id, originalProof, check) {
    return consumerLock(c, id, () => ownedResource(c, id, resource => lock(c, async lease => {
      let reserved = false;
      const current = async () => { lease.assert(); await check(); };
      try {
        await current(); const row = await get(c, id);
        if (!row?.cleanupPending || row.cleanupStarted || row.volume || scopeHash(row.proof) !== scopeHash(originalProof)) throw Error("The original image is already transferred, changed or retained; no volume attach replay was attempted.");
        await verifyImage(c, row, resource.controller.signal); await native(c, row, true, resource, current); await current();
        const root = join(row.path, "mount"); await mkdir(root, { mode: 0o700 }); const mountIdentity = identity(await directoryIdentity(root));
        try {
          await update(c, id, "windows-volume-reserve", value => { if (value.volume || value.cleanupStarted || !value.cleanupPending || scopeHash(value.proof) !== scopeHash(originalProof)) throw Error("The original image transfer changed."); value.volume = { mountIdentity, requestedAt: now(), phase: "attach-reserved", detachedVerified: false }; }); reserved = true;
        } catch (error) {
          const observed = await get(c, id);
          if (!observed.volume && same(identity(await directoryIdentity(root)), mountIdentity) && !(await readdir(root)).length) await rmdir(root);
          throw error;
        }
        const proof = await nativeVolume(c, await get(c, id), "attach", resource, current);
        if (!proof.exchangeQuotaEnforced || !proof.attached || !proof.mounted) throw Error("The original image was not verified as a bounded writable volume.");
        await update(c, id, "windows-volume-mounted", value => { value.volume.phase = "mounted"; }); await current();
        return { schema: volumeSchema, operationId: id, scopeDigest: row.scopeDigest, root, stagingIdentity: row.stagingIdentity, imageIdentity: row.proof.imageIdentity, mountIdentity, volumeGuid: proof.volume, maximumBytes: virtualBytes, privateAclReadbackVerified: true, exchangeQuotaEnforced: true, sandboxEnforced: false,
          nativeBinding: { schema: volumeSchema, operationId: id, stagingRoot: row.path, stagingIdentity: structuredClone(row.stagingIdentity), imageIdentity: structuredClone(row.proof.imageIdentity), mountIdentity: structuredClone(mountIdentity), footerSha256: row.proof.footerSha256 },
          assertCurrent: () => assertVolume(c, id, check),
          withConsumer: fn => { if (typeof fn !== "function") throw Error("Use a trusted host consumer for the exact bounded volume."); return consumerLock(c, id, async held => { held.assert(); await assertVolume(c, id, check); const result = await fn(); held.assert(); await check(); return result; }); },
          release: async () => { if (!(await cleanup(c, id)).cleaned) throw Error("Writable-volume cleanup awaits independently verified guest and native exit."); } };
      } catch (error) {
        if (reserved) await update(c, id, "windows-volume-unconfirmed", value => { value.volume.phase = "outcome-unconfirmed"; }).catch(() => {});
        throw error;
      }
    })));
  }
  async function cleanup(c, id) {
    const initial = await get(c, id); if (!initial?.cleanupPending) return { cleaned: true };
    return consumerLock(c, id, () => ownedResource(c, id, resource => lock(c, async lease => {
      const row = await get(c, id); if (!row?.cleanupPending) return { cleaned: true };
      if (row.schema !== schema || row.path !== join(stateDirectory, c, `disk-${id}`)) throw Error("Preserve an unfamiliar protected image path.");
      if (row.ownedRuntime ? !await guardianStopped(row.ownedRuntime) : row.status !== "not-started") return { cleaned: false, reason: "native-image-owner-unconfirmed" };
      if (!await consumerStopped(c, id)) return { cleaned: false, reason: "image-consumer-exit-unconfirmed" };
      try { await directoryIdentity(row.path); } catch (error) { if (error.code !== "ENOENT") throw error; if (row.volume && !(row.cleanupStarted && row.volume.detachedVerified)) return { cleaned: false, reason: "writable-volume-root-unconfirmed" }; await update(c, id, "windows-image-removal-observed", current => { current.cleanupPending = false; }); return { cleaned: true }; }
      await verifyDirectory(c, row);
      if (row.volume) return cleanVolume(c, row, resource, lease);
      if ((await readdir(row.path)).length) {
        await verifyImage(c, row, resource.controller.signal);
        await native(c, row, true, resource, async () => { lease.assert(); if (!await consumerStopped(c, id)) throw Error("The image consumer exit changed."); });
        await verifyImage(c, row, resource.controller.signal);
        await update(c, id, "windows-image-cleanup-started", current => { current.cleanupStarted = true; });
        if (!await consumerStopped(c, id)) throw Error("The image consumer exit changed before removal.");
        await unlink(join(row.path, "exchange.vhd"));
      } else if (row.proof && row.cleanupStarted !== true) throw Error("The original image disappeared before cleanup; preserve its directory.");
      await rmdir(row.path); await update(c, id, "windows-image-cleaned", current => { current.cleanupPending = false; }); return { cleaned: true };
    })));
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
            assertCurrent: () => ownedResource(c, id, next => lock(c, async held => { await check(); const latest = await get(c, id); if (latest.volume || latest.cleanupStarted || scopeHash(latest.proof) !== scopeHash(proof)) throw Error("The original image was transferred, entered cleanup or its protected proof changed."); await verifyImage(c, latest, next.controller.signal); await native(c, latest, true, next, async () => { held.assert(); await check(); }); await check(); })),
            createVolume: () => createVolume(c, id, proof, check),
            release: async () => { if (!(await cleanup(c, id)).cleaned) throw Error("Image cleanup awaits independently verified native and consumer exit."); } };
        } catch (error) { if (reserved) await update(c, id, "windows-image-unconfirmed", row => { row.status = row.ownedRuntime ? "outcome-unconfirmed" : "not-started"; if (!row.ownedRuntime) row.stoppedVerified = true; }).catch(() => {}); throw error; }
      }));
    },
    cleanup, recover, stopCompartment,
    async list(c) { return ((await store.snapshot(c)).repositoryWindowsImages ?? []).map(row => ({ operationId: row.operationId, status: row.status, volumeAdmissionStatus: row.volume?.phase ?? null, volumeStatus: row.volume ? !row.cleanupPending ? "removed" : row.volume.proof?.detachedVerified ? "detached" : row.volume.phase : null, stoppedVerified: row.stoppedVerified === true, cleanupPending: row.cleanupPending, virtualBytes, exchangeQuotaEnforced: row.cleanupPending && row.volume?.proof?.exchangeQuotaEnforced === true })); },
    async close() { closed = true; const results = await Promise.all([...seen].map(stopCompartment)); if (results.some(result => !result.stopped)) throw Error("An exact image guardian still has unknown exit; its image was preserved."); }
  };
}
