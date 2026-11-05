#!/usr/bin/env node
/** Installed exact-pane trial: one empty restricted Claude CLI, zero prompts. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, lstat, unlink, rmdir, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { applicationStatus, applicationStateRoot } from "../deployment/suite/application.mjs";
import { installationRoot } from "../deployment/suite/installation.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { endpointIdentity, requestInstance } from "../tools/layout-studio/instance.mjs";
import { linuxProcess } from "../tools/layout-studio/native-process.mjs";
import { runHypr } from "../tools/layout-studio/host.mjs";
import { trustedCli } from "../tools/layout-studio/agents.mjs";
import { desktopEnvironment } from "../tools/layout-studio/process-environment.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";

const flags = process.argv.slice(2), inputRoot = flags[1]?.slice(13);
if (process.platform !== "linux" || flags.length !== 2 || flags[0] !== "--synthetic" || !flags[1].startsWith("--repository=") || !isAbsolute(inputRoot ?? "")) throw Error("Use on the pilot: node scripts/verify-tmux-focus-host.mjs --synthetic --repository=/absolute/trusted/git/repository. Opens and closes one empty restricted Claude session; no prompt or terminal text is submitted.");
const repositoryRoot = await realpath(inputRoot), installed = await applicationStatus(); assert.equal(installed.status, "ready");
const endpointPath = join(applicationStateRoot(), "endpoint.json"), endpointBefore = await privateRead(endpointPath), endpoint = JSON.parse(endpointBefore), binding = endpointIdentity(endpoint);
const current = async () => { assert.equal(await privateRead(endpointPath), endpointBefore); assert.equal((await requestInstance(endpoint)).authenticated, true); };
await current();
const execute = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex"), definitions = state => hash(JSON.stringify([state.profile, state.workflow, state.roleBindings ?? [], state.mode]));
const checks = [], evidence = { schema: "switchyard-installed-tmux-focus/v1", at: new Date().toISOString(), applicationRelease: installed.build, checks, modelPromptsSubmitted: 0, keyboardOpened: false, microphoneOpened: false, frontendChanged: false, userTerminalConfigurationChanged: false, taskResumptionAccepted: false };
async function api(path, body = {}, expected = 200, authenticated = true) {
  await current(); const response = await fetch(new URL("/api/suite/" + path, binding.url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: binding.url.origin, ...(authenticated ? { Authorization: "Bearer " + binding.token } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const bytes = await response.text(); assert.ok(Buffer.byteLength(bytes) <= 1048576); const value = JSON.parse(bytes);
  if (response.status !== expected) evidence.refusal = { status: response.status, expected, message: typeof value.error === "string" ? value.error.replaceAll(binding.url.origin, "[application]").replaceAll(binding.token, "[redacted]").replaceAll(repositoryRoot, "[repository]").slice(0, 256) : "Unknown refusal" };
  assert.equal(response.status, expected, "The fixed installed tmux request was refused."); return value;
}
const store = createSuiteStore(), selected = await store.selection(), personal = definitions(await store.snapshot("personal")), compartment = "tmux-validation-" + randomUUID().slice(0, 8), sessionId = randomUUID();
const originalWindow = JSON.parse(await runHypr("activewindow", "-j")), originalProcess = originalWindow.pid ? await linuxProcess(originalWindow.pid) : null;
evidence.syntheticNativeSessionId = sessionId; evidence.originalSelection = selected; evidence.validationCompartment = compartment;
const units = [], beforeProcesses = new Map(); let stage = "installed-source-binding", baseline, root, rootIdentity, socket, socketIdentity, nativeTask, failure;
const command = async (exe, args) => (await execute(exe, args, { timeout: 15000, maxBuffer: 65536, encoding: "utf8" })).stdout;
const tmux = async (...args) => command("/usr/bin/tmux", ["-N", "-S", socket, ...args]);
async function startUnit(name, args) {
  await command("/usr/bin/systemd-run", ["--user", "--expand-environment=no", "--unit=" + name, "--collect", "--property=KillMode=control-group", "--property=RuntimeMaxSec=300", "/usr/bin/env", "-i", ...Object.entries({ ...desktopEnvironment(), DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }).map(([key,value]) => key + "=" + value), ...args]);
  units.push(name);
}
async function remember(pid) { const row = await linuxProcess(pid); beforeProcesses.set(pid, row.startTicks); evidence.ownedProcesses = [...beforeProcesses].map(([pid,startTicks]) => ({pid,startTicks})); return row; }
try {
  for (const path of ["tools/layout-studio/task-window.mjs", "tools/layout-studio/tmux-task-window.mjs", "tools/layout-studio/native-process.mjs", "tools/layout-studio/claude-coding.mjs", "tools/layout-studio/suite-store.mjs"]) assert.equal(hash(await readFile(join(installationRoot(), "versions", installed.build, path))), hash(await readFile(new URL("../" + path, import.meta.url))));
  checks.push("normal installed release contains the exact pane, provider and state source"); stage = "original-workspace-preflight";
  const retained = new Map(); function collect(value) { if (!value || typeof value !== "object") return; if (value.ownedRuntime?.schema === "switchyard-runtime-command/v1") retained.set(value.ownedRuntime.id,value.ownedRuntime); for (const child of Object.values(value)) collect(child); } collect(await store.snapshot(selected)); for (const guardian of retained.values()) assert.equal(await runtimeGuardianStopped(guardian),true,"Preserve an existing owned native task");
  const active = await api("snapshot", { compartment: selected }); assert.equal(active.policy, "personal"); assert.equal(active.observations.some(row => row.status === "recording") || active.voice.some(row => row.status === "recording") || active.conversations.some(row => row.status === "pending") || (active.codingTurns ?? []).some(row => ["submitting", "submitted", "cancellation-requested"].includes(row.status)), false);
  stage = "empty-validation-workspace"; await api("compartment/create", { compartment, policy: "personal" }); const candidate = await store.snapshot(compartment); assert.equal(candidate.mode, "keyboard-only"); assert.equal(candidate.profile, null); for (const key of ["codingSessions", "codingTurns", "roleBindings", "conversations", "observations", "voice"]) assert.equal((candidate[key] ?? []).length, 0); baseline = candidate;
  await api("coding/claude/focus", { compartment, id: randomUUID() }, 401, false); await api("compartment/select", { compartment }); await api("mode", { compartment, mode: "personal-companion" });
  stage = "native-account-discovery"; const discovery = await api("coding/claude/discovery", { compartment }); assert.equal(discovery.available, true); assert.ok(discovery.terminalFocus.multiplexers.includes("tmux")); checks.push("native supported Claude account and protected installed tmux capability verified without a model prompt");
  stage = "owned-private-server"; root = await mkdtemp(join(homedir(), ".cache/sx-tmux-installed-")); rootIdentity = await lstat(root); socket = join(root, "socket");
  await startUnit("switchyard-tmux-server-" + randomUUID().replaceAll("-", "") + ".service", ["/usr/bin/tmux", "-D", "-f", "/dev/null", "-S", socket]);
  for (let tries = 0; tries < 50; tries++) { try { socketIdentity = await lstat(socket); break; } catch (error) { if (error.code !== "ENOENT") throw error; } await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.ok(socketIdentity?.isSocket()); await tmux("new-session", "-d", "-s", "switchyard-validation", "-c", root, "/usr/bin/sleep", "300");
  const serverPid = Number((await tmux("display-message", "-p", "-t", "%0", "#{pid}")).trim()); await remember(serverPid);
  await tmux("set-option", "-g", "remain-on-exit", "on");
  const executable = await trustedCli("claude-code");
  const cliRootPid = Number((await tmux("new-window", "-d", "-P", "-F", "#{pane_pid}", "-t", "$0", "-c", repositoryRoot, executable, "--session-id", sessionId, "--safe-mode", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--settings", '{"disableAllHooks":true}', "--permission-mode", "plan", "--no-chrome")).trim());
  try { await remember(cliRootPid); } catch (error) { if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error; }
  await startUnit("switchyard-tmux-terminal-" + randomUUID().replaceAll("-", "") + ".service", ["/usr/bin/foot", "--app-id=switchyard-installed-tmux-validation", "--title=Switchyard empty task navigation", "/usr/bin/tmux", "-N", "-S", socket, "attach-session", "-E", "-t", "$0"]);
  stage = "exact-native-inventory"; const deadline = Date.now() + 45000; let row;
  while (Date.now() < deadline) {
    try { row = (await api("coding/claude/inventory", { compartment, repositoryRoot })).find(item => item.sessionId === sessionId && item.kind === "interactive" && item.pid); }
    catch (error) { if (evidence.refusal?.message?.includes("not-yet-verified")) { delete evidence.refusal; } else throw error; }
    if (row) break;
    const welcome=await tmux("capture-pane","-p","-t","%1","-S","-20");
    if (/trust this|trust.*folder|workspace not trusted/i.test(welcome)) { evidence.blockedCheck={kind:"native-workspace-trust",accountAvailable:true,trustApprovalSent:false,outputSha256:hash(welcome)}; throw Error("The native workspace trust dialog needs deliberate owner review; no approval was injected."); }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!row) {
    const metadata=(await tmux("display-message","-p","-t","%1","#{pane_dead}\t#{pane_dead_status}\t#{pane_pid}")).trim().split("\t"); evidence.startup={dead:metadata[0]==="1",exitCode:/^\d{1,3}$/.test(metadata[1])?Number(metadata[1]):null};
    const output=await tmux("capture-pane","-p","-t","%1","-S","-20"); evidence.startup.outputSha256=hash(output); evidence.startup.unsupportedFlag=/unknown option|unrecognized option|unexpected argument/i.test(output); evidence.startup.workspaceTrustRequested=/trust this|trust.*folder|workspace not trusted/i.test(output); evidence.startup.nestedSessionRefused=/nested.*session|inside another Claude|CLAUDECODE/i.test(output);
  }
  assert.ok(row, "The exact empty native session did not become identifiable; no task was guessed."); await remember(row.pid);
  stage = "exact-native-binding"; nativeTask = await api("coding/claude/bind", { compartment, sessionId, repositoryRoot, label: "Empty native tmux navigation acceptance" }); assert.equal(nativeTask.sessionId, sessionId);
  stage = "installed-pane-and-window-focus";
  for (let index = 0; index < 2; index++) { const focused = await api("coding/claude/focus", { compartment, id: nativeTask.id }); assert.equal(focused.sessionId, sessionId); assert.equal(focused.terminalKind, "foot+tmux"); assert.equal(focused.paneFocusVerified, true); assert.equal(focused.windowFocusVerified, true); assert.equal(focused.modelPromptSubmitted, false); assert.equal(focused.taskResumptionVerified, false); }
  checks.push("normal installed API binds and repeatedly selects/focuses the same real empty Claude session and exact tmux pane without terminal text");
  assert.equal((await tmux("display-message", "-p", "-t", "$0", "#{pane_id}")).trim(), "%1"); evidence.registeredClaudeAccountAccepted = true; evidence.sameSessionRepeated = true;
} catch (error) { failure = error; evidence.failure = { phase: stage, category: error.name }; }
finally {
  const cleanupFailures=[];
  const safely=async(phase,fn)=>{try{await fn();return true;}catch(error){failure??=error;cleanupFailures.push({phase,category:error.name});return false;}};
  for(const unit of units) await safely("owned-process-capture",async()=>{
    const group=(await command("/usr/bin/systemctl",["--user","show","--property=ControlGroup","--value",unit])).trim();
    if(!group)return;assert.ok(group.startsWith("/user.slice/")&&group.endsWith("/"+unit));
    for(const entry of(await readFile("/sys/fs/cgroup"+group+"/cgroup.procs","utf8")).split(/\s+/).filter(Boolean)){try{await remember(Number(entry));}catch(error){if(error.code!=="ENOENT"&&error.code!=="ESRCH")throw error;}}
  });
  for(const unit of units.toReversed())await safely("owned-unit-stop",()=>command("/usr/bin/systemctl",["--user","stop",unit]));
  const retired=await safely("owned-process-exit",async()=>{
    for(const[pid,birth]of beforeProcesses){
      let exited=false;const deadline=Date.now()+5000;
      while(Date.now()<deadline){try{const current=await linuxProcess(pid);if(current.startTicks!==birth||current.state==="Z"){exited=true;break;}}catch(error){if(error.code==="ENOENT"||error.code==="ESRCH"){exited=true;break;}throw error;}await new Promise(resolve=>setTimeout(resolve,50));}
      assert.equal(exited,true,"An exact owned fixture process has not verified exit.");
    }
    evidence.ownedProcessExitsVerified=beforeProcesses.size;
  });
  if(baseline)await safely("workspace-restoration",async()=>{
    await api("mode",{compartment,mode:"keyboard-only"});if(await store.selection()===compartment)await api("compartment/select",{compartment:selected});
    assert.equal(await store.selection(),selected);assert.equal(definitions(await store.snapshot("personal")),personal);assert.equal(definitions(await store.snapshot(compartment)),definitions(baseline));await current();evidence.validationRestored=true;
  });
  if(originalProcess)await safely("original-focus-restoration",async()=>{
    assert.equal((await linuxProcess(originalProcess.pid)).startTicks,originalProcess.startTicks);const windows=JSON.parse(await runHypr("clients","-j"));assert.ok(windows.some(window=>window.address===originalWindow.address&&window.pid===originalWindow.pid));
    assert.equal((await runHypr("dispatch",`hl.dsp.focus({ window = "address:${originalWindow.address}" })`)).trim(),"ok");const after=JSON.parse(await runHypr("activewindow","-j"));assert.equal(after.address,originalWindow.address);assert.equal(after.pid,originalWindow.pid);evidence.originalFocusRestored=true;
  });
  if(root&&retired)await safely("owned-socket-retirement",async()=>{
    const directory=await lstat(root);assert.equal(directory.dev,rootIdentity.dev);assert.equal(directory.ino,rootIdentity.ino);
    if(socketIdentity){try{const current=await lstat(socket);assert.equal(current.dev,socketIdentity.dev);assert.equal(current.ino,socketIdentity.ino);await unlink(socket);}catch(error){if(error.code!=="ENOENT")throw error;}}
    assert.equal((await readdir(root)).length,0);await rmdir(root);evidence.ownedSocketAndDirectoryRemoved=true;
  });
  await safely("installed-frontend-restoration",async()=>{await current();const home=await fetch(binding.url.origin,{redirect:"error",signal:AbortSignal.timeout(15000)});evidence.homeSha256=hash(await home.text());assert.equal(evidence.homeSha256,"20ba0095a6b9650046df34541872aa7e0a7cdc7db5182f065abb009127c6c130");assert.equal((await applicationStatus()).build,installed.build);});
  if(cleanupFailures.length)evidence.cleanupFailures=cleanupFailures;
}
evidence.success = !failure; const name = "installed-tmux-focus-" + Date.now() + ".json"; await privateWrite(join(homedir(), ".local/state/strathex-switchyard/runtime-verification", name), JSON.stringify(evidence, null, 2) + "\n"); console.log(JSON.stringify({ success: evidence.success, receipt: name, checks: checks.length, phase: evidence.failure?.phase ?? null, blockedCheck:evidence.blockedCheck?.kind??null, restored: evidence.validationRestored ?? false, ownedRemoved: evidence.ownedSocketAndDirectoryRemoved ?? false, modelPromptsSubmitted: 0 })); if (failure) process.exitCode = 1;
