/** Review a source workflow on the captured typing layer, without device/host effects. */
import { createHash, randomUUID } from "node:crypto";
import { identifyCatalogSnapshot } from "./catalog-identity.mjs";
import { recommendedWorkflow, taskControls } from "./catalog.mjs";
import { importVialSnapshot } from "./vial-snapshot.mjs";
import { portableProfile } from "./workspace.mjs";
import { newPlan, parseBoardProfile } from "./model.mjs";
import { boardBounds } from "./geometry.mjs";
import { createPortablePackage } from "./portable-package.mjs";
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function createReadoutProfiles({ store, catalog, now = () => Date.now() } = {}) {
  const reviews = new Map(), lifetime = 120000;
  let closed = false;
  const open = () => { if (closed) throw new Error("This readout review service was closed. Review again in the running application."); };
  function readout(state, deviceId) {
    if (typeof deviceId !== "string" || !/^[a-f0-9]{64}$/.test(deviceId)) throw new Error("Choose an exact previously read interface.");
    const found = (state.deviceSnapshots ?? []).filter((s) => s.identity.deviceId === deviceId);
    if (found.length !== 1) throw new Error("Read this exact keyboard in this workspace first.");
    const age = now() - Date.parse(found[0].capturedAt);
    if (!Number.isFinite(age) || age < 0 || age > lifetime) throw new Error("The readout is stale. Read the keyboard again before reviewing its workflow.");
    return found[0];
  }
  return {
    async review(compartment, { deviceId, deviceIds, name }) {
      open();
      for (const [id, value] of reviews) if (value.expiresAt < now()) reviews.delete(id);
      if (reviews.size >= 64) throw new Error("Resolve or let older readout reviews expire before opening another.");
      const ids = deviceIds ?? [deviceId];
      if (deviceIds !== undefined && deviceId !== undefined || !Array.isArray(ids) || ids.length < 1 || ids.length > 2 || new Set(ids).size !== ids.length) throw new Error("Choose one exact keyboard or two distinct split interfaces in left/right source order.");
      const state = await store.snapshot(compartment), snapshots = ids.map((id) => readout(state, id)), matches = snapshots.map((s) => identifyCatalogSnapshot(catalog, s));
      if (matches.some((m) => !m.sourceProposalEligible)) throw new Error("A readout has no complete verified source identity and decoded choices. Current typing was preserved.");
      if (ids.length === 1 && matches[0].suggestedModels.length && matches[0].suggestedModels.every((m) => m.variants.every((v) => v.totalParts > 1))) throw new Error("One split half cannot supply the whole keyboard's typing layer. Read and select both halves.");
      if (ids.length === 2 && !catalog.models.some((m) => m.variants.some((v) => v.parts.length === 2 && v.parts.every((p, i) => matches[i].definitions.some((d) => d.id === p.definitionId && d.uidMatches))))) throw new Error("The selected readouts do not verify one declared split source pair in left/right order. No half was guessed or combined.");
      const profiles = snapshots.map((s, i) => importVialSnapshot(s, matches[i].selections)); let offset = 0;
      const keys = profiles.flatMap((p, i) => { const rows = p.keys.map((k) => ids.length === 1 ? k : { ...k, id: `${i === 0 ? "left" : "right"}:${k.id}`, matrix: [k.matrix[0] + i * 128, k.matrix[1]], x: k.x + offset }); offset += boardBounds(p.keys).width + 2; return rows; });
      const actual = parseBoardProfile({ ...profiles[0], name: ids.length === 1 ? profiles[0].name : "Paired keyboard readouts", layout: ids.length === 1 ? profiles[0].layout : "Paired Vial readouts", keys });
      const plan = newPlan(actual);
      plan.actions = taskControls.map((control, i) => {
        let key = null;
        for (const codes of [[`KC_${i + 1}`], [`KC_P${i + 1}`, `KC_KP_${i + 1}`], [`KC_F${i + 1}`], [["KC_R", "KC_S", "KC_V", "KC_H"][i]]]) { const positions = actual.keys.filter((k) => codes.includes(k.baseKeycode)); if (positions.length) { if (positions.length === 1) key = positions[0]; break; } }
        return { id: `task-${control.id}`, label: control.label, family: control.family, consequence: control.consequence, confirmation: false, frequencyPerDay: 0, secondsSaved: 0, binding: key ? { keyId: key.id, modifier: "gui_ctrl" } : null };
      });
      const profileId = `readout-${digest(matches.map((m) => [m.definitionSha256, m.selections])).slice(0, 24)}`;
      const p = portableProfile(plan, profileId, name ?? `${actual.name.slice(0, 85)} · Keep my place`, recommendedWorkflow());
      const intentAssignments = plan.actions.map((a) => {
        const intent = a.id.replace(/^task-/, ""); if (!["resume", "status", "review", "handoff"].includes(intent)) throw new Error("The recommended workflow has an unsupported stable meaning.");
        return { actionId: a.id, roleId: intent === "review" ? "reviewer" : "builder", intent };
      });
      const document = createPortablePackage(p, { modePreference: "keyboard-only", intentAssignments }), review = await store.reviewProfilePackage(compartment, document), id = randomUUID();
      open();
      const expiresAt = Math.min(now() + lifetime, ...snapshots.map((s) => Date.parse(s.capturedAt) + lifetime));
      reviews.set(id, { compartment, sources: snapshots.map((s, i) => ({ deviceId: ids[i], digest: digest(s) })), document, packageReviewId: review.reviewId, expiresAt });
      return { ...review, reviewId: id, source: { readouts: snapshots.map((s, i) => ({ capturedAt: s.capturedAt, definitionSha256: matches[i].definitionSha256 })), currentTypingPreserved: true, hardwareOrCaseVerified: false, liveConnectionVerified: false }, unassignedActions: plan.actions.filter((a) => !a.binding).map((a) => a.id), expiresAt, note: "The workflow uses the captured typing layer, including opaque keycodes. Ambiguous or missing positions stay unassigned. Adopting it changes saved definitions only; review physical choices and connect local tools separately." };
    },
    async adopt(compartment, { reviewId }) {
      open();
      const review = reviews.get(reviewId);
      if (!review || review.compartment !== compartment) throw new Error("Review this exact keyboard workflow in this workspace first.");
      reviews.delete(reviewId);
      if (review.expiresAt < now()) throw new Error("The readout workflow review expired. Read and review it again.");
      const result = await store.importProfilePackage(compartment, review.document, review.packageReviewId, { verifySource: (state) => {
        open();
        if (review.sources.some((s) => digest(readout(state, s.deviceId)) !== s.digest)) throw new Error("A protected readout changed after review. Saved definitions are unchanged; review the new readouts.");
      } });
      return { ...result, sourceReviewConsumed: true, hardwareChanged: false, hostConnectionApplied: false };
    },
    close() { closed = true; reviews.clear(); }
  };
}
