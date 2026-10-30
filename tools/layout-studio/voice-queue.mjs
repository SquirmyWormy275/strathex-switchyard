/** Bounded durable audio identities, one CPU worker and correctable continuity. */
import { createHash } from "node:crypto";
const provider = "local-transcription", request = { operation: "record", provider };
const voiceSession = (s, id) => { const v = s.voice.find((v) => v.id === id); if (!v) throw new Error("That voice session is unavailable in this compartment."); return v; };
function source(audio) {
  if (typeof audio !== "string" || audio.length < 4 || audio.length > 240000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)) throw new Error("Audio segments must be bounded canonical base64.");
  const bytes = Buffer.from(audio, "base64");
  if (!bytes.length || bytes.toString("base64") !== audio) throw new Error("Audio segments must be bounded canonical base64.");
  return { audioDigest: createHash("sha256").update(bytes).digest("hex"), audioBytes: bytes.length };
}
function checkpoint(v) {
  if (!v.reviewCheckpoint && v.reviewedTranscript) v.reviewCheckpoint = { schema: "switchyard-transcript-review/v1", text: v.reviewedTranscript, chunkIds: v.chunks.filter((c) => c.status === "transcribed").map((c) => c.id), at: v.updatedAt };
}
function prefix(v) { const firstPending = v.chunks.findIndex((c) => c.status !== "transcribed"); return firstPending < 0 ? v.chunks : v.chunks.slice(0, firstPending); }
function rebuild(v) {
  const reviewed = v.reviewCheckpoint, covered = new Set(reviewed?.chunkIds ?? []);
  const suffix = prefix(v).filter((c) => !covered.has(c.id)).map((c) => c.text ?? "").join(" ").trim();
  const text = reviewed ? reviewed.text + (suffix ? `${reviewed.text ? "\n\n" : ""}${suffix}` : "") : suffix;
  if (text.length > 160000) throw new Error("Voice transcript limit reached. Preserve this pending audio and review the session before continuing.");
  v.transcript = text;
  if (suffix && reviewed) { v.reviewedTranscript = ""; v.reviewStatus = "needs-review"; }
}
function response(v, c, extra = {}) { return { transcript: v.transcript, text: c.text, destination: "Local CPU; audio removed after successful transcription", ...extra }; }
export function reviewTranscript(v, text, now = () => Date.now()) {
  if (typeof text !== "string" || text.length > 160000) throw new Error("The reviewed transcript exceeds the session limit.");
  v.reviewedTranscript = text; v.transcript = text; v.reviewStatus = "current";
  v.reviewCheckpoint = { schema: "switchyard-transcript-review/v1", text, chunkIds: prefix(v).map((c) => c.id), at: now() };
  v.updatedAt = now(); return { reviewed: true };
}
export function createVoiceQueue({ store, voice, now = () => Date.now(), maxPending = 16 } = {}) {
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 64) throw new Error("Choose a bounded local transcription queue size.");
  const inFlight = new Map(), generations = new Map(), sessions = new Map(); let tail = Promise.resolve(), pending = 0, closed = false;
  const generation = (c) => generations.get(c) ?? 0, sessionKey = (c, id) => JSON.stringify([c, id]);
  function current(c, id, fence) { if (closed || generation(c) !== fence.compartment || (sessions.get(sessionKey(c, id)) ?? 0) !== fence.session) throw new Error("This transcription request was stopped. Its encrypted pending audio is preserved for deliberate retry."); }
  async function authorize(c, id, fence) { current(c, id, fence); await store.authorize(c, request); current(c, id, fence); }
  async function lock(kind, id, fn) { if (!store.withResourceLock) throw new Error("A protected cross-process voice lease is required. Pending audio was preserved."); return store.withResourceLock(kind, id, fn); }
  return {
    async segment(compartment, { id, audio, chunkId }) {
      const fence = { compartment: generation(compartment), session: sessions.get(sessionKey(compartment, id)) ?? 0 }, identity = source(audio);
      if (typeof chunkId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(chunkId)) throw new Error("Audio segments need a bounded unique chunk identity.");
      current(compartment, id, fence);
      const cached = await store.update(compartment, "voice-segment", (s) => {
        const v = voiceSession(s, id), existing = v.chunks.find((c) => c.id === chunkId); checkpoint(v);
        if (existing) {
          const original = existing.audioDigest ?? (existing.audio ? source(existing.audio).audioDigest : null);
          if (original && original !== identity.audioDigest) throw new Error("This voice chunk identity already belongs to different audio. Its source and transcript were preserved.");
          if (existing.status === "transcribed") return response(v, existing, { duplicate: true, ...(original ? {} : { audioIdentity: "not-recorded-by-earlier-version" }) });
          existing.audioDigest ??= original; existing.audioBytes ??= identity.audioBytes; return null;
        }
        if (!["recording", "paused"].includes(v.status)) throw new Error("This voice session cannot accept new audio.");
        if (v.chunks.length >= 1000) throw new Error("Voice session limit reached. Review this transcript and start another session.");
        v.chunks.push({ schema: "switchyard-voice-chunk/v2", id: chunkId, ...identity, audio, text: null, status: "pending", createdAt: now() }); v.updatedAt = now(); return null;
      }, request);
      if (cached) return cached;
      const key = JSON.stringify([compartment, id, chunkId]);
      if (inFlight.has(key)) return inFlight.get(key).then((result) => ({ ...result, duplicate: true }));
      if (pending >= maxPending) throw new Error("The local transcription queue is full. Your encrypted audio was saved; pause and deliberately retry pending segments.");
      pending++;
      const operation = tail.catch(() => {}).then(() => lock("voice-cpu", "one-local-cpu-worker/v1", async (cpuLease) => {
        await authorize(compartment, id, fence); cpuLease.assert();
        // Re-read after taking the shared CPU lease. Another suite process may
        // have completed this same exact chunk while this request waited.
        const saved = voiceSession(await store.snapshot(compartment), id), c = saved.chunks.find((c) => c.id === chunkId);
        if (!c || c.audioDigest !== identity.audioDigest) throw new Error("The exact pending audio was deleted or changed; no transcription was started.");
        if (c.status === "transcribed") return response(saved, c, { duplicate: true });
        if (!c.audio) throw new Error("The pending audio source is unavailable. Preserve the saved transcript.");
        const transcription = await voice.transcribe(c.audio, { compartment, sessionId: id, beforeStart: () => authorize(compartment, id, fence) });
        if (typeof transcription?.text !== "string" || transcription.text.length > 16000) throw new Error("Local transcription returned an unsupported response. Pending audio is preserved.");
        await authorize(compartment, id, fence); cpuLease.assert();
        return store.update(compartment, "voice-transcribe", (s) => {
          current(compartment, id, fence);
          const v = voiceSession(s, id), currentChunk = v.chunks.find((c) => c.id === chunkId);
          if (!currentChunk || currentChunk.audioDigest !== identity.audioDigest) throw new Error("The exact audio was deleted or changed while transcription ran.");
          if (currentChunk.status === "transcribed") return response(v, currentChunk, { duplicate: true });
          checkpoint(v); currentChunk.text = transcription.text; currentChunk.audio = null; currentChunk.status = "transcribed";
          rebuild(v); v.updatedAt = now(); return response(v, currentChunk);
        }, { provider });
      }));
      tail = operation; inFlight.set(key, operation);
      try { return await operation; } finally { pending--; if (inFlight.get(key) === operation) inFlight.delete(key); }
    },
    async stopCompartment(c) { generations.set(c, generation(c) + 1); return voice.stopCompartment?.(c) ?? { stopped: true, ownedProcesses: 0 }; },
    async stopSession(c, id) { const key = sessionKey(c, id); sessions.set(key, (sessions.get(key) ?? 0) + 1); return voice.stopSession?.(c, id) ?? { stopped: true, ownedProcesses: 0 }; },
    async close() { closed = true; await voice.close?.(); await Promise.allSettled(inFlight.values()); }
  };
}
