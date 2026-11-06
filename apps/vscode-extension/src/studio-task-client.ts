import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { request, type ClientRequest } from "node:http";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { codexTerminalResumeArguments } from "./codex-terminal.ts";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is string => typeof v === "string" && /^[1-9]\d{0,24}$/.test(v);
function object(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function keys(v: Record<string, unknown>, names: readonly string[]): boolean { return Object.keys(v).sort().join() === [...names].sort().join(); }
function requireValue(v: unknown): asserts v { if (!v) throw Error("The original Switchyard editor target did not authenticate or validate."); }
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
// The instance/v1 metadata operation signs both request and response. Its
// private API bearer never leaves the endpoint file, including during restart.
const mac = (token: string, direction: string, route: string, body: string) => createHmac("sha256", token).update(`SWITCHYARD-INSTANCE-V1\n${direction}\nPOST\n${route}\n`).update(body).digest("hex");

export interface StudioEditorSelection { readonly compartment: string; readonly ownerRequestId: string; readonly loadRequestId: string; }
export interface StudioEditorRequest extends StudioEditorSelection { readonly requestId: string; readonly editorId: string; }
export interface StudioEditorTarget {
  readonly schema: "switchyard-codex-editor-target/v1";
  readonly ownerRequestId: string; readonly loadRequestId: string; readonly taskId: string; readonly sessionId: string;
  readonly repositoryRoot: string; readonly repositoryIdentity: Readonly<{ device: string; inode: string }>;
  readonly accountFingerprint: string; readonly permissions: "read-only/on-request";
  readonly endpoint: Readonly<{ socketPath: string; socketDevice: string; socketInode: string; peerPid: number; peerBirth: string; peerExecutableSha256: string }>;
}
export interface StudioEditorObservation {
  readonly target: StudioEditorTarget; readonly targetDigest: string;
  readonly metadataObserved: true; readonly nativeLoadAcknowledged: true;
  readonly nativeTaskLoaded: false; readonly authorityGranted: false; readonly terminalLaunched: false;
  readonly ideAttached: false; readonly modelPromptSubmitted: false; readonly completionVerified: false;
}
function observation(value: unknown, selected: StudioEditorSelection): StudioEditorObservation {
  requireValue(object(value) && keys(value, ["target", "targetDigest", "metadataObserved", "nativeLoadAcknowledged", "nativeTaskLoaded", "authorityGranted", "terminalLaunched", "ideAttached", "modelPromptSubmitted", "completionVerified"]));
  requireValue(value.metadataObserved === true && value.nativeLoadAcknowledged === true);
  for (const key of ["nativeTaskLoaded", "authorityGranted", "terminalLaunched", "ideAttached", "modelPromptSubmitted", "completionVerified"]) requireValue(value[key] === false);
  const t = value.target;
  requireValue(object(t) && keys(t, ["schema", "ownerRequestId", "loadRequestId", "taskId", "sessionId", "repositoryRoot", "repositoryIdentity", "accountFingerprint", "permissions", "endpoint"]));
  requireValue(t.schema === "switchyard-codex-editor-target/v1" && t.ownerRequestId === selected.ownerRequestId && t.loadRequestId === selected.loadRequestId && uuid(t.taskId) && uuid(t.sessionId) && hash(t.accountFingerprint) && t.permissions === "read-only/on-request");
  const repo = t.repositoryIdentity, endpoint = t.endpoint;
  requireValue(object(repo) && keys(repo, ["device", "inode"]) && integer(repo.device) && integer(repo.inode));
  requireValue(object(endpoint) && keys(endpoint, ["socketPath", "socketDevice", "socketInode", "peerPid", "peerBirth", "peerExecutableSha256"]) && integer(endpoint.socketDevice) && integer(endpoint.socketInode) && integer(endpoint.peerBirth) && Number.isSafeInteger(endpoint.peerPid) && (endpoint.peerPid as number) > 0 && hash(endpoint.peerExecutableSha256));
  requireValue(typeof t.repositoryRoot === "string" && typeof endpoint.socketPath === "string");
  codexTerminalResumeArguments(t.sessionId, t.repositoryRoot, endpoint.socketPath);
  requireValue(hash(value.targetDigest) && value.targetDigest === digest(t));
  Object.freeze(repo); Object.freeze(endpoint); Object.freeze(t);
  return Object.freeze(value) as unknown as StudioEditorObservation;
}

export interface StudioEditorReview {
  readonly status: "requires-confirmation"; readonly selection: Omit<StudioEditorRequest, "compartment">; readonly target: StudioEditorTarget;
  readonly confirmation: Readonly<{ token: string; record: Readonly<{ id: string; action: "launch_codex_editor"; sessionId: string; targetSnapshotId: string; scopeDigest: string; reason: string; reauthenticated: false; createdAt: string; expiresAt: string }> }>;
  readonly terminalLaunchAuthorized: false; readonly terminalLaunched: false; readonly ideAttached: false; readonly modelPromptSubmitted: false; readonly completionVerified: false;
}
export interface StudioEditorAuthorization {
  readonly requestId: string; readonly editorId: string; readonly ownerRequestId: string; readonly loadRequestId: string;
  readonly status: "issued" | "consumed"; readonly terminalLaunchAuthorized: boolean;
  readonly terminalLaunched: false; readonly ideAttached: false; readonly modelPromptSubmitted: false; readonly completionVerified: false;
  readonly permit?: string; readonly expiresAt?: number; readonly targetDigest?: string; readonly target?: StudioEditorTarget; readonly duplicatePrevented?: true;
}
const editorIds = ["ownerRequestId", "loadRequestId", "requestId", "editorId"] as const;
const editorFlags = ["terminalLaunchAuthorized", "terminalLaunched", "ideAttached", "modelPromptSubmitted", "completionVerified"] as const;
function editorSelection(input: StudioEditorRequest, extra: "token" | "permit" | undefined = undefined): StudioEditorRequest & Record<string, unknown> {
  requireValue(object(input) && keys(input as unknown as Record<string, unknown>, ["compartment", ...editorIds, ...(extra ? [extra] : [])]) && /^[a-z][a-z0-9-]{0,63}$/.test(input.compartment) && editorIds.every(key => uuid(input[key])));
  if (extra) requireValue(uuid((input as unknown as Record<string, unknown>)[extra]));
  return Object.freeze({ ...input });
}
function editorTarget(value: unknown, selected: StudioEditorSelection): StudioEditorTarget {
  return observation({ target: value, targetDigest: digest(value), metadataObserved: true, nativeLoadAcknowledged: true, nativeTaskLoaded: false, authorityGranted: false, terminalLaunched: false, ideAttached: false, modelPromptSubmitted: false, completionVerified: false }, selected).target;
}
function editorReview(value: unknown, selected: StudioEditorRequest): StudioEditorReview {
  requireValue(object(value) && keys(value, ["status", "selection", "target", "confirmation", ...editorFlags]) && value.status === "requires-confirmation" && editorFlags.every(key => value[key] === false));
  const selection = value.selection, confirmation = value.confirmation;
  requireValue(object(selection) && keys(selection, editorIds) && editorIds.every(key => selection[key] === selected[key]));
  const target = editorTarget(value.target, selected);
  requireValue(object(confirmation) && keys(confirmation, ["record", "token"]) && uuid(confirmation.token));
  const record = confirmation.record;
  requireValue(object(record) && keys(record, ["id", "action", "sessionId", "targetSnapshotId", "scopeDigest", "reason", "reauthenticated", "createdAt", "expiresAt"]) && uuid(record.id) && record.action === "launch_codex_editor" && record.sessionId === target.sessionId && hash(record.scopeDigest) && record.reauthenticated === false);
  requireValue(record.targetSnapshotId === digest(["switchyard-editor-launch/v1", selected.compartment, Object.fromEntries(editorIds.map(key => [key, selected[key]]))]));
  requireValue(typeof record.reason === "string" && record.reason.length > 0 && record.reason.length <= 2048 && !/[\x00-\x1f\x7f]/.test(record.reason) && typeof record.createdAt === "string" && typeof record.expiresAt === "string");
  const created = Date.parse(record.createdAt), expires = Date.parse(record.expiresAt), at = Date.now();
  requireValue(Number.isFinite(created) && created <= at && expires > at && expires - created === 300000);
  Object.freeze(selection); Object.freeze(record); Object.freeze(confirmation);
  return Object.freeze(value) as unknown as StudioEditorReview;
}
function editorAuthorization(value: unknown, selected: StudioEditorRequest, operation: "editorIssue" | "editorConsume"): StudioEditorAuthorization {
  requireValue(object(value)); const duplicate = value.duplicatePrevented === true;
  const extra = duplicate ? ["duplicatePrevented"] : operation === "editorIssue" ? ["permit", "expiresAt", "targetDigest"] : ["target", "targetDigest", "expiresAt"];
  requireValue(keys(value, [...editorIds, "status", ...editorFlags, ...extra]) && editorIds.every(key => value[key] === selected[key]) && ["issued", "consumed"].includes(value.status as string));
  requireValue(editorFlags.filter(key => key !== "terminalLaunchAuthorized").every(key => value[key] === false) && value.terminalLaunchAuthorized === (!duplicate && operation === "editorConsume"));
  if (operation === "editorConsume" || !duplicate) requireValue(value.status === (operation === "editorIssue" ? "issued" : "consumed"));
  if (!duplicate) {
    requireValue(hash(value.targetDigest) && Number.isSafeInteger(value.expiresAt) && (value.expiresAt as number) > Date.now() && (value.expiresAt as number) <= Date.now() + 30000);
    if (operation === "editorIssue") requireValue(uuid(value.permit));
    else { editorTarget(value.target, selected); requireValue(digest(value.target) === value.targetDigest); }
  }
  return Object.freeze(value) as unknown as StudioEditorAuthorization;
}

/** Signed target/review/permit transport. No command registration, task load or terminal launch. */
export class StudioTaskClient {
  private readonly active = new Set<ClientRequest>();
  private closed = false;
  private readonly endpointPath: string;
  private readonly assertContext: () => void | Promise<void>;
  constructor(options: { endpointPath?: string; assertCurrent?: () => void | Promise<void> } = {}) {
    this.endpointPath = options.endpointPath ?? join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/application/endpoint.json");
    requireValue(isAbsolute(this.endpointPath) && normalize(this.endpointPath) === this.endpointPath);
    this.assertContext = options.assertCurrent ?? (() => {});
  }
  private async current(): Promise<void> { requireValue(process.platform === "linux" && !this.closed); await this.assertContext(); requireValue(!this.closed); }
  private async endpoint(): Promise<{ bytes: string; url: URL; token: string; instance: { id: string; build: string }; pid: number }> {
    await this.current();
    const parent = dirname(this.endpointPath), before = await lstat(parent), uid = process.getuid!();
    requireValue(before.isDirectory() && !before.isSymbolicLink() && before.uid === uid && !(before.mode & 0o077) && await realpath(parent) === parent);
    const file = await open(this.endpointPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: string;
    try {
      const info = await file.stat(); requireValue(info.isFile() && info.uid === uid && !(info.mode & 0o077) && info.nlink === 1 && info.size > 0 && info.size <= 4096);
      const data = Buffer.alloc(4097); const read = await file.read(data, 0, data.length, 0); requireValue(read.bytesRead === info.size);
      const after = await lstat(this.endpointPath), directory = await lstat(parent);
      requireValue(after.dev === info.dev && after.ino === info.ino && after.size === info.size && after.mtimeMs === info.mtimeMs && after.ctimeMs === info.ctimeMs && directory.dev === before.dev && directory.ino === before.ino);
      bytes = data.subarray(0, read.bytesRead).toString("utf8");
    } finally { await file.close(); }
    const e: unknown = JSON.parse(bytes); requireValue(object(e) && e.schema === "switchyard-active-endpoint/v1" && typeof e.url === "string" && object(e.instance) && uuid(e.instance.id) && hash(e.instance.build) && Number.isSafeInteger(e.pid) && (e.pid as number) > 0);
    const url = new URL(e.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
    requireValue(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === "/" && !url.search && !url.username && !url.password && +url.port >= 1024 && +url.port <= 65535 && token);
    await this.current(); return { bytes, url, token, instance: { id: e.instance.id, build: e.instance.build }, pid: e.pid as number };
  }
  private post(url: URL, body: string, headers: Record<string, string>): Promise<{ status: number; signature: string | string[] | undefined; body: string }> {
    requireValue(!this.closed);
    return new Promise((resolve, reject) => {
      const req = request(url, { method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), ...headers } }, res => {
        let bytes = 0; const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 32768) res.destroy(Error("Switchyard target response exceeded its bound.")); else chunks.push(chunk); });
        res.once("error", reject); res.once("end", () => resolve({ status: res.statusCode ?? 0, signature: res.headers["x-switchyard-instance-response"], body: Buffer.concat(chunks).toString("utf8") }));
      });
      this.active.add(req); const timer = setTimeout(() => req.destroy(Error("Switchyard target observation timed out.")), 5000);
      req.once("close", () => { clearTimeout(timer); this.active.delete(req); }); req.once("error", reject); req.end(body);
    });
  }
  private async exchange(operation: "editorTarget" | "editorReview" | "editorIssue" | "editorConsume", selected: StudioEditorSelection): Promise<unknown> {
    const e = await this.endpoint(), route = { editorTarget: "/instance/v1/editor-target", editorReview: "/instance/v1/editor-review", editorIssue: "/instance/v1/editor-issue", editorConsume: "/instance/v1/editor-consume" }[operation], nonce = randomBytes(32).toString("base64url");
    const body = JSON.stringify({ schema: "switchyard-instance/v1", operation, nonce, at: Date.now(), instanceId: e.instance.id, build: e.instance.build, selection: selected });
    const proof = await this.post(new URL(route, e.url.origin), body, { "X-Switchyard-Instance-Request": mac(e.token, "REQUEST", route, body) });
    requireValue(proof.status === 200 && hash(proof.signature) && timingSafeEqual(Buffer.from(proof.signature, "hex"), Buffer.from(mac(e.token, "RESPONSE-200", route, proof.body), "hex")));
    const identity: unknown = JSON.parse(proof.body);
    const field = operation === "editorTarget" ? "targetObservation" : "editorAuthorization";
    requireValue(object(identity) && keys(identity, ["schema", "operation", "nonce", "instanceId", "build", "pid", "origin", "status", field]) && identity.schema === "switchyard-instance/v1" && identity.operation === operation && identity.nonce === nonce && identity.instanceId === e.instance.id && identity.build === e.instance.build && identity.pid === e.pid && identity.origin === e.url.origin && identity.status === "ready");
    requireValue((await this.endpoint()).bytes === e.bytes);
    await this.current(); return identity[field];
  }
  async editorTarget(input: StudioEditorSelection): Promise<StudioEditorObservation> {
    requireValue(object(input) && keys(input as unknown as Record<string, unknown>, ["compartment", "ownerRequestId", "loadRequestId"]) && /^[a-z][a-z0-9-]{0,63}$/.test(input.compartment) && uuid(input.ownerRequestId) && uuid(input.loadRequestId));
    const selected = Object.freeze({ ...input }); return observation(await this.exchange("editorTarget", selected), selected);
  }
  async reviewEditor(input: StudioEditorRequest): Promise<StudioEditorReview> { const selected = editorSelection(input); return editorReview(await this.exchange("editorReview", selected), selected); }
  async issueEditor(input: StudioEditorRequest & { readonly token: string }): Promise<StudioEditorAuthorization> { const selected = editorSelection(input, "token"); return editorAuthorization(await this.exchange("editorIssue", selected), selected, "editorIssue"); }
  async consumeEditor(input: StudioEditorRequest & { readonly permit: string }): Promise<StudioEditorAuthorization> { const selected = editorSelection(input, "permit"); return editorAuthorization(await this.exchange("editorConsume", selected), selected, "editorConsume"); }
  close(): void { this.closed = true; for (const request of this.active) request.destroy(Error("Switchyard editor observation stopped.")); }
}
