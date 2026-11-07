import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { studioEditorChoices, studioEditorProjects, type StudioEditorProjects, type StudioEditorChoices } from "./studio-editor-choices.ts";
import { StudioInstanceTransport } from "./studio-instance-transport.ts";
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

export interface StudioEditorPeer {
  readonly pid: number; readonly birth: string; readonly executable: string; readonly executableSha256: string;
}
export interface StudioEditorConnectionObservation {
  readonly requestId: string; readonly status: string; readonly peerVerified: boolean; readonly protocolAcknowledged: boolean;
  readonly terminalLaunched: false; readonly ideAttached: false; readonly authorityGranted: false; readonly completionVerified: false;
}
export interface StudioEditorConnectionRecord {
  readonly requestId: string; readonly editorId: string; readonly ownerRequestId: string; readonly loadRequestId: string;
  readonly status: string; readonly protocolAcknowledgementRecorded: boolean; readonly stoppedVerified: boolean;
  readonly terminalLaunched: false; readonly ideAttached: false; readonly authorityGranted: false; readonly completionVerified: false;
  readonly duplicatePrevented?: true; readonly recoveryBlocked?: true;
}
export interface StudioEditorConnectionReady extends StudioEditorConnectionObservation {
  readonly duplicatePrevented: false;
  readonly endpoint: Readonly<{ socketPath: string; socketDevice: string; socketInode: string }>;
}
type ConnectionAction = "open" | "pin-peer" | "observe" | "stop" | "recover";
const connectionOperations = { open: "editorConnectionOpen", "pin-peer": "editorConnectionPeer", observe: "editorConnectionObserve", stop: "editorConnectionStop", recover: "editorConnectionRecover" } as const;
type ConnectionOperation = typeof connectionOperations[ConnectionAction];
function editorPeer(value: unknown): StudioEditorPeer {
  requireValue(object(value) && keys(value, ["pid", "birth", "executable", "executableSha256"]) && Number.isSafeInteger(value.pid) && (value.pid as number)>0 && (value.pid as number)<=2147483647 && typeof value.birth === "string" && /^[1-9][0-9]{0,19}$/.test(value.birth) && hash(value.executableSha256));
  requireValue(typeof value.executable === "string" && isAbsolute(value.executable) && normalize(value.executable) === value.executable && Buffer.byteLength(value.executable)<=4096 && !/[\\\x00-\x1f\x7f]/.test(value.executable));
  return Object.freeze({ ...value }) as unknown as StudioEditorPeer;
}
function connectionResult(value: unknown, selected: StudioEditorRequest, action: ConnectionAction): StudioEditorConnectionObservation | StudioEditorConnectionReady | StudioEditorConnectionRecord {
  requireValue(object(value) && keys(value, ["schema", "action", "selection", "result"]) && value.schema === "switchyard-editor-connection-result/v1" && value.action === action && object(value.selection) && keys(value.selection, editorIds) && editorIds.every(key => (value.selection as Record<string, unknown>)[key] === selected[key]));
  const result = value.result, flags = ["terminalLaunched", "ideAttached", "authorityGranted", "completionVerified"];
  requireValue(object(result) && result.requestId === selected.requestId && flags.every(key => result[key] === false));
  if (action === "stop" || action === "recover" || action === "open" && result.duplicatePrevented === true) {
    const extra = [...(result.duplicatePrevented === true ? ["duplicatePrevented"] : []), ...(result.recoveryBlocked === true ? ["recoveryBlocked"] : [])];
    requireValue(keys(result, [...editorIds, "status", "protocolAcknowledgementRecorded", "stoppedVerified", ...flags, ...extra]) && editorIds.every(key => result[key] === selected[key]));
    requireValue(typeof result.protocolAcknowledgementRecorded === "boolean" && ["reserved", "directory-planned", "private", "upstream", "ingress-reserved", "ingress-started", "ready", "peer-pinned", "peer-requested", "connected", "acknowledged", "uncertain", "stopped"].includes(result.status as string) && result.stoppedVerified === (result.status === "stopped"));
    requireValue(action === "recover" || result.recoveryBlocked === undefined);
    if (action === "stop") requireValue(["stopped", "uncertain"].includes(result.status as string));
    return Object.freeze(result) as unknown as StudioEditorConnectionRecord;
  }
  const opening = action === "open";
  requireValue(keys(result, ["requestId", "status", "peerVerified", "protocolAcknowledged", ...flags, ...(opening ? ["endpoint", "duplicatePrevented"] : [])]));
  requireValue(["ready", "peer-requested", "connected", "acknowledged"].includes(result.status as string) && typeof result.peerVerified === "boolean" && typeof result.protocolAcknowledged === "boolean" && result.protocolAcknowledged === (result.status === "acknowledged") && (!result.protocolAcknowledged || result.peerVerified));
  if (opening) {
    const endpoint = result.endpoint;
    requireValue(result.duplicatePrevented === false && result.status === "ready" && result.peerVerified === false && object(endpoint) && keys(endpoint, ["socketPath", "socketDevice", "socketInode"]) && integer(endpoint.socketDevice) && integer(endpoint.socketInode));
    requireValue(typeof endpoint.socketPath === "string" && isAbsolute(endpoint.socketPath) && normalize(endpoint.socketPath) === endpoint.socketPath && Buffer.byteLength(endpoint.socketPath)<=100 && !/[\\\x00-\x1f\x7f]/.test(endpoint.socketPath));
    Object.freeze(endpoint);
  }
  return Object.freeze(result) as unknown as StudioEditorConnectionObservation | StudioEditorConnectionReady;
}

/** Signed target/review/permit transport. No command registration, task load or terminal launch. */
export class StudioTaskClient {
  private readonly transport: StudioInstanceTransport;
  private closed = false;
  private readonly endpointPath: string;
  private readonly assertContext: () => void | Promise<void>;
  constructor(options: { endpointPath?: string; assertCurrent?: () => void | Promise<void> } = {}) {
    this.endpointPath = options.endpointPath ?? join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "strathex-switchyard/application/endpoint.json");
    requireValue(isAbsolute(this.endpointPath) && normalize(this.endpointPath) === this.endpointPath);
    this.assertContext = options.assertCurrent ?? (() => {});
    this.transport = new StudioInstanceTransport({ readEndpoint: () => this.endpoint(), assertCurrent: () => this.current() });
  }
  private async current(): Promise<void> { requireValue(process.platform === "linux" && !this.closed); await this.assertContext(); requireValue(!this.closed); }
  private async endpoint(): Promise<string> {
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
    await this.current(); return bytes;
  }
  async editorProjects(): Promise<StudioEditorProjects> {
    return studioEditorProjects(await this.transport.exchange("editorProjects", Object.freeze({})), value => typeof value === "string" && isAbsolute(value) && normalize(value) === value && !/[\\\x00-\x1f\x7f]/.test(value));
  }
  async editorChoices(repositoryRoot: string): Promise<StudioEditorChoices> {
    requireValue(typeof repositoryRoot === "string" && isAbsolute(repositoryRoot) && normalize(repositoryRoot) === repositoryRoot && Buffer.byteLength(repositoryRoot) <= 4096 && !/[\\\x00-\x1f\x7f]/.test(repositoryRoot));
    return studioEditorChoices(await this.transport.exchange("editorChoices", Object.freeze({ repositoryRoot })), repositoryRoot);
  }
  async editorTarget(input: StudioEditorSelection): Promise<StudioEditorObservation> {
    requireValue(object(input) && keys(input as unknown as Record<string, unknown>, ["compartment", "ownerRequestId", "loadRequestId"]) && /^[a-z][a-z0-9-]{0,63}$/.test(input.compartment) && uuid(input.ownerRequestId) && uuid(input.loadRequestId));
    const selected = Object.freeze({ ...input }); return observation(await this.transport.exchange("editorTarget", selected), selected);
  }
  async returnEditorTarget(input: StudioEditorRequest): Promise<StudioEditorObservation> { const selected = editorSelection(input); return observation(await this.transport.exchange("editorReturnTarget", selected), selected); }
  async reviewEditor(input: StudioEditorRequest): Promise<StudioEditorReview> { const selected = editorSelection(input); return editorReview(await this.transport.exchange("editorReview", selected), selected); }
  async issueEditor(input: StudioEditorRequest & { readonly token: string }): Promise<StudioEditorAuthorization> { const selected = editorSelection(input, "token"); return editorAuthorization(await this.transport.exchange("editorIssue", selected), selected, "editorIssue"); }
  async consumeEditor(input: StudioEditorRequest & { readonly permit: string }): Promise<StudioEditorAuthorization> { const selected = editorSelection(input, "permit"); return editorAuthorization(await this.transport.exchange("editorConsume", selected), selected, "editorConsume"); }
  async openEditorConnection(input: StudioEditorRequest): Promise<StudioEditorConnectionReady | StudioEditorConnectionRecord> {
    const selected = editorSelection(input); return connectionResult(await this.transport.exchange("editorConnectionOpen", selected), selected, "open") as StudioEditorConnectionReady | StudioEditorConnectionRecord;
  }
  async pinEditorPeer(input: StudioEditorRequest & { readonly peer: StudioEditorPeer }): Promise<StudioEditorConnectionObservation> {
    requireValue(object(input) && keys(input as unknown as Record<string, unknown>, ["compartment", ...editorIds, "peer"]));
    const { peer: supplied, ...selection } = input, selected = editorSelection(selection), peer = editorPeer(supplied);
    return connectionResult(await this.transport.exchange("editorConnectionPeer", Object.freeze({ ...selected, peer })), selected, "pin-peer") as StudioEditorConnectionObservation;
  }
  async observeEditorConnection(input: StudioEditorRequest): Promise<StudioEditorConnectionObservation> {
    const selected = editorSelection(input); return connectionResult(await this.transport.exchange("editorConnectionObserve", selected), selected, "observe") as StudioEditorConnectionObservation;
  }
  async stopEditorConnection(input: StudioEditorRequest): Promise<StudioEditorConnectionRecord> {
    const selected = editorSelection(input); return connectionResult(await this.transport.exchange("editorConnectionStop", selected), selected, "stop") as StudioEditorConnectionRecord;
  }
  async recoverEditorConnection(input: StudioEditorRequest): Promise<StudioEditorConnectionRecord> {
    const selected = editorSelection(input); return connectionResult(await this.transport.exchange("editorConnectionRecover", selected), selected, "recover") as StudioEditorConnectionRecord;
  }
  cancelPending(): void { this.transport.cancelPending(); }
  close(): void { this.closed = true; this.transport.close(); }
}
