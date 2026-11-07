/** Explicit, ephemeral physical-key tests. No timers poll keys and no samples persist. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { matrixDimensions } from "./vial-matrix.mjs";
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const tokenHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v) ? digest(v) : null;
export function createMatrixDiagnostics({ store, devices, isActive, now = () => Date.now() } = {}) {
  const reviews = new Map(), sessions = new Map(), running = new Map(), generations = new Map();
  let closed = false;
  const generation = (c) => generations.get(c) ?? 0;
  async function scope(c, deviceId) {
    if (closed) throw new Error("The key diagnostic is closed.");
    if (!await isActive(c)) throw new Error("Key tests require the currently selected workspace.");
    await store.authorize(c, { operation: "record" });
    const state = await store.snapshot(c), found = (state.deviceSnapshots ?? []).filter((s) => s.identity.deviceId === deviceId);
    if (found.length !== 1) throw new Error("Read this exact keyboard in this workspace before reviewing a key test.");
    const baseline = found[0], age = now() - Date.parse(baseline.capturedAt);
    if (!Number.isFinite(age) || age < 0 || age > 120000) throw new Error("The keyboard readout is stale. Read and review it again.");
    if (baseline.identity.viaProtocol !== 9 || !Number.isInteger(baseline.identity.vialProtocol) || baseline.identity.vialProtocol < 1 || baseline.identity.vialProtocol > 6 || !/^[a-f0-9]{16}$/.test(baseline.identity.keyboardId ?? "") || /^0+$/.test(baseline.identity.keyboardId)) throw new Error("Only a verified Vial identity supports this key test.");
    matrixDimensions(baseline.rows, baseline.cols);
    if (baseline.rows !== baseline.definition?.matrix?.rows || baseline.cols !== baseline.definition?.matrix?.cols) throw new Error("The protected matrix and definition disagree.");
    return { baseline, digest: digest([c, state.policy, state.mode, state.accounts, baseline]) };
  }
  async function run(c, record, operation) {
    if (running.has(c)) throw new Error("A key diagnostic request is already running in this workspace.");
    const fence = generation(c), controller = new AbortController(), resource = { controller };
    const current = () => { if (closed || generation(c) !== fence || controller.signal.aborted || now() >= record.expiresAt) throw new Error("This key test stopped or expired. Review a new test explicitly."); };
    const authorize = async () => {
      current(); const latest = await scope(c, record.deviceId); current();
      if (latest.digest !== record.scopeDigest) throw new Error("The reviewed keyboard readout or workspace policy changed. The key test stopped.");
      return latest.baseline;
    };
    running.set(c, resource);
    const timer = setTimeout(() => controller.abort(), 10000); timer.unref?.();
    resource.pending = (async () => {
      const baseline = await authorize(), result = await operation(baseline, { beforeIo: authorize, signal: controller.signal });
      await authorize(); return result;
    })();
    try { return await resource.pending; }
    finally { clearTimeout(timer); if (running.get(c) === resource) running.delete(c); }
  }
  async function stopCompartment(c) {
    generations.set(c, generation(c) + 1); sessions.delete(c);
    for (const [id, review] of reviews) if (review.compartment === c) reviews.delete(id);
    const resource = running.get(c); resource?.controller.abort();
    await resource?.pending?.catch(() => {});
    return { stopped: true, samplesRetained: false, keyboardRelocked: false };
  }
  return {
    async review(c, { deviceId }) {
      const fence = generation(c), { baseline, digest: scopeDigest } = await scope(c, deviceId);
      if (closed || generation(c) !== fence) throw new Error("The key test stopped during review.");
      for (const [id, r] of reviews) if (now() >= r.expiresAt) reviews.delete(id);
      if (reviews.size >= 64) throw new Error("Let older key-test reviews expire before opening another.");
      const reviewId = randomUUID(), consentToken = randomBytes(32).toString("hex"), expiresAt = now() + 120000;
      reviews.set(reviewId, { compartment: c, deviceId, scopeDigest, tokenHash: tokenHash(consentToken), expiresAt });
      return { reviewId, consentToken, expiresAt, rows: baseline.rows, cols: baseline.cols, durationMs: 60000, maximumSamples: 240, minimumIntervalMs: 100, samplesRetained: false,
        notice: "This test reads physical switch positions, which can reveal typing. Close sensitive applications and type only test keys. Explicit consent and physical Vial unlock are required. Stop, workspace changes, keyboard-only mode and expiry revoke capture. No samples are saved or sent to a provider. Stopping capture does not relock firmware; use the separate relock action." };
    },
    async start(c, { reviewId, consentToken, consent }) {
      const fence = generation(c);
      const record = reviews.get(reviewId);
      if (!record || record.compartment !== c || consent !== true || tokenHash(consentToken) !== record.tokenHash) throw new Error("Approve the exact key-test notice and its one-use consent token in this workspace.");
      if (sessions.has(c)) throw new Error("Stop the current key test before starting another.");
      reviews.delete(reviewId);
      await run(c, record, (baseline, options) => devices.matrixProbe(baseline, options));
      if (closed || generation(c) !== fence) throw new Error("The key test stopped during startup.");
      const id = randomUUID(), expiresAt = now() + 60000;
      sessions.set(c, { ...record, id, expiresAt, samples: 0, lastSampleAt: null });
      return { id, expiresAt, maximumSamples: 240, samplesRetained: false, keyboardWritten: false };
    },
    async sample(c, { id }) {
      const record = sessions.get(c);
      if (!record || record.id !== id) throw new Error("Choose the exact active consented key test in this workspace.");
      if (record.samples >= 240 || now() >= record.expiresAt) { sessions.delete(c); throw new Error("The key test reached its capture limit. Review a new test explicitly."); }
      if (record.lastSampleAt !== null && now() - record.lastSampleAt < 100) throw new Error("Wait at least 100 ms before requesting another switch-state sample.");
      if (running.has(c)) throw new Error("A key diagnostic request is already running in this workspace.");
      record.samples++; record.lastSampleAt = now();
      try {
        const result = await run(c, record, (baseline, options) => devices.matrixProbe(baseline, { ...options, sample: true }));
        if (sessions.get(c) !== record) throw new Error("The key test stopped; its late sample was discarded.");
        return { id, sequence: record.samples, observedAt: now(), pressed: result.pressed, samplesRetained: false, provenance: "Vial switch matrix; no host character, layout, rollover or physical LED attestation" };
      } catch (error) { if (sessions.get(c) === record) sessions.delete(c); throw error; }
    },
    async stop(c, { id }) {
      if (typeof id !== "string" || !sessions.has(c) || id !== sessions.get(c).id) throw new Error("Choose the exact active key test in this workspace.");
      return stopCompartment(c);
    },
    stopCompartment,
    async close() { closed = true; await Promise.all([...new Set([...running.keys(), ...sessions.keys()])].map(stopCompartment)); reviews.clear(); }
  };
}
