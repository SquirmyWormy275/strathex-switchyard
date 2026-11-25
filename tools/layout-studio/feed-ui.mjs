import { api } from "./connection.mjs";
const actions = { "install-trust": "Trust a public signing key", "install-fixture": "Install a signed feed", "revoke-fixture": "Revoke a feed", "remove-fixture": "Remove retained feed files", "revoke-trust": "Revoke a signing key" };
const option = (value, label) => { const e = document.createElement("option"); e.value = value; e.textContent = label; return e; };
export function mountFeeds({ notify }) {
  const $ = id => document.getElementById(id);
  let state = null, registry = null, policy = null, reviewed = null, generation = 0, busy = false;
  const personal = () => state?.policy === "personal", permitted = () => personal() && state.mode === "personal-companion";
  const action = () => $("feed-action").value;
  const targets = () => action() === "revoke-trust" ? (registry?.trusts ?? []).filter(t => t.status === "active") : action() === "remove-fixture" ? (registry?.storage.allocations ?? []).filter(f => ["revoked", "reserved"].includes(f.status)) : (registry?.fixtures ?? []).filter(f => f.status === "active");
  const target = () => targets().find(t => (t.authorityId && action() === "revoke-trust" ? t.authorityId + ":" + t.keyId : t.id) === $("feed-target").value);
  function controls() {
    $("load-feeds").disabled = busy || !personal(); $("recover-feeds").disabled = busy || !permitted();
    for (const id of ["feed-action", "feed-policy-file", "feed-manifest", "feed-target", "feed-reason"]) $(id).disabled = busy || !permitted();
    const ready = action() === "install-trust" ? policy : action() === "install-fixture" ? $("feed-manifest").value.trim() : target() && $("feed-reason").value.trim();
    $("review-feed").disabled = busy || !permitted() || !ready; $("confirm-feed").disabled = busy || !reviewed;
  }
  function invalidate() { generation++; reviewed = null; $("feed-review-dialog").close(); $("feed-review-summary").textContent = ""; controls(); }
  function fields() {
    $("feed-policy-wrap").hidden = action() !== "install-trust"; $("feed-manifest-wrap").hidden = action() !== "install-fixture";
    $("feed-target-wrap").hidden = ["install-trust", "install-fixture"].includes(action()); $("feed-reason-wrap").hidden = $("feed-target-wrap").hidden;
    $("feed-target").replaceChildren(...targets().map(t => option(action() === "revoke-trust" ? t.authorityId + ":" + t.keyId : t.id, action() === "revoke-trust" ? `${t.authorityId} · key ${t.keyId}` : `${t.id} · ${t.status ?? "retained allocation"}`))); controls();
  }
  function render() {
    const lines = registry ? [
      `Stored feed bytes: ${registry.storage.allocatedBytes} / ${registry.storage.maximumBytes}`,
      ...registry.trusts.map(t => `Signing key: ${t.authorityId} · ${t.status} · ${t.allowedKinds.join(", ")} · expires ${t.expiresAt}\nKey fingerprint: ${t.keyId}`),
      ...registry.fixtures.map(f => `Feed: ${f.id} · ${f.kind} · ${f.status}\nManifest: ${f.manifestSha256}`),
      ...registry.storage.allocations.map(a => `Retained files: ${a.id} · ${a.status ?? "allocated"}`)
    ] : ["Load this workspace’s installed signing keys, feeds and retained files."];
    $("feed-inventory").textContent = lines.join("\n\n");
    $("feed-history").replaceChildren(...[...(registry?.reviews ?? [])].reverse().map(r => { const e = document.createElement("li"); e.textContent = `${actions[r.action]} · ${r.status}\n${r.result?.summary ?? r.result?.status ?? "Reviewed; no registry effect confirmed."}\nRequest: ${r.requestId}`; return e; })); fields();
  }
  async function work(fn, readOnly = false) {
    if (busy || !(readOnly ? personal() : permitted())) return; busy = true; controls(); const version = generation, compartment = state.id;
    const context = { compartment, current: () => version === generation && state?.id === compartment };
    try { await fn(context); } catch (e) { if (context.current()) { $("feed-status").textContent = e.message; notify(e.message); } } finally { busy = false; controls(); }
  }
  async function load(context) { const value = await api("/api/suite/host/scanner-fixtures/list", { compartment: context.compartment }); if (context.current()) { registry = value; render(); } }
  for (const id of ["feed-manifest", "feed-target", "feed-reason"]) for (const event of ["input", "change"]) $(id).addEventListener(event, invalidate);
  $("feed-action").addEventListener("change", () => { invalidate(); fields(); });
  $("feed-policy-file").addEventListener("change", () => { invalidate(); policy = null; $("feed-policy-detail").textContent = ""; void work(async context => {
    const file = $("feed-policy-file").files?.[0]; if (!file) return;
    if (file.size > 16384) throw Error("Choose a public trust policy no larger than 16 KiB.");
    const text = await file.text(); if (!context.current()) return;
    if (new TextEncoder().encode(text).length > 16384 || /PRIVATE KEY/.test(text)) throw Error("Choose a public trust policy only. A private signing key must not enter this form.");
    const value = JSON.parse(text), keys = ["schema", "version", "authorityId", "keyId", "publicKeyPem", "allowedKinds", "expiresAt"];
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join()
      || value.schema !== "sxsy-b122.scanner-fixture-trust" || value.version !== 1 || typeof value.publicKeyPem !== "string"
      || !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(value.publicKeyPem) || /PRIVATE KEY/.test(JSON.stringify(value))) throw Error("Choose only the public signing-key policy, with no private key or extra fields.");
    policy = value; $("feed-policy-detail").textContent = "Public policy loaded locally. Review the verified authority and key fingerprint before trusting it.";
  }); });
  $("load-feeds").addEventListener("click", () => { invalidate(); void work(async context => { await load(context); if (context.current()) $("feed-status").textContent = "Registry metadata loaded. No signing key, feed or scan was installed or started."; }, true); });
  $("review-feed").addEventListener("click", () => work(async context => {
    const selected = target(), kind = action(), input = { compartment: context.compartment, requestId: crypto.randomUUID(), action: kind };
    if (kind === "install-trust") input.policy = structuredClone(policy);
    else if (kind === "install-fixture") input.manifestPath = $("feed-manifest").value.trim();
    else if (kind === "revoke-trust") { if (!selected) return; input.authorityId = selected.authorityId; input.keyId = selected.keyId; input.reason = $("feed-reason").value.trim(); }
    else { if (!selected) return; input.fixtureId = selected.id; input.reason = $("feed-reason").value.trim(); }
    const result = await api("/api/suite/host/scanner-fixtures/review", input); if (!context.current()) return;
    reviewed = { requestId: result.review.requestId, token: result.confirmation.token };
    $("feed-review-title").textContent = actions[kind]; $("confirm-feed").textContent = actions[kind];
    $("feed-review-summary").textContent = `${result.confirmation.record.reason}\n\n${Object.entries(result.review.summary).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value, null, 2) : value}`).join("\n")}\n\nAll prior pipeline and Shield receipts in this workspace will be invalidated before this registry change.\nApproval expires: ${result.review.expiresAt}`;
    $("feed-review-dialog").showModal();
  }));
  $("confirm-feed").addEventListener("click", () => work(async context => {
    if (!reviewed) return; const approval = reviewed; reviewed = null; $("feed-review-dialog").close();
    try { const result = await api("/api/suite/host/scanner-fixtures/apply", { compartment: context.compartment, ...approval }); if (!context.current()) return;
      $("feed-status").textContent = result.status === "completed" ? "Registry change recorded. No task permission was granted and no scan was started." : `Outcome: ${result.status}. ${result.summary ?? "Preserve the original files and inspect its history; no automatic replay was made."}`;
    } catch (e) { if (context.current()) { $("feed-status").textContent = `Registry outcome unconfirmed: ${e.message}. No automatic retry was made. Inspect the retained history before another change.`; notify("Feed maintenance outcome needs review."); } }
    finally { if (context.current()) try { await load(context); } catch (e) { if (context.current()) $("feed-status").textContent += ` History unavailable: ${e.message}.`; } }
  }));
  $("cancel-feed").addEventListener("click", invalidate);
  $("feed-review-dialog").addEventListener("close", () => { reviewed = null; $("feed-review-summary").textContent = ""; controls(); });
  $("recover-feeds").addEventListener("click", () => { invalidate(); void work(async context => { const result = await api("/api/suite/host/scanner-fixtures/recover", { compartment: context.compartment }); if (!context.current()) return; await load(context); if (context.current()) $("feed-status").textContent = result.stopped ? "Interrupted maintenance inspected. Uncertain outcomes stay preserved; no installation or removal was replayed." : "The original owner is still active or unconfirmed. Its files remain preserved."; }); });
  function clear() { registry = null; policy = null; for (const id of ["feed-manifest", "feed-reason", "feed-policy-file"]) $(id).value = ""; $("feed-policy-detail").textContent = ""; $("feed-action").replaceChildren(...Object.entries(actions).map(([id, name]) => option(id, name))); render(); }
  document.addEventListener("switchyard-workspace-changing", () => { state = null; invalidate(); clear(); $("feed-status").textContent = "Choose a workspace to inspect its signed feeds."; });
  document.addEventListener("switchyard-compartment-state", event => { state = event.detail; invalidate(); clear(); $("feed-status").textContent = permitted() ? "Manage only the signing keys and feeds you intend to trust in this workspace." : "Feed changes require a Personal companion workspace. Existing Personal metadata remains reviewable in keyboard-only mode."; });
  clear(); controls();
}
