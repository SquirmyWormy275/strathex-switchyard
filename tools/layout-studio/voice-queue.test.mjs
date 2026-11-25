import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "./suite-store.mjs";
import { createVoiceQueue, reviewTranscript } from "./voice-queue.mjs";

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "switchyard-voice-queue-")), keys = new Map();
  const store = createSuiteStore({ root, secrets: { get: async (c, p) => keys.get(`${c}:${p}`), set: async (c, p, v) => { keys.set(`${c}:${p}`, v); } } });
  await store.initialize("personal"); await store.update("personal", "mode-select", (s) => { s.mode = "personal-companion"; s.voice.push({ id: "voice", status: "recording", chunks: [], transcript: "", reviewedTranscript: "", updatedAt: Date.now() }); });
  const queues = [], make = (voice, options = {}) => { const q = createVoiceQueue({ store, voice, ...options }); queues.push(q); return q; };
  try { await fn({ root, store, make }); } finally { await Promise.all(queues.map((q) => q.close())); await rm(root, { recursive: true, force: true }); }
}
const body = (chunkId = "one", audio = "U3ludGhldGlj") => ({ id: "voice", chunkId, audio });
const gate = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function until(fn) { const deadline = Date.now() + 5000; while (Date.now() < deadline) { const r = await fn(); if (r) return r; await new Promise((r) => setTimeout(r, 10)); } throw new Error("The expected bounded voice state did not appear"); }

test("simultaneous duplicates share transcription and a reused chunk ID cannot replace different audio", () => fixture(async ({ make, store, root }) => {
  const wait = gate(), started = gate(); let calls = 0;
  const q = make({ transcribe: async () => { calls++; started.resolve(); await wait.promise; return { text: "raw synthetic text" }; } });
  const first = q.segment("personal", body()), second = q.segment("personal", body());
  try { await started.promise; await assert.rejects(q.segment("personal", body("one", "T3RoZXI=")), /different audio/); assert.equal(calls, 1); }
  finally { wait.resolve(); }
  const result = await Promise.all([first, second]); assert.ok(result.every((r) => r.transcript === "raw synthetic text")); assert.equal(calls, 1);
  assert.equal((await q.segment("personal", body())).duplicate, true);
  assert.equal((await store.snapshot("personal")).voice[0].chunks[0].audio, null);
  const sealed = await readFile(join(root, "personal.sealed.json"), "utf8"); assert.equal(sealed.includes("U3ludGhldGlj"), false); assert.equal(sealed.includes("raw synthetic text"), false);
}));

test("independent queue instances use one shared CPU lease and re-read a completed chunk after acquisition", () => fixture(async ({ make, root }) => {
  const wait = gate(), started = gate(); let calls = 0, active = 0, maximum = 0;
  const voice = { transcribe: async () => { calls++; maximum = Math.max(maximum, ++active); started.resolve(); await wait.promise; active--; return { text: "one exact result" }; } };
  const a = make(voice), b = make(voice), first = a.segment("personal", body()), second = b.segment("personal", body());
  await started.promise; wait.resolve(); const result = await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(maximum, 1); assert.equal(result.filter((r) => r.duplicate).length, 1);
  assert.equal((await readdir(join(root, "locks"))).filter((p) => p.startsWith("voice-cpu-")).length, 1, "long sessions must not create a lock file for every segment");
}));

test("bounded queue saves overflow audio for retry, runs one worker, and preserves reviewed corrections as later segments arrive", () => fixture(async ({ make, store }) => {
  const wait = gate(), started = gate(); let calls = 0;
  const q = make({ transcribe: async () => { calls++; started.resolve(); await wait.promise; return { text: calls === 1 ? "incorrect first" : "new raw segment" }; } }, { maxPending: 1 });
  const first = q.segment("personal", body()); await started.promise;
  await assert.rejects(q.segment("personal", body("two")), /queue is full/);
  assert.equal((await store.snapshot("personal")).voice[0].chunks[1].status, "pending"); wait.resolve(); await first;
  await store.update("personal", "voice-review", (s) => reviewTranscript(s.voice[0], "Corrected first decision."));
  const second = await q.segment("personal", body("two")); assert.equal(second.transcript, "Corrected first decision.\n\nnew raw segment");
  const v = (await store.snapshot("personal")).voice[0]; assert.equal(v.reviewCheckpoint.text, "Corrected first decision."); assert.equal(v.reviewedTranscript, ""); assert.equal(v.reviewStatus, "needs-review");
  await store.update("personal", "voice-review", (s) => reviewTranscript(s.voice[0], ""));
  assert.equal((await q.segment("personal", body("two"))).transcript, "", "an intentionally empty correction must not restore raw text");
}));

test("a stopped request cannot resume itself after mode re-enable and failed audio remains available after restart", () => fixture(async ({ make, store }) => {
  const wait = gate(), started = gate(); let calls = 0;
  const q = make({ transcribe: async () => { calls++; started.resolve(); await wait.promise; return { text: "must not commit" }; }, stopCompartment: async () => ({ stopped: true }) });
  const first = q.segment("personal", body()), rejectedFirst = assert.rejects(first, /was stopped/); await started.promise;
  const second = q.segment("personal", body("two")), rejectedSecond = assert.rejects(second, /was stopped/);
  await until(async () => (await store.snapshot("personal")).voice[0].chunks.length === 2);
  await q.stopCompartment("personal"); await store.update("personal", "mode-select", (s) => { s.mode = "keyboard-only"; }); await store.update("personal", "mode-select", (s) => { s.mode = "personal-companion"; });
  wait.resolve(); await Promise.all([rejectedFirst, rejectedSecond]); assert.equal(calls, 1);
  const v = (await store.snapshot("personal")).voice[0]; assert.equal(v.chunks.every((c) => c.audio && c.status === "pending"), true);
  const restarted = make({ transcribe: async () => ({ text: "deliberate retry" }) }); assert.equal((await restarted.segment("personal", body())).text, "deliberate retry");
}));

test("session deletion invalidates queued/in-flight results without reviving deleted data", () => fixture(async ({ make, store }) => {
  const wait = gate(), started = gate(); let stopped = 0;
  const q = make({ transcribe: async () => { started.resolve(); await wait.promise; return { text: "deleted source" }; }, stopSession: async () => { stopped++; return { stopped: true }; } });
  const pending = q.segment("personal", body()), rejection = assert.rejects(pending, /was stopped/); await started.promise;
  await store.update("personal", "voice-delete", (s) => { s.voice = []; }); await q.stopSession("personal", "voice"); wait.resolve(); await rejection;
  assert.equal(stopped, 1); assert.equal((await store.snapshot("personal")).voice.length, 0);
}));

test("malformed audio, prohibited work policy and partial chronology never produce an invented transcript", () => fixture(async ({ make, store }) => {
  let calls = 0; const q = make({ transcribe: async () => { calls++; return { text: "first pending result" }; } });
  await assert.rejects(q.segment("personal", body("bad", "QQ")), /canonical/);
  await store.initialize("work", "work"); await assert.rejects(q.segment("work", body()), /prohibited/); assert.equal(calls, 0);
  const failed = make({ transcribe: async () => { throw new Error("Synthetic unavailable CPU worker"); } });
  await assert.rejects(failed.segment("personal", body()), /unavailable CPU/);
  await store.update("personal", "synthetic-out-of-order", (s) => { s.voice[0].chunks.push({ id: "later", status: "transcribed", text: "later result", audio: null }); reviewTranscript(s.voice[0], "Reviewed introduction."); });
  const result = await q.segment("personal", body()); assert.equal(result.transcript, "Reviewed introduction.\n\nfirst pending result later result");
}));
