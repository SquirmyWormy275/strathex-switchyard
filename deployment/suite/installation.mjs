/** Versioned per-user installation, with dated exact-file rollback journals. */
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, rmdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { verifySuiteRelease, nodeVersion } from "./release.mjs";
import { stableLoader, launcherContents } from "./launcher.mjs";
import { fileDigest, readOwnedFile, replaceOwnedFile } from "./owned-files.mjs";
import { privateDirectory, privateRead, privateWrite } from "../../tools/layout-studio/private-fs.mjs";
import { withStateLock } from "../../tools/layout-studio/state-lock.mjs";
import { applicationStateRoot, applicationStatus, stopApplication, launchApplication } from "./application.mjs";

const idPattern = /^[a-f0-9]{64}$/, backupPattern = /^[0-9TZ.-]+-[a-f0-9-]{36}$/;
export const installationRoot = () => process.platform === "win32" ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData/Local"), "Programs/Switchyard") : join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "strathex-switchyard/application");
export function installationPaths(root = installationRoot(), platform = process.platform) {
  return { record: join(root, "installed.json"), loader: join(root, "launch.mjs"), command: platform === "win32" ? join(root, "switchyard.cmd") : join(homedir(), ".local/bin/switchyard"), desktop: platform === "win32" ? join(process.env.APPDATA || join(homedir(), "AppData/Roaming"), "Microsoft/Windows/Start Menu/Programs/Switchyard.lnk") : join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "applications/io.strathex.Switchyard.desktop") };
}
async function noActiveHostConnections() {
  if (process.platform === "linux") {
    const { createHostBridge } = await import("../../tools/layout-studio/host.mjs");
    const active = (await createHostBridge().transactions()).filter((t) => ["prepared", "applying", "applied", "kept", "recovery-pending"].includes(t.status));
    if (active.length) throw new Error("Restore active Switchyard host connections in the app before uninstalling. Program files were retained so their exact baselines remain usable.");
  } else {
    const { createSuiteStore } = await import("../../tools/layout-studio/suite-store.mjs"), store = createSuiteStore();
    for (const c of await store.list()) { const s = await store.snapshot(c.id); if (s.windowsHost?.bindings?.length) throw new Error("Restore saved Windows hotkey connections in the app before uninstalling. Their program and protected baselines were preserved."); }
  }
}
export function createInstallation({ root = installationRoot(), stateRoot = applicationStateRoot(), paths = installationPaths(root), platform = process.platform, application, beforeRemove = noActiveHostConnections, afterWrite = async () => {}, afterCopy = async () => {} } = {}) {
  if (!["linux", "win32"].includes(platform) || new Set(Object.values(paths)).size !== 4 || Object.keys(paths).sort().join(",") !== "command,desktop,loader,record" || paths.record !== join(root, "installed.json") || paths.loader !== join(root, "launch.mjs")) throw new Error("The installation paths or platform are unsupported.");
  application ??= { status: () => applicationStatus({ stateRoot }), stop: () => stopApplication({ stateRoot }), launch: (bundleRoot) => launchApplication({ bundleRoot, stateRoot, installationRoot: root }) };
  const versions = join(root, "versions"), pending = join(root, "pending.json"), backups = join(stateRoot, "installation-backups"), staging = join(stateRoot, "installation-stage.json");
  const bundle = (id) => { if (!idPattern.test(id)) throw new Error("The installed version identity is invalid."); return join(versions, id); };
  async function record() {
    const saved = await readOwnedFile(paths.record); if (!saved) return null;
    const v = JSON.parse(saved.bytes.toString("utf8"));
    if (v.schema !== "switchyard-installation/v1" || !idPattern.test(v.current) || v.previous !== null && !idPattern.test(v.previous) || v.platform !== platform || v.runtime?.version !== nodeVersion || typeof v.runtime.path !== "string" || !idPattern.test(v.runtime.sha256) || !Array.isArray(v.managedFiles) || v.managedFiles.length !== 3 || v.managedFiles.some((f) => !["loader", "command", "desktop"].includes(f.role) || paths[f.role] !== f.path || !idPattern.test(f.sha256)) || new Set(v.managedFiles.map((f) => f.role)).size !== 3) throw new Error("The existing installation record is unsupported; no files were changed.");
    return v;
  }
  async function ownedRecord() {
    const old = await record();
    for (const role of ["loader", "command", "desktop"]) { const f = await readOwnedFile(paths[role]), expected = old?.managedFiles.find((f) => f.role === role)?.sha256 ?? null; if ((f?.sha256 ?? null) !== expected) throw new Error(`The ${role} entry is unowned or changed. It was preserved; its existing bytes cannot be replaced by this installer.`); }
    return old;
  }
  async function copyBundle(source, expectedId, lease) {
    source = await realpath(source);
    const manifest = await verifySuiteRelease(source, { expectedId, platform, checkRuntime: true });
    if (!["deployment/suite/manage.mjs", "deployment/suite/installation.mjs", "deployment/suite/cli.mjs"].every((path) => manifest.files.some((f) => f.path === path))) throw new Error("This older standalone development bundle has no supported installation contract.");
    await privateDirectory(versions); const destination = bundle(manifest.id);
    try { await lstat(destination); await verifySuiteRelease(destination, { expectedId: manifest.id, platform }); return destination; }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    const stageId = randomUUID(), stage = join(versions, `.install-${stageId}`), manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    const descriptor = { schema: "switchyard-installation-stage/v1", stageId, releaseId: manifest.id, source, files: [...manifest.files, { path: "switchyard-release.json", size: manifestBytes.length, sha256: fileDigest(manifestBytes) }] };
    await privateWrite(staging, JSON.stringify(descriptor) + "\n");
    try {
      await privateDirectory(stage);
      await writeFile(join(stage, "switchyard-release.json"), manifestBytes, { flag: "wx", mode: 0o600 });
      for (const name of manifest.files.map((f) => f.path)) { const target = join(stage, name); await privateDirectory(join(target, "..")); await copyFile(join(source, name), target, constants.COPYFILE_FICLONE); await chmod(target, 0o600); lease.assert(); await afterCopy(name); }
      await verifySuiteRelease(stage, { expectedId: manifest.id, platform }); lease.assert(); await rename(stage, destination); return destination;
    } finally { await rm(stage, { recursive: true, force: true }); await rm(staging, { force: true }); }
  }
  async function recoverStage(lease) {
    let v; try { v = JSON.parse(await privateRead(staging)); } catch (e) { if (e.code === "ENOENT") return { stageRecovered: false }; throw e; }
    const safePath = (s) => typeof s === "string" && s.length <= 240 && s.split("/").every((p) => /^[A-Za-z0-9_.-]+$/.test(p) && !/^\.+$/.test(p));
    if (v.schema !== "switchyard-installation-stage/v1" || !/^[a-f0-9-]{36}$/.test(v.stageId) || !idPattern.test(v.releaseId) || typeof v.source !== "string" || !Array.isArray(v.files) || v.files.length < 1 || v.files.length > 513 || v.files.some((f) => !safePath(f.path) || !idPattern.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > 128 * 1024 * 1024) || new Set(v.files.map((f) => f.path.toLowerCase())).size !== v.files.length) throw new Error("The interrupted stage descriptor is invalid; its files were preserved.");
    const stage = join(versions, `.install-${v.stageId}`), files = new Map(v.files.map((f) => [f.path, f])), directories = new Set([""]);
    for (const f of v.files) { const parts = f.path.split("/"); parts.pop(); while (parts.length) { directories.add(parts.join("/")); parts.pop(); } }
    let sourceVerified = false, actual = 0;
    async function inspect(at = "") {
      const directory = join(stage, at), info = await lstat(directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Interrupted staging contains a directory link or changed directory.");
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = at ? `${at}/${entry.name}` : entry.name;
        if (entry.isDirectory() && directories.has(name)) { await inspect(name); continue; }
        const expected = files.get(name); if (!expected || !entry.isFile() || ++actual > v.files.length) throw new Error("Interrupted staging contains unrelated content. It was preserved.");
        const path = join(stage, name), s = await lstat(path); if (!s.isFile() || s.isSymbolicLink() || s.size > expected.size) throw new Error("An interrupted stage file changed beyond its owned copy bound.");
        const value = await readFile(path);
        if (value.length === expected.size && fileDigest(value) === expected.sha256) continue;
        // A killed copy can leave an incomplete file. Delete it only when its
        // exact prefix still agrees with the independently verified source.
        if (name === "switchyard-release.json") throw new Error("The stage manifest changed; recovery preserved it.");
        if (!sourceVerified) { await verifySuiteRelease(v.source, { expectedId: v.releaseId, platform }); sourceVerified = true; }
        const original = await readFile(join(v.source, name));
        if (value.length >= original.length || !value.equals(original.subarray(0, value.length))) throw new Error("An interrupted stage file has unrelated edits. Recovery preserved it.");
      }
    }
    try { await inspect(); }
    catch (e) { if (e.code !== "ENOENT") throw e; if (await lstat(stage).catch((x) => { if (x.code === "ENOENT") return null; throw x; })) throw e; }
    lease.assert(); await rm(stage, { recursive: true, force: true }); await rm(staging); return { stageRecovered: true, releaseId: v.releaseId };
  }
  async function prune(keep) {
    await privateDirectory(versions); const retained = new Set(keep.filter(Boolean)), removed = [];
    for (const name of await readdir(versions)) if (idPattern.test(name) && !retained.has(name)) { await verifySuiteRelease(bundle(name), { expectedId: name, platform }); await rm(bundle(name), { recursive: true }); removed.push(name); }
    return removed;
  }
  async function journal(action, replacements, previous, wasRunning) {
    const id = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`, directory = join(backups, id); await privateDirectory(directory);
    const entries = [];
    for (const role of ["loader", "command", "desktop", "record"]) {
      const before = await readOwnedFile(paths[role]), next = replacements[role];
      if (before) await writeFile(join(directory, `${role}.before`), before.bytes, { flag: "wx", mode: 0o600 });
      entries.push({ role, path: paths[role], before: before ? { sha256: before.sha256, mode: before.mode } : null, after: next ? { sha256: fileDigest(next.bytes), mode: next.mode } : null });
    }
    const plan = { schema: "switchyard-installation-journal/v1", id, action, reason: `${action} the per-user Switchyard application; preserve dated launcher bytes before changing persistent entries. Protected workspaces, credentials and shared optional runtimes are excluded.`, previous, wasRunning, entries, createdAt: new Date().toISOString(), status: "prepared" };
    await privateWrite(join(directory, "journal.json"), JSON.stringify(plan, null, 2) + "\n");
    const nextRecord = replacements.record ? JSON.parse(replacements.record.bytes.toString("utf8")) : null;
    await privateWrite(pending, JSON.stringify({ schema: "switchyard-installation-pending/v1", backup: id, recoveryVersion: previous?.current ?? nextRecord?.current, runtime: previous?.runtime ?? nextRecord?.runtime }) + "\n"); return plan;
  }
  async function finish(plan, status) { await privateWrite(join(backups, plan.id, "journal.json"), JSON.stringify({ ...plan, status, finishedAt: new Date().toISOString() }, null, 2) + "\n"); await rm(pending); }
  async function recover(lease) {
    let p; try { p = JSON.parse(await privateRead(pending)); } catch (e) { if (e.code === "ENOENT") return { recovered: false }; throw e; }
    if (p.schema !== "switchyard-installation-pending/v1" || !backupPattern.test(p.backup)) throw new Error("The pending installation record is invalid. Its recovery files were preserved.");
    const plan = JSON.parse(await privateRead(join(backups, p.backup, "journal.json")));
    if (plan.schema !== "switchyard-installation-journal/v1" || plan.id !== p.backup || !Array.isArray(plan.entries) || plan.entries.length !== 4 || new Set(plan.entries.map((e) => e.role)).size !== 4 || plan.entries.some((e) => !Object.hasOwn(paths, e.role) || paths[e.role] !== e.path || [e.before, e.after].some((s) => s !== null && (!idPattern.test(s.sha256) || ![0o600, 0o644, 0o700, 0o755].includes(s.mode))))) throw new Error("The installation recovery scope did not verify.");
    // Preflight ALL files before the first restore, so unrelated edits cannot
    // turn a failed update into a destructive partial rollback.
    const current = new Map();
    for (const e of plan.entries) {
      const f = await readOwnedFile(e.path), sha = f?.sha256 ?? null;
      if (sha !== (e.before?.sha256 ?? null) && sha !== (e.after?.sha256 ?? null)) throw new Error(`Recovery found an unrelated ${e.role} edit. Both the edit and dated backup were preserved.`);
      if (e.before && fileDigest(await readFile(join(backups, plan.id, `${e.role}.before`))) !== e.before.sha256) throw new Error("An installation recovery copy failed its digest.");
      current.set(e.role, sha);
    }
    if (plan.status === "committed") {
      if (plan.entries.some((e) => current.get(e.role) !== (e.after?.sha256 ?? null))) throw new Error("A committed installation changed before journal cleanup. Current files were preserved.");
      await rm(pending); return { recovered: true, committed: true, backup: join(backups, plan.id) };
    }
    const live = await application.status(); if (["ready", "stopping"].includes(live.status)) await application.stop();
    for (const e of [...plan.entries].reverse()) { lease.assert(); if (current.get(e.role) !== (e.before?.sha256 ?? null)) await replaceOwnedFile(e.path, e.before ? await readFile(join(backups, plan.id, `${e.role}.before`)) : null, e.before?.mode ?? 0o600, current.get(e.role)); }
    lease.assert(); await finish(plan, "restored"); return { recovered: true, backup: join(backups, plan.id), previous: plan.previous, wasRunning: plan.wasRunning };
  }
  async function operation(action, prepare, { start = false } = {}) {
    await privateDirectory(root);
    return withStateLock(join(stateRoot, "installation"), "installation", async (lease) => {
      await recoverStage(lease); await recover(lease); const old = await ownedRecord(), next = await prepare(old, lease), live = await application.status(), wasRunning = ["ready", "stopping"].includes(live.status);
      if (next.unchanged) { if (start) await application.launch(bundle(old.current)); return { status: "unchanged", current: old.current }; }
      if (action === "uninstall") await beforeRemove();
      const plan = await journal(action, next.replacements, old, wasRunning);
      try {
        if (wasRunning) await application.stop();
        for (const e of plan.entries) { lease.assert(); const replacement = next.replacements[e.role]; await replaceOwnedFile(e.path, replacement?.bytes ?? null, replacement?.mode ?? 0o600, e.before?.sha256 ?? null); await afterWrite(e.role, action); }
        lease.assert(); if (next.current && (start || wasRunning)) await application.launch(bundle(next.current));
        await finish(plan, "committed");
        let removedVersions = [], cleanupPending = null;
        try { removedVersions = await prune([next.current, next.previous]); } catch (e) { cleanupPending = e.message; }
        if (!next.current) { for (const path of [versions, root]) try { await rmdir(path); } catch (e) { if (!["ENOTEMPTY", "ENOENT"].includes(e.code)) throw e; } }
        return { status: action === "uninstall" ? "removed" : "installed", current: next.current, previous: next.previous, backup: join(backups, plan.id), removedVersions, cleanupPending, protectedData: "retained", optionalRuntime: "retained" };
      } catch (error) {
        try { const restored = await recover(lease); if (restored.wasRunning && restored.previous?.current) await application.launch(bundle(restored.previous.current)); }
        catch (recovery) { throw new Error(`${error.message} Recovery remains pending: ${recovery.message}`); }
        throw error;
      }
    });
  }
  async function replacements(current, previous) {
    if (process.versions.node !== nodeVersion) throw new Error(`Installation requires Node ${nodeVersion}.`);
    const nodePath = await realpath(process.execPath), s = await lstat(nodePath); if (!s.isFile() || s.size > 128 * 1024 * 1024) throw new Error("The pinned Node runtime is invalid or oversized.");
    const runtime = { path: nodePath, version: nodeVersion, sha256: fileDigest(await readFile(nodePath)) }, contents = await launcherContents({ root, nodePath, platform, stateRoot });
    const files = { loader: { bytes: stableLoader, mode: 0o600 }, ...contents };
    const v = { schema: "switchyard-installation/v1", current, previous, platform, runtime, managedFiles: Object.entries(files).map(([role, f]) => ({ role, path: paths[role], sha256: fileDigest(f.bytes) })), updatedAt: new Date().toISOString() };
    return { ...files, record: { bytes: Buffer.from(JSON.stringify(v, null, 2) + "\n"), mode: 0o600 } };
  }
  return {
    root, paths,
    inspect: record,
    recover: () => withStateLock(join(stateRoot, "installation"), "installation", async (lease) => ({ ...await recoverStage(lease), ...await recover(lease) })),
    install: (source, expectedId, options) => { if (!idPattern.test(expectedId)) throw new Error("An independently reviewed expected release identity is required."); return operation("install/update", async (old, lease) => { await copyBundle(source, expectedId, lease); if (old?.current === expectedId) return { unchanged: true }; return { current: expectedId, previous: old?.current ?? null, replacements: await replacements(expectedId, old?.current ?? null) }; }, options); },
    rollback: (options) => operation("rollback", async (old) => { if (!old?.previous) throw new Error("There is no retained previous application version."); await verifySuiteRelease(bundle(old.previous), { expectedId: old.previous, platform, checkRuntime: true }); return { current: old.previous, previous: old.current, replacements: await replacements(old.previous, old.current) }; }, options),
    uninstall: () => operation("uninstall", async (old) => { if (!old) throw new Error("No owned installation exists."); return { current: null, previous: null, replacements: { loader: null, command: null, desktop: null, record: null } }; })
  };
}
