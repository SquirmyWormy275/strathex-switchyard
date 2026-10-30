/** Optional software maintenance: immutable components, atomic selection, durable recovery. */
import { randomUUID } from "node:crypto";
import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { privateDirectory, privateRead, privateWrite, directoryIdentity } from "./private-fs.mjs";
import { withStateLock } from "./state-lock.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { runtimeRoot, runtimeEnvironment, trustedUv, downloadRuntimeModel, verifyRuntimeModel } from "./runtime-setup.mjs";
import { requiredRuntimeSpec, validateRuntimeSpec, runtimeMetadata, runtimeId, runtimeComponentKeys, inventoryRuntimeComponent, verifyRuntimeComponent, runtimeReleaseRecord, readRuntimeRelease, saveRuntimeRelease, readRuntimeSelection } from "./runtime-storage.mjs";

const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const selectionOf = (current, previous = null) => ({ schema: "switchyard-runtime-selection/v1", current, previous });
const validateSelection = value => value === null || value?.schema === "switchyard-runtime-selection/v1" && (value.current === null || runtimeId(value.current)) && (value.previous === null || runtimeId(value.previous)) && Object.keys(value).sort().join(",") === "current,previous,schema";
const directoryToken = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
export function createRuntimeLifecycle({ root = runtimeRoot(), spec, command = runRuntimeCommand, uvResolver = trustedUv, downloader = downloadRuntimeModel, guardianStopped = runtimeGuardianStopped, coordinate = fn => fn(), afterSelection = async () => {}, afterRemove = async () => {} } = {}) {
  const meta = runtimeMetadata(root), pointer = join(meta, "current.json"), pendingPath = join(meta, "pending.json"), cleanupPath = join(meta, "cleanup.json");
  let coordinated = false;
  async function maintain(fn) { if (coordinated) return fn(); return coordinate(async () => { coordinated = true; try { return await fn(); } finally { coordinated = false; } }); }
  const currentSpec = async () => validateRuntimeSpec(spec ?? await requiredRuntimeSpec());
  async function readJson(path) { try { return JSON.parse(await privateRead(path)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
  async function writeJson(path, value) { await privateWrite(path, JSON.stringify(value)); }
  async function records() {
    let names; try { names = await readdir(join(meta, "releases")); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const values = [];
    for (const name of names.sort()) { if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error("Runtime records contain unrelated files; maintenance preserved them."); values.push(await readRuntimeRelease(root, name.slice(0, -5))); }
    return values;
  }
  async function specFiles(value) {
    const directory = join(meta, "specs", value.id);
    for (const [name, content] of [["requirements.lock", value.requirements], ["probe.py", value.probe], ["spec.json", JSON.stringify(value)]]) {
      const path = join(directory, name);
      if (await exists(path)) { if (await privateRead(path) !== content) throw new Error("A stored runtime specification changed. Its files were preserved."); }
      else await privateWrite(path, content);
    }
    return { lock: join(directory, "requirements.lock"), probe: join(directory, "probe.py") };
  }
  async function verifySpecFiles(value, allowMissing = false) {
    validateRuntimeSpec(value);
    const directory = join(meta, "specs", value.id);
    if (!await exists(directory)) { if (allowMissing) return; throw new Error("Stored runtime specification files are missing."); }
    await directoryIdentity(directory);
    const contents = { "requirements.lock": value.requirements, "probe.py": value.probe, "spec.json": JSON.stringify(value) };
    for (const name of await readdir(directory)) if (!Object.hasOwn(contents, name)) throw new Error("Stored runtime specification contains unrelated content; it was preserved.");
    for (const [name, expected] of Object.entries(contents)) { if (allowMissing && !await exists(join(directory, name))) continue; if (await privateRead(join(directory, name)) !== expected) throw new Error("Stored runtime specification changed; it was preserved."); }
  }
  async function probe(python, model, value, run = command) {
    const files = await specFiles(value);
    const response = JSON.parse(await run(python, ["-I", "-B", files.probe, files.lock, ...(model ? [model] : [])], { env: runtimeEnvironment() }));
    if (response.schema !== "switchyard-runtime-probe/v1" || response.python !== value.python || !same(response.imports, ["av", "hid", "faster_whisper", "langchain_core"]) || !Array.isArray(response.extraDistributions) || response.extraDistributions.length || response.hidOpened !== false || response.providerContacted !== false || model && response.modelLoaded !== true) throw new Error("The selected runtime failed its pinned, offline import/model contract. Existing components were preserved.");
    return response;
  }
  const pythonPath = component => join(root, component.location, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  async function verifyRecord(record, { load = true } = {}) {
    for (const component of Object.values(record.components)) await verifyRuntimeComponent(root, component);
    await verifyRuntimeModel(join(root, record.components.model.location), record.spec.model);
    return load ? probe(pythonPath(record.components.python), join(root, record.components.model.location), record.spec) : null;
  }
  async function retained(selection = undefined) {
    selection ??= await readRuntimeSelection(root);
    return Promise.all([...new Set([selection?.current, selection?.previous].filter(Boolean))].map(id => readRuntimeRelease(root, id)));
  }
  async function completeCleanup(lease) {
    const plan = await readJson(cleanupPath); if (!plan) return { removedComponents: [] };
    if (plan.schema !== "switchyard-runtime-cleanup/v1" || !validateSelection(plan.selection) || !Array.isArray(plan.components) || plan.components.length > 128 || !Array.isArray(plan.specs) || plan.specs.length > 128 || !Array.isArray(plan.records) || plan.records.some(id => !runtimeId(id)) || !same(await readRuntimeSelection(root), plan.selection)) throw new Error("The runtime cleanup scope changed. Existing files were preserved.");
    const kept = await retained(plan.selection), protectedSpecs = new Set(kept.map(record => record.spec.id)), protectedLocations = new Set(kept.flatMap(record => Object.values(record.components).map(component => component.location)));
    for (const component of plan.components) {
      if (protectedLocations.has(component.location)) throw new Error("Cleanup overlaps a retained runtime. Its files were preserved.");
      await verifyRuntimeComponent(root, component, { allowMissing: true });
    }
    for (const value of plan.specs) { if (protectedSpecs.has(value.id)) throw new Error("Cleanup overlaps a retained runtime specification."); await verifySpecFiles(value, true); }
    const removedComponents = [];
    for (const component of plan.components) {
      lease.assert(); await rm(join(root, component.location), { recursive: true, force: true }); removedComponents.push(component.location); await afterRemove(component.location);
      if (component.location.startsWith("versions/")) { try { await rmdir(join(root, component.location.split("/").slice(0, 2).join("/"))); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; } }
    }
    for (const id of plan.records) { if ([plan.selection?.current, plan.selection?.previous].includes(id)) throw new Error("Cleanup attempted to remove retained metadata."); lease.assert(); await rm(join(meta, "releases", `${id}.json`), { force: true }); }
    for (const value of plan.specs) { lease.assert(); await rm(join(meta, "specs", value.id), { recursive: true, force: true }); }
    lease.assert(); await rm(cleanupPath); return { removedComponents };
  }
  async function prune(lease) {
    await completeCleanup(lease);
    const selection = await readRuntimeSelection(root), keep = await retained(selection), all = await records();
    const keepIds = new Set(keep.map(record => record.id)), locations = new Set(keep.flatMap(record => Object.values(record.components).map(component => component.location))), obsolete = all.filter(record => !keepIds.has(record.id));
    const components = [...new Map(obsolete.flatMap(record => Object.values(record.components)).filter(component => !locations.has(component.location)).map(component => [component.location, component])).values()];
    const protectedSpecs = new Set(keep.map(record => record.spec.id)), specs = [];
    let names = []; try { names = await readdir(join(meta, "specs")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const name of names) {
      if (!runtimeId(name)) throw new Error("Runtime specifications contain unrelated content; it was preserved.");
      if (protectedSpecs.has(name)) continue;
      const value = validateRuntimeSpec(JSON.parse(await privateRead(join(meta, "specs", name, "spec.json"))));
      if (value.id !== name) throw new Error("Stored runtime specification identity changed.");
      await verifySpecFiles(value); specs.push(value);
    }
    if (!obsolete.length && !specs.length) return { removedComponents: [] };
    // All candidates are checked before the first removal, and the deletion
    // inventory survives an interruption between individual atomic unlinks.
    for (const component of components) await verifyRuntimeComponent(root, component);
    lease.assert(); await writeJson(cleanupPath, { schema: "switchyard-runtime-cleanup/v1", selection, components, specs, records: obsolete.map(record => record.id) });
    return completeCleanup(lease);
  }
  async function cleanStage(pending, lease) {
    if (!pending.stage) return;
    const stage = join(root, pending.stage);
    if (!await exists(stage)) return;
    const identity = directoryToken(await directoryIdentity(stage));
    const names = await readdir(stage);
    if (!pending.stageIdentity && names.length === 0) { lease.assert(); await rmdir(stage); return; }
    if (!pending.stageIdentity || !same(identity, pending.stageIdentity)) throw new Error("The interrupted runtime stage changed identity. Its content was preserved.");
    if (names.some(name => !["venv", "base.en"].includes(name))) throw new Error("The interrupted runtime stage contains unrelated content; it was preserved.");
    // This UUID tree was durably reserved before installer acknowledgement and
    // has never been selected. It contains generated software only, not user data.
    for (const name of names) await inventoryRuntimeComponent(join(stage, name), name);
    lease.assert(); await rm(stage, { recursive: true, force: true });
  }
  async function pendingRecord() {
    const pending = await readJson(pendingPath); if (!pending) return null;
    if (pending.schema !== "switchyard-runtime-transaction/v1" || !/^[a-f0-9-]{36}$/.test(pending.id) || !Number.isSafeInteger(pending.ownerPid) || pending.ownerPid < 1 || !validateSelection(pending.before) || !validateSelection(pending.after) || !["install/update", "rollback", "uninstall"].includes(pending.action) || pending.stage !== null && !/^versions\/[a-f0-9-]{36}$/.test(pending.stage) || pending.release !== null && !runtimeId(pending.release)) throw new Error("The interrupted runtime transaction is invalid. Its files were preserved.");
    return pending;
  }
  async function recover(lease) {
    await completeCleanup(lease);
    const pending = await pendingRecord(); if (!pending) return { recovered: false };
    if (pending.ownerPid !== process.pid) { try { process.kill(pending.ownerPid, 0); throw new Error("The original runtime maintenance owner may still be active. Its journal and stage were preserved."); } catch (error) { if (error.code !== "ESRCH") throw error; } }
    if (pending.guardian && !await guardianStopped(pending.guardian)) throw new Error("The interrupted runtime worker is still active or its exit is unconfirmed. Preserve its stage and retry recovery after verified exit.");
    const selected = await readRuntimeSelection(root);
    let outcome;
    if (pending.after !== null && same(selected, pending.after)) {
      for (const record of await retained(selected)) await verifyRecord(record, { load: false });
      outcome = "committed";
    } else if (same(selected, pending.before)) {
      await cleanStage(pending, lease);
      if (pending.release && ![selected?.current, selected?.previous].includes(pending.release) && await exists(join(meta, "releases", `${pending.release}.json`))) { await readRuntimeRelease(root, pending.release); await rm(join(meta, "releases", `${pending.release}.json`)); }
      outcome = "discarded-unselected-stage";
    } else throw new Error("The runtime selection differs from both recorded transaction states. Its content was preserved.");
    lease.assert(); await rm(pendingPath); return { recovered: true, outcome, ...await prune(lease) };
  }
  async function locked(fn) {
    await privateDirectory(root);
    return withStateLock(meta, "runtime", async lease => {
      const run = async () => { await recover(lease); return fn(lease); };
      return await exists(pendingPath) || await exists(cleanupPath) || await exists(join(meta, "application-resume.json")) ? maintain(run) : run();
    });
  }
  async function mutate(action, lease, build) {
    return maintain(async () => {
      const before = await readRuntimeSelection(root), pending = { schema: "switchyard-runtime-transaction/v1", id: randomUUID(), ownerPid: process.pid, action, before, after: null, stage: null, stageIdentity: null, guardian: null, release: null };
      await writeJson(pendingPath, pending);
      const persist = async () => { lease.assert(); await writeJson(pendingPath, pending); };
      const run = async (executable, args, options = {}) => {
        try {
          const value = await command(executable, args, { ...options, env: runtimeEnvironment(), onGuardianReady: async frame => { pending.guardian = frame; await persist(); } });
          pending.guardian = null; await persist(); return value;
        } catch (error) { if (error.code !== "RUNTIME_STOP_UNCONFIRMED") { pending.guardian = null; await persist(); } throw error; }
      };
      try {
        const result = await build(pending, persist, run);
        lease.assert(); await writeJson(pointer, pending.after); await afterSelection(action);
        await rm(pendingPath); return { ...result, ...await prune(lease) };
      } catch (error) {
        if (error.code === "RUNTIME_STOP_UNCONFIRMED" || pending.guardian || pending.after && same(await readRuntimeSelection(root), pending.after)) throw error;
        await cleanStage(pending, lease);
        if (pending.release && ![pending.before?.current, pending.before?.previous].includes(pending.release)) await rm(join(meta, "releases", `${pending.release}.json`), { force: true });
        lease.assert(); await rm(pendingPath); throw error;
      }
    });
  }
  async function install() {
    return locked(async lease => {
      const value = await currentSpec(), selection = await readRuntimeSelection(root), selected = selection?.current ? await readRuntimeRelease(root, selection.current) : null;
      if (selected?.spec.id === value.id) return { status: "verified", unchanged: true, releaseId: selected.id, ...await verifyRecord(selected), ...await prune(lease) };
      return mutate("install/update", lease, async (pending, persist, run) => {
        const keys = runtimeComponentKeys(value), components = {}, candidates = await retained(selection);
        for (const name of ["python", "model"]) {
          const existing = candidates.find(record => record.components[name].key === keys[name])?.components[name];
          if (existing) { await verifyRuntimeComponent(root, existing); components[name] = existing; }
        }
        // Adopt a matching legacy runtime in place; never duplicate it or try
        // to repair an unowned/mismatched environment by modifying it.
        if (!selection) for (const [name, location] of [["python", "venv"], ["model", "base.en"]]) if (await exists(join(root, location))) {
          if (name === "python") await probe(join(root, location, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"), null, value, run);
          else await verifyRuntimeModel(join(root, location), value.model);
          components[name] = { location, key: keys[name], inventory: await inventoryRuntimeComponent(join(root, location), location) };
        }
        const missing = ["python", "model"].filter(name => !components[name]);
        if (missing.length) {
          pending.stage = `versions/${randomUUID()}`; await persist(); await privateDirectory(join(root, pending.stage)); pending.stageIdentity = directoryToken(await directoryIdentity(join(root, pending.stage))); await persist();
          if (missing.includes("python")) {
            const uv = await uvResolver(), files = await specFiles(value), location = `${pending.stage}/venv`, python = join(root, location, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
            await run(uv, ["--version"]);
            await run(uv, ["venv", "--no-config", "--no-cache", "--managed-python", "--relocatable", "--python", value.python, join(root, location)], { timeout: 600000 });
            await run(uv, ["pip", "sync", "--no-config", "--no-cache", "--require-hashes", "--only-binary", ":all:", "--index-url", "https://pypi.org/simple", "--python", python, files.lock], { timeout: 600000 });
            await probe(python, null, value, run);
            components.python = { location, key: keys.python, inventory: await inventoryRuntimeComponent(join(root, location), "venv") };
          }
          if (missing.includes("model")) { const location = `${pending.stage}/base.en`; await downloader(join(root, location), value.model); components.model = { location, key: keys.model, inventory: await inventoryRuntimeComponent(join(root, location), "base.en") }; }
        }
        await verifyRuntimeModel(join(root, components.model.location), value.model);
        const result = await probe(pythonPath(components.python), join(root, components.model.location), value, run);
        pending.release = runtimeReleaseRecord(value, components).id; await persist();
        const record = await saveRuntimeRelease(root, value, components); pending.after = selectionOf(record.id, selection?.current ?? null); await persist();
        return { status: "verified", unchanged: false, releaseId: record.id, reusedComponents: ["python", "model"].filter(name => !missing.includes(name)), installedComponents: missing, ...result };
      });
    });
  }
  return {
    root, install, update: install,
    check: () => locked(async () => { const value = await currentSpec(), selection = await readRuntimeSelection(root); const record = (await retained(selection)).find(record => record.spec.id === value.id); if (!record) throw new Error("No managed optional runtime matches this application. Run switchyard runtime install to verify/adopt an existing runtime or install missing components."); return { status: "verified", releaseId: record.id, selected: selection.current === record.id, ...await verifyRecord(record) }; }),
    recover: () => withStateLock(meta, "runtime", lease => maintain(() => recover(lease))),
    rollback: () => locked(async lease => {
      const before = await readRuntimeSelection(root); if (!before?.previous) throw new Error("No previous optional runtime is retained.");
      const record = await readRuntimeRelease(root, before.previous), value = await currentSpec();
      if (record.spec.id !== value.id) throw new Error("The retained runtime requires its matching application version. Roll back the application before selecting that runtime.");
      await verifyRecord(record);
      return mutate("rollback", lease, async (pending, persist) => { pending.after = selectionOf(before.previous, before.current); await persist(); return { status: "verified", releaseId: before.previous, rolledBack: true }; });
    }),
    uninstall: () => locked(async lease => {
      const selection = await readRuntimeSelection(root);
      if (!selection) throw new Error("Adopt/verify the legacy optional runtime before uninstalling it; unrecorded files were preserved.");
      for (const record of await retained(selection)) await verifyRecord(record, { load: false });
      return mutate("uninstall", lease, async (pending, persist) => { pending.after = selectionOf(null); await persist(); return { status: "uninstalled", protectedDataPreserved: true }; });
    })
  };
}
