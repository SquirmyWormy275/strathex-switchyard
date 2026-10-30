import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./test-support/fixture.mjs";
import { launchApplication, stopApplication, applicationStatus, applicationEnvironment } from "./application.mjs";
import { buildSuiteRelease } from "./release.mjs";

async function applicationFixture(fn) {
  return fixture(async ({ root, bundle, options: releaseOptions }) => {
    const environment = applicationEnvironment({ ...process.env, XDG_STATE_HOME: join(root, "s"), XDG_RUNTIME_DIR: join(root, "r"), LOCALAPPDATA: join(root, "l") });
    await mkdir(environment.XDG_RUNTIME_DIR, { mode: 0o700 });
    const stateRoot = join(environment.XDG_STATE_HOME, "strathex-switchyard/application"), options = { bundleRoot: bundle.directory, stateRoot, environment, port: 0 };
    try { await fn({ root, bundle, options, releaseOptions }); } finally { await stopApplication({ stateRoot }); }
  }, process.platform);
}
test("parallel application launches share one authenticated owner, keep tokens private and stop only the exact managed application", () => applicationFixture(async ({ options }) => {
  let launches = 0; const spawnProcess = (...args) => { launches++; return spawn(...args); };
  const results = await Promise.all([1, 2, 3].map(() => launchApplication({ ...options, spawnProcess })));
  assert.equal(launches, 1); assert.equal(new Set(results.map((r) => r.instanceId)).size, 1); assert.equal(results.filter((r) => r.reused).length, 2);
  const status = await applicationStatus(options); assert.equal(status.authenticated, true); assert.equal(status.pid, results[0].pid); assert.equal(JSON.stringify(status).includes(new URL(results[0].url).hash.slice(8)), false);
  const response = await fetch(new URL(results[0].url).origin + "/"); assert.equal(response.status, 200);
  assert.equal((await stopApplication(options)).stopped, true); assert.equal((await stopApplication(options)).stopped, true);
}));
test("an abruptly exited application releases its kernel ownership lease; relaunch creates one new generation and preserves saved state", () => applicationFixture(async ({ root, options }) => {
  const first = await launchApplication(options); const marker = join(options.stateRoot, "kept.json");
  await import("../../tools/layout-studio/private-fs.mjs").then(({ privateWrite }) => privateWrite(marker, '{"synthetic":"preserved"}'));
  process.kill(first.pid, "SIGKILL");
  let status; const until = Date.now() + 5000;
  while (Date.now() < until) { try { status = await applicationStatus(options); if (status.status === "not-listening") break; } catch (e) { if (!["ECONNRESET", "EPIPE"].includes(e.code)) throw e; } await new Promise((r) => setTimeout(r, 25)); }
  assert.equal(status.status, "not-listening"); const restarted = await launchApplication(options);
  assert.notEqual(restarted.instanceId, first.instanceId); assert.notEqual(restarted.pid, first.pid); assert.equal(await readFile(marker, "utf8"), '{"synthetic":"preserved"}');
}));
test("a running different build is preserved and an occupied port is never displaced", () => applicationFixture(async ({ root, options, releaseOptions }) => {
  const first = await launchApplication(options);
  const second = await buildSuiteRelease({ ...releaseOptions, sourceCommit: "b".repeat(40) });
  await assert.rejects(launchApplication({ ...options, bundleRoot: second.directory }), /Another verified suite build/);
  assert.equal((await applicationStatus(options)).instanceId, first.instanceId);
  const listener = createServer((req, res) => res.end("existing listener")); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const environment = { ...options.environment, XDG_STATE_HOME: join(root, "s2"), XDG_RUNTIME_DIR: join(root, "r2"), LOCALAPPDATA: join(root, "l2") }, stateRoot = join(environment.XDG_STATE_HOME, "strathex-switchyard/application");
  try {
    await mkdir(environment.XDG_RUNTIME_DIR, { mode: 0o700 });
    await assert.rejects(launchApplication({ ...options, stateRoot, environment, port: listener.address().port }), /startup did not verify/);
    assert.equal(await (await fetch(`http://127.0.0.1:${listener.address().port}/`)).text(), "existing listener");
  } finally { listener.closeAllConnections(); await new Promise((r) => listener.close(r)); }
}));
test("application subprocesses receive desktop/credential-store coordinates without provider secrets or runtime injection", () => {
  const env = applicationEnvironment({ HOME: "/safe", PATH: "/bin", XDG_RUNTIME_DIR: "/private/runtime", DBUS_SESSION_BUS_ADDRESS: "unix:path=/private/bus", WAYLAND_DISPLAY: "wayland-1", HYPRLAND_INSTANCE_SIGNATURE: "synthetic", NODE_OPTIONS: "--inspect", NODE_PATH: "/injected", PYTHONPATH: "/injected", OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret", GH_TOKEN: "secret" });
  assert.equal(env.HOME, "/safe"); assert.equal(env.WAYLAND_DISPLAY, "wayland-1"); assert.equal(env.DBUS_SESSION_BUS_ADDRESS, "unix:path=/private/bus");
  for (const k of ["NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GH_TOKEN"]) assert.equal(env[k], undefined);
});
