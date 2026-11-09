import test from "node:test";
import assert from "node:assert/strict";
import { browserSurfaceFixture, until } from "./test-support/browser-ui.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(fn) {
  const native = [], recorders = [], streams = [], page = new EventTarget(); let permission, permissionError, transcription, recordingBytes = "Synthetic microphone segment";
  const voice = { discovery: async () => ({ available: true, destination: "Synthetic local CPU" }), transcribe: async () => { native.push("transcribe"); if (transcription) await transcription.promise; return { text: "Synthetic recognized words" }; } };
  return browserSurfaceFixture(async c => {
    await c.store.initialize("work", "work");
    const { mountVoice } = await import("./voice-ui.mjs"), { api } = await import("./connection.mjs"); const notices = [];
    let compartment = "personal";
    const refresh = async () => c.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await api("/api/suite/snapshot", { compartment }) }));
    const media = { async getUserMedia(options) { assert.deepEqual(options, { audio: true, video: false }); native.push("microphone-permission"); if (permissionError) throw permissionError; const stream = { stops: 0, getTracks() { return [{ stop() { stream.stops++; } }]; } }; streams.push(stream); if (permission) await permission.promise; return stream; } };
    class Recorder extends EventTarget {
      static isTypeSupported(type) { return type === "audio/webm;codecs=opus"; }
      constructor(stream, options) { super(); this.stream = stream; this.mimeType = options.mimeType; this.state = "inactive"; recorders.push(this); }
      start() { this.state = "recording"; }
      stop() { assert.equal(this.state, "recording"); this.state = "inactive"; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([recordingBytes]) }); this.onstop?.(); this.dispatchEvent(new Event("stop")); }); }
    }
    const ui = mountVoice({ notify: value => notices.push(value), refresh, media, Recorder, page }); ui.setAvailability({ available: true, destination: "Synthetic local CPU" }); await refresh();
    const select = async id => { c.document.dispatchEvent(new Event("switchyard-workspace-changing")); compartment = id; await refresh(); };
    try { await fn({ ...c, ui, refresh, select, native, recorders, streams, notices, page, holdPermission: () => permission = deferred(), holdTranscription: () => transcription = deferred(), denyPermission: () => { permissionError = Error("Synthetic microphone permission denied"); }, setBytes: bytes => { recordingBytes = bytes; } }); }
    finally { permission?.resolve(); transcription?.resolve(); await ui.beforeWorkspaceChange(); await ui.dispose(); }
  }, { voice });
}
async function settle(c) { await until(() => !c.$("voice-session").disabled); }
async function start(c) { c.click("start-voice"); await until(() => c.recorders.at(-1)?.state === "recording" && !c.$("pause-voice").disabled); return c.$("voice-session").value; }
async function pause(c) { c.click("pause-voice"); await settle(c); }
async function seed(c) {
  await c.store.update("personal", "synthetic-voice-history", s => { s.voice = [
    { id: "older", status: "stopped", chunks: [], transcript: "Older note", reviewedTranscript: "", updatedAt: Date.now() - 1000 },
    { id: "newer", status: "paused", chunks: [], transcript: "Newer note", reviewedTranscript: "", updatedAt: Date.now() },
  ]; }); await c.refresh();
}

test("voice history is passive, keeps exact note selection and corrections, and clears Personal text in Work", () => fixture(async c => {
  await seed(c); const before = await c.store.snapshot("personal"); assert.equal(c.$("voice-session").value, "newer");
  c.change("voice-session", "older"); assert.equal(c.$("voice-transcript").value, "Older note");
  c.$("voice-transcript").value = "Unsent correction"; c.$("voice-transcript").dispatchEvent(new Event("input")); await c.refresh(); assert.equal(c.$("voice-transcript").value, "Unsent correction");
  c.change("voice-session", "newer"); c.change("voice-session", "older"); assert.equal(c.$("voice-transcript").value, "Unsent correction"); assert.deepEqual(c.native, []); assert.deepEqual(await c.store.snapshot("personal"), before);
  await c.select("work"); assert.equal(c.$("voice-transcript").value, ""); assert.equal(c.$("voice-session").options.length, 0); assert.equal(c.$("start-voice").disabled, true);
}));

test("correcting a note and placing it in a design draft are separate actions that preserve existing drafts", () => fixture(async c => {
  await seed(c); c.change("voice-session", "older"); c.$("voice-transcript").value = "Reviewed correction"; c.$("voice-transcript").dispatchEvent(new Event("input"));
  c.$("design-message").value = "Existing unsent draft"; c.click("review-transcript"); await until(() => c.$("voice-status").textContent.includes("Corrected transcript saved") && !c.$("use-voice-draft").disabled);
  assert.equal((await c.store.snapshot("personal")).voice[0].reviewedTranscript, "Reviewed correction"); assert.equal(c.$("design-message").value, "Existing unsent draft");
  c.click("use-voice-draft"); assert.equal(c.$("design-message").value, "Existing unsent draft"); c.$("design-message").value = ""; c.click("use-voice-draft"); assert.equal(c.$("design-message").value, "Reviewed correction"); assert.equal(c.calls.some(row => row.path === "/api/suite/design"), false); assert.deepEqual(c.native, []);
}));

test("explicit capture, pause, resume and stop use the same exact note and remove successfully transcribed audio", () => fixture(async c => {
  const id = await start(c); assert.equal(c.native.filter(v => v === "microphone-permission").length, 1); await pause(c);
  let note = (await c.store.snapshot("personal")).voice[0]; assert.equal(note.id, id); assert.equal(note.status, "paused"); assert.equal(note.chunks.length, 1); assert.equal(note.chunks[0].audio, null); assert.ok(c.streams[0].stops > 0);
  c.click("pause-voice"); await until(() => c.recorders.length === 2 && !c.$("pause-voice").disabled); c.click("stop-voice"); await settle(c);
  note = (await c.store.snapshot("personal")).voice[0]; assert.equal(note.id, id); assert.equal(note.status, "stopped"); assert.equal(note.chunks.length, 2); assert.equal(new Set(note.chunks.map(row => row.id)).size, 2); assert.equal(c.$("pause-voice").disabled, true); assert.ok(c.streams.every(s => s.stops > 0));
}));

test("late microphone permission cannot begin recording after changing from Personal to Work", () => fixture(async c => {
  const gate = c.holdPermission(); c.click("start-voice"); await until(() => c.native.includes("microphone-permission"));
  await c.ui.beforeWorkspaceChange(); await c.select("work"); gate.resolve(); await until(() => c.streams[0].stops > 0); await until(() => !c.$("start-voice").disabled || c.$("voice-session").options.length === 0);
  assert.equal(c.recorders.length, 0); assert.equal((await c.store.snapshot("personal")).voice[0].status, "paused"); assert.equal((await c.store.snapshot("work")).voice.length, 0); assert.equal(c.$("voice-transcript").value, "");
}));

test("a late start acknowledgement pauses its original note without requesting a microphone in the new workspace", () => fixture(async c => {
  const fetch = globalThis.fetch, gate = deferred(); let entered = false;
  globalThis.fetch = async (path, input) => { const response = await fetch(path, input); if (path === "/api/suite/voice/start") { entered = true; await gate.promise; } return response; };
  try { c.click("start-voice"); await until(() => entered); await c.ui.beforeWorkspaceChange(); await c.select("work"); gate.resolve(); await until(() => c.calls.some(row => row.path === "/api/suite/voice/state")); await c.responses.findLast(row => row.path === "/api/suite/voice/state").response;
    assert.equal((await c.store.snapshot("personal")).voice[0].status, "paused"); assert.deepEqual(c.native, []); assert.equal(c.$("voice-transcript").value, ""); }
  finally { gate.resolve(); globalThis.fetch = fetch; }
}));

test("a lost segment reply refreshes saved state without replaying audio or creating a replacement note", () => fixture(async c => {
  await start(c); const fetch = globalThis.fetch;
  globalThis.fetch = async (path, input) => { const response = await fetch(path, input); if (path === "/api/suite/voice/segment") { await response.text(); throw Error("Synthetic lost segment reply"); } return response; };
  try { await pause(c); } finally { globalThis.fetch = fetch; }
  const saved = (await c.store.snapshot("personal")).voice; assert.equal(saved.length, 1); assert.equal(saved[0].chunks.length, 1); assert.equal(saved[0].chunks[0].status, "transcribed"); assert.equal(c.native.filter(v => v === "transcribe").length, 1); assert.equal(c.calls.filter(row => row.path === "/api/suite/voice/segment").length, 1); assert.equal(c.$("retry-voice").disabled, true); assert.ok(c.notices.some(v => v.includes("Synthetic lost"))); assert.match(c.$("voice-status").textContent, /Audio delivery is unconfirmed/);
}));

test("deliberate saved-audio retry keeps corrected continuity and does not request microphone permission", () => fixture(async c => {
  await seed(c); await c.store.update("personal", "synthetic-pending-audio", s => { const v = s.voice[1]; v.reviewedTranscript = "Corrected introduction"; v.transcript = v.reviewedTranscript; v.reviewStatus = "current"; v.chunks.push({ id: "pending", status: "pending", audio: btoa("Synthetic pending audio"), text: null }); }); await c.refresh(); c.click("retry-voice"); await settle(c);
  const note = (await c.store.snapshot("personal")).voice[1]; assert.equal(note.transcript, "Corrected introduction\n\nSynthetic recognized words"); assert.equal(note.reviewStatus, "needs-review"); assert.equal(note.chunks[0].audio, null); assert.deepEqual(c.native, ["transcribe"]); assert.equal(c.$("voice-transcript").value, note.transcript); assert.equal(c.$("use-voice-draft").disabled, true);
}));

test("workspace preparation releases capture and flushes its original note before mode changes", () => fixture(async c => {
  const id = await start(c); await c.ui.beforeWorkspaceChange(); c.document.dispatchEvent(new Event("switchyard-workspace-changing")); await c.suite.handle("/api/suite/mode", { compartment: "personal", mode: "keyboard-only" }); await c.refresh();
  const saved = (await c.store.snapshot("personal")).voice[0]; assert.equal(saved.id, id); assert.equal(saved.status, "paused"); assert.equal(saved.chunks[0].status, "transcribed"); assert.ok(c.streams[0].stops > 0); assert.equal(c.$("start-voice").disabled, true); assert.equal(c.$("pause-voice").disabled, true);
}));

test("deleting a selected saved note needs separate confirmation and never removes another note or design draft", () => fixture(async c => {
  await seed(c); c.change("voice-session", "older"); c.$("design-message").value = "Already copied text"; c.click("delete-voice"); assert.equal(c.$("voice-delete-dialog").open, true); assert.match(c.$("voice-delete-summary").textContent, /Older note/); c.click("cancel-voice-delete"); assert.equal((await c.store.snapshot("personal")).voice.length, 2);
  c.click("delete-voice"); c.change("voice-session", "newer"); assert.equal(c.$("voice-delete-dialog").open, false); c.$("confirm-voice-delete").dispatchEvent(new Event("click")); await settle(c); assert.equal((await c.store.snapshot("personal")).voice.length, 2);
  c.change("voice-session", "older"); c.click("delete-voice"); c.click("confirm-voice-delete"); await settle(c); assert.deepEqual((await c.store.snapshot("personal")).voice.map(v => v.id), ["newer"]); assert.equal(c.$("design-message").value, "Already copied text");
}));

test("bounded capture pauses at three queued segments without dropping their exact saved identities", () => fixture(async c => {
  const gate = c.holdTranscription(); await start(c);
  for (let i = 0; i < 3; i++) { c.recorders[i].stop(); if (i < 2) await until(() => c.recorders.length === i + 2); }
  await until(() => c.streams[0].stops > 0); assert.equal(c.recorders.length, 3); gate.resolve(); await settle(c); await c.ui.beforeWorkspaceChange(); await c.refresh();
  const note = (await c.store.snapshot("personal")).voice[0]; assert.equal(note.status, "paused"); assert.equal(note.chunks.length, 3); assert.equal(new Set(note.chunks.map(v => v.id)).size, 3); assert.equal(note.chunks.every(v => v.status === "transcribed" && v.audio === null), true); assert.equal(c.native.filter(v => v === "transcribe").length, 3);
}));

test("denied microphone permission leaves one paused note and never creates a recorder or retries", () => fixture(async c => {
  c.denyPermission(); c.click("start-voice"); c.$("start-voice").dispatchEvent(new Event("click")); await until(() => c.notices.some(v => v.includes("permission denied"))); await settle(c);
  const notes = (await c.store.snapshot("personal")).voice; assert.equal(notes.length, 1); assert.equal(notes[0].status, "paused"); assert.equal(c.recorders.length, 0); assert.deepEqual(c.native, ["microphone-permission"]); assert.equal(c.calls.filter(row => row.path === "/api/suite/voice/start").length, 1);
}));

test("oversized microphone data is refused without an upload and page exit immediately releases tracks", () => fixture(async c => {
  c.setBytes("x".repeat(175001)); await start(c); c.page.dispatchEvent(new Event("pagehide")); assert.ok(c.streams[0].stops > 0); await c.ui.dispose();
  assert.equal(c.calls.some(row => row.path === "/api/suite/voice/segment"), false); assert.equal((await c.store.snapshot("personal")).voice[0].chunks.length, 0); assert.equal(c.recorders.length, 1);
}));

test("a lost delete reply reads back absence without replaying deletion or clearing the remaining note", () => fixture(async c => {
  await seed(c); c.change("voice-session", "older"); c.click("delete-voice"); const fetch = globalThis.fetch;
  globalThis.fetch = async (path, input) => { const response = await fetch(path, input); if (path === "/api/suite/voice/delete") { await response.text(); throw Error("Synthetic lost delete reply"); } return response; };
  try { c.click("confirm-voice-delete"); await until(() => c.notices.some(v => v.includes("lost delete"))); await settle(c); } finally { globalThis.fetch = fetch; }
  assert.equal(c.$("voice-session").value, "newer"); assert.equal(c.$("voice-transcript").value, "Newer note"); assert.equal(c.calls.filter(row => row.path === "/api/suite/voice/delete").length, 1);
}));

test("the complete page releases its microphone before changing mode and clears voice history when selecting Work", () => browserSurfaceFixture(async c => {
  await c.store.initialize("work", "work");
  const previous = Object.fromEntries(["navigator", "MediaRecorder", "window"].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const stream = { stopped: false, getTracks: () => [{ stop() { stream.stopped = true; } }] }; let recorder;
  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); recorder = this; this.state = "inactive"; this.mimeType = "audio/webm"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; queueMicrotask(() => { this.ondataavailable({ data: new Blob(["Synthetic complete-page audio"]) }); this.onstop(); this.dispatchEvent(new Event("stop")); }); }
  }
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
  Object.defineProperty(globalThis, "MediaRecorder", { configurable: true, value: Recorder }); Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  c.document.querySelector = selector => { assert.equal(selector, ".app-main"); return c.$("synthetic-app-main"); };
  try {
    const { mountSuite } = await import("./suite-ui.mjs"); mountSuite({ getProfile: () => null, loadProfile() {}, previewProposal() {}, notify() {}, saved() {}, onPolicy() {}, onWorkflow() {}, download() {} });
    await until(() => /Private workspace connected/.test(c.$("suite-status").textContent)); c.click("start-voice"); await until(() => recorder?.state === "recording" && !c.$("pause-voice").disabled);
    c.change("operating-mode", "keyboard-only"); await until(() => !c.$("operating-mode").disabled && c.$("operating-mode").value === "keyboard-only");
    assert.equal(stream.stopped, true); const personal = await c.store.snapshot("personal"); assert.equal(personal.voice[0].status, "paused"); assert.equal(personal.voice[0].transcript, "Synthetic full-page transcript");
    const segment = c.calls.findIndex(row => row.path === "/api/suite/voice/segment"), mode = c.calls.findIndex(row => row.path === "/api/suite/mode"); assert.ok(segment >= 0 && mode > segment);
    c.change("compartment-picker", "work"); await until(() => !c.$("compartment-picker").disabled && c.$("policy-summary").textContent.startsWith("Copilot-only Work"));
    assert.equal(await c.store.selection(), "work"); assert.equal(c.$("voice-session").options.length, 0); assert.equal(c.$("voice-transcript").value, ""); assert.equal(c.$("start-voice").disabled, true);
  } finally { globalThis.window.dispatchEvent(new Event("pagehide")); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }
}, { voice: { discovery: async () => ({ available: true, destination: "Synthetic local runtime" }), transcribe: async () => ({ text: "Synthetic full-page transcript" }), stopCompartment: async () => ({ stopped: true }) } }));
