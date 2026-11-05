/** Microsoft 365 Copilot Graph preview; deliberately separate from GitHub Copilot. */
import { randomUUID } from "node:crypto";
import { parsePlan } from "./model.mjs";
import { designResponseSchema, validateDesignResponse } from "./agents.mjs";
import { scopeHash } from "./confirmations.mjs";
import { createCopilotRequests, copilotRequestResource, copilotResponseDigest } from "./copilot-requests.mjs";

const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const copilotScopes = ["User.Read", "Sites.Read.All", "Mail.Read", "People.Read.All", "OnlineMeetingTranscript.Read.All", "Chat.Read", "ChannelMessage.Read.All", "ExternalItem.Read.All"];
const provider = "microsoft-365-copilot";
const credentialFields = ["tenantId", "clientId", "account", "accessToken", "refreshToken", "expiresAt"];
function validateCredential(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !credentialFields.includes(key)) || !guid.test(value.tenantId) || !guid.test(value.clientId) || typeof value.account !== "string" || value.account.slice(0, 37) !== value.tenantId + ":" || !guid.test(value.account.slice(37)) || typeof value.accessToken !== "string" || !value.accessToken || value.accessToken.length > 16000 || value.refreshToken !== undefined && (typeof value.refreshToken !== "string" || !value.refreshToken || value.refreshToken.length > 16000) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) throw new Error("The local Microsoft credential binding is invalid. Reconnect the approved account deliberately.");
  return value;
}

export function createCopilot({ store, fetcher = fetch, now = () => Date.now(), isActive = async () => true }) {
  const logins = new Map(), busy = new Set(), generations = new Map(), operations = new Set(); let closed = false;
  const requests = createCopilotRequests({ store, now, isActive: async c => !closed && await isActive(c) });
  function operation(compartment) {
    if (closed) throw new Error("The Microsoft request service is closed.");
    const generation = generations.get(compartment) ?? 0, controller = new AbortController(); let finish;
    const scope = { compartment, generation, signal: controller.signal, done: new Promise(resolve => { finish = resolve; }),
      assert() { this.resourceAssert?.(); if (closed || generation !== (generations.get(compartment) ?? 0) || controller.signal.aborted) throw new Error("The Microsoft request was stopped. Remote cancellation is unverified; no follow-up or response was accepted."); },
      async current() { this.assert(); if (!await isActive(compartment)) throw new Error("The Microsoft workspace is no longer active."); await store.authorize(compartment, { provider }); await this.requestCheck?.(); this.assert(); },
      abort() { controller.abort(); }, finish() { operations.delete(scope); finish(); }
    };
    operations.add(scope); return scope;
  }
  async function stopCompartment(compartment) {
    generations.set(compartment, (generations.get(compartment) ?? 0) + 1);
    for (const [id, login] of logins) if (login.compartment === compartment) logins.delete(id);
    const pending = [...operations].filter(scope => scope.compartment === compartment); for (const scope of pending) scope.abort();
    let timer; try { await Promise.race([Promise.all(pending.map(scope => scope.done)), new Promise(resolve => { timer = setTimeout(resolve, 1000); })]); } finally { clearTimeout(timer); }
    return { stopped: true, localDeliveryBlocked: true, localRequestsSettled: pending.every(scope => !operations.has(scope)), remoteCancellationVerified: false };
  }
  async function request(url, options, scope) {
    await scope.current();
    const target = new URL(url);
    if (target.protocol !== "https:" || !["graph.microsoft.com", "login.microsoftonline.com"].includes(target.hostname) || target.username || target.password || target.port) throw new Error("The Microsoft route is outside the supported approved endpoints.");
    const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(60000)]);
    const r = await fetcher(url, { ...options, redirect: "error", signal });
    let reader, completed = false;
    try {
      scope.assert(); signal.throwIfAborted(); reader = r.body.getReader(); const chunks = []; let bytes = 0;
      for (;;) { const { value, done } = await reader.read(); scope.assert(); signal.throwIfAborted(); if (done) break; bytes += value.length; if (bytes > 1048576) throw new Error("Microsoft response exceeded the supported size."); chunks.push(value); }
      await scope.current();
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Microsoft returned an unsupported response."); }
      completed = true; return { ok: r.ok, status: r.status, body };
    } finally {
      if (!completed) { if (reader) await reader.cancel().catch(() => {}); else if (r.body && !r.body.locked) await r.body.cancel().catch(() => {}); }
      reader?.releaseLock();
    }
  }
  const tokenRequest = (tenant, data, scope) => request(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() }, scope);
  async function verifyCredential(compartment, token, binding, scope) {
    if (typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 16000 || !Number.isSafeInteger(Number(token.expires_in)) || Number(token.expires_in) < 1 || Number(token.expires_in) > 604800) throw new Error("Microsoft credential response is invalid.");
    const me = await request("https://graph.microsoft.com/v1.0/me?$select=id,displayName", { headers: { Authorization: `Bearer ${token.access_token}` } }, scope);
    if (!me.ok || !guid.test(me.body.id)) throw new Error("Microsoft could not verify this delegated work account.");
    const account = `${binding.tenantId}:${me.body.id}`;
    if (binding.account && account !== binding.account) throw new Error("The refreshed Microsoft account changed. Re-enroll deliberately; no fallback account was used.");
    const credential = { tenantId: binding.tenantId, clientId: binding.clientId, account, accessToken: token.access_token, refreshToken: token.refresh_token ?? binding.refreshToken, expiresAt: now() + Number(token.expires_in) * 1000 };
    validateCredential(credential);
    await scope.current();
    await store.credential(compartment, "m365-token", JSON.stringify(credential), { provider });
    await scope.current();
    await store.update(compartment, "m365-account-enroll", (s) => { scope.assert(); s.accounts = [account]; s.copilotAccount = { account, tenantId: binding.tenantId, displayName: String(me.body.displayName ?? "Work account").slice(0, 120), surface: "Microsoft Graph Copilot Chat beta" }; }, { provider });
    await scope.current();
    return credential;
  }
  async function credential(compartment, scope) {
    await store.authorize(compartment, { provider });
    const raw = await store.credential(compartment, "m365-token", undefined, { provider });
    if (!raw) throw new Error("Enroll an approved Microsoft 365 work account first. No personal provider will be used.");
    let c; try { c = JSON.parse(raw); } catch { throw new Error("The local Microsoft credential reference is invalid."); }
    validateCredential(c);
    await store.authorize(compartment, { provider, account: c.account });
    await requests.assertAvailable(compartment, c.account);
    if (c.expiresAt <= now() + 60000) {
      if (!c.refreshToken) throw new Error("Microsoft sign-in expired. Sign in again with the approved account.");
      const token = await tokenRequest(c.tenantId, { grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.refreshToken, scope: [...copilotScopes, "offline_access"].join(" ") }, scope);
      if (!token.ok) throw new Error("Microsoft could not refresh this account. Reconnect it; no alternate account was selected.");
      c = await verifyCredential(compartment, token.body, c, scope);
    }
    return c;
  }
  async function assertCredential(compartment, c) {
    await store.authorize(compartment, { provider, account: c.account });
    const raw = await store.credential(compartment, "m365-token", undefined, { provider });
    let current; try { current = validateCredential(JSON.parse(raw)); } catch { throw new Error("The pinned Microsoft sign-in is unavailable or changed. No alternate credential was used."); }
    if (credentialFields.some(key => current[key] !== c[key]) || c.expiresAt <= now()) throw new Error("The pinned Microsoft sign-in changed or expired. The old response cannot be accepted; no alternate credential was used.");
  }
  async function graph(compartment, path, body, c, scope) {
    await assertCredential(compartment, c);
    const response = await request(`https://graph.microsoft.com${path}`, { method: "POST", headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, scope);
    await assertCredential(compartment, c);
    if (!response.ok) throw new Error(`Microsoft 365 Copilot returned HTTP ${response.status}. Check this tenant's license, Graph preview availability and all documented delegated permissions. The layout is preserved; no personal provider was used.`);
    return { value: response.body, account: c.account };
  }
  return {
    stopCompartment,
    listRequests: c => requests.list(c),
    reviewRequest: (c, id) => requests.review(c, id),
    resolveRequest: (c, input) => requests.resolve(c, input),
    async close() { closed = true; const compartments = new Set([...operations].map(scope => scope.compartment)); for (const login of logins.values()) compartments.add(login.compartment); const results = await Promise.all([...compartments].map(stopCompartment)); logins.clear(); return { stopped: true, localRequestsSettled: results.every(row => row.localRequestsSettled), remoteCancellationVerified: false }; },
    async discovery(compartment) { const state = await store.snapshot(compartment); return { id: provider, surface: "Microsoft 365 Copilot Chat · Graph beta or approved web", webUrl: "https://m365.cloud.microsoft/chat", account: state.copilotAccount ?? null, installed: "web route available", api: state.copilotAccount ? "enrolled; capability checked on use" : "not enrolled", capabilities: ["approved-web-launch", "configured-api-conversation", "exact-owned-conversation"], unsupported: ["arbitrary desktop chat observation", "GitHub Copilot equivalence", "verified task completion", "application-only or personal Microsoft accounts"], preview: true, scopes: copilotScopes }; },
    async beginLogin(compartment, { tenantId, clientId, approved }) {
      await store.authorize(compartment, { provider });
      if (approved !== true || !guid.test(tenantId) || !guid.test(clientId)) throw new Error("Use your approved organization's tenant and registered public-client application IDs, then explicitly start sign-in.");
      await stopCompartment(compartment);
      const scope = operation(compartment);
      try {
        const r = await request(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, scope: [...copilotScopes, "offline_access"].join(" ") }).toString() }, scope);
        if (!r.ok || typeof r.body.device_code !== "string" || !r.body.device_code || r.body.device_code.length > 4096 || typeof r.body.user_code !== "string" || !r.body.user_code || r.body.user_code.length > 128 || typeof r.body.verification_uri !== "string" || r.body.verification_uri.length > 1024) throw new Error("Microsoft device sign-in is unavailable for this approved application.");
        const verification = new URL(r.body.verification_uri);
        if (verification.protocol !== "https:" || !["microsoft.com", "www.microsoft.com", "login.microsoftonline.com"].includes(verification.hostname) || verification.username || verification.password || verification.port || verification.hash) throw new Error("Microsoft returned an unexpected sign-in destination.");
        const id = randomUUID(), interval = Math.max(5, Math.min(30, Number(r.body.interval) || 5)), expiresIn = Math.max(1, Math.min(900, Number(r.body.expires_in) || 900));
        await scope.current();
        logins.set(id, { compartment, tenantId, clientId, deviceCode: r.body.device_code, generation: scope.generation, interval, nextPoll: now() + interval * 1000, expires: now() + expiresIn * 1000, polling: false });
        return { loginId: id, verificationUrl: verification.href, userCode: r.body.user_code, interval, expiresIn };
      } finally { scope.finish(); }
    },
    async pollLogin(compartment, loginId) {
      const login = logins.get(loginId);
      if (!login || login.compartment !== compartment || now() > login.expires) { logins.delete(loginId); throw new Error("Microsoft sign-in expired. Start a new explicit sign-in."); }
      await store.authorize(compartment, { provider });
      if (login.polling || now() < login.nextPoll) return { status: "pending", interval: login.interval };
      const scope = operation(compartment); login.polling = true;
      try {
        if (scope.generation !== login.generation) throw new Error("Microsoft sign-in was stopped; start a new explicit sign-in.");
        login.nextPoll = now() + login.interval * 1000;
        const r = await tokenRequest(login.tenantId, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: login.clientId, device_code: login.deviceCode }, scope);
        if (!r.ok) {
          if (r.body.error === "authorization_pending") return { status: "pending", interval: login.interval };
          if (r.body.error === "slow_down") { login.interval = Math.min(900, login.interval + 5); login.nextPoll = now() + login.interval * 1000; return { status: "pending", interval: login.interval }; }
          logins.delete(loginId); throw new Error("Microsoft sign-in was declined, expired, or unavailable. No credentials were stored.");
        }
        if (now() > login.expires) throw new Error("Microsoft sign-in expired before its result could be accepted.");
        const c = await verifyCredential(compartment, r.body, login, scope); scope.assert(); logins.delete(loginId);
        return { status: "connected", account: c.account };
      } finally { login.polling = false; scope.finish(); }
    },
    async design({ compartment, message, plan: input, conversationId, requestId }) {
      await store.authorize(compartment, { provider }); const plan = parsePlan(input);
      if (typeof message !== "string" || !message.trim() || message.length > 12000) throw new Error("Enter a bounded design request.");
      const state = await store.snapshot(compartment), existing = conversationId ? state.conversations.find((c) => c.id === conversationId && c.provider === provider) : null;
      if (conversationId && !existing) throw new Error("That exact Microsoft conversation is not owned by this compartment.");
      const id = existing?.id ?? randomUUID(); if (busy.has(`${compartment}:${id}`)) throw new Error("This Microsoft conversation already has a pending request."); const scope = operation(compartment); busy.add(`${compartment}:${id}`);
      try {
        await scope.current(); const c = await credential(compartment, scope);
        if (existing && existing.account !== c.account) throw new Error("This Microsoft conversation belongs to a different or unverified account. Reconnect its exact approved account; no conversation was continued.");
        const content = { instruction: "Help improve the workflow, then propose physical controls. Do not take external actions or invent capability evidence. Return only JSON matching responseSchema. Use exact supplied key IDs and preserve ordinary typing. Output is a proposal, never permission.", request: message, plan, workflow: state.workflow, responseSchema: designResponseSchema };
        const body = { message: { text: JSON.stringify(content) }, locationHint: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, contextualResources: { webContext: { isWebEnabled: false } } };
        if (Buffer.byteLength(JSON.stringify(body)) > 1048576) throw new Error("The Microsoft design context exceeds its bounded request size. No request was delivered.");
        const output = await store.withResourceLock("copilot-request", copilotRequestResource(compartment, c.account, c.clientId), async lease => {
        scope.resourceAssert = () => lease.assert();
        try {
        const assertCurrent = () => { scope.assert(); lease.assert(); }; assertCurrent(); await scope.current();
        const reserved = await requests.reserve(compartment, { account: c.account, clientId: c.clientId, conversationId: id, sessionId: existing?.sessionId ?? null, scopeDigest: scopeHash(["switchyard-copilot-design/v1", c.account, c.clientId, existing?.id ?? null, body]), requestId }, assertCurrent);
        const operationId = reserved.row.id; scope.requestId = operationId;
        if (reserved.reused) {
          const saved = (await store.snapshot(compartment)).conversations.find(row => row.id === reserved.row.conversationId);
          if (!saved || saved.account !== c.account || saved.lastCopilotRequestId !== operationId || copilotResponseDigest(saved) !== reserved.row.responseDigest) throw new Error("This exact Microsoft request already completed. Its original response is retained in history; no request was submitted again.");
          await assertCredential(compartment, c); await scope.current();
          return { reply: saved.messages.at(-1).text, proposal: saved.proposal, workflow: saved.workflow, ...(saved.limitation ? { limitation: saved.limitation } : {}), provider, conversationId: saved.id, sessionId: saved.sessionId, operationId, requestId: reserved.row.requestId, reused: true, modelPromptSubmitted: false, provenance: "Original exact account-bound private response; no Microsoft request replayed" };
        }
        scope.requestStage = "reserved"; scope.requestCheck = () => requests.assertCurrent(compartment, operationId, scope.requestStage);
        try {
        let remoteId = existing?.sessionId;
        if (!remoteId) {
          await requests.enter(compartment, operationId, "creating", assertCurrent);
          scope.requestStage = "creating";
          remoteId = (await graph(compartment, "/beta/copilot/conversations", {}, c, scope)).value.id;
          if (!guid.test(remoteId)) throw new Error("Microsoft returned an unsupported conversation identity.");
          await requests.created(compartment, operationId, remoteId, assertCurrent);
          scope.requestStage = "created";
        }
        if (!guid.test(remoteId)) throw new Error("Microsoft returned an unsupported conversation identity.");
        await requests.enter(compartment, operationId, "submitting", assertCurrent);
        scope.requestStage = "submitting";
        const r = await graph(compartment, `/beta/copilot/conversations/${remoteId}/chat`, body, c, scope);
        if (r.value.id !== remoteId || !Array.isArray(r.value.messages)) throw new Error("Microsoft's reply does not match the exact owned conversation.");
        const reply = r.value.messages.filter((m) => typeof m.text === "string").at(-1)?.text;
        if (!reply || reply.length > 64000) throw new Error("Microsoft did not return a bounded conversation response.");
        let design;
        try { design = validateDesignResponse(JSON.parse(reply.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")), plan); }
        catch { design = { reply, proposal: null, workflow: state.workflow, limitation: "The Chat API does not guarantee a structured response. This reply is displayed as text; no layout change was inferred." }; }
        await assertCredential(compartment, c);
        const saved = await store.update(compartment, "m365-design", (s) => {
          assertCurrent(); requests.assertOwned(s, operationId, "submitting"); const current = s.conversations.find(row => row.id === id);
          if (existing ? !current || current.provider !== provider || current.sessionId !== remoteId || current.account !== c.account : current) throw new Error("The exact Microsoft conversation binding changed before its response could be saved.");
          const saved = { id, provider, sessionId: remoteId, account: r.account, updatedAt: now(), messages: [...(existing?.messages ?? []), { role: "user", text: message }, { role: "assistant", text: design.reply }].slice(-40), proposal: design.proposal, workflow: design.workflow, limitation: design.limitation ?? null, lastCopilotRequestId: operationId };
          s.conversations = [...s.conversations.filter((row) => row.id !== id), saved]; return structuredClone(saved);
        }, { provider, account: r.account });
        await scope.current();
        await requests.complete(compartment, operationId, saved, assertCurrent);
        scope.requestStage = "completed";
        return { ...design, provider, conversationId: id, sessionId: remoteId, operationId, requestId: reserved.row.requestId, provenance: "Microsoft Graph delegated work account; exact owned conversation; tenant acceptance required" };
        } catch (error) {
          try { await requests.fail(compartment, operationId); } catch { throw new Error("The Microsoft request outcome could not be recorded. Preserve its original delivery facts; no automatic retry is permitted."); }
          throw error;
        }
        } finally { scope.resourceAssert = undefined; scope.requestCheck = undefined; }
        });
        await scope.current(); return output;
      } finally { busy.delete(`${compartment}:${id}`); scope.finish(); }
    }
  };
}
