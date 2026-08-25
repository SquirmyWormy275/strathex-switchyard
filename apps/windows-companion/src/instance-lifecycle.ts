import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { UserSecretProtector } from "./windows-secret.ts";

const schema = "sxsy-b122.companion-instance" as const;
const digestPattern = /^[a-f0-9]{64}$/;
const supervisorIdPattern = /^companion:[a-f0-9]{64}$/;
const maximumDocumentBytes = 256 * 1024;

export interface CompanionSupervisorBinding {
  readonly supervisorId: string;
  readonly requestPath: string;
  readonly statePath: string;
  readonly helperPath: string;
  readonly helperSha256: string;
  readonly jobName: string;
  readonly supervisorCreationFileTimeUtc: string;
  readonly childCreationFileTimeUtc: string;
}

export interface CompanionInstanceRecord {
  readonly schema: typeof schema;
  readonly version: 1 | 2;
  readonly nonce: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly mainPath: string;
  readonly processPath: string;
  readonly supervisorId?: string;
  readonly supervisorRequestPath?: string;
  readonly supervisorStatePath?: string;
  readonly supervisorHelperPath?: string;
  readonly supervisorHelperSha256?: string;
  readonly supervisorJobName?: string;
  readonly supervisorCreationFileTimeUtc?: string;
  readonly childCreationFileTimeUtc?: string;
}

export interface CompanionInstanceLease { readonly record: CompanionInstanceRecord; readonly filePath: string; release(): Promise<void>; }
export interface CompanionInstanceOptions {
  readonly supervisor?: CompanionSupervisorBinding;
  readonly protector?: UserSecretProtector;
  readonly observeSupervisor?: (record: CompanionInstanceRecord) => Promise<"active" | "terminal" | "ambiguous">;
}

/** A dead PID is never enough: supervised stale leases require exact whole-Job terminal proof. */
export async function acquireCompanionInstance(stateDirectory: string, mainPath: string, options: CompanionInstanceOptions = {}): Promise<CompanionInstanceLease> {
  if (!isAbsolute(stateDirectory) || !isAbsolute(mainPath) || /[\r\n\0]/.test(stateDirectory + mainPath)) throw new Error("Companion instance paths must be fixed and absolute.");
  const requestedDirectory = resolve(stateDirectory);
  await mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
  const directory = await realpath(requestedDirectory);
  const canonicalMain = await realpath(mainPath);
  const canonicalProcess = await realpath(process.execPath);
  const supervisor = options.supervisor ?? await loadCompanionSupervisorBinding(directory, canonicalMain, canonicalProcess);
  const filePath = join(directory, "companion-instance.json");
  const base = { schema, nonce: randomUUID(), pid: process.pid, startedAt: new Date().toISOString(), mainPath: canonicalMain, processPath: canonicalProcess } as const;
  const leaseRecord: CompanionInstanceRecord = supervisor
    ? { ...base, version: 2, supervisorId: supervisor.supervisorId, supervisorRequestPath: supervisor.requestPath, supervisorStatePath: supervisor.statePath, supervisorHelperPath: supervisor.helperPath, supervisorHelperSha256: supervisor.helperSha256, supervisorJobName: supervisor.jobName, supervisorCreationFileTimeUtc: supervisor.supervisorCreationFileTimeUtc, childCreationFileTimeUtc: supervisor.childCreationFileTimeUtc }
    : { ...base, version: 1 };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(filePath, "wx", 0o600);
      try { await handle.writeFile(`${JSON.stringify(leaseRecord)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      return { record: leaseRecord, filePath, async release() {
        let opened: ConcreteTextFile | undefined;
        try { opened = await readConcreteTextFile(directory, "companion-instance.json", maximumDocumentBytes); } catch { return; }
        if (!opened) return;
        let current: CompanionInstanceRecord | undefined; try { current = parseInstance(opened.text); } catch { return; }
        if (current.nonce === leaseRecord.nonce && current.pid === leaseRecord.pid) await removeConcreteTextFile(opened);
      } };
    } catch (error) {
      if (!alreadyExists(error)) throw error;
      let opened: ConcreteTextFile | undefined;
      try { opened = await readConcreteTextFile(directory, "companion-instance.json", maximumDocumentBytes); } catch { throw new Error("The companion instance record is malformed, unsafe, or oversized; refusing automatic replacement."); }
      if (!opened) throw new Error("The companion instance record disappeared during acquisition; refusing automatic replacement.");
      let current: CompanionInstanceRecord; try { current = parseInstance(opened.text); } catch { throw new Error("The companion instance record is malformed; refusing automatic replacement."); }
      if (attempt > 0) throw new Error("The stale companion instance record could not be replaced safely.");
      if (current.version !== 2) {
        if (processExists(current.pid)) throw new Error("Another SXSY-B122 companion instance is already active.");
        throw new Error("A dead unsupervised companion lease requires reviewed management recovery; PID absence alone is insufficient.");
      }
      const shutdownRecovery = await validateShutdownRecoveryIfPresent(directory, current, options.protector);
      const disposition = options.observeSupervisor ? await options.observeSupervisor(current) : await observeRecordedSupervisor(current);
      if (disposition === "active") throw new Error("The prior companion Job Object still owns an active process tree.");
      if (disposition !== "terminal") throw new Error("The prior companion Job Object lacks an exact terminal containment receipt; refusing restart.");
      if (shutdownRecovery) await removeConcreteTextFile(shutdownRecovery);
      await removeConcreteTextFile(opened);
    }
  }
  throw new Error("The companion instance lease could not be acquired.");
}

/** Reads the two fixed supervisor paths injected by Start-B122's reviewed helper request. */
export async function loadCompanionSupervisorBinding(stateDirectory: string, mainPath: string, processPath: string): Promise<CompanionSupervisorBinding | undefined> {
  const requestPath = process.env.SXSY_B122_COMPANION_SUPERVISOR_REQUEST;
  const statePath = process.env.SXSY_B122_COMPANION_SUPERVISOR_STATE;
  if (!requestPath && !statePath) return undefined;
  if (!requestPath || !statePath) throw new Error("The companion supervisor environment binding is incomplete.");
  return validateSupervisorFiles(stateDirectory, mainPath, processPath, requestPath, statePath, process.pid);
}

export function parseInstance(text: string): CompanionInstanceRecord {
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error("Companion instance record is not JSON."); }
  if (!record(value) || value.schema !== schema || (value.version !== 1 && value.version !== 2) || typeof value.nonce !== "string" || !/^[a-f0-9-]{36}$/i.test(value.nonce) || !Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) || typeof value.mainPath !== "string" || !isAbsolute(value.mainPath) || typeof value.processPath !== "string" || !isAbsolute(value.processPath)) throw new Error("Companion instance record is invalid.");
  if (value.version === 1) {
    if (Object.keys(value).length !== 7) throw new Error("Companion instance record is invalid.");
  } else if (!exactKeys(value, ["schema", "version", "nonce", "pid", "startedAt", "mainPath", "processPath", "supervisorId", "supervisorRequestPath", "supervisorStatePath", "supervisorHelperPath", "supervisorHelperSha256", "supervisorJobName", "supervisorCreationFileTimeUtc", "childCreationFileTimeUtc"])
    || typeof value.supervisorId !== "string" || !supervisorIdPattern.test(value.supervisorId)
    || typeof value.supervisorRequestPath !== "string" || !isAbsolute(value.supervisorRequestPath)
    || typeof value.supervisorStatePath !== "string" || !isAbsolute(value.supervisorStatePath)
    || typeof value.supervisorHelperPath !== "string" || !isAbsolute(value.supervisorHelperPath)
    || typeof value.supervisorHelperSha256 !== "string" || !digestPattern.test(value.supervisorHelperSha256)
    || value.supervisorJobName !== `Global\\SxsyB122Companion-${value.supervisorId.slice("companion:".length)}`
    || typeof value.supervisorCreationFileTimeUtc !== "string" || !/^[1-9][0-9]{10,19}$/.test(value.supervisorCreationFileTimeUtc)
    || typeof value.childCreationFileTimeUtc !== "string" || !/^[1-9][0-9]{10,19}$/.test(value.childCreationFileTimeUtc)) throw new Error("Companion supervised instance record is invalid.");
  return value as unknown as CompanionInstanceRecord;
}

async function validateSupervisorFiles(stateDirectory: string, mainPath: string, processPath: string, inputRequestPath: string, inputStatePath: string, expectedPid: number): Promise<CompanionSupervisorBinding> {
  const directory = await realpath(resolve(stateDirectory));
  const requestPath = await concreteFile(inputRequestPath, maximumDocumentBytes);
  const statePath = await concreteFile(inputStatePath, maximumDocumentBytes);
  if (!samePath(requestPath, join(directory, "companion-supervisor.request.json")) || !samePath(statePath, join(directory, "companion-supervisor.state.json"))) throw new Error("The companion supervisor control files escaped the exact state root.");
  const request = parseSupervisorRequest(await readFile(requestPath, "utf8"));
  const state = parseSupervisorState(await readFile(statePath, "utf8"));
  const helperPath = await concreteFile(request.helperPath, 512 * 1024 * 1024);
  const canonicalMain = await realpath(mainPath); const canonicalProcess = await realpath(processPath); const bundleRoot = await realpath(request.bundleRoot);
  if (!samePath(request.stateRoot, directory) || !samePath(request.statePath, statePath) || !samePath(request.nodePath, canonicalProcess) || !samePath(request.mainPath, canonicalMain) || !samePath(request.workingDirectory, bundleRoot)
    || !samePath(canonicalProcess, join(bundleRoot, "runtime", "node.exe")) || !samePath(canonicalMain, join(bundleRoot, "app", "dist", "apps", "windows-companion", "src", "main.js"))) throw new Error("The companion supervisor request is not bound to this packaged process.");
  if (!samePath(request.environment.SXSY_B122_COMPANION_SUPERVISOR_REQUEST, requestPath) || !samePath(request.environment.SXSY_B122_COMPANION_SUPERVISOR_STATE, statePath)) throw new Error("The companion supervisor child environment is confused.");
  const [helperSha256, nodeSha256, mainSha256, requestSha256] = await Promise.all([sha256File(helperPath), sha256File(canonicalProcess), sha256File(canonicalMain), sha256File(requestPath)]);
  if (helperSha256 !== request.helperSha256 || nodeSha256 !== request.nodeSha256 || mainSha256 !== request.mainSha256 || state.requestSha256 !== requestSha256 || !samePath(state.helperPath, helperPath) || state.helperSha256 !== helperSha256 || state.bundleId !== request.bundleId || !samePath(state.bundleRoot, bundleRoot) || state.supervisorId !== request.supervisorId || state.controlTokenSha256 !== sha256Text(request.controlToken)
    || state.jobName !== `Global\\SxsyB122Companion-${request.supervisorId.slice("companion:".length)}` || state.childPid !== expectedPid || state.status !== "running" || state.activeProcesses < 1 || !fixedDigestEquals(state.authenticationTag, supervisorStateTag(state, request.controlToken))) throw new Error("The companion supervisor state is stale, tampered, or bound to another process.");
  return { supervisorId: request.supervisorId, requestPath, statePath, helperPath, helperSha256, jobName: state.jobName, supervisorCreationFileTimeUtc: state.supervisorCreationFileTimeUtc, childCreationFileTimeUtc: state.childCreationFileTimeUtc };
}

async function observeRecordedSupervisor(instance: CompanionInstanceRecord): Promise<"active" | "terminal" | "ambiguous"> {
  if (instance.version !== 2 || !instance.supervisorRequestPath || !instance.supervisorStatePath || !instance.supervisorHelperPath || !instance.supervisorId) return "ambiguous";
  const binding = await validateSupervisorFilesForRecord(instance);
  const result = await runObserver(binding.helperPath, ["--observe", binding.requestPath, binding.statePath]);
  const lines = result.stdout.split(/\r?\n/).filter(Boolean); if (lines.length !== 1) return "ambiguous";
  let receipt: unknown; try { receipt = JSON.parse(lines[0]!); } catch { return "ambiguous"; }
  if (!record(receipt) || !exactKeys(receipt, ["schema", "version", "supervisorId", "status", "activeProcesses"]) || receipt.schema !== "sxsy-b122.companion-supervisor-observation" || receipt.version !== 1 || receipt.supervisorId !== instance.supervisorId || !Number.isSafeInteger(receipt.activeProcesses)) return "ambiguous";
  if (result.code === 0 && receipt.status === "active" && receipt.activeProcesses > 0) return "active";
  if (result.code === 1 && ["clean_exit", "terminated", "contained_after_parent_exit", "failed_contained", "contained_after_supervisor_exit"].includes(String(receipt.status)) && receipt.activeProcesses === 0) return "terminal";
  return "ambiguous";
}

async function validateSupervisorFilesForRecord(instance: CompanionInstanceRecord): Promise<CompanionSupervisorBinding> {
  const requestPath = await concreteFile(instance.supervisorRequestPath!, maximumDocumentBytes); const statePath = await concreteFile(instance.supervisorStatePath!, maximumDocumentBytes);
  const request = parseSupervisorRequest(await readFile(requestPath, "utf8")); const state = parseSupervisorState(await readFile(statePath, "utf8")); const helperPath = await concreteFile(instance.supervisorHelperPath!, 512 * 1024 * 1024);
  if (request.supervisorId !== instance.supervisorId || state.supervisorId !== instance.supervisorId || state.supervisorCreationFileTimeUtc !== instance.supervisorCreationFileTimeUtc || state.childPid !== instance.pid || state.childCreationFileTimeUtc !== instance.childCreationFileTimeUtc || !samePath(requestPath, request.environment.SXSY_B122_COMPANION_SUPERVISOR_REQUEST) || !samePath(statePath, request.statePath) || !samePath(helperPath, request.helperPath) || await sha256File(helperPath) !== instance.supervisorHelperSha256 || state.requestSha256 !== await sha256File(requestPath) || !fixedDigestEquals(state.authenticationTag, supervisorStateTag(state, request.controlToken))) throw new Error("The recorded companion supervisor binding is stale or tampered.");
  return { supervisorId: instance.supervisorId!, requestPath, statePath, helperPath, helperSha256: instance.supervisorHelperSha256!, jobName: instance.supervisorJobName!, supervisorCreationFileTimeUtc: instance.supervisorCreationFileTimeUtc!, childCreationFileTimeUtc: instance.childCreationFileTimeUtc! };
}

async function validateShutdownRecoveryIfPresent(directory: string, instance: CompanionInstanceRecord, protector: UserSecretProtector | undefined): Promise<ConcreteTextFile | undefined> {
  const opened = await readConcreteTextFile(directory, "shutdown-recovery.json", maximumDocumentBytes, true);
  if (!opened) return undefined;
  if (!protector) throw new Error("Authenticated shutdown recovery exists but no CurrentUser protector is available.");
  let envelope: unknown; try { envelope = JSON.parse(opened.text); } catch { throw new Error("The shutdown recovery envelope is malformed."); }
  if (!record(envelope) || !exactKeys(envelope, ["schema", "version", "protector", "sealed"]) || envelope.schema !== "sxsy-b122.dpapi-shutdown-recovery" || envelope.version !== 1 || envelope.protector !== protector.provider || typeof envelope.sealed !== "string") throw new Error("The shutdown recovery envelope is invalid.");
  const clear = await protector.open(envelope.sealed);
  try { const payload: unknown = JSON.parse(Buffer.from(clear).toString("utf8")); if (!record(payload) || !exactKeys(payload, ["schema", "version", "status", "leaseNonce", "pid", "supervisorId", "failedResources", "blockedResources", "recordedAt"]) || payload.schema !== "sxsy-b122.shutdown-recovery" || payload.version !== 2 || payload.status !== "recovery_required" || payload.leaseNonce !== instance.nonce || payload.pid !== instance.pid || payload.supervisorId !== instance.supervisorId || !stringList(payload.failedResources) || !stringList(payload.blockedResources) || typeof payload.recordedAt !== "string" || !Number.isFinite(Date.parse(payload.recordedAt))) throw new Error("The authenticated shutdown recovery payload is stale or invalid."); }
  finally { clear.fill(0); }
  return opened;
}

async function runObserver(executable: string, args: readonly string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, env: {}, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderrBytes = 0; let overflow = false; let timedOut = false; let settled = false;
    const finish = (work: () => void): void => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); work(); };
    child.stdout.on("data", (chunk: Buffer) => { if (Buffer.byteLength(stdout) + chunk.length > 16 * 1024) overflow = true; else stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 16 * 1024) overflow = true; });
    child.once("error", () => finish(() => rejectResult(new Error("The companion supervisor observer could not start."))));
    child.once("close", (code) => finish(() => timedOut ? rejectResult(new Error("The companion supervisor observer exceeded its timeout but its exact process was terminated.")) : overflow ? rejectResult(new Error("The companion supervisor observer exceeded its output bound.")) : resolveResult({ code: code ?? -1, stdout })));
    const killTimer = setTimeout(() => finish(() => rejectResult(new Error("The companion supervisor observer could not prove termination after its timeout."))), 10_000);
    killTimer.unref();
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch { /* the exact process handle is already gone */ } }, 5_000);
  });
}

interface ConcreteTextFile { readonly path: string; readonly text: string; readonly device: bigint; readonly inode: bigint; readonly size: bigint; }

async function readConcreteTextFile(directory: string, name: string, maximumBytes: number, allowMissing = false): Promise<ConcreteTextFile | undefined> {
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/i.test(name)) throw new Error("A companion lifecycle metadata name is invalid.");
  const path = join(directory, name);
  let pathStat;
  try { pathStat = await lstat(path, { bigint: true }); } catch (error) { if (allowMissing && record(error) && error.code === "ENOENT") return undefined; throw error; }
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.size < 1n || pathStat.size > BigInt(maximumBytes)) throw new Error("Companion lifecycle metadata is not one bounded concrete file.");
  const canonical = await realpath(path);
  if (!samePath(canonical, path) || !samePath(await realpath(join(path, "..")), directory)) throw new Error("Companion lifecycle metadata escaped the exact state directory.");
  const handle = await open(path, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== pathStat.dev || before.ino !== pathStat.ino || before.size !== pathStat.size) throw new Error("Companion lifecycle metadata changed before read.");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || BigInt(bytes.length) !== before.size) throw new Error("Companion lifecycle metadata changed during read.");
    return { path, text: bytes.toString("utf8"), device: before.dev, inode: before.ino, size: before.size };
  } finally { await handle.close(); }
}

async function removeConcreteTextFile(opened: ConcreteTextFile): Promise<void> {
  const current = await lstat(opened.path, { bigint: true });
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== opened.device || current.ino !== opened.inode || current.size !== opened.size || !samePath(await realpath(opened.path), opened.path)) throw new Error("Companion lifecycle metadata changed before removal.");
  await rm(opened.path);
}

function parseSupervisorRequest(text: string): SupervisorRequest {
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error("The companion supervisor request is not JSON."); }
  const keys = ["schema", "version", "supervisorId", "bundleRoot", "bundleId", "helperPath", "helperSha256", "nodePath", "nodeSha256", "mainPath", "mainSha256", "arguments", "workingDirectory", "stateRoot", "stdoutPath", "stderrPath", "environment", "controlToken", "statePath"];
  if (!record(value) || !exactKeys(value, keys) || value.schema !== "sxsy-b122.companion-supervisor-request" || value.version !== 1 || typeof value.supervisorId !== "string" || !supervisorIdPattern.test(value.supervisorId) || !absoluteFields(value, ["bundleRoot", "helperPath", "nodePath", "mainPath", "workingDirectory", "stateRoot", "stdoutPath", "stderrPath", "statePath"]) || !digestFields(value, ["bundleId", "helperSha256", "nodeSha256", "mainSha256", "controlToken"]) || !Array.isArray(value.arguments) || value.arguments.some((item) => typeof item !== "string") || !record(value.environment) || typeof value.environment.SXSY_B122_COMPANION_SUPERVISOR_REQUEST !== "string" || typeof value.environment.SXSY_B122_COMPANION_SUPERVISOR_STATE !== "string") throw new Error("The companion supervisor request has an invalid exact schema.");
  return value as unknown as SupervisorRequest;
}

function parseSupervisorState(text: string): SupervisorState {
  let value: unknown; try { value = JSON.parse(text); } catch { throw new Error("The companion supervisor state is not JSON."); }
  const keys = ["schema", "version", "supervisorId", "bundleRoot", "bundleId", "helperPath", "helperSha256", "requestSha256", "controlTokenSha256", "jobName", "supervisorPid", "childPid", "supervisorCreationFileTimeUtc", "childCreationFileTimeUtc", "startedAt", "status", "exitCode", "activeProcesses", "authenticationTag"];
  if (!record(value) || !exactKeys(value, keys) || value.schema !== "sxsy-b122.companion-supervisor-state" || value.version !== 1 || typeof value.supervisorId !== "string" || !supervisorIdPattern.test(value.supervisorId) || !absoluteFields(value, ["bundleRoot", "helperPath"]) || !digestFields(value, ["bundleId", "helperSha256", "requestSha256", "controlTokenSha256", "authenticationTag"]) || typeof value.jobName !== "string" || !positiveInteger(value.supervisorPid) || !positiveInteger(value.childPid) || typeof value.supervisorCreationFileTimeUtc !== "string" || !/^[1-9][0-9]{10,19}$/.test(value.supervisorCreationFileTimeUtc) || typeof value.childCreationFileTimeUtc !== "string" || !/^[1-9][0-9]{10,19}$/.test(value.childCreationFileTimeUtc) || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) || typeof value.status !== "string" || !["running", "clean_exit", "terminated", "contained_after_parent_exit", "failed", "failed_contained", "contained_after_supervisor_exit", "ambiguous"].includes(value.status) || !(value.exitCode === null || Number.isSafeInteger(value.exitCode)) || !Number.isSafeInteger(value.activeProcesses) || value.activeProcesses < 0) throw new Error("The companion supervisor state has an invalid exact schema.");
  return value as unknown as SupervisorState;
}

interface SupervisorRequest { readonly schema: string; readonly version: 1; readonly supervisorId: string; readonly bundleRoot: string; readonly bundleId: string; readonly helperPath: string; readonly helperSha256: string; readonly nodePath: string; readonly nodeSha256: string; readonly mainPath: string; readonly mainSha256: string; readonly arguments: readonly string[]; readonly workingDirectory: string; readonly stateRoot: string; readonly stdoutPath: string; readonly stderrPath: string; readonly environment: Record<string, string>; readonly controlToken: string; readonly statePath: string; }
interface SupervisorState { readonly schema: string; readonly version: 1; readonly supervisorId: string; readonly bundleRoot: string; readonly bundleId: string; readonly helperPath: string; readonly helperSha256: string; readonly requestSha256: string; readonly controlTokenSha256: string; readonly jobName: string; readonly supervisorPid: number; readonly childPid: number; readonly supervisorCreationFileTimeUtc: string; readonly childCreationFileTimeUtc: string; readonly startedAt: string; readonly status: string; readonly exitCode: number | null; readonly activeProcesses: number; readonly authenticationTag: string; }

function supervisorStateTag(state: SupervisorState, token: string): string { return createHmac("sha256", Buffer.from(token, "hex")).update(JSON.stringify({ ...state, authenticationTag: "" })).digest("hex"); }
async function concreteFile(path: string, maximumBytes: number): Promise<string> { if (!isAbsolute(path) || /[\r\n\0]/.test(path)) throw new Error("A companion supervisor path is invalid."); const item = await lstat(path); if (!item.isFile() || item.isSymbolicLink() || item.size < 1 || item.size > maximumBytes) throw new Error("A companion supervisor file is absent, unsafe, or oversized."); const canonical = await realpath(path); if (!samePath(canonical, path)) throw new Error("A companion supervisor file changed canonical identity."); return canonical; }
async function sha256File(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex"); }
function sha256Text(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function fixedDigestEquals(left: string, right: string): boolean { return digestPattern.test(left) && digestPattern.test(right) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex")); }
function samePath(left: string, right: string): boolean { const l = resolve(left).replace(/[\\/]+$/, ""); const r = resolve(right).replace(/[\\/]+$/, ""); return process.platform === "win32" ? l.toLowerCase() === r.toLowerCase() : l === r; }
function stringList(value: unknown): value is readonly string[] { return Array.isArray(value) && value.length <= 16 && value.every((item) => typeof item === "string" && /^[a-z0-9-]{1,64}$/.test(item)); }
function processExists(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return !(record(error) && error.code === "ESRCH"); } }
function alreadyExists(error: unknown): boolean { return record(error) && error.code === "EEXIST"; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function absoluteFields(value: Record<string, unknown>, keys: readonly string[]): boolean { return keys.every((key) => typeof value[key] === "string" && isAbsolute(value[key])); }
function digestFields(value: Record<string, unknown>, keys: readonly string[]): boolean { return keys.every((key) => typeof value[key] === "string" && digestPattern.test(value[key])); }
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
