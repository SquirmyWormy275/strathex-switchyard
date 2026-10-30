import { api } from "/connection.mjs";
const $ = (id) => document.getElementById(id);
const common = [[0, "Unassigned"], [1, "Transparent"], ...Array.from({ length: 26 }, (_, i) => [i + 4, String.fromCharCode(65 + i)]), ...Array.from({ length: 10 }, (_, i) => [i + 30, String((i + 1) % 10)]), [40, "Enter"], [41, "Escape"], [42, "Backspace"], [43, "Tab"], [44, "Space"], ...Array.from({ length: 12 }, (_, i) => [i + 58, `F${i + 1}`]), ...Array.from({ length: 12 }, (_, i) => [i + 104, `F${i + 13}`]), [224, "Left Control"], [225, "Left Shift"], [226, "Left Alt"], [227, "Left Super"], [228, "Right Control"], [229, "Right Shift"], [230, "Right Alt"], [231, "Right Super"]];
const option = (value, label) => { const o = document.createElement("option"); o.value = String(value); o.textContent = label; return o; };

export function mountDevices({ onSnapshot, notify, getProfile }) {
  let snapshot, review, receipt, busy = false;
  const message = (s) => { $("device-status").textContent = s; };
  async function run(fn) { if (busy) return; busy = true; controls(); try { await fn(); } catch (e) { message(e.message); notify(e.message); } finally { busy = false; controls(); } }
  function controls() { $("read-device").disabled = busy || !$("device-picker").value; $("review-device-change").disabled = busy || !snapshot || !$("device-key").value; $("apply-device-change").disabled = busy || !review; $("restore-device-change").disabled = busy || !receipt; $("unlock-device").disabled = busy || !snapshot?.identity.vialProtocol; }
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
  document.addEventListener("switchyard-compartment-state", (event) => { receipt = event.detail.deviceTransactions?.findLast((t) => ["applied", "applying", "recovery-pending"].includes(t.status)) ?? null; controls(); });
  $("discover-devices").addEventListener("click", () => run(async () => {
    const devices = await api("/api/suite/devices/list", {});
    snapshot = null; review = null;
    $("device-picker").replaceChildren(option("", devices.length ? "Select a configuration interface" : "No supported configuration interface connected"), ...devices.map((d) => option(d.id, `${d.name} · ${d.candidateProtocol} · ${d.vendor_id.toString(16)}:${d.product_id.toString(16)}`)));
    message(devices.length ? "Select the exact configuration interface, then read its firmware identity. Controller hardware is not inferred from the product label." : "No supported interface is connected. Saved preview and host configuration remain useful. Connect the F77 and discover again for a fresh live read.");
  }));
  $("device-picker").addEventListener("change", () => { snapshot = null; review = null; controls(); });
  $("read-device").addEventListener("click", () => run(async () => {
    snapshot = await api("/api/suite/devices/read", { deviceId: $("device-picker").value });
    $("device-layer").replaceChildren(...Array.from({ length: snapshot.layers }, (_, i) => option(i, i === 0 ? "Layer 0 · ordinary typing" : `Layer ${i}`)));
    keys();
    message(`Read ${snapshot.layers} layers on a ${snapshot.rows} × ${snapshot.cols} matrix. ${snapshot.identity.vialProtocol ? `VIA ${snapshot.identity.viaProtocol}, Vial ${snapshot.identity.vialProtocol}` : snapshot.identity.protocol}. Controller: ${snapshot.identity.controller}. Baseline covers configuration, not a firmware image.`);
    if (snapshot.definition) onSnapshot(snapshot);
  }));
  $("device-layer").addEventListener("change", keys);
  for (const id of ["device-key", "device-after"]) $(id).addEventListener("change", () => { review = null; controls(); });
  $("review-device-change").addEventListener("click", () => run(async () => {
    const [row, col] = $("device-key").value.split(":").map(Number), layer = Number($("device-layer").value);
    review = await api("/api/suite/devices/review", { deviceId: snapshot.identity.deviceId, changes: [{ layer, row, col, before: snapshot.keymap_raw[layer][row][col], after: Number($("device-after").value) }] });
    $("device-review-summary").textContent = `${review.changes.map((c) => `Layer ${c.layer}, matrix ${c.row},${c.col}: ${c.before} → ${c.after}`).join("; ")}. ${review.note}`;
    $("device-review-dialog").showModal();
  }));
  $("cancel-device-change").addEventListener("click", () => { review = null; $("device-review-dialog").close(); controls(); });
  $("apply-device-change").addEventListener("click", () => run(async () => { const reviewId = review.reviewId; review = null; receipt = await api("/api/suite/devices/apply", { reviewId }); $("device-review-dialog").close(); message("Configuration change applied and read back. Test ordinary typing and the new control; Restore is available."); }));
  $("restore-device-change").addEventListener("click", () => run(async () => { const r = await api("/api/suite/devices/restore", { id: receipt.id }); message(`Device transaction ${r.status}. Test ordinary typing after restoration.`); receipt = null; snapshot = null; }));
  $("unlock-device").addEventListener("click", () => run(async () => {
    let state = await api("/api/suite/devices/unlock", { deviceId: snapshot.identity.deviceId, operation: "start" });
    message(`Hold the device's physical unlock keys at matrix ${state.physicalKeys.map((k) => k.join(",")).join(" and ")}. No keypress is synthesized.`);
    for (let n = 0; n < 75 && !state.unlocked; n++) { await new Promise((r) => setTimeout(r, 150)); state = await api("/api/suite/devices/unlock", { deviceId: snapshot.identity.deviceId, operation: "poll" }); }
    message(state.unlocked ? "Physical unlock verified. Review the exact change again before Apply." : "Physical unlock was not completed. The configuration remains locked.");
  }));
  controls();
}
