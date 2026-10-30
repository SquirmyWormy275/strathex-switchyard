/** One exact restricted turn on an exclusive owned connection. No tool authority. */
import { stopOwnedChild } from "./owned-process.mjs";
const identity = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export function runRestrictedCodexTurn({ client, threadId, text, outputSchema, onStarted = async () => {}, checkCurrent = () => {}, signal, timeoutMs = 120000, maxOutputBytes = 512 * 1024, stopChild = stopOwnedChild } = {}) {
  if (!client || client.closed || client.nativeVersion !== "0.166.0" || client.restrictionsVerified !== true || typeof client.recheckAccount !== "function" || !/^[a-f0-9]{64}$/.test(client.accountFingerprint ?? "") || !identity(threadId) || typeof text !== "string" || !text.trim() || Buffer.byteLength(text) > 1024 * 1024 || !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120000 || !Number.isInteger(maxOutputBytes) || maxOutputBytes < 128 || maxOutputBytes > 512 * 1024) throw new Error("An exact reviewed native connection and bounded text turn are required.");
  checkCurrent();
  return new Promise((resolve, reject) => {
    let turnId = null, ready = false, settled = false, stopping = false, completing = false, bufferedBytes = 0, outputBytes = 0;
    const pending = [], messages = [];
    const cleanup = () => { clearTimeout(timer); client.off("notification", notification); client.off("disconnected", disconnected); signal?.removeEventListener("abort", aborted); };
    const finish = (error, value) => { if (settled) return; settled = true; cleanup(); if (error) { error.turnId = turnId; reject(error); } else resolve(value); };
    async function stop(reason, code) {
      if (settled || stopping) return; stopping = true;
      if (turnId && !client.closed) try { await client.request("turn/interrupt", { threadId, turnId }); } catch { /* owned exit below determines containment */ }
      client.close(); const result = await stopChild(client.child).catch(() => ({ stopped: false }));
      const error = new Error(reason); error.code = code; error.stopVerified = result.stopped === true;
      finish(error);
    }
    function accept(event) {
      if (settled || stopping || completing || event.turnId !== turnId) return;
      try { checkCurrent(); } catch { void stop("The original native turn was stopped. Saved content was preserved.", "TURN_STOPPED"); return; }
      if (event.kind === "tool") { void stop("The restricted native turn attempted tool activity. No tool authority was granted.", "UNEXPECTED_TOOL"); return; }
      if (event.kind === "message") {
        outputBytes += Buffer.byteLength(event.text);
        if (outputBytes > maxOutputBytes || messages.length >= 64) { void stop("The native reply exceeded its bounded output.", "OUTPUT_BOUND"); return; }
        messages.push(event.text);
      } else if (event.kind === "completed") {
        if (event.status !== "completed") { const error = new Error("The exact native turn did not complete. Its task outcome remains unverified."); error.code = "TURN_INCOMPLETE"; error.nativeStatus = event.status; finish(error); }
        else { completing = true; void (async () => { try { await client.recheckAccount(); checkCurrent(); if (!stopping) finish(null, { threadId, turnId, messages, text: messages.at(-1) ?? "", nativeStatus: "completed", taskCompletionVerified: false }); } catch { await stop("The native account or generation changed before retaining the reply.", "ACCOUNT_UNCONFIRMED"); } })(); }
      }
    }
    function notification(m) {
      if (settled || stopping || m.params?.threadId !== threadId) return;
      let event;
      if (m.method === "item/completed" && m.params.item?.type === "agentMessage") {
        if (ready && identity(m.params.turnId) && m.params.turnId !== turnId) return;
        if (!identity(m.params.turnId) || typeof m.params.item.text !== "string" || Buffer.byteLength(m.params.item.text) > maxOutputBytes) { void stop("The native reply did not verify a bounded exact turn identity.", "INVALID_REPLY"); return; }
        event = { kind: "message", turnId: m.params.turnId, text: m.params.item.text };
      } else if (m.method === "turn/completed") {
        if (!identity(m.params.turn?.id)) { void stop("The native completion did not identify its exact turn.", "INVALID_REPLY"); return; }
        event = { kind: "completed", turnId: m.params.turn.id, status: m.params.turn.status };
      } else if (["item/started", "item/completed"].includes(m.method) && !["userMessage", "agentMessage", "reasoning", "plan", "contextCompaction"].includes(m.params.item?.type)) {
        if (!identity(m.params.turnId)) { void stop("The native tool event did not identify its exact turn.", "INVALID_REPLY"); return; }
        event = { kind: "tool", turnId: m.params.turnId };
      } else return;
      if (ready) accept(event);
      else {
        bufferedBytes += Buffer.byteLength(JSON.stringify(event));
        if (pending.length >= 128 || bufferedBytes > maxOutputBytes + 4096) { void stop("The native acknowledgement queue exceeded its bound.", "ACKNOWLEDGEMENT_BOUND"); return; }
        pending.push(event);
      }
    }
    const disconnected = () => { void stop("The owned native connection closed; completion is unconfirmed.", "DISCONNECTED"); };
    const aborted = () => { void stop("Cancellation was requested for this owned native turn.", "CANCELLED"); };
    const timer = setTimeout(() => { void stop("The exact native turn exceeded its deadline.", "TURN_TIMEOUT"); }, timeoutMs);
    client.on("notification", notification); client.on("disconnected", disconnected); signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    try { checkCurrent(); } catch { void stop("The native request was stopped before submission.", "TURN_STOPPED"); return; }
    (async () => { await client.recheckAccount(); checkCurrent(); if (stopping || settled) return null; return client.request("turn/start", { threadId, input: [{ type: "text", text }], approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false }, ...(outputSchema ? { outputSchema } : {}) }); })().then(async (value) => {
      if (settled || stopping) return;
      if (!identity(value?.turn?.id)) { await stop("The native runtime did not acknowledge an exact turn.", "INVALID_ACKNOWLEDGEMENT"); return; }
      turnId = value.turn.id;
      try { checkCurrent(); await onStarted(turnId); checkCurrent(); }
      catch { await stop("The acknowledged native turn could not retain its exact binding. No replacement was submitted.", "BINDING_UNCONFIRMED"); return; }
      if (settled || stopping) return;
      ready = true; for (const event of pending) accept(event); pending.length = 0;
    }, () => { void stop("Native submission was not acknowledged. No replacement was submitted.", "SUBMISSION_UNCONFIRMED"); });
  });
}
