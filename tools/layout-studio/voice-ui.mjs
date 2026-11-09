import { api } from "./connection.mjs";

/** Local microphone ownership and saved voice history; never sends a design message. */
export function mountVoice({ notify, refresh, request = api, media = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder, page = globalThis.window } = {}) {
  const $ = id => document.getElementById(id), drafts = new Map();
  let state = null, epoch = 0, busy = false, available = false, selected = "", review = null, deliveryWarning = "";
  let capture = null, pending = Promise.resolve(), active = Promise.resolve(), queued = 0;
  const session = () => state?.voice.find(v => v.id === selected);
  const permitted = () => state?.policyRules.recording && state.mode === "personal-companion";
  const scope = () => { const compartment = state?.id, generation = epoch; return { compartment, current: () => state?.id === compartment && epoch === generation }; };
  const text = v => v?.reviewStatus === "current" ? v.reviewedTranscript : v?.transcript ?? "";
  const label = v => `${new Date(v.updatedAt).toLocaleString()} · ${v.status} · ${text(v).trim().replace(/\s+/g, " ").slice(0, 60) || "No transcript yet"}`;
  function message(value) { $("voice-status").textContent = value; }
  function controls() {
    const v = session(), recording = !!capture, pendingAudio = v?.chunks.some(c => c.pendingAudio || c.status === "pending");
    $("voice-session").disabled = busy || recording || queued > 0 || !state?.voice.length;
    $("start-voice").disabled = busy || recording || queued > 0 || !permitted() || !available || state.voice.some(v => v.status === "recording");
    $("pause-voice").textContent = recording || v?.status === "recording" ? "Pause voice" : "Resume voice";
    $("pause-voice").disabled = busy || !v || v.status === "stopped" || (!recording && v.status !== "recording" && (!permitted() || !available));
    $("stop-voice").disabled = busy || !v || v.status === "stopped";
    $("voice-transcript").disabled = busy || recording || queued > 0 || !v;
    $("review-transcript").disabled = busy || recording || queued > 0 || !v || v.status === "recording";
    $("use-voice-draft").disabled = busy || recording || queued > 0 || !v || v.reviewStatus !== "current" || !$("voice-transcript").value || $("voice-transcript").value !== v.reviewedTranscript;
    $("retry-voice").disabled = busy || recording || queued > 0 || !permitted() || !available || !pendingAudio;
    $("delete-voice").disabled = busy || recording || queued > 0 || !v || v.status === "recording";
    $("confirm-voice-delete").disabled = busy || !review;
  }
  function render({ keepMessage = false } = {}) {
    const v = session();
    $("voice-transcript").value = drafts.has(selected) ? drafts.get(selected) : text(v);
    if (!keepMessage) message(deliveryWarning || (capture ? "Microphone recording locally. Pause or stop at any time." : v ? `${v.status} · ${v.chunks.filter(c => c.status === "transcribed").length} transcribed segments · ${v.chunks.filter(c => c.pendingAudio || c.status === "pending").length} saved segments awaiting deliberate retry. This page's microphone is off.` : "Microphone is off. Choose a saved note or start a new local recording."));
    controls();
  }
  function run(fn) {
    if (busy) return; busy = true; controls(); const context = scope();
    active = (async () => {
    try { await fn(context); }
    catch (error) { if (context.current()) { try { await refresh(); } catch { /* Do not retry the failed action. */ } if (context.current()) { message(error.message); notify(error.message); } } }
    finally { busy = false; controls(); }
    })(); return active;
  }
  function stopTracks(value) { for (const track of value?.getTracks() ?? []) track.stop(); }
  function halt() {
    const owned = capture; capture = null;
    if (!owned) return Promise.resolve();
    clearTimeout(owned.timer); stopTracks(owned.stream);
    if (owned.recorder?.state === "recording") {
      const stopped = new Promise(resolve => owned.recorder.addEventListener("stop", resolve, { once: true }));
      owned.recorder.stop(); return stopped;
    }
    return Promise.resolve();
  }
  async function release() { await halt(); await pending; }
  async function pauseSaved(compartment, id) { if (id) await request("/api/suite/voice/state", { compartment, id, status: "paused" }); }
  function queueSegment(blob, chunkId, owned) {
    if (!blob.size) return;
    queued++; controls();
    if (queued >= 3) { void halt(); void pauseSaved(owned.compartment, owned.id).catch(() => {}); if (owned.current()) message("Microphone paused while local transcription catches up. Resume deliberately when ready."); }
    pending = pending.then(async () => {
      if (blob.size > 175000) throw Error("This audio segment exceeds the local size limit; it was not saved. Earlier saved notes are preserved.");
      const data = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (const byte of data) binary += String.fromCharCode(byte);
      await request("/api/suite/voice/segment", { compartment: owned.compartment, id: owned.id, chunkId, audio: btoa(binary) });
      if (owned.current()) await refresh();
    }).catch(async error => {
      void halt();
      if (owned.current()) { deliveryWarning = `${error.message} Audio delivery is unconfirmed. Inspect saved segments before deliberate retry; some audio may not have reached local storage.`; notify(error.message); }
      try { await pauseSaved(owned.compartment, owned.id); } catch { /* Retain the original uncertainty; do not replay audio. */ }
      if (owned.current()) { try { await refresh(); } catch { /* No automatic retry. */ } if (owned.current()) message(deliveryWarning); }
    }).finally(() => { queued--; controls(); });
  }
  function recordSegment(owned) {
    if (capture !== owned) return;
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(type => Recorder.isTypeSupported(type));
    const recorder = new Recorder(owned.stream, { audioBitsPerSecond: 32000, ...(mimeType ? { mimeType } : {}) }), chunks = [], chunkId = crypto.randomUUID(); owned.recorder = recorder;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      clearTimeout(owned.timer); queueSegment(new Blob(chunks, { type: recorder.mimeType }), chunkId, owned);
      if (capture === owned) { try { recordSegment(owned); } catch (error) { void halt(); void pauseSaved(owned.compartment, owned.id).catch(() => {}); if (owned.current()) { message(error.message); notify(error.message); } } }
    };
    recorder.onerror = () => { void halt(); void pauseSaved(owned.compartment, owned.id).catch(() => {}); if (owned.current()) message("The microphone recorder failed. Inspect saved segments before retrying; no audio was replayed."); };
    recorder.start(); owned.timer = setTimeout(() => { if (capture === owned && recorder.state === "recording") recorder.stop(); }, 20000);
  }
  async function acquire(context, id, resume) {
    if (!media?.getUserMedia || !Recorder) throw Error("This browser cannot record a microphone. Saved notes remain available.");
    let stream;
    try {
      stream = await media.getUserMedia({ audio: true, video: false });
      if (!context.current()) { stopTracks(stream); await pauseSaved(context.compartment, id); return; }
      if (resume) await request("/api/suite/voice/state", { compartment: context.compartment, id, status: "recording" });
      if (!context.current()) { stopTracks(stream); await pauseSaved(context.compartment, id); return; }
      capture = { ...context, id, stream }; recordSegment(capture); render();
    } catch (error) { stopTracks(stream); await release(); try { await pauseSaved(context.compartment, id); } catch { /* Preserve the original failure. */ } throw error; }
  }
  $("voice-session").addEventListener("change", () => { if (busy || capture || queued) { $("voice-session").value = selected; return; } epoch++; selected = $("voice-session").value; deliveryWarning = ""; review = null; $("voice-delete-dialog").close(); render(); });
  $("voice-transcript").addEventListener("input", () => { if (selected) drafts.set(selected, $("voice-transcript").value); controls(); });
  $("start-voice").addEventListener("click", () => run(async context => {
    if (!permitted() || !available || capture) throw Error("Choose Personal companion mode and an available local transcription runtime first.");
    if (!media?.getUserMedia || !Recorder) throw Error("This browser cannot record a microphone. Saved notes remain available.");
    deliveryWarning = "";
    const value = await request("/api/suite/voice/start", { compartment: context.compartment, consent: true });
    if (!context.current()) { await pauseSaved(context.compartment, value.id); return; }
    selected = value.id; await refresh(); if (context.current()) await acquire(context, value.id, false); else await pauseSaved(context.compartment, value.id);
  }));
  $("pause-voice").addEventListener("click", () => run(async context => {
    const v = session(); if (!v || v.status === "stopped") throw Error("Choose a resumable voice note.");
    if (capture || v.status === "recording") { await release(); await pauseSaved(context.compartment, v.id); }
    else { if (!permitted() || !available) throw Error("Recording is unavailable in this workspace or mode."); await acquire(context, v.id, true); }
    if (context.current()) await refresh();
  }));
  $("stop-voice").addEventListener("click", () => run(async context => {
    const id = selected; await release(); await request("/api/suite/voice/state", { compartment: context.compartment, id, status: "stopped" }); if (context.current()) await refresh();
  }));
  $("review-transcript").addEventListener("click", () => run(async context => {
    const id = selected, transcript = $("voice-transcript").value;
    try {
      await request("/api/suite/voice/review", { compartment: context.compartment, id, transcript });
      if (context.current() && selected === id) { drafts.delete(id); await refresh(); message("Corrected transcript saved locally. Use it in a design draft when ready; nothing was sent."); }
    } catch (error) { if (context.current()) await refresh(); throw Error(`${error.message} Inspect the saved note before saving again; the review was not replayed.`); }
  }));
  $("use-voice-draft").addEventListener("click", () => {
    if ($("use-voice-draft").disabled) return;
    const draft = $("design-message"), value = $("voice-transcript").value;
    if (draft.disabled || draft.value && draft.value !== value) { message("A design draft is already present or busy. Review or clear it before using this note."); return; }
    draft.value = value; draft.dispatchEvent(new Event("input")); message("Reviewed note placed in the current design draft. Choose its destination and send it when ready.");
  });
  $("retry-voice").addEventListener("click", () => run(async context => {
    const id = selected;
    try { await request("/api/suite/voice/retry", { compartment: context.compartment, id }); }
    finally { if (context.current()) await refresh(); }
  }));
  $("delete-voice").addEventListener("click", () => { if (busy || !session() || capture) return; review = { ...scope(), id: selected }; $("voice-delete-summary").textContent = `Delete this saved voice note?\n${label(session())}\n\nThis removes its encrypted audio, transcript and corrections from this workspace. Any text already copied into a design draft or sent to a provider is separate and will remain.`; $("voice-delete-dialog").showModal(); controls(); });
  $("cancel-voice-delete").addEventListener("click", () => { review = null; $("voice-delete-dialog").close(); controls(); });
  $("voice-delete-dialog").addEventListener("close", () => { if (!$("voice-delete-dialog").open) { review = null; controls(); } });
  $("confirm-voice-delete").addEventListener("click", () => run(async context => {
    const saved = review; review = null; $("voice-delete-dialog").close(); if (!saved?.current() || saved.id !== selected) return;
    try { await request("/api/suite/voice/delete", { compartment: saved.compartment, id: saved.id }); drafts.delete(saved.id); }
    finally { if (context.current()) await refresh(); }
  }));
  function clear() { epoch++; state = null; selected = ""; deliveryWarning = ""; drafts.clear(); review = null; $("voice-delete-dialog").close(); $("voice-delete-summary").textContent = ""; $("voice-session").replaceChildren(); render(); }
  document.addEventListener("switchyard-workspace-changing", () => { const old = capture; clear(); void release().then(() => old && pauseSaved(old.compartment, old.id)).catch(() => {}); });
  document.addEventListener("switchyard-compartment-state", event => {
    if (state?.id && state.id !== event.detail.id) clear();
    state = event.detail;
    if (!state.voice.some(v => v.id === selected)) selected = state.voice.at(-1)?.id ?? "";
    $("voice-session").replaceChildren(...[...state.voice].reverse().map(v => { const option = document.createElement("option"); option.value = v.id; option.textContent = label(v); return option; })); $("voice-session").value = selected;
    if (capture && (!permitted() || session()?.status !== "recording")) { epoch++; void release(); }
    render();
  });
  page?.addEventListener("pagehide", () => { epoch++; void halt(); });
  render();
  return {
    setAvailability(value) { available = value.available === true; $("local-voice-detail").textContent = available ? value.destination : value.reason; controls(); },
    async beforeWorkspaceChange() { const old = scope(), id = capture?.id ?? (session()?.status === "recording" ? selected : null); epoch++; await release(); await pauseSaved(old.compartment, id); },
    async dispose() { epoch++; await release(); await active; },
  };
}
