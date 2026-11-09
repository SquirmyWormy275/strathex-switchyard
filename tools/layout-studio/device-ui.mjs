import { api } from "./connection.mjs";
const $ = (id) => document.getElementById(id);
const common = [[0, "Unassigned"], [1, "Transparent"], ...Array.from({ length: 26 }, (_, i) => [i + 4, String.fromCharCode(65 + i)]), ...Array.from({ length: 10 }, (_, i) => [i + 30, String((i + 1) % 10)]), [40, "Enter"], [41, "Escape"], [42, "Backspace"], [43, "Tab"], [44, "Space"], ...Array.from({ length: 12 }, (_, i) => [i + 58, `F${i + 1}`]), ...Array.from({ length: 12 }, (_, i) => [i + 104, `F${i + 13}`]), [224, "Left Control"], [225, "Left Shift"], [226, "Left Alt"], [227, "Left Super"], [228, "Right Control"], [229, "Right Shift"], [230, "Right Alt"], [231, "Right Super"]];
const option = (value, label) => { const o = document.createElement("option"); o.value = String(value); o.textContent = label; return o; };

export function mountDevices({ onSnapshot, notify, getProfile }) {
  let snapshot, review, receipt, busy = false, savedSnapshots = [], compartment = "personal", generation = 0;
  const savedSnapshot = () => savedSnapshots.find(s => s.identity.deviceId === $("saved-device-picker").value);
  function clearReview() { generation++; snapshot = null; review = null; $("device-review-dialog").close(); controls(); }
  function savedControls() {
    const selected = savedSnapshot();
    $("inspect-saved-device").disabled = busy || !selected;
    $("use-saved-device").disabled = busy || !selected?.definition;
    $("saved-device-facts").replaceChildren();
    $("saved-device-status").textContent = selected ? `Captured ${new Date(selected.capturedAt).toLocaleString()} · ${selected.layers} layers · ${selected.rows} × ${selected.cols} matrix. This is saved evidence, not a live connection.` : "No saved readouts in this workspace. Import one, or deliberately read a connected keyboard below.";
  }
  $("saved-device-picker").addEventListener("change", () => { generation++; savedControls(); });
  $("import-device-readout").addEventListener("click", () => { $("profile-dialog").showModal(); $("snapshot-file").closest("details").open = true; $("snapshot-file").focus(); });
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
  async function run(fn) { if (busy) return; busy = true; controls(); const version = generation, scope = compartment; try { await fn({ scope, current: () => version === generation }); } catch (e) { message(e.message); notify(e.message); } finally { busy = false; controls(); } }
  function controls() { $("inspect-saved-device").disabled = busy || !savedSnapshot(); $("use-saved-device").disabled = busy || !savedSnapshot()?.definition; $("read-device").disabled = busy || !$("device-picker").value; $("review-device-change").disabled = busy || !snapshot || !$("device-key").value; $("apply-device-change").disabled = busy || !review; $("restore-device-change").disabled = busy || !receipt; $("unlock-device").disabled = busy || !snapshot?.identity.vialProtocol; }
  function keys() {
    if (!snapshot) return;
    const layer = Number($("device-layer").value); review = null;
    const known = getProfile()?.plan.profile.keys ?? [];
    $("device-key").replaceChildren(option("", "Choose a verified matrix position"));
    for (let r = 0; r < snapshot.rows; r++) for (let c = 0; c < snapshot.cols; c++) {
      const physical = known.find((k) => k.matrix[0] === r && k.matrix[1] === c);
      if (known.length && !physical) continue;
      const code = snapshot.keymap_raw[layer][r][c];
      $("device-key").append(option(`${r}:${c}`, `${physical?.label ?? `Row ${r}, column ${c}`} · ${common.find(([n]) => n === code)?.[1] ?? `code 0x${code.toString(16)}`}`));
    }
    controls();
  }
  $("device-after").replaceChildren(...common.map(([value, label]) => option(value, label)));
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
    snapshot = null; review = null;
    $("device-picker").replaceChildren(option("", devices.length ? "Select a configuration interface" : "No supported configuration interface connected"), ...devices.map((d) => option(d.id, `${d.name} · ${d.candidateProtocol} · ${d.vendor_id.toString(16)}:${d.product_id.toString(16)}`)));
    message(devices.length ? "Select the exact configuration interface, then read its firmware identity. Controller hardware is not inferred from the product label." : "No supported interface is connected. Saved preview and host configuration remain useful. Connect the F77 and discover again for a fresh live read.");
  }));
  $("device-picker").addEventListener("change", () => { clearReview(); });
  $("read-device").addEventListener("click", () => run(async () => {
    const version = generation;
    const captured = await api("/api/suite/devices/read", { compartment, deviceId: $("device-picker").value });
    if (version !== generation) return;
    snapshot = captured;
    document.dispatchEvent(new Event("switchyard-refresh-request"));
    $("device-layer").replaceChildren(...Array.from({ length: snapshot.layers }, (_, i) => option(i, i === 0 ? "Layer 0 · ordinary typing" : `Layer ${i}`)));
    keys();
    message(`Read ${snapshot.layers} layers on a ${snapshot.rows} × ${snapshot.cols} matrix. ${snapshot.identity.vialProtocol ? `VIA ${snapshot.identity.viaProtocol}, Vial ${snapshot.identity.vialProtocol}` : snapshot.identity.protocol}. Controller: ${snapshot.identity.controller}. Baseline covers configuration, not a firmware image.`);
    if (snapshot.definition) onSnapshot(snapshot);
  }));
  $("device-layer").addEventListener("change", keys);
  for (const id of ["device-key", "device-after"]) $(id).addEventListener("change", () => { review = null; controls(); });
  $("review-device-change").addEventListener("click", () => run(async ({ scope, current }) => {
    const [row, col] = $("device-key").value.split(":").map(Number), layer = Number($("device-layer").value);
    const result = await api("/api/suite/devices/review", { compartment: scope, deviceId: snapshot.identity.deviceId, changes: [{ layer, row, col, before: snapshot.keymap_raw[layer][row][col], after: Number($("device-after").value) }] });
    if (!current()) return;
    review = result;
    $("device-review-summary").textContent = `${review.changes.map((c) => `Layer ${c.layer}, matrix ${c.row},${c.col}: ${c.before} → ${c.after}`).join("; ")}. ${review.note}`;
    $("device-review-dialog").showModal();
  }));
  $("cancel-device-change").addEventListener("click", () => { review = null; $("device-review-dialog").close(); controls(); });
  $("apply-device-change").addEventListener("click", () => run(async ({ scope, current }) => {
    if (!review) return;
    const reviewId = review.reviewId; review = null;
    const result = await api("/api/suite/devices/apply", { compartment: scope, reviewId });
    if (!current()) return;
    receipt = result; $("device-review-dialog").close();
    message("Configuration change applied and read back. Test ordinary typing and the new control; Restore is available.");
    document.dispatchEvent(new Event("switchyard-refresh-request"));
  }));
  $("restore-device-change").addEventListener("click", () => run(async ({ scope, current }) => {
    if (!receipt) return;
    const result = await api("/api/suite/devices/restore", { compartment: scope, id: receipt.id });
    if (!current()) return;
    message(`Device transaction ${result.status}. Test ordinary typing after restoration.`); receipt = null; snapshot = null;
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
  controls();
}
