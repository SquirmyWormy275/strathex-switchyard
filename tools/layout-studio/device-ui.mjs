import { api } from "./connection.mjs";
import { mountDeviceSettings, deviceKeyEditor, deviceKeyName, describeDynamic } from "./device-settings-ui.mjs";
import { mountDeviceDiagnostic } from "./device-diagnostic-ui.mjs";
const $ = (id) => document.getElementById(id);

const option = (value, label) => { const o = document.createElement("option"); o.value = String(value); o.textContent = label; return o; };

export function mountDevices({ onSnapshot, notify }) {
  let snapshot, review, receipt, busy = false, savedSnapshots = [], compartment = "personal", generation = 0, settings, keyEditor, diagnostic;
  const savedSnapshot = () => savedSnapshots.find(s => s.identity.deviceId === $("saved-device-picker").value);
  function invalidateReview() { generation++; review = null; $("device-review-dialog").close(); $("device-review-summary").textContent = ""; controls(); }
  function clearReview() { snapshot = null; keyEditor = null; settings?.update(null); diagnostic?.update(null); $("device-key-editor").replaceChildren(); invalidateReview(); }
  function setSnapshot(value) { snapshot = value; settings.update(value); diagnostic.update(value); $("device-layer").replaceChildren(...Array.from({ length: value.layers }, (_, i) => option(i, i === 0 ? "Layer 0 · ordinary typing" : `Layer ${i}`))); keys(); }
  function editKey() { invalidateReview(); const position = $("device-key").value; if (!snapshot || !position) { keyEditor = null; $("device-key-editor").replaceChildren(); return; } const [r, c] = position.split(":").map(Number); keyEditor = deviceKeyEditor(snapshot, snapshot.keymap_raw[Number($("device-layer").value)][r][c], invalidateReview, { transparent: true }); $("device-key-editor").replaceChildren(keyEditor.element); }
  function savedControls() {
    const selected = savedSnapshot();
    $("inspect-saved-device").disabled = busy || !selected;
    $("use-saved-device").disabled = busy || !selected?.definition;
    $("plan-saved-device").disabled = busy || !selected?.keymap_raw;
    $("saved-device-facts").replaceChildren();
    $("saved-device-status").textContent = selected ? `Captured ${new Date(selected.capturedAt).toLocaleString()} · ${selected.layers} layers · ${selected.rows} × ${selected.cols} matrix. This is saved evidence, not a live connection.` : "No saved readouts in this workspace. Import one, or deliberately read a connected keyboard below.";
  }
  $("saved-device-picker").addEventListener("change", () => { clearReview(); savedControls(); });
  $("import-device-readout").addEventListener("click", () => { $("profile-dialog").showModal(); $("snapshot-file").closest("details").open = true; $("snapshot-file").focus(); });
  $("plan-saved-device").addEventListener("click", () => { const saved = savedSnapshot(); if (saved?.keymap_raw) { invalidateReview(); setSnapshot(saved); message("Planning from a saved readout. Review will read the connected keyboard; no device has been opened by this selection."); } });
  $("use-saved-device").addEventListener("click", () => { if (savedSnapshot()) onSnapshot(savedSnapshot()); });
  $("inspect-saved-device").addEventListener("click", () => run(async () => {
    const selected = savedSnapshot(), version = generation;
    if (!selected) return;
    const result = await api("/api/suite/devices/identify", { compartment, deviceId: selected.identity.deviceId });
    if (version !== generation) return;
    $("saved-device-status").textContent = result.reason;
    const facts = [
      ["Source match", result.status === "source-identity-match" ? "Definition and firmware ID match pinned source" : result.status.replaceAll("-", " ")],
      ["Matching designs", result.suggestedModels.map(m => m.name).join(", ") || "No complete model match"],
      ["Readout", `${new Date(result.capturedAt).toLocaleString()} · ${result.snapshotStatus === "recent-readout" ? "recent" : "historical"}`],
      ["Controller hardware", "Not verified by this source comparison"],
      ["Solenoid", result.haptics?.sourceSupport === "declared-solenoid" ? "Declared in matched source; live state and controls unavailable" : "No verified control route"]
    ];
    $("saved-device-facts").replaceChildren(...facts.flatMap(([name, value]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = name; dd.textContent = value; return [dt, dd]; }));
  }));
  document.addEventListener("switchyard-workspace-changing", () => { savedSnapshots = []; receipt = null; clearReview(); savedControls(); });

  const message = (s) => { $("device-status").textContent = s; };
  async function run(fn) { if (busy) return; busy = true; controls(); const version = generation, scope = compartment; try { await fn({ scope, current: () => version === generation }); } catch (e) { if (version === generation) { message(e.message); notify(e.message); document.dispatchEvent(new Event("switchyard-refresh-request")); } } finally { busy = false; controls(); } }
  function controls() { settings?.busy(busy); diagnostic?.busy(busy); for (const id of ["saved-device-picker", "device-picker", "device-layer", "device-key"]) $(id).disabled = busy; $("device-key-editor").inert = busy; $("plan-saved-device").disabled = busy || !savedSnapshot()?.keymap_raw; $("inspect-saved-device").disabled = busy || !savedSnapshot(); $("use-saved-device").disabled = busy || !savedSnapshot()?.definition; $("read-device").disabled = busy || !$("device-picker").value; $("review-device-change").disabled = busy || !snapshot || !$("device-key").value; $("apply-device-change").disabled = busy || !review; $("restore-device-change").disabled = busy || !receipt; $("unlock-device").disabled = busy || !snapshot?.identity.vialProtocol; }
  function keys() {
    if (!snapshot) return;
    invalidateReview(); const layer = Number($("device-layer").value); keyEditor = null; $("device-key-editor").replaceChildren();
    $("device-key").replaceChildren(option("", "Choose a recorded matrix position"));
    for (let r = 0; r < snapshot.rows; r++) for (let c = 0; c < snapshot.cols; c++) {
      const code = snapshot.keymap_raw[layer][r][c];
      $("device-key").append(option(`${r}:${c}`, `Row ${r}, column ${c} · ${deviceKeyName(code)}`));
    }
    controls();
  }
  document.addEventListener("switchyard-compartment-state", (event) => {
    if (compartment !== event.detail.id) clearReview();
    compartment = event.detail.id;
    receipt = event.detail.deviceTransactions?.findLast((t) => ["applied", "applying", "recovery-pending"].includes(t.status)) ?? null;
    const previous = $("saved-device-picker").value;
    savedSnapshots = event.detail.deviceSnapshots ?? [];
    $("saved-device-picker").replaceChildren(option("", savedSnapshots.length ? "Choose a saved readout" : "No saved readouts in this workspace"), ...savedSnapshots.map(s => option(s.identity.deviceId, `${s.definition?.name ?? "Keyboard"} · ${new Date(s.capturedAt).toLocaleString()}`)));
    if (savedSnapshots.some(s => s.identity.deviceId === previous)) $("saved-device-picker").value = previous;
    else if (savedSnapshots.length === 1) $("saved-device-picker").value = savedSnapshots[0].identity.deviceId;
    savedControls(); controls();
  });
  $("discover-devices").addEventListener("click", () => run(async ({ scope, current }) => {
    const devices = await api("/api/suite/devices/list", { compartment: scope });
    if (!current()) return;
    clearReview();
    $("device-picker").replaceChildren(option("", devices.length ? "Select a configuration interface" : "No supported configuration interface connected"), ...devices.map((d) => option(d.id, `${d.name} · ${d.candidateProtocol} · ${d.vendor_id.toString(16)}:${d.product_id.toString(16)}`)));
    message(devices.length ? "Select the exact configuration interface, then read its firmware identity. Controller hardware is not inferred from the product label." : "No supported interface is connected. Saved preview and host configuration remain useful. Connect the F77 and discover again for a fresh live read.");
  }));
  $("device-picker").addEventListener("change", () => { clearReview(); });
  $("read-device").addEventListener("click", () => run(async () => {
    const version = generation;
    const captured = await api("/api/suite/devices/read", { compartment, deviceId: $("device-picker").value });
    if (version !== generation) return;
    setSnapshot(captured);
    document.dispatchEvent(new Event("switchyard-refresh-request"));
    message(`Read ${snapshot.layers} layers on a ${snapshot.rows} × ${snapshot.cols} matrix. ${snapshot.identity.vialProtocol ? `VIA ${snapshot.identity.viaProtocol}, Vial ${snapshot.identity.vialProtocol}` : snapshot.identity.protocol}. Controller: ${snapshot.identity.controller}. Baseline covers configuration, not a firmware image.`);
    if (snapshot.definition) onSnapshot(snapshot);
  }));
  $("device-layer").addEventListener("change", keys);
  $("device-key").addEventListener("change", editKey);
  document.addEventListener("switchyard-plan-change", invalidateReview);
  async function reviewConfiguration(configuration) { return run(async ({ scope, current }) => {
    if (!snapshot) throw Error("Choose a saved readout or read a keyboard first.");
    const result = await api("/api/suite/devices/review", { compartment: scope, deviceId: snapshot.identity.deviceId, configuration });
    if (!current()) return;
    review = result;
    const lines = [
      ...review.changes.map(c => `Layer ${c.layer}, matrix ${c.row},${c.col}: ${deviceKeyName(c.before)} → ${deviceKeyName(c.after)}`),
      ...(review.macros ?? []).map(m => `Macro ${m.index}: ${m.beforeBytes} → ${m.afterBytes} bytes. ${m.actions.length ? m.actions.map(a => a.type === "text" ? `Type “${a.text}”` : a.type === "delay" ? `Wait ${a.milliseconds} ms` : `${a.type} ${deviceKeyName(a.keycode)}`).join("; ") : "Clear this slot"}. These keystrokes go to the foreground application.`),
      ...(review.layoutOptions?.choices ?? []).map(c => `${c.label}: ${c.before} → ${c.after}`),
      ...(review.qmkSettings ?? []).map(c => `${c.name}: ${c.before} → ${c.after}`),
      ...(review.dynamic ?? []).map(c => `${c.kind} ${c.index}: Before: ${describeDynamic(c.kind, c.before)}. After: ${describeDynamic(c.kind, c.after)}`),
      ...(review.encoders ?? []).map(c => `Layer ${c.layer}, encoder ${c.index}, direction ${c.direction}: ${deviceKeyName(c.before)} → ${deviceKeyName(c.after)}`)
    ];
    $("device-review-summary").textContent = lines.join("\n\n") + "\n\n" + review.note;
    $("device-review-dialog").showModal();
  }); }
  $("review-device-change").addEventListener("click", () => { try {
    if (!snapshot || !keyEditor || !$("device-key").value) return;
    const [row, col] = $("device-key").value.split(":").map(Number), layer = Number($("device-layer").value);
    void reviewConfiguration({ changes: [{ layer, row, col, before: snapshot.keymap_raw[layer][row][col], after: keyEditor.value() }] });
  } catch (error) { message(error.message); notify(error.message); } });
  $("device-review-dialog").addEventListener("close", () => { $("device-review-summary").textContent = ""; if (review) invalidateReview(); });
  $("cancel-device-change").addEventListener("click", () => { review = null; $("device-review-dialog").close(); $("device-review-summary").textContent = ""; controls(); });
  $("apply-device-change").addEventListener("click", () => run(async ({ scope, current }) => {
    if (!review) return;
    const reviewId = review.reviewId; review = null;
    const result = await api("/api/suite/devices/apply", { compartment: scope, reviewId });
    if (!current()) return;
    receipt = result; clearReview();
    message("Configuration change applied and read back. Test ordinary typing and the new control; Restore is available.");
    document.dispatchEvent(new Event("switchyard-refresh-request"));
  }));
  $("restore-device-change").addEventListener("click", () => run(async ({ scope, current }) => {
    if (!receipt) return;
    const result = await api("/api/suite/devices/restore", { compartment: scope, id: receipt.id });
    if (!current()) return;
    message(`Device transaction ${result.status}. Test ordinary typing after restoration.`); receipt = null; clearReview();
    document.dispatchEvent(new Event("switchyard-refresh-request"));
  }));
  $("unlock-device").addEventListener("click", () => run(async ({ scope, current }) => {
    if (!snapshot) return;
    const deviceId = snapshot.identity.deviceId;
    let state = await api("/api/suite/devices/unlock", { compartment: scope, deviceId, operation: "start" });
    if (!current()) return;
    message(`Hold the device's physical unlock keys at matrix ${state.physicalKeys.map(k => k.join(",")).join(" and ")}. No keypress is synthesized.`);
    for (let n = 0; n < 75 && !state.unlocked; n++) {
      await new Promise(resolve => setTimeout(resolve, 150)); if (!current()) return;
      state = await api("/api/suite/devices/unlock", { compartment: scope, deviceId, operation: "poll" });
    }
    if (current()) message(state.unlocked ? "Physical unlock verified. Review the exact change again before Apply." : "Physical unlock was not completed. The configuration remains locked.");
  }));
  settings = mountDeviceSettings({ review: reviewConfiguration, changed: invalidateReview, notify });
  diagnostic = mountDeviceDiagnostic({ notify });
  settings.update(null);
  controls();
}
