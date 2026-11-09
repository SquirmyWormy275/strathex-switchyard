#!/usr/bin/env node
/** Interactive UI against fresh encrypted state, a synthetic readout and a signed local agent. */
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { createSuite } from "../tools/layout-studio/suite.mjs";
import { createStudioServer } from "../tools/layout-studio/serve.mjs";
import { standardPreset } from "../tools/layout-studio/catalog.mjs";
import { layoutChoices } from "../tools/layout-studio/geometry.mjs";
import { createCopilotRequests } from "../tools/layout-studio/copilot-requests.mjs";
import { switchyardAgent } from "../integrations/agent-sdk.mjs";

if (process.argv.slice(2).join(" ") !== "--synthetic") throw Error("Usage: node scripts/demo-switchyard-ui.mjs --synthetic");
const parent = join(homedir(), ".local/state/strathex-switchyard");
await mkdir(parent, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(parent, "ui-demo-")), owner = await lstat(root), keys = new Map();
const store = createSuiteStore({ root, secrets: { get: async (id, purpose) => keys.get(id + purpose), set: async (id, purpose, value) => { keys.set(id + purpose, value); } } });
const catalog = JSON.parse(await readFile(new URL("../tools/layout-studio/model-f-catalog.json", import.meta.url), "utf8"));
const preset = standardPreset(catalog, "f77-classic", { typing: "dvorak" }), part = preset.variant.parts[0], source = catalog.definitions[part.definitionId], definition = source.definition;
const rows = definition.matrix.rows, cols = definition.matrix.cols, layer = Array.from({ length: rows }, () => Array(cols).fill(0));
const codes = { ENTER: 40, ESC: 41, ESCAPE: 41, BSPC: 42, BSPACE: 42, TAB: 43, SPACE: 44, MINUS: 45, MINS: 45, EQUAL: 46, EQL: 46, LBRACKET: 47, LBRC: 47, RBRACKET: 48, RBRC: 48, BSLASH: 49, BSLS: 49, SCOLON: 51, SCLN: 51, QUOTE: 52, QUOT: 52, GRAVE: 53, COMMA: 54, DOT: 55, SLASH: 56, SLSH: 56, CAPSLOCK: 57, CAPS: 57, LCTRL: 224, LCTL: 224, LSHIFT: 225, LSFT: 225, LALT: 226, LGUI: 227, RCTRL: 228, RCTL: 228, RSHIFT: 229, RSFT: 229, RALT: 230, RGUI: 231 };
for (let i = 0; i < 26; i++) codes[String.fromCharCode(65 + i)] = i + 4;
for (let i = 0; i < 10; i++) codes[String((i + 1) % 10)] = i + 30;
for (const [i, key] of preset.portable.plan.profile.keys.entries()) layer[key.matrix[0]][key.matrix[1]] = codes[key.baseKeycode?.replace(/^KC_/, "")] ?? 0x7000 + i;
const options = layoutChoices(definition), packed = part.choices.reduce((v, choice, i) => v * 2 ** Math.ceil(Math.log2(options[i].options.length)) + choice, 0);
await store.initialize("personal"); await store.initialize("work", "work");
const syntheticAccount = "11111111-1111-1111-1111-111111111111:33333333-3333-3333-3333-333333333333";
await store.update("work", "synthetic-copilot-outcome", state => { state.mode = "managed-companion"; state.accounts = [syntheticAccount]; });
const requests = createCopilotRequests({ store }), pending = await requests.reserve("work", { account: syntheticAccount, clientId: "22222222-2222-2222-2222-222222222222", conversationId: "synthetic-work-design", sessionId: null, scopeDigest: "e".repeat(64), requestId: randomUUID() }, () => {});
await requests.enter("work", pending.row.id, "creating", () => {}); await requests.fail("work", pending.row.id);
await store.update("work", "synthetic-copilot-keyboard-only", state => { state.mode = "keyboard-only"; });
await store.update("personal", "synthetic-ui-readout", state => { state.deviceSnapshots = [{ schema: "switchyard-device-snapshot/v1", identity: { deviceId: "a".repeat(64), keyboardId: source.firmwareIdentity.keyboardId, viaProtocol: 9, vialProtocol: part.definitionId.startsWith("wcass") ? 4 : 6, controller: "unknown" }, capturedAt: new Date().toISOString(), definition, rows, cols, layers: 1, keymap_raw: [layer], layoutOptions: packed, configurationOnly: true }]; });
const refuse = async () => { throw Error("This demonstration uses synthetic data. Hardware, native tasks, accounts and desktop changes are unavailable here."); };
await store.update("personal", "synthetic-ui-conversations", state => { state.conversations = [
  { id: "demo-design", provider: "codex", sessionId: "synthetic-design-session", accountFingerprint: "d".repeat(64), status: "complete", updatedAt: Date.now(), messages: [{ role: "user", text: "Synthetic example: keep my place between tools." }, { role: "assistant", text: "Start with Return to task, Check progress, Review work and Leave a handoff. This is saved demonstration text; no model was contacted." }] },
  { id: "demo-legacy", provider: "claude-code", sessionId: "synthetic-legacy-session", status: "interrupted", updatedAt: Date.now(), messages: [{ role: "user", text: "Synthetic older conversation with an unknown original account." }] }
]; });
await store.update("personal", "synthetic-ui-task", state => { state.codingSessions = [{ schema: "switchyard-coding-session/v1", id: "demo-text-task", provider: "claude-code", label: "Example reserved text task · synthetic", repositoryRoot: "/synthetic/project", repositoryIdentity: { device: "0", inode: "1" }, sessionId: randomUUID(), accountFingerprint: "d".repeat(64), nativeTransport: "owned-print", nativeIdentityVerified: false, backgroundId: null, launchPolicy: "tools-disabled/plan", status: "registered", createdAt: Date.now() }]; });
const suite = createSuite({ store, agents: { discovery: async () => [], close: async () => {}, stopCompartment: async () => {} }, voice: { discovery: async () => ({ available: false, reason: "Microphone capture is outside this demonstration." }) }, foreground: { implemented: false, close: async () => {}, stopCompartment: async () => {} }, devices: { list: async () => [], close: async () => {} } });
const allowed = new Set(["bootstrap", "snapshot", "compartment/select", "mode", "profile/save", "profile/select", "workflow/save", "roles/choices", "roles/bind-choice", "roles/dispatch", "devices/identify", "devices/list", "copilot/discovery", "copilot/requests", "copilot/requests/review", "copilot/requests/resolve", "integrations/catalog", "integrations/launches", "integrations/recipe", "coding/authority/list", "coding/execution/list", "coding/execution/stop/list", "coding/scanner-save/list", "host/scanner-fixtures/list", "profile/package/export", "profile/package/review", "profile/package/import", "profile/legends/export", "design/observations/review", "observation/start", "observation/mark", "observation/state", "observation/delete"]);
const handle = suite.handle.bind(suite);
const safeSuite = { ...suite, handle: async (path, body) => {
  const route = path.replace("/api/suite/", "");
  if (!allowed.has(route) || route === "roles/dispatch" && body.intent !== "status" || route === "observation/start" && body.sources.some(source => source !== "deliberate")) return refuse();
  return handle(path, body);
} };
const token = randomBytes(32).toString("base64url");
const server = createStudioServer({ suite: safeSuite, token, bridge: { transactions: async () => [], review: refuse, apply: refuse, restore: refuse, keep: refuse, trial: refuse, close() {} }, discover: async () => ({ synthetic: true, platform: process.platform, checkedAt: new Date().toISOString(), shortcuts: false, hostLayouts: ["US · synthetic"], keyboard: { status: "demo", message: "Synthetic F77 readout. No physical keyboard was opened." }, chatgpt: { status: "unavailable", message: "Native applications are outside this demonstration." } }) });
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
// Seed one explicit fixture; the normal UI still starts in keyboard-only mode.
await handle("/api/suite/mode", { compartment: "personal", mode: "personal-companion" });
const enrollment = await handle("/api/suite/agents/enroll", { compartment: "personal", id: "demo-agent", name: "Example builder · synthetic", capabilities: ["status"] });
const sdk = switchyardAgent({ ...enrollment, baseUrl: origin + "/", compartment: "personal", agentId: "demo-agent" }), sessionId = randomUUID();
await sdk.publish(sessionId, "ready");
await handle("/api/suite/mode", { compartment: "personal", mode: "keyboard-only" });
let stopped = false, timer, polling = null;
timer = setInterval(() => {
  if (stopped || polling) return;
  polling = (async () => {
  try {
    if ((await store.snapshot("personal")).mode !== "keyboard-only") {
      await sdk.publish(sessionId, "ready");
      const { command } = await sdk.poll(); if (command) await sdk.acknowledge(command.id, "completed");
    }
  } catch { /* Workspace changes can reject the fixture's heartbeat. */ }
  finally { polling = null; }
  })();
}, 5000);
async function close() {
  if (stopped) return; stopped = true; clearInterval(timer);
  await polling;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.cleanup();
  const current = await lstat(root); if (current.dev !== owner.dev || current.ino !== owner.ino || !current.isDirectory()) throw Error("Demo state ownership changed; preserve it for inspection.");
  await rm(root, { recursive: true, force: true }); keys.clear();
  console.log(JSON.stringify({ demonstration: "stopped", syntheticStateRemoved: true }));
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void close().catch(error => { console.error(error.message); process.exitCode = 1; }));
console.log(JSON.stringify({ demonstration: "synthetic-only", origin, accessUrl: `${origin}/#access=${token}`, stateDirectory: root }));
