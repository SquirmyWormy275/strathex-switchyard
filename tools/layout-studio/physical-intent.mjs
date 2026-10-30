/** Physical shortcuts always enter the authenticated active-compartment policy. */
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { privateDirectory, privateRead, privateWrite } from "./suite-store.mjs";
const intents = ["summon", "resume", "review", "handoff", "status", "cancel"];
export function closedIntent(value) {
  if (value?.implementation === "native-chatgpt.focus/v1") return { implementation: value.implementation };
  if (value?.implementation === "switchyard.role/v1" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value.roleId) && intents.includes(value.intent)) return { implementation: value.implementation, roleId: value.roleId, intent: value.intent };
  throw new Error("Physical shortcut is outside the closed intent contract.");
}
export function intentArguments(value) { const v = closedIntent(value); return ["intent", v.implementation, ...(v.roleId ? [v.roleId, v.intent] : [])]; }
export const intentKey = (value) => createHash("sha256").update(JSON.stringify(closedIntent(value))).digest("hex");
export function runtimeDirectory() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "strathex-switchyard/runtime");
  if (!process.env.XDG_RUNTIME_DIR) throw new Error("The private session runtime directory is unavailable. Start Switchyard in the desktop session.");
  return join(process.env.XDG_RUNTIME_DIR, "switchyard-studio");
}
/** Preserve an open review tab's access across backend restarts in this login. */
export async function reviewAccessToken({ root = runtimeDirectory(), port, review, processExists = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === "ESRCH") return false; throw e; } } }) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(review)) throw new Error("The review identity or port is invalid.");
  await privateDirectory(root);
  let endpoint; try { endpoint = JSON.parse(await privateRead(join(root, `${port}.json`))); } catch (e) { if (e.code === "ENOENT") return undefined; throw e; }
  const url = new URL(endpoint.url), match = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash);
  if (endpoint.schema !== "switchyard-active-endpoint/v1" || !Number.isSafeInteger(endpoint.pid) || endpoint.pid < 1 || url.origin !== `http://127.0.0.1:${port}` || url.pathname !== "/" || url.search || url.username || url.password || !match) throw new Error("The saved review endpoint is invalid; it was preserved for inspection.");
  if (processExists(endpoint.pid)) throw new Error("An existing process still owns this review endpoint. Reuse the running review or stop its verified owner before restarting.");
  return endpoint.review === review ? match[1] : undefined;
}
export async function publishEndpoint(server, { root = runtimeDirectory(), review = null } = {}) {
  await privateDirectory(root);
  const url = `http://127.0.0.1:${server.address().port}/#access=${server.accessToken}`, value = JSON.stringify({ schema: "switchyard-active-endpoint/v1", url, pid: process.pid, ...(review ? { review } : {}) });
  await privateWrite(join(root, `${server.address().port}.json`), value);
  await privateWrite(join(root, "active.json"), value);
  return url;
}
export async function dispatchPhysicalIntent(value, { root = runtimeDirectory(), fetcher = fetch } = {}) {
  const request = closedIntent(value); await privateDirectory(root);
  const endpoint = JSON.parse(await privateRead(join(root, "active.json"))), url = new URL(endpoint.url);
  const match = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash);
  if (endpoint.schema !== "switchyard-active-endpoint/v1" || !Number.isSafeInteger(endpoint.pid) || endpoint.pid < 1 || url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/" || url.search || url.username || url.password || !match || +url.port < 1024) throw new Error("The active local endpoint could not be verified.");
  try { process.kill(endpoint.pid, 0); } catch { throw new Error("Switchyard is not running. The intent was not redirected or replayed."); }
  const invocationId = randomUUID(), at = Date.now(); let accepted = false;
  try {
    const response = await fetcher(`${url.origin}/api/suite/intent`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(125000), headers: { Authorization: `Bearer ${match[1]}`, Origin: url.origin, "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    while (true) { const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.byteLength; if (size > 256 * 1024) { await reader.cancel(); throw new Error("Intent response exceeds its bound."); } chunks.push(Buffer.from(chunk)); }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!response.ok) throw new Error(result.error || "The active compartment rejected this physical intent.");
    accepted = true; return result;
  } finally {
    const directory = join(root, "intent-receipts"); await privateDirectory(directory);
    await privateWrite(join(directory, `${intentKey(request)}.json`), JSON.stringify({ schema: "switchyard-physical-intent-receipt/v1", invocationId, at, completedAt: Date.now(), processId: process.pid, intent: request, status: accepted ? "accepted" : "rejected", evidence: "authenticated local dispatch; external task completion and physical keyboard event not established" }));
  }
}
export async function waitIntentReceipt(value, since, { root = runtimeDirectory(), timeoutMs = 130000 } = {}) {
  const path = join(root, "intent-receipts", `${intentKey(value)}.json`), deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const receipt = JSON.parse(await privateRead(path)); if (receipt.schema === "switchyard-physical-intent-receipt/v1" && receipt.at >= since && JSON.stringify(receipt.intent) === JSON.stringify(closedIntent(value))) { if (receipt.status !== "accepted") throw new Error("The active compartment rejected the registered shortcut. Review its target and policy."); return receipt; } }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The registered shortcut did not produce an authenticated local receipt. No task outcome was claimed.");
}
