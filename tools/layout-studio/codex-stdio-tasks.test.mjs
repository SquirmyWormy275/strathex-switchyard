import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { CodexClient, codexDesignConfig } from "./agents.mjs";
import { createCodexStdioTasks } from "./codex-stdio-tasks.mjs";
import { createCodingSessions } from "./coding-sessions.mjs";
import { createSuiteStore } from "./suite-store.mjs";
import { stopOwnedChild } from "./owned-process.mjs";

const childSource = `
const readline=require('node:readline'), settings=JSON.parse(process.argv[1]);
const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');let started=false;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(!m.method||m.id===undefined)return;
 let result={};
 switch(m.method){
  case 'initialize':result={userAgent:settings.peerUserAgent??(m.params.clientInfo.name+'/0.166.0 (synthetic fixture)')};break;
  case 'config/read':if(Object.hasOwn(settings,'badFrame')){send(settings.badFrame);return;}for(const [id,method] of [[999,'item/commandExecution/requestApproval'],[1000,'item/fileChange/requestApproval'],[1001,'item/permissions/requestApproval'],[1002,'mcpServer/elicitation/request'],[1003,'item/tool/requestUserInput'],[1004,'item/tool/call'],[1005,'unknown/requestApproval']])send({id,method,params:{command:'never-executed'}});result={config:m.params.cwd?(started&&settings.projectConfigAfterStart||settings.projectConfig||settings.config):settings.config};break;
  case 'account/read':result={account:{type:'chatgpt',email:'synthetic@example.invalid'}};break;
  case 'thread/list':result={data:[{id:'synthetic-existing',preview:'never-return-preview',status:{type:'idle'}}]};break;
  case 'thread/read':result={thread:{id:settings.badId?77:m.params.threadId,cwd:settings.wrongRoot||settings.repositoryRoot,status:{type:'idle'},turns:settings.history?[{private:'never-return-history'}]:[]}};break;
  case 'thread/start':case 'thread/resume':started=true;result={thread:{id:m.params.threadId||'synthetic-created',cwd:settings.repositoryRoot,status:{type:'idle'},turns:[]},cwd:settings.repositoryRoot,sandbox:{type:settings.badPermissions?'workspaceWrite':'readOnly'},approvalPolicy:'on-request'};break;
  case 'thread/inject_items':if(settings.failInject){send({id:m.id,error:{message:'Synthetic marker failure'}});return;}break;
  default:send({id:m.id,error:{message:'Unexpected method'}});return;
 }
 send({id:m.id,result});
});`;
async function fixture(fn, overrides = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "cs-")), root = await realpath(temporary), repositoryRoot = join(root, "repo"), keys = new Map(), frames = [], children = [], launches = [];
  await mkdir(join(repositoryRoot, ".git"), { recursive: true });
  const store = createSuiteStore({ root: join(root, "state"), secrets: { get: async (id, purpose) => keys.get(`${id}:${purpose}`), set: async (id, purpose, value) => { keys.set(`${id}:${purpose}`, value); } } });
  await store.initialize("personal"); await store.initialize("company", "work");
  await store.update("personal", "synthetic-mode", (s) => { s.mode = "personal-companion"; });
  const settings = { repositoryRoot, config: codexDesignConfig(), ...overrides };
  const clientFactory = (exe, cwd, names) => new CodexClient(exe, cwd, names, { spawnProcess: (_, args, options) => {
    launches.push(args);
    assert.equal(options.shell, false); assert.equal(options.env.OPENAI_API_KEY, undefined); assert.ok(args.includes("features.shell_tool=false"));
    const child = spawn(process.execPath, ["-e", childSource, JSON.stringify(settings)], options), write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (value, ...rest) => { frames.push(JSON.parse(String(value))); return write(value, ...rest); };
    children.push(child); return child;
  } });
  const options = { store, root: join(root, "runtime"), resolveCli: async () => process.execPath, resolveMcp: async () => [], clientFactory }, driver = createCodexStdioTasks(options);
  try { await fn({ root, repositoryRoot, store, driver, frames, children, options, settings, launches }); }
  finally { await driver.close(); for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL"); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 }); }
}
test("configured and generated MCP entries receive complete disabled transports without inheriting native commands", () => fixture(async ({ options, launches }) => {
  const driver = createCodexStdioTasks({ ...options, resolveMcp: async () => ["configured", "generated"] });
  try {
    await driver.account("personal");
    for (const name of ["configured", "generated"]) assert.ok(launches[0].includes(`mcp_servers.${name}={command=${JSON.stringify(process.execPath)},args=["--version"],enabled=false}`));
    assert.ok(launches[0].includes("project_doc_max_bytes=0")); assert.equal(launches[0].some((arg) => /^mcp_servers\..*\.enabled=false$/.test(arg)), false);
  } finally { await driver.close(); }
}));
test("real stdio framing verifies restricted initialization/account and returns only exact thread metadata", () => fixture(async ({ repositoryRoot, driver, frames, children }) => {
  const login = await driver.account("personal"); assert.equal(login.type, "chatgpt"); assert.match(login.fingerprint, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(login).includes("@"), false);
  assert.deepEqual(await driver.list("personal"), [{ id: "synthetic-existing", observation: "idle" }]);
  const task = await driver.read("synthetic-existing", repositoryRoot, "personal"); assert.equal(task.repositoryRoot, repositoryRoot); assert.equal(task.observation, "idle");
  assert.ok(frames.some((m) => m.id === 999 && m.result?.decision === "cancel"));
  assert.ok(frames.some((m) => m.id === 1000 && m.result?.decision === "cancel"));
  assert.deepEqual(frames.find(m => m.id === 1001).result, { permissions: {}, scope: "turn" });
  assert.deepEqual(frames.find(m => m.id === 1002).result, { action: "cancel", content: null });
  assert.deepEqual(frames.find(m => m.id === 1003).result, { answers: {} });
  assert.equal(frames.find(m => m.id === 1004).result.success, false); assert.equal(frames.find(m => m.id === 1005).error.code, -32601);
  assert.ok(frames.some((m) => m.method === "thread/read" && m.params.includeTurns === false));
  assert.equal(frames.some((m) => m.method === "turn/start"), false); assert.equal(children.length, 1);
  assert.equal((await driver.stopCompartment("personal")).stopped, true); assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
}));
test("malformed native frames close only the owned connection instead of crashing or granting authority", async () => {
  for (const badFrame of [null, [], {}, { id: 1, method: 17 }, { id: 1, method: "" }, { id: { invalid: true }, method: "item/permissions/requestApproval" }]) {
    const frames = [], client = new CodexClient(process.execPath, process.cwd(), [], { spawnProcess: (_, args, options) => {
      const child = spawn(process.execPath, ["-e", childSource, JSON.stringify({ badFrame, config: codexDesignConfig() })], options), write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (value, ...rest) => { frames.push(JSON.parse(String(value))); return write(value, ...rest); }; return child;
    } });
    try { await assert.rejects(client.initialize(), /disconnected|stopped/i); assert.equal((await stopOwnedChild(client.child)).stopped, true); assert.equal(frames.some(frame => frame.result?.decision === "accept" || frame.result?.permissions?.network?.enabled === true), false); }
    finally { client.close(); await stopOwnedChild(client.child); }
  }
});
test("owned task creation persists only a local marker; resume reads back exact read-only permissions", () => fixture(async ({ repositoryRoot, driver, frames }) => {
  const result = await driver.start(repositoryRoot, "switchyard-synthetic", "personal"); assert.equal(result.threadId, "synthetic-created");
  const resumed = await driver.resume(result.threadId, repositoryRoot, "personal"); assert.equal(resumed.permissions, "read-only/on-request"); assert.equal(resumed.modelPromptSubmitted, false);
  const marker = frames.find((m) => m.method === "thread/inject_items"); assert.equal(marker.params.items[0].role, "assistant");
  assert.ok(frames.some((m) => m.method === "thread/resume" && m.params.excludeTurns === true && m.params.cwd === repositoryRoot));
  for (const method of ["thread/start", "thread/resume"]) assert.deepEqual(frames.find((m) => m.method === method).params.config, codexDesignConfig());
  assert.equal(frames.filter((m) => m.method === "config/read" && m.params.cwd === repositoryRoot).length, 4);
  assert.equal(frames.some((m) => /turn\//.test(m.method)), false);
}));
test("repository-specific tools and feature changes cannot cross an owned task creation or resume boundary", async () => {
  for (const projectConfig of [{ ...codexDesignConfig(), mcp_servers: { project_local: { enabled: true } } }, ...["hooks", "computer_use", "browser_use", "view_image", "image_generation", "workspace_dependencies"].map((name) => ({ ...codexDesignConfig(), features: { ...codexDesignConfig().features, [name]: true } })), { ...codexDesignConfig(), approvals_reviewer: "auto_review" }]) await fixture(async ({ repositoryRoot, driver, frames }) => {
    await assert.rejects(driver.start(repositoryRoot, "switchyard-restricted", "personal"), /restricted design configuration/);
    await assert.rejects(driver.resume("synthetic-created", repositoryRoot, "personal"), /restricted design configuration/);
    assert.equal(frames.some((m) => m.method === "thread/start" || m.method === "thread/resume" || m.method === "turn/start"), false);
    assert.ok(frames.some((m) => m.method === "config/read" && m.params.cwd === repositoryRoot));
  }, { projectConfig });
});
test("unreviewed native versions or another peer identity cannot initialize tools, read accounts or create a task", async () => {
  for (const peerUserAgent of ["switchyard_design/0.167.0 (synthetic fixture)", "another_peer/0.166.0 (synthetic fixture)", "", "switchyard_design/0.166.0\n(synthetic fixture)"]) await fixture(async ({ driver, frames }) => {
    await assert.rejects(driver.account("personal"), /verified.*version|version.*verified/);
    assert.equal(frames.some((m) => m.method !== "initialize"), false);
  }, { peerUserAgent });
});
test("a changed project configuration after native creation preserves its returned identity without injecting or submitting content", () => fixture(async ({ repositoryRoot, driver, frames }) => {
  await assert.rejects(driver.start(repositoryRoot, "switchyard-restricted", "personal"), (e) => e.createdThreadId === "synthetic-created" && /restricted/.test(e.message));
  assert.equal(frames.filter((m) => m.method === "thread/start").length, 1);
  assert.equal(frames.some((m) => m.method === "thread/inject_items" || m.method === "turn/start"), false);
}, { projectConfigAfterStart: { ...codexDesignConfig(), mcp_servers: { late_project_tool: { enabled: true } } } }));
test("wrong root, non-string identity, unexpected history and unrestricted configuration are rejected", async () => {
  await fixture(async ({ repositoryRoot, driver, settings }) => { settings.wrongRoot = dirname(repositoryRoot); await assert.rejects(driver.read("synthetic-existing", repositoryRoot, "personal"), /another working directory/); });
  await fixture(async ({ repositoryRoot, driver }) => { await assert.rejects(driver.read("synthetic-existing", repositoryRoot, "personal"), /different thread/); }, { badId: true });
  await fixture(async ({ repositoryRoot, driver }) => { await assert.rejects(driver.read("synthetic-existing", repositoryRoot, "personal"), /metadata-only/); }, { history: true });
  await fixture(async ({ driver, frames }) => { await assert.rejects(driver.list("personal"), /restricted design configuration/); assert.equal(frames.some((m) => m.method === "thread/list"), false); }, { config: { ...codexDesignConfig(), mcp_servers: { unsafe: { enabled: true } } } });
});
test("a created identity survives failed permission readback or marker persistence without an automatic replacement", async () => {
  for (const settings of [{ badPermissions: true }, { failInject: true }]) await fixture(async ({ repositoryRoot, driver, frames }) => {
    await assert.rejects(driver.start(repositoryRoot, "switchyard-synthetic", "personal"), (e) => e.createdThreadId === "synthetic-created");
    if (settings.badPermissions) assert.equal(frames.some((m) => m.method === "thread/inject_items"), false);
  }, settings);
});
test("Windows service composition retains durable duplicate prevention, exact ownership and honest capabilities", () => fixture(async ({ repositoryRoot, store, driver, frames }) => {
  const service = createCodingSessions({ store, platform: "win32", daemon: driver, resolveCli: async () => process.execPath });
  assert.equal((await service.discovery("personal")).adapter.id, "switchyard.codex-stdio");
  const request = { requestId: randomUUID(), repositoryRoot, label: "Synthetic owned task" };
  const [created, duplicate] = await Promise.all([service.create("personal", request), service.create("personal", request)]);
  assert.equal(created.sessionId ?? duplicate.sessionId, "synthetic-created"); assert.equal([created, duplicate].filter((r) => r.duplicatePrevented).length, 1);
  assert.equal(frames.filter((m) => m.method === "thread/start").length, 1);
  const resumed = await service.resume("personal", request.requestId); assert.equal(resumed.capabilities.mediated, false); assert.equal(resumed.windowFocusVerified, false); assert.equal(resumed.modelPromptSubmitted, false);
  const count = frames.length; assert.equal((await service.discovery("company")).permitted, false); assert.equal(frames.length, count);
  assert.equal((await service.stopCompartment("personal")).stopped, true);
}));
test("mode-off during startup prevents a late native spawn and permits a later deliberate reconnection", () => fixture(async ({ driver, store, options, children }) => {
  let entered, release; const gate = new Promise((r) => { release = r; }), ready = new Promise((r) => { entered = r; });
  const guarded = createCodexStdioTasks({ ...options, resolveMcp: async () => { entered(); await gate; return []; } });
  try {
    const pending = guarded.list("personal"); await ready;
    await store.update("personal", "synthetic-off", (s) => { s.mode = "keyboard-only"; });
    const stopping = guarded.stopCompartment("personal"); release(); await assert.rejects(pending, /stopped|Keyboard-only/); assert.equal((await stopping).stopped, true); assert.equal(children.length, 0);
    await store.update("personal", "synthetic-on", (s) => { s.mode = "personal-companion"; });
    assert.equal((await guarded.list("personal")).length, 1);
  } finally { await guarded.close(); }
}));
test("mode-off after a returned create retains its exact identity for recovery without routing further content", () => fixture(async ({ repositoryRoot, store, driver, frames }) => {
  const wrapped = { ...driver, start: async (...args) => { const r = await driver.start(...args); await store.update("personal", "synthetic-off", (s) => { s.mode = "keyboard-only"; }); return r; } };
  const service = createCodingSessions({ store, platform: "win32", daemon: wrapped, resolveCli: async () => process.execPath }), requestId = randomUUID();
  await assert.rejects(service.create("personal", { requestId, repositoryRoot, label: "Pending identity" }), /uncertain/);
  const task = (await store.snapshot("personal")).codingSessions[0]; assert.equal(task.sessionId, "synthetic-created"); assert.equal(task.status, "creation-uncertain");
  assert.equal(frames.filter((m) => m.method === "thread/start").length, 1);
  await assert.rejects(service.create("personal", { requestId, repositoryRoot, label: "Pending identity" }), /Keyboard-only/);
}));
test("an unconfirmed owned-process exit blocks replacement without closing an unrelated compartment", () => fixture(async ({ options }) => {
  let starts = 0;
  const stopped = new Set(), owned = [];
  const driver = createCodexStdioTasks({ ...options, clientFactory: () => { const child = {}; owned.push(child); starts++; return { child, closed: false, initialize: async () => {}, request: async () => ({ data: [] }), close() { this.closed = true; } }; }, stopChild: async (child) => ({ stopped: stopped.has(child) }) });
  try {
    await options.store.initialize("other-client"); await options.store.update("other-client", "synthetic-mode", (s) => { s.mode = "personal-companion"; });
    await driver.list("personal"); await driver.list("other-client"); assert.equal((await driver.stopCompartment("personal")).stopped, false);
    await assert.rejects(driver.list("personal"), /No replacement/); await driver.list("other-client"); assert.equal(starts, 2);
    stopped.add(owned[0]); assert.equal((await driver.stopCompartment("personal")).stopped, true);
    await driver.list("personal"); assert.equal(starts, 3);
  } finally { owned.forEach((c) => stopped.add(c)); await driver.close(); }
}));
