import { api } from "./connection.mjs";
/** Explicit switch-position samples. Never polls, records text or persists samples. */
export function mountDeviceDiagnostic({ notify }) {
  const $ = id => document.getElementById(id);
  let snapshot = null, compartment = "personal", permitted = false, parentBusy = false, busy = false, generation = 0, review = null, session = null, timer = null;
  function controls() {
    $("device-key-test").ariaBusy = String(busy);
    $("review-key-test").disabled = busy || parentBusy || !snapshot?.identity.vialProtocol || !permitted || !!session;
    $("start-key-test").disabled = busy || parentBusy || !review || !$("key-test-consent").checked;
    $("sample-key-test").disabled = busy || parentBusy || !session;
    $("stop-key-test").disabled = !session;
    $("relock-keyboard").disabled = busy || parentBusy || !snapshot?.identity.vialProtocol;
  }
  function clear() { generation++; clearTimeout(timer); timer = null; review = null; session = null; $("key-test-review-dialog").close(); $("key-test-consent").checked = false; $("key-test-result").replaceChildren(); controls(); }
  function status(text) { $("key-test-status").textContent = text; }
  async function stop(text = "Test stopped. Displayed samples cleared. Firmware has not been relocked.") {
    const previous = session, scope = compartment; clear(); const version = generation;
    if (!previous) return;
    try { await api("/api/suite/devices/matrix/stop", { compartment: scope, id: previous.id }); if (generation === version) status(text); }
    catch (error) { if (generation === version) { status(`Samples cleared. Stop was not confirmed: ${error.message}`); notify(error.message); } }
  }
  async function run(fn) {
    if (busy || parentBusy) return;
    busy = true; controls(); const version = generation, scope = compartment;
    try { await fn({ scope, current: () => generation === version }); }
    catch (error) { if (generation === version) { clear(); status(error.message); notify(error.message); } }
    finally { busy = false; controls(); }
  }
  $("review-key-test").addEventListener("click", () => run(async ({ scope, current }) => {
    if (!snapshot || !permitted || session) return;
    const result = await api("/api/suite/devices/matrix/review", { compartment: scope, deviceId: snapshot.identity.deviceId });
    if (!current()) return;
    review = result; $("key-test-consent").checked = false;
    $("key-test-notice").textContent = `${result.rows} × ${result.cols} switch matrix · ${result.durationMs / 1000} seconds · at most ${result.maximumSamples} manual samples.\n\n${result.notice}`;
    $("key-test-review-dialog").showModal();
  }));
  $("key-test-consent").addEventListener("change", controls);
  $("cancel-key-test").addEventListener("click", () => { review = null; $("key-test-review-dialog").close(); controls(); });
  $("key-test-review-dialog").addEventListener("close", () => { review = null; controls(); });
  $("start-key-test").addEventListener("click", () => run(async ({ scope, current }) => {
    if (!review || !$("key-test-consent").checked) return;
    const { reviewId, consentToken } = review; review = null; $("key-test-review-dialog").close();
    const result = await api("/api/suite/devices/matrix/start", { compartment: scope, reviewId, consentToken, consent: true });
    if (!current()) { await api("/api/suite/devices/matrix/stop", { compartment: scope, id: result.id }).catch(() => {}); return; }
    session = result; status("Test active for up to 60 seconds. Hold test keys and choose Sample held keys. Nothing is sampled automatically.");
    timer = setTimeout(() => { void stop("Test expired. Displayed samples cleared. Firmware has not been relocked."); }, Math.max(0, result.expiresAt - Date.now())); timer.unref?.();
  }));
  $("sample-key-test").addEventListener("click", () => run(async ({ scope, current }) => {
    if (!session) return;
    const id = session.id, result = await api("/api/suite/devices/matrix/sample", { compartment: scope, id });
    if (!current() || session?.id !== id) return;
    const output = document.createElement("p"); output.textContent = result.pressed.length ? result.pressed.map(([row, col]) => `Row ${row}, column ${col}`).join(" · ") : "No switches held in this sample.";
    $("key-test-result").replaceChildren(output); status(`Sample ${result.sequence}. ${result.provenance}. This replaces the previous sample; nothing is saved.`);
  }));
  $("stop-key-test").addEventListener("click", () => { void stop(); });
  $("relock-keyboard").addEventListener("click", () => run(async ({ scope }) => {
    if (!snapshot) return; const deviceId = snapshot.identity.deviceId; clear(); const version = generation;
    try { const result = await api("/api/suite/devices/lock", { compartment: scope, deviceId });
      if (generation === version) status(result.lockedVerified ? "Firmware lock verified. No configuration was changed." : "Firmware lock was not verified.");
    } catch (error) { if (generation === version) { status(error.message); notify(error.message); } }
  }));
  document.addEventListener("switchyard-workspace-changing", () => { clear(); snapshot = null; permitted = false; status("No key test is active in this view."); controls(); });
  document.addEventListener("switchyard-compartment-state", event => {
    const next = event.detail, allowed = next.mode !== "keyboard-only" && next.policyRules?.recording === true;
    if (compartment !== next.id || !allowed) clear(); compartment = next.id; permitted = allowed; controls();
  });
  return { update(value) { if (session) void stop(); else clear(); snapshot = value; controls(); }, busy(value) { parentBusy = value; controls(); } };
}
