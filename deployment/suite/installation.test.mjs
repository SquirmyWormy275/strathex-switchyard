import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "./test-support/fixture.mjs";
import { buildSuiteRelease } from "./release.mjs";
import { createInstallation } from "./installation.mjs";
import { fileDigest } from "./owned-files.mjs";
import { applicationEnvironment, applicationStatus, launchApplication, stopApplication } from "./application.mjs";
const idle = { status: async () => ({ status: "not-started" }), stop: async () => { throw new Error("Unexpected stop"); }, launch: async () => { throw new Error("Unexpected launch"); } };
async function installFixture(fn) {
  return fixture(async ({ root, options: releaseOptions, bundle: first }) => {
    const home = join(root, "h"), data = join(root, "d"), applicationRoot = join(root, "a"), stateRoot = join(root, "s/strathex-switchyard/application");
    await mkdir(home, { mode: 0o700 });
    const paths = { record: join(applicationRoot, "installed.json"), loader: join(applicationRoot, "launch.mjs"), command: process.platform === "win32" ? join(applicationRoot, "switchyard.cmd") : join(home, ".local/bin/switchyard"), desktop: process.platform === "win32" ? join(data, "Microsoft/Windows/Start Menu/Programs/Switchyard.lnk") : join(data, "applications/io.strathex.Switchyard.desktop") };
    const options = { root: applicationRoot, stateRoot, paths, application: idle, beforeRemove: async () => {} }, make = (overrides = {}) => createInstallation({ ...options, ...overrides });
    const second = await buildSuiteRelease({ ...releaseOptions, sourceCommit: "b".repeat(40) });
    await fn({ root, home, options, make, first, second, releaseOptions, paths });
  }, process.platform);
}
async function snapshots(paths) { return Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([role, path]) => [role, await readFile(path).then(fileDigest).catch((e) => { if (e.code === "ENOENT") return null; throw e; })]))); }
async function crashUpdate(options, release, boundary = "record") {
  const module = pathToFileURL(join(process.cwd(), "deployment/suite/installation.mjs")).href;
  const program = `import{createInstallation}from ${JSON.stringify(module)};const options=${JSON.stringify({ root: options.root, stateRoot: options.stateRoot, paths: options.paths })};const boundary=${JSON.stringify(boundary)};const i=createInstallation({...options,application:{status:async()=>({status:'not-started'}),stop:async()=>{},launch:async()=>{}},beforeRemove:async()=>{},afterWrite:async role=>{if(role===boundary)process.exit(77)},afterCopy:async()=>{if(boundary==='copy')process.exit(77)}});await i.install(${JSON.stringify(release.directory)},${JSON.stringify(release.id)});`;
  const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ["--input-type=module", "-e", program], { shell: false, stdio: ["ignore", "ignore", "pipe"] }); let diagnostic = ""; const timer = setTimeout(() => child.kill("SIGKILL"), 20000); child.stderr.on("data", (b) => { if (diagnostic.length < 1024) diagnostic += b; }); child.once("error", reject); child.once("close", (n) => { clearTimeout(timer); n === 77 ? resolve(n) : reject(new Error(`Synthetic update did not reach its crash boundary: ${diagnostic}`)); }); });
  assert.equal(code, 77);
}
test("installation keeps current and one rollback version, records dated backups, preserves data and removes only owned entries", () => installFixture(async ({ root, options, make, first, second, releaseOptions, paths }) => {
  const install = make(), protectedData = join(root, "irreplaceable.sealed"), runtime = join(root, "shared-model.bin");
  await writeFile(protectedData, "synthetic protected state"); await writeFile(runtime, "synthetic shared runtime");
  const one = await install.install(first.directory, first.id); assert.equal(one.status, "installed"); assert.equal(one.previous, null);
  assert.equal((await install.install(first.directory, first.id)).status, "unchanged");
  await install.install(second.directory, second.id); const third = await buildSuiteRelease({ ...releaseOptions, sourceCommit: "c".repeat(40) });
  await install.install(third.directory, third.id);
  assert.deepEqual((await readdir(join(options.root, "versions"))).sort(), [second.id, third.id].sort());
  const restored = await install.rollback(); assert.equal(restored.current, second.id); assert.equal(restored.previous, third.id);
  const record = await install.inspect(); assert.equal(record.current, second.id); assert.equal(record.runtime.version, "24.14.0");
  const folders = await readdir(join(options.stateRoot, "installation-backups")); assert.equal(folders.length, 4);
  const journal = JSON.parse(await readFile(join(options.stateRoot, "installation-backups", folders[1], "journal.json"), "utf8")); assert.ok(journal.reason.includes("persistent entries")); assert.equal(journal.status, "committed");
  assert.equal((await install.uninstall()).status, "removed"); assert.deepEqual(await snapshots(paths), { record: null, loader: null, command: null, desktop: null });
  assert.equal(await readFile(protectedData, "utf8"), "synthetic protected state"); assert.equal(await readFile(runtime, "utf8"), "synthetic shared runtime");
}));
test("unowned or edited desktop entries and corrupted new releases preserve the current application", () => installFixture(async ({ make, first, second, paths }) => {
  await mkdir(join(paths.desktop, ".."), { recursive: true }); await writeFile(paths.desktop, "Existing unrelated launcher");
  await assert.rejects(make().install(first.directory, first.id), /unowned or changed/); assert.equal(await readFile(paths.desktop, "utf8"), "Existing unrelated launcher");
  await import("node:fs/promises").then(({ rm }) => rm(paths.desktop)); const install = make(); await install.install(first.directory, first.id); const before = await snapshots(paths);
  await writeFile(join(second.directory, "frontend/index.html"), "corrupted"); await assert.rejects(install.install(second.directory, second.id), /integrity failed/); assert.deepEqual(await snapshots(paths), before);
  await writeFile(paths.desktop, "user edit"); await assert.rejects(install.uninstall(), /unowned or changed/); assert.equal((await install.inspect()).current, first.id);
}));
test("a failed persistent write restores every earlier launcher and the exact previous installation record", () => installFixture(async ({ make, first, second, paths }) => {
  const install = make(); await install.install(first.directory, first.id); const before = await snapshots(paths);
  await assert.rejects(make({ afterWrite: async (role) => { if (role === "desktop") throw new Error("Synthetic persistent-write fault"); } }).install(second.directory, second.id), /Synthetic persistent-write fault/);
  assert.deepEqual(await snapshots(paths), before); assert.equal((await install.inspect()).current, first.id);
}));
test("forced owner exit leaves a durable journal; another installer restores the exact before state without touching unrelated files", () => installFixture(async ({ make, first, second, options, paths }) => {
  const install = make(); await install.install(first.directory, first.id); const before = await snapshots(paths); await crashUpdate(options, second);
  assert.equal((await install.inspect()).current, second.id); assert.ok((await lstat(join(options.root, "pending.json"))).isFile());
  assert.equal((await make().recover()).recovered, true); assert.deepEqual(await snapshots(paths), before); assert.equal((await make().recover()).recovered, false);
}));
test("recovery preflights all edits before writing, and respects a committed update whose pending marker survived", () => installFixture(async ({ make, first, second, options, paths }) => {
  const install = make(); await install.install(first.directory, first.id); await crashUpdate(options, second);
  const after = await snapshots(paths), desktop = await readFile(paths.desktop); await writeFile(paths.desktop, "unrelated edit during recovery");
  await assert.rejects(install.recover(), /unrelated desktop edit/); assert.equal(fileDigest(await readFile(paths.record)), after.record); assert.equal(await readFile(paths.desktop, "utf8"), "unrelated edit during recovery");
  await writeFile(paths.desktop, desktop);
  const pending = JSON.parse(await readFile(join(options.root, "pending.json"), "utf8")), journal = join(options.stateRoot, "installation-backups", pending.backup, "journal.json"), plan = JSON.parse(await readFile(journal, "utf8"));
  await writeFile(journal, JSON.stringify({ ...plan, status: "committed" }));
  assert.equal((await install.recover()).committed, true); assert.equal((await install.inspect()).current, second.id); assert.deepEqual(await snapshots(paths), after);
}));
test("active host connections block uninstall before any application stop or persistent mutation", () => installFixture(async ({ make, first, paths }) => {
  await make().install(first.directory, first.id); const before = await snapshots(paths); let stops = 0;
  const install = make({ application: { status: async () => ({ status: "ready" }), stop: async () => { stops++; } }, beforeRemove: async () => { throw new Error("Synthetic active connection needs restoration"); } });
  await assert.rejects(install.uninstall(), /active connection needs restoration/); assert.equal(stops, 0); assert.deepEqual(await snapshots(paths), before);
}));
test("an explicit no-start update stops the previous generation without restarting the new one", () => installFixture(async ({ make, first, second }) => {
  let running = false, starts = 0, stops = 0;
  const install = make({ application: { status: async () => ({ status: running ? "ready" : "not-started" }), stop: async () => { stops++; running = false; }, launch: async () => { starts++; running = true; } } });
  await install.install(first.directory, first.id, { start: true }); assert.equal(running, true);
  await install.install(second.directory, second.id, { start: false });
  assert.equal((await install.inspect()).current, second.id); assert.equal(running, false); assert.equal(starts, 1); assert.equal(stops, 1);
}));
test("the stable installed loader verifies and addresses the actual application across update and rollback", () => installFixture(async ({ root, home, make, first, second, options, paths }) => {
  const environment = applicationEnvironment({ ...process.env, HOME: home, USERPROFILE: home, XDG_DATA_HOME: join(root, "d"), APPDATA: join(root, "d"), LOCALAPPDATA: join(root, "l"), XDG_STATE_HOME: join(root, "s"), XDG_RUNTIME_DIR: join(root, "r") });
  await mkdir(environment.XDG_RUNTIME_DIR, { mode: 0o700 });
  const appOptions = { stateRoot: options.stateRoot, environment, port: 0, installationRoot: options.root };
  const application = { status: () => applicationStatus(appOptions), stop: () => stopApplication(appOptions), launch: (bundleRoot) => launchApplication({ ...appOptions, bundleRoot }) }, install = make({ application });
  async function command(args) {
    return new Promise((resolve, reject) => { const child = spawn(process.execPath, [paths.loader, ...args], { cwd: home, env: environment, shell: false, stdio: ["ignore", "pipe", "pipe"] }); let output = "", error = ""; const timer = setTimeout(() => child.kill("SIGKILL"), 10000); child.stdout.on("data", (b) => { output += b; }); child.stderr.on("data", (b) => { error = (error + b).slice(-2048); }); child.once("error", reject); child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolve(JSON.parse(output)) : reject(new Error(`Installed loader failed: ${error}`)); }); });
  }
  try {
    await install.install(first.directory, first.id, { start: true }); const initial = await command(["status"]); assert.equal(initial.build, first.id); assert.equal(initial.authenticated, true);
    await install.install(second.directory, second.id); const updated = await command(["status"]); assert.equal(updated.build, second.id); assert.notEqual(updated.instanceId, initial.instanceId);
    await install.rollback(); assert.equal((await command(["status"])).build, first.id);
    await install.uninstall(); assert.equal((await applicationStatus(appOptions)).status, "not-listening");
  } finally { await stopApplication(appOptions); }
}));
test("pre-promotion owner loss recovers only verified staging copies and exact incomplete source prefixes", () => installFixture(async ({ make, first, second, options, paths }) => {
  const install = make(); await install.install(first.directory, first.id); const before = await snapshots(paths);
  await crashUpdate(options, second, "copy");
  const descriptorPath = join(options.stateRoot, "installation-stage.json"), descriptor = JSON.parse(await readFile(descriptorPath, "utf8")), stage = join(options.root, "versions", `.install-${descriptor.stageId}`);
  const unrelated = join(stage, "unrelated.txt"); await writeFile(unrelated, "Preserve an unrelated staging edit");
  await assert.rejects(install.recover(), /unrelated content/); assert.equal(await readFile(unrelated, "utf8"), "Preserve an unrelated staging edit"); assert.deepEqual(await snapshots(paths), before);
  await import("node:fs/promises").then(({ rm }) => rm(unrelated));
  const copied = descriptor.files[0].path, complete = await readFile(join(stage, copied)); assert.ok(complete.length > 8); await writeFile(join(stage, copied), complete.subarray(0, 8));
  assert.equal((await install.recover()).stageRecovered, true); assert.deepEqual(await snapshots(paths), before);
  await assert.rejects(lstat(stage), { code: "ENOENT" }); await assert.rejects(lstat(descriptorPath), { code: "ENOENT" });
}));
