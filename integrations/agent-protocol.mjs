/** Versioned wire facts shared by the Node SDK and local server. */
import { createHmac, timingSafeEqual } from "node:crypto";
export const agentIntents = Object.freeze(["summon", "resume", "review", "handoff", "status", "cancel"]);
export const agentRoutes = Object.freeze({ event: "/agent/v2/event", poll: "/agent/v2/poll", ack: "/agent/v2/ack" });
export const agentMessageSchema = "switchyard-agent-message/v2";
export const agentResponseSchema = "switchyard-agent-response/v2";
export const requestMac = (token, path, text) => createHmac("sha256", token).update(`SWITCHYARD-REQUEST-V2\nPOST\n${path}\n${text}`).digest("hex");
export const responseMac = (token, path, status, text) => createHmac("sha256", token).update(`SWITCHYARD-RESPONSE-V2\n${status}\n${path}\n${text}`).digest("hex");
export function sameMac(actual, expected) { return typeof actual === "string" && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected)); }
