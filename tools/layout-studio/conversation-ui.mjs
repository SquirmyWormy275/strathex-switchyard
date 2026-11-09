import { api } from "./connection.mjs";

const names = { codex: "Codex", "claude-code": "Claude Code", "microsoft-365-copilot": "Microsoft 365 Copilot" };
const native = provider => ["codex", "claude-code"].includes(provider);
const option = (value, text) => { const e = document.createElement("option"); e.value = value; e.textContent = text; return e; };

/** Selecting saved context performs no provider request. Account binding is a separate reviewed effect. */
export function mountConversations({ notify, refresh }) {
  const $ = id => document.getElementById(id), drafts = new Map();
  let state = null, provider = "", selected = null, generation = 0, busy = false, sending = false, activeSend = null, reviewed = null, uncertain = false;
  const row = () => state?.conversations.find(c => c.id === selected && c.provider === provider);
  const permitted = () => state && state.mode === (state.policy === "work" ? "managed-companion" : "personal-companion") && state.policyRules.providers.includes(provider);
  const legacy = () => row()?.sessionId && native(provider) && row().accountFingerprint == null;
  const key = () => JSON.stringify([state?.id, provider, selected]);
  function saveDraft() { if (state) { drafts.delete(key()); drafts.set(key(), $("design-message").value); while (drafts.size > 64) drafts.delete(drafts.keys().next().value); } }
  function controls() {
    $("saved-conversation").disabled = busy || sending || !state;
    $("conversation-provider").disabled = busy || sending || !state;
    $("new-design-conversation").disabled = busy || sending || !state;
    $("refresh-conversations").disabled = busy || sending || !state;
    $("review-conversation-binding").disabled = busy || sending || !permitted() || !legacy();
    $("confirm-conversation-binding").disabled = busy || !reviewed;
    $("observe-conversation").disabled = busy || sending || !permitted() || !native(provider) || !row()?.sessionId || !!legacy();
    $("send-design").disabled = busy || sending || !permitted() || !!legacy() || uncertain || row()?.status === "pending";
    $("design-message").disabled = busy || sending || !state;
    $("cancel-design").disabled = !permitted() || !native(provider) || !(activeSend?.compartment === state.id && activeSend.destination === provider || row()?.status === "pending");
  }
  function invalidate() { generation++; reviewed = null; $("conversation-binding-dialog").close(); $("conversation-binding-summary").textContent = ""; controls(); }
  function render() {
    const rows = state?.conversations.filter(c => c.provider === provider) ?? [];
    $("saved-conversation").replaceChildren(option("", "New conversation"), ...rows.toReversed().map(c => option(c.id, `${c.messages?.find(m => m.role === "user")?.text?.replace(/\s+/g, " ").slice(0, 72) || "Saved conversation"} · ${c.status ?? "saved"}`)));
    $("saved-conversation").value = selected ?? "";
    const c = row(), history = $("conversation-history"); history.replaceChildren();
    for (const message of c?.messages ?? []) {
      const article = document.createElement("p"), label = document.createElement("strong"), text = document.createElement("span");
      article.className = `message ${message.role === "user" ? "user" : "assistant"}`; label.textContent = message.role === "user" ? "You" : names[provider]; text.textContent = message.text;
      article.append(label, text); history.append(article);
    }
    $("conversation-detail").textContent = c ? `${names[provider]} · ${c.status ?? "saved"}\nNative conversation: ${c.sessionId ?? "not yet acknowledged"}\nAccount: ${native(provider) ? c.accountFingerprint ?? "original account unknown; review binding before continuing" : "checked against the enrolled work connection on use"}\nSaved context stays in this workspace. Opening it does not resume a native task.` : "Start a new design conversation, or choose saved context. No provider is contacted until you request an operation.";
    controls();
  }
  function choose(id) {
    saveDraft(); selected = id || null; uncertain = false; invalidate(); $("design-message").value = drafts.get(key()) ?? ""; render();
    $("design-status").textContent = selected ? "Saved conversation selected locally. Review its context and account before your next message." : "Ready for a new conversation with the selected assistant.";
  }
  function context() { const version = generation, compartment = state?.id, destination = provider, conversationId = selected; return { compartment, destination, conversationId, current: () => version === generation && state?.id === compartment && provider === destination && selected === conversationId }; }
  async function work(fn) {
    if (busy || sending || !state) return; busy = true; controls(); const ctx = context();
    try { await fn(ctx); } catch (error) { if (ctx.current()) { $("design-status").textContent = error.message; notify(error.message); } }
    finally { busy = false; controls(); }
  }
  $("saved-conversation").addEventListener("change", () => choose($("saved-conversation").value));
  $("conversation-provider").addEventListener("change", () => { saveDraft(); provider = $("conversation-provider").value; selected = null; uncertain = false; invalidate(); $("design-message").value = drafts.get(key()) ?? ""; render(); });
  $("new-design-conversation").addEventListener("click", () => choose(null));
  $("refresh-conversations").addEventListener("click", () => work(async () => { await refresh(); }));
  $("observe-conversation").addEventListener("click", () => work(async ctx => {
    if (!permitted() || !row()?.sessionId || !native(provider) || legacy()) return;
    const result = await api("/api/suite/design/status", { compartment: ctx.compartment, conversationId: ctx.conversationId }); if (!ctx.current()) return;
    $("design-status").textContent = `${JSON.stringify(result.status)} · ${result.provenance}. No message was sent and no task completion is inferred.`;
  }));
  $("review-conversation-binding").addEventListener("click", () => work(async ctx => {
    if (!permitted() || !legacy()) return;
    const result = await api("/api/suite/conversation/binding/review", { compartment: ctx.compartment, conversationId: ctx.conversationId }); if (!ctx.current()) return;
    reviewed = { conversationId: ctx.conversationId, token: result.confirmation.token };
    $("conversation-binding-summary").textContent = `${result.confirmation.record.reason}\n\nProvider: ${names[result.scope.provider]}\nNative conversation: ${result.scope.sessionId}\nCurrent account fingerprint: ${result.scope.currentAccountFingerprint}\nContext digest: ${result.scope.contextDigest}\nExpires: ${result.confirmation.record.expiresAt}\n\nExact saved context:\n${JSON.stringify({ messages: result.scope.messages, proposal: result.scope.proposal }, null, 2)}\n\nThis saves the reviewed binding. It does not submit a message, verify the original account or grant tools.`;
    $("conversation-binding-dialog").showModal();
  }));
  $("cancel-conversation-binding").addEventListener("click", invalidate);
  $("conversation-binding-dialog").addEventListener("close", () => { reviewed = null; controls(); });
  $("confirm-conversation-binding").addEventListener("click", () => work(async ctx => {
    if (!reviewed || !permitted() || !legacy()) return; const review = reviewed; reviewed = null; $("conversation-binding-dialog").close();
    try {
      await api("/api/suite/conversation/binding/bind", { compartment: ctx.compartment, ...review }); if (!ctx.current()) return;
      $("design-status").textContent = "Reviewed account binding saved. The original account remains unverified. No message was sent.";
    } catch (error) { if (ctx.current()) { $("design-status").textContent = `Binding result unconfirmed: ${error.message}. Inspect saved context before reviewing again; no automatic retry was made.`; notify("Inspect the saved account binding; no automatic retry was made."); } }
    finally { if (ctx.current()) await refresh(); }
  }));
  document.addEventListener("switchyard-workspace-changing", () => { saveDraft(); state = null; provider = ""; selected = null; uncertain = false; invalidate(); $("design-message").value = ""; $("design-status").textContent = "Select a workspace to view its conversations."; render(); });
  document.addEventListener("switchyard-compartment-state", event => {
    const next = event.detail, destination = $("conversation-provider").value;
    if (state?.id !== next.id || provider !== destination) { saveDraft(); selected = null; uncertain = false; $("design-message").value = drafts.get(JSON.stringify([next.id, destination, null])) ?? ""; }
    state = next; provider = destination; invalidate();
    if (selected && !row()) selected = null; render();
  });
  controls();
  return {
    id: () => selected,
    begin() { if ($("send-design").disabled) throw Error("Choose an available conversation and review any account binding or uncertain reply before sending."); const ctx = { ...context(), ...(provider === "microsoft-365-copilot" ? { requestId: crypto.randomUUID() } : {}) }; sending = true; activeSend = ctx; controls(); return ctx; },
    accepted(ctx, id) { if (!ctx.current()) return false; drafts.delete(key()); selected = id; uncertain = false; return true; },
    failed(ctx, error, submitted = true) { if (!ctx.current()) return; uncertain = submitted; $("design-status").textContent = submitted ? `Reply unconfirmed: ${error.message}. Your draft is preserved.${ctx.requestId ? " Microsoft submission: " + ctx.requestId + ". Review saved delivery outcomes in Your tools before another message." : ""} Refresh saved conversations and deliberately select the exact context before sending again. No automatic retry was made.` : `Message not sent: ${error.message}. Your draft is preserved.`; },
    cancellation() { if ($("cancel-design").disabled) throw Error("Choose the exact pending native conversation before cancellation."); const ctx = context(); return { ...ctx, conversationId: activeSend?.compartment === state.id && activeSend.destination === provider ? activeSend.conversationId : ctx.conversationId }; },
    finish() { sending = false; activeSend = null; controls(); }
  };
}
