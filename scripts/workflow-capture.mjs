#!/usr/bin/env node
/** Local, content-free baseline observations before the B122 arrives. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const kinds = ["resume", "switch", "handoff", "status", "review", "approval", "run", "failure", "recovery", "other"];
const surfaces = ["codex", "claude", "chatgpt", "vscode", "terminal", "browser", "system", "other"];
const methods = ["keyboard", "mouse", "palette", "command", "automatic", "mixed"];
const outcomes = ["success", "retry", "blocked", "unknown"];
const evidenceLevels = ["provider", "companion", "user", "none"];
const maxRecordBytes = 2048;
const maxLogBytes = 10 * 1024 * 1024;
const stateRoot = process.env.SXSY_WORKFLOW_STUDY_DIR || join(
  platform() === "win32"
    ? absoluteOr(process.env.LOCALAPPDATA, join(homedir(), "AppData", "Local"))
    : absoluteOr(process.env.XDG_STATE_HOME, join(homedir(), ".local", "state")),
  "strathex-switchyard", "workflow-study"
);
if (!isAbsolute(stateRoot)) throw new Error("Workflow study directory must be an absolute path.");
const activePath = join(stateRoot, "active.json");
const eventsPath = join(stateRoot, "events.jsonl");

function absoluteOr(value, fallback) { return value && isAbsolute(value) ? value : fallback; }
function usage() {
  return `Usage:
  node scripts/workflow-capture.mjs start linux|windows [task-alias]
  node scripts/workflow-capture.mjs event KIND SURFACE METHOD OUTCOME DURATION_MS FRICTION EVIDENCE
  node scripts/workflow-capture.mjs end
  node scripts/workflow-capture.mjs toggle
  node scripts/workflow-capture.mjs status
  node scripts/workflow-capture.mjs path
  node scripts/workflow-capture.mjs report

KIND: ${kinds.join("| ")}
SURFACE: ${surfaces.join("| ")}
METHOD: ${methods.join("| ")}
OUTCOME: ${outcomes.join("| ")}
EVIDENCE: ${evidenceLevels.join("| ")}
Task aliases are local labels of 1-32 letters, digits, underscores, or hyphens. No prompts, paths, titles, or credentials are accepted.`;
}
function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  return value;
}
function integer(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  return parsed;
}
async function ensureStateRoot() {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const identity = await lstat(stateRoot);
  if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error("Workflow state directory must be a real directory.");
  if (platform() !== "win32" && (identity.mode & 0o077) !== 0) throw new Error("Workflow state directory must be private (mode 0700).");
}
async function readActive() {
  let handle;
  try {
    handle = await open(activePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    await assertPrivateFile(handle);
    const value = JSON.parse(await handle.readFile("utf8"));
    if (value?.schema !== "sxsy.workflow-study.session" || value.version !== 1 || typeof value.id !== "string") throw new Error("Active workflow session is malformed.");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("No workflow session is active. Run start first.");
    throw error;
  } finally { await handle?.close(); }
}
async function append(record) {
  const line = `${JSON.stringify(record)}\n`;
  const bytes = Buffer.byteLength(line);
  if (bytes > maxRecordBytes) throw new Error("Workflow record exceeds the bounded event size.");
  const handle = await open(eventsPath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await assertPrivateFile(handle);
    const reserveForEnd = record.type === "end" ? 0 : maxRecordBytes;
    if ((await handle.stat()).size + bytes + reserveForEnd > maxLogBytes) {
      throw new Error("Workflow log reached its 10 MiB cap. Preserve or move events.jsonl before recording more sessions.");
    }
    await handle.writeFile(line);
  } finally { await handle.close(); }
}
async function assertPrivateFile(handle) {
  const identity = await handle.stat();
  if (!identity.isFile() || (platform() !== "win32" && (identity.mode & 0o077) !== 0)) throw new Error("Workflow state file must be a private regular file (mode 0600).");
}
async function start(args) {
  if (args.length < 1 || args.length > 2) throw new Error(usage());
  const machine = oneOf(args[0], ["linux", "windows"], "Machine");
  const alias = args[1];
  if (alias && !/^[A-Za-z0-9_-]{1,32}$/.test(alias)) throw new Error("Task alias must contain 1-32 letters, digits, underscores, or hyphens.");
  await ensureStateRoot();
  const session = { schema: "sxsy.workflow-study.session", version: 1, id: randomUUID(), machine, ...(alias ? { taskAlias: alias } : {}), startedAt: new Date().toISOString() };
  const handle = await open(activePath, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(session)}\n`); } finally { await handle.close(); }
  try { await append({ type: "start", ...session }); }
  catch (error) { await rm(activePath, { force: true }); throw error; }
  process.stdout.write(`Started local workflow session ${session.id}\n`);
}
async function event(args) {
  if (args.length !== 7) throw new Error(usage());
  const [kind, surface, method, outcome, duration, friction, evidence] = args;
  const record = {
    type: "event", version: 1, sessionId: (await readActive()).id, at: new Date().toISOString(),
    kind: oneOf(kind, kinds, "Kind"), surface: oneOf(surface, surfaces, "Surface"),
    method: oneOf(method, methods, "Method"), outcome: oneOf(outcome, outcomes, "Outcome"),
    durationMs: integer(duration, 0, 3_600_000, "Duration"), friction: integer(friction, 1, 5, "Friction"),
    evidence: oneOf(evidence, evidenceLevels, "Evidence")
  };
  await append(record);
  process.stdout.write(`Recorded ${record.kind} (${record.outcome}); evidence: ${record.evidence}.\n`);
}
export async function recordFocus(surface, durationMs) {
  const record = {
    type: "focus", version: 1, sessionId: (await readActive()).id, at: new Date().toISOString(),
    surface: oneOf(surface, surfaces, "Surface"), durationMs: integer(durationMs, 0, 60_000, "Focus duration")
  };
  await append(record);
}
async function end() {
  const session = await readActive();
  await append({ type: "end", version: 1, sessionId: session.id, at: new Date().toISOString() });
  await rm(activePath);
  process.stdout.write(`Ended local workflow session ${session.id}\n`);
}
async function toggle() {
  try { await readActive(); }
  catch (error) {
    if (error?.message?.startsWith("No workflow session")) { await start(["linux"]); return; }
    throw error;
  }
  await end();
}
async function status() {
  try {
    const session = await readActive();
    process.stdout.write(`Active: ${session.id} | ${session.machine} | ${session.taskAlias ?? "unlabelled"} | since ${session.startedAt}\n`);
  } catch (error) {
    if (error?.message?.startsWith("No workflow session")) process.stdout.write("No workflow session is active.\n");
    else throw error;
  }
}
async function path() {
  let bytes = 0;
  try {
    const identity = await lstat(eventsPath);
    if (!identity.isFile() || identity.isSymbolicLink()) throw new Error("Workflow log is not a regular file.");
    bytes = identity.size;
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  process.stdout.write(`Directory: ${stateRoot}\nLog: ${eventsPath}\nSize: ${bytes} / ${maxLogBytes} bytes\n`);
}
async function report() {
  await ensureStateRoot();
  let content;
  let handle;
  try {
    handle = await open(eventsPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    await assertPrivateFile(handle);
    if ((await handle.stat()).size > maxLogBytes) throw new Error("Workflow log exceeds the 10 MiB report limit; archive it before continuing.");
    content = await handle.readFile("utf8");
  }
  catch (error) { if (error?.code === "ENOENT") { process.stdout.write("No workflow observations recorded.\n"); return; } throw error; }
  finally { await handle?.close(); }
  const records = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const starts = records.filter((record) => record.type === "start");
  const ends = new Set(records.filter((record) => record.type === "end").map((record) => record.sessionId));
  const observations = records.filter((record) => record.type === "event");
  const focus = records.filter((record) => record.type === "focus");
  const summary = { sessionsStarted: starts.length, sessionsCompleted: starts.filter((record) => ends.has(record.id)).length, events: observations.length, focusIntervals: focus.length, focusDurationMs: {}, byKind: {} };
  for (const surface of surfaces) {
    const duration = focus.filter((record) => record.surface === surface).reduce((sum, record) => sum + record.durationMs, 0);
    if (duration) summary.focusDurationMs[surface] = duration;
  }
  for (const kind of kinds) {
    const entries = observations.filter((record) => record.kind === kind);
    if (entries.length) summary.byKind[kind] = { count: entries.length, retriesOrBlocked: entries.filter((record) => record.outcome === "retry" || record.outcome === "blocked").length, totalDurationMs: entries.reduce((sum, record) => sum + record.durationMs, 0), averageFriction: Number((entries.reduce((sum, record) => sum + record.friction, 0) / entries.length).toFixed(1)) };
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const [command, ...args] = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) try {
  if (!command || command === "help" || command === "--help") process.stdout.write(`${usage()}\n`);
  else if (command === "start") await start(args);
  else if (command === "event") await event(args);
  else if (command === "end" && args.length === 0) await end();
  else if (command === "toggle" && args.length === 0) await toggle();
  else if (command === "status" && args.length === 0) await status();
  else if (command === "path" && args.length === 0) await path();
  else if (command === "report" && args.length === 0) await report();
  else throw new Error(usage());
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
