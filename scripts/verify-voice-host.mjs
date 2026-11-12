#!/usr/bin/env node
/** Explicit synthetic-audio acceptance. Never opens a microphone or plays audio. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { runtimeDirectory } from "../tools/layout-studio/physical-intent.mjs";

if (process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage: node scripts/verify-voice-host.mjs --synthetic (local speech synthesis, real CPU transcription, correction continuity and owned-parent-loss verification; no microphone)");
if (process.platform !== "linux") throw new Error("This synthetic acceptance currently uses Linux espeak-ng and /proc. Native Windows acceptance remains pending.");
const temporary = await mkdtemp(join(tmpdir(), "switchyard-voice-host-")), results = [], compartment = "host-validation";
const endpoint = JSON.parse(await privateRead(join(runtimeDirectory(), "active.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
if (!token || url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Start the private local suite first.");
let failure, enabled = false, session;
async function api(path, body = {}) {
  const r = await fetch(new URL(path, url.origin), { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify({ compartment, ...body }), signal: AbortSignal.timeout(110000) });
  const value = await r.json(); if (!r.ok) throw new Error(value.error); return value;
}
async function synthesize(path) {
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/espeak-ng", ["-s", "175", "-w", path, "Keep the same task."], { shell: false, stdio: "ignore" });
    child.once("error", reject); child.once("close", (code) => code === 0 ? resolve() : reject(new Error("Synthetic speech generation failed.")));
  });
}
async function parentLoss(audio) {
  const voiceModule = new URL("../tools/layout-studio/voice.mjs", import.meta.url).href;
  // The Python worker inherits FD 3, so the parent's stdout cannot close until
  // BOTH processes exit. This proves owner EOF, rather than guessing from PIDs.
  const program = `import {spawn} from 'node:child_process'; import {localVoice} from ${JSON.stringify(voiceModule)}; const v=localVoice({spawnProcess:(exe,args,options)=>{ const c=spawn(exe,args,{...options,stdio:['pipe','pipe','ignore',1]}); console.log(JSON.stringify({worker:c.pid})); return c; }}); let audio=''; process.stdin.on('data',b=>{audio+=b; if(audio.length>240000)process.exit(1);}); process.stdin.once('end',async()=>{try{await v.transcribe(audio,{sessionId:'synthetic-parent-loss'}); console.log('EARLY_RESULT');}catch{} });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", program], { cwd: fileURLToPath(new URL("../", import.meta.url)), shell: false, stdio: ["pipe", "pipe", "ignore"] });
  let worker, output = "", closed = false, identity;
  const ended = new Promise((resolve) => child.once("close", () => { closed = true; resolve(); }));
  child.stdout.on("data", (b) => { output += b; if (output.length > 1024) child.kill("SIGKILL"); });
  child.stdin.end(audio);
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !closed) {
      const match = /\{"worker":(\d+)\}/.exec(output); if (match) { worker = Number(match[1]); break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(worker, "The owned Python worker did not start.");
    await new Promise((r) => setTimeout(r, 250));
    const command = await readFile(`/proc/${worker}/cmdline`, "utf8"); assert.ok(command.includes("transcribe.py")); assert.equal(output.includes("EARLY_RESULT"), false);
    identity = { command, started: (await readFile(`/proc/${worker}/stat`, "utf8")).split(") ")[1].split(" ")[19] };
    const at = Date.now(); child.kill("SIGKILL");
    let timer; try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The Python worker retained its inherited pipe after its owner exited.")), 5000); })]); } finally { clearTimeout(timer); }
    return { scenario: "actual-python-owner-loss", workerObservedBeforeOwnerExit: true, inheritedWorkerPipeClosed: true, exitMs: Date.now() - at };
  } finally {
    if (!closed) child.kill("SIGKILL");
    if (identity && worker) try { const cmd = await readFile(`/proc/${worker}/cmdline`, "utf8"), started = (await readFile(`/proc/${worker}/stat`, "utf8")).split(") ")[1].split(" ")[19]; if (cmd === identity.command && started === identity.started) process.kill(worker, "SIGKILL"); } catch (e) { if (e.code !== "ENOENT" && e.code !== "ESRCH") throw e; }
  }
}
try {
  const wav = join(temporary, "synthetic.wav"); await synthesize(wav); const audio = (await readFile(wav)).toString("base64"); assert.ok(audio.length <= 240000);
  await api("/api/suite/bootstrap"); await api("/api/suite/compartment/create", { policy: "personal" }); enabled = true;
  await api("/api/suite/mode", { mode: "personal-companion" });
  session = await api("/api/suite/voice/start", { consent: true });
  const body = { id: session.id, chunkId: randomUUID(), audio }, segments = await Promise.all([api("/api/suite/voice/segment", body), api("/api/suite/voice/segment", body)]);
  assert.ok(segments.every((r) => typeof r.text === "string" && r.text.trim().length > 0)); assert.equal(segments.filter((r) => r.duplicate).length, 1);
  assert.equal(segments[0].transcript, segments[1].transcript);
  await api("/api/suite/voice/review", { id: session.id, transcript: "Corrected synthetic decision." });
  const next = await api("/api/suite/voice/segment", { ...body, chunkId: randomUUID() });
  assert.ok(next.transcript.startsWith("Corrected synthetic decision.\n\n"));
  const snapshot = await api("/api/suite/snapshot"), saved = snapshot.voice.find((v) => v.id === session.id);
  assert.equal(saved.chunks.length, 2); assert.equal(saved.chunks.every((c) => !c.pendingAudio && c.status === "transcribed"), true); assert.equal(saved.reviewStatus, "needs-review");
  results.push({ scenario: "actual-cpu-http", chunks: 2, duplicatePrevented: true, audioRemovedAfterSuccess: true, correctedPrefixRetained: true, laterSegmentNeedsReview: true, recognitionAccuracy: "synthetic speech produced text; no accuracy score asserted" });
  results.push(await parentLoss(audio));
} catch (e) { failure = e; }
finally {
  if (session) try { await api("/api/suite/voice/state", { id: session.id, status: "stopped" }); await api("/api/suite/voice/delete", { id: session.id }); } catch (e) { failure ??= e; }
  if (enabled) try { assert.equal((await api("/api/suite/mode", { mode: "keyboard-only" })).ownedProcessesStopped, true); } catch (e) { failure ??= e; }
  await rm(temporary, { recursive: true, force: true });
  const evidence = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `voice-${Date.now()}.json`);
  await privateWrite(evidence, JSON.stringify({ at: new Date().toISOString(), results, failure: failure?.message ?? null, temporaryAudioRemoved: true, microphoneOpened: false, externalTranscription: false, uiAccepted: false }, null, 2) + "\n");
  console.log(JSON.stringify({ evidence, scenarios: results.length, failure: failure?.message ?? null, microphoneOpened: false, temporaryAudioRemoved: true }));
}
if (failure) throw failure;
