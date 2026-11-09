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

export async function api(path, body, { selectedWorkspace = false } = {}) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${localStorage.getItem(credentialKey) ?? ""}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(selectedWorkspace ? body : { compartment: activeCompartment, ...body }) }), signal: AbortSignal.timeout(path.endsWith("/design") || path.endsWith("/voice/segment") ? 130000 : 15000)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "The local connection is unavailable.");
  document.getElementById("connect-local").hidden = true;
  return value;
}

export function connectWorkspace({ getPlan, notify, request = api }) {
  let reviewed = null;
  let receipt = null;
  let busy = false;
  let snapshot = null, roleTargets = [], workspace = null, generation = 0;
  const roleTarget = () => $("connection-role-target").value === "" ? null : roleTargets[Number($("connection-role-target").value)];
  const roleConnection = () => $("connection-implementation").value === "switchyard.role/v1";
  function invalidate() {
    generation++; reviewed = null;
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
    $("connection-role-wrap").hidden = !roleConnection();
    $("connection-description").textContent = roleConnection() ? "Installs a shortcut for the saved role control. Its target is checked again whenever the shortcut runs." : "Focuses the verified native ChatGPT main window. This does not resume a particular task.";
    $("review-connection").disabled = busy || !getPlan() || getPlan().profile.evidence === "source-reference" || !$("connection-action").value || !snapshot?.shortcuts || (roleConnection() ? !roleTarget() || workspace?.mode === "keyboard-only" : snapshot.chatgpt?.status !== "focusable");
    $("apply-connection").disabled = busy || !reviewed;
    $("restore-connection").disabled = busy || !receipt || !["prepared", "applying", "applied", "kept", "recovery-pending"].includes(receipt.status);
    $("trial-connection").disabled = busy || !receipt || !["applied", "kept"].includes(receipt.status);
    $("keep-connection").disabled = busy || receipt?.status !== "applied" || receipt?.trial !== "verified";
    $("connection-receipt").textContent = receipt
      ? `${receipt.shortcut} · ${receipt.status.replaceAll("-", " ")} · ${receipt.trial === "verified" ? "connection trial verified" : "trial not verified"}${receipt.detail ? `. ${receipt.detail}` : ""}`
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
    const transactions = await request("/api/transactions");
    receipt = transactions.find((t) => ["prepared", "applying", "applied", "kept", "recovery-pending"].includes(t.status)) ?? transactions[0] ?? null;
    controls();
  }
  async function refresh() {
    $("discovery-status").textContent = "Checking this computer…";
    try {
      snapshot = await request("/api/discovery");
      $("demo-banner").hidden = snapshot.synthetic !== true;
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
  document.addEventListener("switchyard-workspace-changing", () => { generation++; workspace = null; roleTargets = []; reviewed = null; $("host-review-dialog").close(); controls(); });
  document.addEventListener("switchyard-compartment-state", event => {
    generation++; workspace = event.detail;
    const previous = roleTarget();
    roleTargets = (workspace.roleBindings ?? []).map(b => ({ roleId: b.roleId, intent: b.intent }));
    $("connection-role-target").replaceChildren();
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = roleTargets.length ? "Choose a connected control" : "Connect a control in Your tools first";
    $("connection-role-target").append(empty);
    roleTargets.forEach((target, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = `${workspace.workflow.roles.find(r => r.id === target.roleId)?.label ?? "Saved role"} · ${({ status: "Check progress", resume: "Return to task", review: "Review work", handoff: "Leave a handoff", summon: "Open app", cancel: "Cancel turn" })[target.intent]}`; $("connection-role-target").append(o); });
    const index = roleTargets.findIndex(t => t.roleId === previous?.roleId && t.intent === previous?.intent);
    if (index >= 0) $("connection-role-target").value = String(index);
    reviewed = null; $("host-review-dialog").close(); controls();
  });
  for (const id of ["connection-implementation", "connection-role-target"]) $(id).addEventListener("change", () => { generation++; reviewed = null; controls(); });
  $("refresh-discovery").addEventListener("click", refresh);
  document.addEventListener("switchyard-local-connected", refresh);
  $("connection-action").addEventListener("change", () => { generation++; reviewed = null; controls(); });
  $("review-connection").addEventListener("click", () => run(async () => {
    const version = generation, label = roleConnection() ? $("connection-role-target").selectedOptions[0]?.textContent : null;
    const result = await request("/api/review", { plan: getPlan(), actionId: $("connection-action").value, implementation: $("connection-implementation").value, ...(roleConnection() ? { target: roleTarget() } : {}) });
    if (version !== generation) return;
    reviewed = result;
    $("host-review-title").textContent = `${reviewed.shortcut} → ${label ?? reviewed.label}`;
    $("host-review-changes").replaceChildren(...reviewed.changes.map((text) => { const li = document.createElement("li"); li.textContent = text; return li; }));
    $("connection-message").textContent = "";
    $("host-review-dialog").showModal();
  }));
  $("cancel-connection").addEventListener("click", () => { reviewed = null; $("host-review-dialog").close(); controls(); });
  $("apply-connection").addEventListener("click", () => run(async () => {
    const reviewId = reviewed?.reviewId;
    reviewed = null;
    receipt = await request("/api/apply", { reviewId });
    $("host-review-dialog").close();
    $("connection-message").textContent = "Shortcut applied and read back. Try it, then keep it or restore the previous configuration.";
    notify("Desktop shortcut verified. Your keyboard firmware is unchanged.");
  }));
  for (const [button, path] of [["restore-connection", "/api/restore"], ["trial-connection", "/api/trial"], ["keep-connection", "/api/keep"]]) {
    $(button).addEventListener("click", () => run(async () => {
      receipt = await request(path, { id: receipt.id });
      $("connection-message").textContent = path === "/api/trial" ? "The connected implementation completed its trial. Review the receipt; physical keypress and exact-task behavior need their own check." : path === "/api/keep" ? "Kept on this host. Restore remains available after restarting Switchyard." : "Previous host configuration restored and verified.";
      notify($("connection-message").textContent);
    }));
  }
  invalidate();
  void refresh();
  return { invalidate };
}
