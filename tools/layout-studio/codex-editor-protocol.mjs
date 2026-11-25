/** Bounded, single-stream protocol witness. No transport, permission or IDE attachment authority. */
import { codexAccountFingerprint } from "./agents.mjs";
import { codexAccountBoundary } from "./codex-requests.mjs";
import { posix, win32 } from "node:path";

const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const uuid = x => typeof x === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const id = x => Number.isSafeInteger(x) || typeof x === "string" && x.length > 0 && x.length <= 128 && !/[\x00-\x1f\x7f]/.test(x);
const key = x => typeof x + ":" + x;

export function createCodexEditorProtocol(input, { platform = "linux" } = {}) {
  // The owning transport selects a path contract. Never infer a different host
  // from an untrusted native reply or normalize it into another repository.
  const repositoryPath = value => typeof value === "string" && value.isWellFormed() && Buffer.byteLength(value) <= 4096 && (
    platform === "linux" ? posix.isAbsolute(value) && posix.normalize(value) === value && !/[\\\x00-\x1f\x7f]/.test(value)
    : platform === "win32" && /^[A-Za-z]:\\/.test(value) && win32.normalize(value) === value
      && !/[\x00-\x1f\x7f<>:"/|?*]/.test(value.slice(3))
      && value.slice(3).split("\\").every(part => part && !/[. ]$/.test(part) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)));
  if (!object(input) || Object.keys(input).sort().join() !== "accountFingerprint,repositoryRoot,sessionId" || !uuid(input.sessionId)
      || typeof input.accountFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.accountFingerprint)
      || !repositoryPath(input.repositoryRoot)) throw Error("Choose the exact original editor protocol target.");
  const target = Object.freeze({ ...input }), pending = new Map(), seen = new Set();
  let stage = "pending", reason = null, before = false, requested = false, resumed = false, after = false;
  const reject = code => { stage = "invalidated"; reason = code; pending.clear(); return false; };
  const view = () => Object.freeze({ schema: "switchyard-codex-editor-protocol/v1", stage, reason,
    accountBeforeVerified: before, exactResumeRequested: requested, exactResumeReplyVerified: resumed, accountAfterVerified: after,
    protocolAcknowledged: stage === "acknowledged", transportPeerVerified: false, terminalProcessVerified: false,
    ideAttached: false, authorityGranted: false, completionVerified: false });
  function message(value) {
    if (!object(value)) throw Error("object");
    const text = JSON.stringify(value); if (!text || Buffer.byteLength(text) > 1048576) throw Error("size");
    const m = JSON.parse(text);
    if (!object(m) || Object.keys(m).some(k => !["id", "method", "params", "result", "error"].includes(k))
        || m.id !== undefined && !id(m.id)
        || m.method !== undefined && (typeof m.method !== "string" || !/^[A-Za-z][A-Za-z0-9/_-]{0,127}$/.test(m.method))
        || m.method === undefined && (m.id === undefined || Object.hasOwn(m, "result") === Object.hasOwn(m, "error") || Object.hasOwn(m, "params"))
        || m.method !== undefined && (Object.hasOwn(m, "result") || Object.hasOwn(m, "error"))) throw Error("frame");
    return m;
  }
  return Object.freeze({
    client(value) {
      if (["closed", "invalidated"].includes(stage)) return false;
      let m; try { m = message(value); } catch { return reject("invalid-client-frame"); }
      // Server-request replies do not acknowledge a task. These booleans are
      // observations, never permission for a transport to forward a message.
      if (m.method === undefined) return true;
      if (m.method.startsWith("account/") && !["account/read", "account/rateLimits/read"].includes(m.method)) return reject("account-effect-requested");
      if (m.method.startsWith("turn/") || m.method.startsWith("thread/") && !["thread/resume", "thread/read", "thread/list", "thread/turns/list", "thread/turns/items/list"].includes(m.method)) return reject("additional-task-effect-requested");
      if (m.id === undefined) return ["account/read", "thread/resume"].includes(m.method) ? reject("missing-request-identity") : true;
      if (seen.has(key(m.id)) || seen.size >= 4096 || pending.size >= 128) return reject("request-identity-or-bound");
      seen.add(key(m.id));
      if (m.method === "account/read") {
        if (!object(m.params) || Object.keys(m.params).join() !== "refreshToken" || m.params.refreshToken !== false) return reject("account-refresh-requested");
        stage = "pending"; pending.set(key(m.id), { method: m.method, afterResume: resumed }); return true;
      }
      if (m.method === "thread/resume") {
        if (!before || requested || [...pending.values()].some(p => p.method === "account/read")) return reject("resume-order-or-replay");
        if (!object(m.params) || Object.keys(m.params).some(k => !["threadId", "cwd", "sandbox", "approvalPolicy", "excludeTurns"].includes(k))
            || m.params.threadId !== target.sessionId || m.params.cwd !== target.repositoryRoot || m.params.sandbox !== "read-only" || m.params.approvalPolicy !== "on-request"
            || m.params.excludeTurns !== undefined && typeof m.params.excludeTurns !== "boolean") return reject("resume-target-or-permissions");
        requested = true; pending.set(key(m.id), { method: m.method }); return true;
      }
      pending.set(key(m.id), { method: m.method }); return true;
    },
    server(value) {
      if (["closed", "invalidated"].includes(stage)) return false;
      let m; try { m = message(value); } catch { return reject("invalid-server-frame"); }
      if (codexAccountBoundary(m)) return reject("account-boundary");
      if (m.method !== undefined) return true;
      const request = pending.get(key(m.id));
      if (!request) return reject("unmatched-server-reply");
      pending.delete(key(m.id));
      if (!["account/read", "thread/resume"].includes(request.method)) return true;
      if (Object.hasOwn(m, "error")) return reject("native-request-refused");
      if (request.method === "account/read") {
        try { if (codexAccountFingerprint(m.result?.account) !== target.accountFingerprint) return reject("account-mismatch"); }
        catch { return reject("account-unconfirmed"); }
        if (request.afterResume) after = true; else before = true;
      } else {
        const r = m.result;
        if (!object(r) || r.thread?.id !== target.sessionId || r.thread?.cwd !== target.repositoryRoot || r.cwd !== target.repositoryRoot
            || r.sandbox?.type !== "readOnly" || r.approvalPolicy !== "on-request"
            || !["idle", "active"].includes(r.thread?.status?.type) || r.modelProvider !== "openai") return reject("resume-reply-mismatch");
        resumed = true;
      }
      if (before && resumed && after && ![...pending.values()].some(p => p.method === "account/read")) stage = "acknowledged";
      return true;
    },
    observation: view,
    close() { pending.clear(); seen.clear(); if (stage !== "invalidated") { stage = "closed"; reason = "connection-closed"; } }
  });
}
