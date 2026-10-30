/** Microsoft 365 Copilot Graph preview; deliberately separate from GitHub Copilot. */
import { randomUUID } from "node:crypto";
import { parsePlan } from "./model.mjs";
import { designResponseSchema, validateDesignResponse } from "./agents.mjs";

const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const copilotScopes = ["User.Read", "Sites.Read.All", "Mail.Read", "People.Read.All", "OnlineMeetingTranscript.Read.All", "Chat.Read", "ChannelMessage.Read.All", "ExternalItem.Read.All"];
const provider = "microsoft-365-copilot";

export function createCopilot({ store, fetcher = fetch, now = () => Date.now() }) {
  const logins = new Map(), busy = new Set();
  async function request(url, options) {
    const target = new URL(url);
    if (target.protocol !== "https:" || !["graph.microsoft.com", "login.microsoftonline.com"].includes(target.hostname) || target.username || target.password || target.port) throw new Error("The Microsoft route is outside the supported approved endpoints.");
    const r = await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(60000) });
    const reader = r.body.getReader(); const chunks = []; let bytes = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 1048576) { await reader.cancel(); throw new Error("Microsoft response exceeded the supported size."); } chunks.push(value); }
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Microsoft returned an unsupported response."); }
    return { ok: r.ok, status: r.status, body };
  }
  const tokenRequest = (tenant, data) => request(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() });
  async function verifyCredential(compartment, token, binding) {
    const me = await request("https://graph.microsoft.com/v1.0/me?$select=id,displayName", { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!me.ok || !guid.test(me.body.id)) throw new Error("Microsoft could not verify this delegated work account.");
    const account = `${binding.tenantId}:${me.body.id}`;
    if (binding.account && account !== binding.account) throw new Error("The refreshed Microsoft account changed. Re-enroll deliberately; no fallback account was used.");
    const credential = { tenantId: binding.tenantId, clientId: binding.clientId, account, accessToken: token.access_token, refreshToken: token.refresh_token ?? binding.refreshToken, expiresAt: now() + Number(token.expires_in) * 1000 };
    if (typeof credential.accessToken !== "string" || credential.accessToken.length > 16000 || !Number.isFinite(credential.expiresAt)) throw new Error("Microsoft credential response is invalid.");
    await store.credential(compartment, "m365-token", JSON.stringify(credential), { provider });
    await store.update(compartment, "m365-account-enroll", (s) => { s.accounts = [account]; s.copilotAccount = { account, tenantId: binding.tenantId, displayName: String(me.body.displayName ?? "Work account").slice(0, 120), surface: "Microsoft Graph Copilot Chat beta" }; }, { provider });
    return credential;
  }
  async function credential(compartment) {
    await store.authorize(compartment, { provider });
    const raw = await store.credential(compartment, "m365-token", undefined, { provider });
    if (!raw) throw new Error("Enroll an approved Microsoft 365 work account first. No personal provider will be used.");
    let c; try { c = JSON.parse(raw); } catch { throw new Error("The local Microsoft credential reference is invalid."); }
    if (!guid.test(c.tenantId) || !guid.test(c.clientId)) throw new Error("The local Microsoft tenant/client binding is invalid.");
    await store.authorize(compartment, { provider, account: c.account });
    if (c.expiresAt <= now() + 60000) {
      if (!c.refreshToken) throw new Error("Microsoft sign-in expired. Sign in again with the approved account.");
      const token = await tokenRequest(c.tenantId, { grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.refreshToken, scope: [...copilotScopes, "offline_access"].join(" ") });
      if (!token.ok) throw new Error("Microsoft could not refresh this account. Reconnect it; no alternate account was selected.");
      c = await verifyCredential(compartment, token.body, c);
    }
    return c;
  }
  async function graph(compartment, path, body) {
    const c = await credential(compartment);
    const response = await request(`https://graph.microsoft.com${path}`, { method: "POST", headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Microsoft 365 Copilot returned HTTP ${response.status}. Check this tenant's license, Graph preview availability and all documented delegated permissions. The layout is preserved; no personal provider was used.`);
    return { value: response.body, account: c.account };
  }
  return {
    async discovery(compartment) { const state = await store.snapshot(compartment); return { id: provider, surface: "Microsoft 365 Copilot Chat · Graph beta or approved web", webUrl: "https://m365.cloud.microsoft/chat", account: state.copilotAccount ?? null, installed: "web route available", api: state.copilotAccount ? "enrolled; capability checked on use" : "not enrolled", capabilities: ["approved-web-launch", "configured-api-conversation", "exact-owned-conversation"], unsupported: ["arbitrary desktop chat observation", "GitHub Copilot equivalence", "verified task completion", "application-only or personal Microsoft accounts"], preview: true, scopes: copilotScopes }; },
    async beginLogin(compartment, { tenantId, clientId, approved }) {
      await store.authorize(compartment, { provider });
      if (approved !== true || !guid.test(tenantId) || !guid.test(clientId)) throw new Error("Use your approved organization's tenant and registered public-client application IDs, then explicitly start sign-in.");
      const r = await request(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, scope: [...copilotScopes, "offline_access"].join(" ") }).toString() });
      if (!r.ok || typeof r.body.device_code !== "string" || typeof r.body.user_code !== "string" || typeof r.body.verification_uri !== "string") throw new Error("Microsoft device sign-in is unavailable for this approved application.");
      const verification = new URL(r.body.verification_uri);
      if (verification.protocol !== "https:" || !["microsoft.com", "www.microsoft.com", "login.microsoftonline.com"].includes(verification.hostname)) throw new Error("Microsoft returned an unexpected sign-in destination.");
      const id = randomUUID(), interval = Math.max(5, Math.min(30, Number(r.body.interval) || 5));
      logins.set(id, { compartment, tenantId, clientId, deviceCode: r.body.device_code, interval, nextPoll: now() + interval * 1000, expires: now() + Math.min(900, Number(r.body.expires_in) || 900) * 1000 });
      return { loginId: id, verificationUrl: verification.href, userCode: r.body.user_code, interval, expiresIn: Math.min(900, Number(r.body.expires_in) || 900) };
    },
    async pollLogin(compartment, loginId) {
      const login = logins.get(loginId);
      if (!login || login.compartment !== compartment || now() > login.expires) { logins.delete(loginId); throw new Error("Microsoft sign-in expired. Start a new explicit sign-in."); }
      await store.authorize(compartment, { provider });
      if (now() < login.nextPoll) return { status: "pending", interval: login.interval };
      login.nextPoll = now() + login.interval * 1000;
      const r = await tokenRequest(login.tenantId, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: login.clientId, device_code: login.deviceCode });
      if (!r.ok) { if (r.body.error === "authorization_pending") return { status: "pending", interval: login.interval }; if (r.body.error === "slow_down") { login.interval += 5; return { status: "pending", interval: login.interval }; } logins.delete(loginId); throw new Error("Microsoft sign-in was declined, expired, or unavailable. No credentials were stored."); }
      const c = await verifyCredential(compartment, r.body, login); logins.delete(loginId);
      return { status: "connected", account: c.account };
    },
    async design({ compartment, message, plan: input, conversationId }) {
      await store.authorize(compartment, { provider }); const plan = parsePlan(input);
      if (typeof message !== "string" || !message.trim() || message.length > 12000) throw new Error("Enter a bounded design request.");
      const state = await store.snapshot(compartment), existing = conversationId ? state.conversations.find((c) => c.id === conversationId && c.provider === provider) : null;
      if (conversationId && !existing) throw new Error("That exact Microsoft conversation is not owned by this compartment.");
      const id = existing?.id ?? randomUUID(); if (busy.has(`${compartment}:${id}`)) throw new Error("This Microsoft conversation already has a pending request."); busy.add(`${compartment}:${id}`);
      try {
        let remoteId = existing?.sessionId;
        if (!remoteId) remoteId = (await graph(compartment, "/beta/copilot/conversations", {})).value.id;
        if (!guid.test(remoteId)) throw new Error("Microsoft returned an unsupported conversation identity.");
        const content = { instruction: "Help improve the workflow, then propose physical controls. Do not take external actions or invent capability evidence. Return only JSON matching responseSchema. Use exact supplied key IDs and preserve ordinary typing. Output is a proposal, never permission.", request: message, plan, workflow: state.workflow, responseSchema: designResponseSchema };
        const r = await graph(compartment, `/beta/copilot/conversations/${remoteId}/chat`, { message: { text: JSON.stringify(content) }, locationHint: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, contextualResources: { webContext: { isWebEnabled: false } } });
        if (r.value.id !== remoteId || !Array.isArray(r.value.messages)) throw new Error("Microsoft's reply does not match the exact owned conversation.");
        const reply = r.value.messages.filter((m) => typeof m.text === "string").at(-1)?.text;
        if (!reply || reply.length > 64000) throw new Error("Microsoft did not return a bounded conversation response.");
        let design;
        try { design = validateDesignResponse(JSON.parse(reply.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")), plan); }
        catch { design = { reply, proposal: null, workflow: state.workflow, limitation: "The Chat API does not guarantee a structured response. This reply is displayed as text; no layout change was inferred." }; }
        await store.update(compartment, "m365-design", (s) => { s.conversations = [...s.conversations.filter((c) => c.id !== id), { id, provider, sessionId: remoteId, account: r.account, updatedAt: now(), messages: [...(existing?.messages ?? []), { role: "user", text: message }, { role: "assistant", text: design.reply }].slice(-40), proposal: design.proposal, workflow: design.workflow }]; }, { provider, account: r.account });
        return { ...design, provider, conversationId: id, sessionId: remoteId, provenance: "Microsoft Graph delegated work account; exact owned conversation; tenant acceptance required" };
      } finally { busy.delete(`${compartment}:${id}`); }
    }
  };
}
