/** Browser connection to the closed local bridge. Portable exports never include it. */
const $ = (id) => document.getElementById(id);
const credentialKey = "switchyard-local-access";
let activeCompartment = "personal";
export function setActiveCompartment(value) { activeCompartment = value; }
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.has("access")) {
  const token = hash.get("access");
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) localStorage.setItem(credentialKey, token);
  history.replaceState(null, "", location.pathname);
}
document.getElementById("connect-local").addEventListener("click", () => document.getElementById("access-dialog").showModal());
document.getElementById("close-access").addEventListener("click", () => document.getElementById("access-dialog").close());
document.getElementById("access-form").addEventListener("submit", (event) => {
  event.preventDefault(); const token = document.getElementById("access-code").value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { document.getElementById("access-message").textContent = "Use the 43-character local code from this running app."; return; }
  localStorage.setItem(credentialKey, token); document.getElementById("access-code").value = ""; document.getElementById("access-dialog").close(); document.dispatchEvent(new Event("switchyard-local-connected"));
});

export async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${localStorage.getItem(credentialKey) ?? ""}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify({ compartment: activeCompartment, ...body }) }), signal: AbortSignal.timeout(path.endsWith("/design") || path.endsWith("/voice/segment") ? 130000 : 15000)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "The local connection is unavailable.");
  document.getElementById("connect-local").hidden = true;
  return value;
}

export function connectWorkspace({ getPlan, notify }) {
  let reviewed = null;
  let receipt = null;
  let busy = false;
  let snapshot = null;
  function invalidate() {
    reviewed = null;
    $("host-review-dialog").close();
    const selected = $("connection-action").value;
    $("connection-action").replaceChildren();
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Choose a navigation action"; $("connection-action").append(empty);
    for (const action of getPlan()?.actions ?? []) {
      const o = document.createElement("option"); o.value = action.id; o.textContent = action.label; $("connection-action").append(o);
    }
    if ([...$("connection-action").options].some((o) => o.value === selected)) $("connection-action").value = selected;
    else if (getPlan()?.actions.length === 1) $("connection-action").value = getPlan().actions[0].id;
    controls();
  }
  function controls() {
    $("review-connection").disabled = busy || !getPlan() || !$("connection-action").value || !snapshot?.shortcuts || snapshot.chatgpt.status !== "focusable";
    $("apply-connection").disabled = busy || !reviewed;
    $("restore-connection").disabled = busy || !receipt || !["prepared", "applying", "applied", "kept", "recovery-pending"].includes(receipt.status);
    $("trial-connection").disabled = busy || !receipt || !["applied", "kept"].includes(receipt.status);
    $("keep-connection").disabled = busy || receipt?.status !== "applied" || receipt?.trial !== "verified";
    $("connection-receipt").textContent = receipt
      ? `${receipt.shortcut} · ${receipt.status.replaceAll("-", " ")} · ${receipt.trial === "verified" ? "native focus tried and verified" : "trial not verified"}${receipt.detail ? `. ${receipt.detail}` : ""}`
      : "Design first, then review a supported connection. A preview changes no desktop or keyboard settings.";
  }
  async function run(fn) {
    if (busy) return;
    busy = true; controls();
    try { await fn(); }
    catch (error) {
      $("connection-message").textContent = error.message;
      notify(error.message);
      try { await refreshReceipts(); } catch { /* keep the last visible receipt */ }
    } finally { busy = false; controls(); }
  }
  async function refreshReceipts() {
    const transactions = await api("/api/transactions");
    receipt = transactions.find((t) => ["prepared", "applying", "applied", "kept", "recovery-pending"].includes(t.status)) ?? transactions[0] ?? null;
    controls();
  }
  async function refresh() {
    $("discovery-status").textContent = "Checking this computer…";
    try {
      snapshot = await api("/api/discovery");
      $("discovery-status").textContent = snapshot.keyboard.message;
      $("discovery-detail").textContent = `Host: ${snapshot.platform} · ${snapshot.hostLayouts.length ? snapshot.hostLayouts.join(", ") : "layout unknown"} · checked ${new Date(snapshot.checkedAt).toLocaleTimeString()}. ${snapshot.chatgpt.message ?? "ChatGPT focus unavailable."}`;
      $("discovery-status").className = snapshot.keyboard.status === "candidate" ? "warn-text" : "";
      await refreshReceipts();
    } catch (error) {
      snapshot = null;
      $("discovery-status").textContent = "Design workspace available. Local host connection unavailable.";
      $("discovery-detail").textContent = error.message;
    }
    controls();
  }
  $("refresh-discovery").addEventListener("click", refresh);
  document.addEventListener("switchyard-local-connected", refresh);
  $("connection-action").addEventListener("change", () => { reviewed = null; controls(); });
  $("review-connection").addEventListener("click", () => run(async () => {
    reviewed = await api("/api/review", { plan: getPlan(), actionId: $("connection-action").value, implementation: "native-chatgpt.focus/v1" });
    $("host-review-title").textContent = `${reviewed.shortcut} → ${reviewed.label}`;
    $("host-review-changes").replaceChildren(...reviewed.changes.map((text) => { const li = document.createElement("li"); li.textContent = text; return li; }));
    $("connection-message").textContent = "";
    $("host-review-dialog").showModal();
  }));
  $("cancel-connection").addEventListener("click", () => { reviewed = null; $("host-review-dialog").close(); controls(); });
  $("apply-connection").addEventListener("click", () => run(async () => {
    const reviewId = reviewed?.reviewId;
    reviewed = null;
    receipt = await api("/api/apply", { reviewId });
    $("host-review-dialog").close();
    $("connection-message").textContent = "Shortcut applied and read back. Try it, then keep it or restore the previous configuration.";
    notify("Desktop shortcut verified. Your keyboard firmware is unchanged.");
  }));
  for (const [button, path] of [["restore-connection", "/api/restore"], ["trial-connection", "/api/trial"], ["keep-connection", "/api/keep"]]) {
    $(button).addEventListener("click", () => run(async () => {
      receipt = await api(path, { id: receipt.id });
      $("connection-message").textContent = path === "/api/trial" ? "Native ChatGPT focus verified. Physical keypress and exact task resumption are separate trials." : path === "/api/keep" ? "Kept on this host. Restore remains available after restarting Switchyard." : "Previous host configuration restored and verified.";
      notify($("connection-message").textContent);
    }));
  }
  invalidate();
  void refresh();
  return { invalidate };
}
