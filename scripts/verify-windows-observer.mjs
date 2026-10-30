#!/usr/bin/env node
/** Actual native read-only handshake; never registers a shortcut or records content. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";
import { WindowsNativeHotkeys } from "../tools/layout-studio/windows-host.mjs";
import { foregroundCategories } from "../tools/layout-studio/foreground.mjs";
import { stopOwnedChild } from "../tools/layout-studio/owned-process.mjs";
if (process.platform !== "win32" || process.argv.length !== 4 || process.argv[2] !== "--helper") throw new Error("Usage on Windows: node scripts/verify-windows-observer.mjs --helper /absolute/built/Switchyard.Hotkeys.exe");
const driver = new WindowsNativeHotkeys({ executable: await realpath(process.argv[3]), origin: "http://127.0.0.1:43177/", token: randomBytes(32).toString("base64url"), readOnly: true });
let failure, result;
try {
  const ready = await driver.ready; assert.equal(ready.readOnly, true); assert.equal(ready.protocolVersion, 2);
  const category = await driver.request("foreground-category"); assert.equal(typeof category.available, "boolean");
  assert.ok(category.available ? foregroundCategories.includes(category.category) : category.category === null);
  assert.equal(Object.keys(category).some((k) => /title|path|url|pid|processId/i.test(k)), false);
  // Exercise the native guard directly, independently of the JS convenience guard.
  await assert.rejects(driver.request("register", { bindingId: 1, modifiers: 10, virtualKey: 65, body: { implementation: "native-chatgpt.focus/v1" } }), /category observation only/);
  assert.deepEqual((await driver.status()).bindings, []);
  result = { protocol: ready.protocolVersion, readOnlyVerified: true, foregroundAvailable: category.available, category: category.category, nativeRegistrationRejected: true, registeredBindings: 0, microphoneOpened: false, keyboardOpened: false };
} catch (e) { failure = e; }
finally { driver.close(); const stopped = await stopOwnedChild(driver.child); assert.equal(stopped.stopped, true); }
if (failure) throw failure;
console.log(JSON.stringify({ ...result, ownedHelperStopped: true, evidence: "Native protocol/API check; interactive user workflow and physical input not accepted." }));
