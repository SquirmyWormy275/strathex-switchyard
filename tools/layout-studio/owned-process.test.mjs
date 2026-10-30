import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { stopOwnedChild } from "./owned-process.mjs";
async function ready(code) {
  const child = spawn(process.execPath, ["-e", code], { stdio: ["pipe", "pipe", "ignore"] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill(); reject(new Error("Synthetic child was not ready")); }, 10000); child.once("error", (e) => { clearTimeout(timer); reject(e); }); child.stdout.once("data", () => { clearTimeout(timer); resolve(); }); });
  return child;
}
test("owned direct-child shutdown waits for actual process exit", async () => {
  const child = await ready('process.on("SIGTERM",()=>process.exit(0));process.stdin.resume();setInterval(()=>{},1000);process.stdout.write("READY");');
  try { assert.equal((await stopOwnedChild(child)).stopped, true); assert.ok(child.exitCode !== null || child.signalCode !== null); }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});
test("a stubborn Unix child is escalated and its exit verified", { skip: process.platform !== "linux" }, async () => {
  const child = await ready('process.on("SIGTERM",()=>{});process.stdin.resume();setInterval(()=>{},1000);process.stdout.write("READY");');
  try { assert.equal((await stopOwnedChild(child, { graceMs: 30, finalMs: 1000 })).stopped, true); assert.equal(child.signalCode, "SIGKILL"); }
  finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});
test("unconfirmed owned-child stop is reported without claiming success", async () => {
  const child = new EventEmitter(); Object.assign(child, { exitCode: null, signalCode: null, kill: () => false });
  assert.equal((await stopOwnedChild(child, { graceMs: 5, finalMs: 5 })).stopped, false);
});
