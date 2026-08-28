import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { Readable } from "node:stream";

import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type { OperationControllerObservation } from "../../../packages/control-plane/src/runtime.ts";
import type { JsonValue, ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import type { RepositoryProcessObservationRequest, RepositoryProcessRecoveryScope, RepositoryProcessStartRequest, RepositoryProcessSupervisor, RepositorySupervisedProcess } from "../../windows-companion/src/repository-runtime.ts";

const startKind = "b122.linux-process.start.v1";
const reservationKind = "b122.linux-process.reservation.v1";
const terminalKind = "b122.linux-process.terminal.v1";

interface LinuxProcessReservation extends Record<string, JsonValue> { readonly supervisorId: string; readonly action: string; readonly operationId: string; readonly targetSnapshotId: string; readonly sessionId: string | null; readonly authorityId: string | null; readonly repositoryRoot: string; readonly manifestSha256: string; readonly executable: string; readonly executableSha256: string; readonly deadlineAt: string; readonly reservedAt: string; }
interface LinuxProcessStart extends Record<string, JsonValue> { readonly supervisorId: string; readonly action: string; readonly operationId: string; readonly targetSnapshotId: string; readonly sessionId: string | null; readonly authorityId: string | null; readonly repositoryRoot: string; readonly manifestSha256: string; readonly executable: string; readonly executableSha256: string; readonly deadlineAt: string; readonly pid: number; readonly procStartTicks: string; readonly startedAt: string; }
interface LinuxProcessTerminal extends Record<string, JsonValue> { readonly supervisorId: string; readonly code: number; readonly signal: string | null; readonly completedAt: string; }

/**
 * Linux process groups are per-operation kill boundaries. systemd's
 * KillMode=control-group remains the outer crash boundary for the companion.
 */
export class LinuxProcessGroupSupervisor implements RepositoryProcessSupervisor {
  private startQueue: Promise<void> = Promise.resolve();
  constructor(private readonly store: ProtectedJsonStore) {}

  async start(request: RepositoryProcessStartRequest): Promise<RepositorySupervisedProcess> {
    const repositoryRoot = await realpath(request.repositoryRoot); const executionRoot = await realpath(request.executionRoot ?? request.repositoryRoot); const cwd = await realpath(request.cwd);
    const executable = await verifiedExecutable(this.store, request.executable, request.executableSha256.toLowerCase());
    if (!insideOrSame(executionRoot, cwd) || !isAbsolute(executable)) throw new Error("The Linux supervised executable or cwd changed before launch.");
    validateRequest(request);
    const deadlineAt = new Date(Date.now() + request.timeoutMs).toISOString();
    const supervisorId = `managed:${createHash("sha256").update(JSON.stringify({ action: request.action, operationId: request.operationId, targetSnapshotId: request.targetSnapshotId, sessionId: request.sessionId ?? null, authorityId: request.authorityId ?? null, repositoryRoot, manifestSha256: request.manifestSha256.toLowerCase(), executable, executableSha256: request.executableSha256.toLowerCase(), deadlineAt })).digest("hex")}`;
    const reservation: LinuxProcessReservation = { supervisorId, action: request.action, operationId: request.operationId, targetSnapshotId: request.targetSnapshotId, sessionId: request.sessionId ?? null, authorityId: request.authorityId ?? null, repositoryRoot, manifestSha256: request.manifestSha256.toLowerCase(), executable, executableSha256: request.executableSha256.toLowerCase(), deadlineAt, reservedAt: new Date().toISOString() };
    await this.exclusiveStart(async () => {
      const existing = (await states(this.store)).filter((state) => state.reservation.operationId === request.operationId);
      if (existing.length) throw new Error("The Linux process supervisor already owns this operation.");
      await this.store.append(reservationKind, reservation);
    });
    const child = spawn(executable, [...request.args], { cwd, env: { ...request.environment }, shell: false, detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (!child.stdout || !child.stderr || !child.pid) { child.kill(); throw new Error("The Linux supervised process did not expose its fixed streams."); }
    const closed = new Promise<{ code: number; signal: NodeJS.Signals | null }>((resolveClose) => child.once("close", (code, signal) => resolveClose({ code: code ?? -1, signal })));
    let startTicks: string;
    try { startTicks = await waitForStartTicks(child.pid); }
    catch (error) { killGroup(child.pid, "SIGKILL"); throw error; }
    const startedAt = new Date().toISOString();
    const record: LinuxProcessStart = { supervisorId, action: request.action, operationId: request.operationId, targetSnapshotId: request.targetSnapshotId, sessionId: request.sessionId ?? null, authorityId: request.authorityId ?? null, repositoryRoot, manifestSha256: request.manifestSha256.toLowerCase(), executable, executableSha256: request.executableSha256.toLowerCase(), deadlineAt, pid: child.pid, procStartTicks: startTicks, startedAt };
    try { await this.store.append(startKind, record); }
    catch (error) { killGroup(child.pid, "SIGKILL"); throw error; }
    const wait = closed.then(async ({ code, signal }) => {
      const terminal: LinuxProcessTerminal = { supervisorId, code, signal, completedAt: new Date().toISOString() };
      try { await this.store.append(terminalKind, terminal); return { code, signal, terminalEvidence: "trusted" as const }; }
      catch { return { code, signal, terminalEvidence: "ambiguous" as const }; }
    });
    return this.handle(record, child.stdout, child.stderr, wait, false);
  }

  async recover(scope: RepositoryProcessRecoveryScope): Promise<readonly RepositorySupervisedProcess[]> {
    const repositoryRoot = await realpath(scope.repositoryRoot); const result: RepositorySupervisedProcess[] = [];
    for (const state of await states(this.store)) if (state.start && !state.terminal && state.start.repositoryRoot === repositoryRoot && state.start.manifestSha256 === scope.manifestSha256.toLowerCase() && await exactAlive(state.start)) {
      const wait = waitForExit(state.start).then(() => ({ code: -1, signal: null, terminalEvidence: "ambiguous" as const }));
      result.push(this.handle(state.start, Readable.from([]), Readable.from([]), wait, true));
    }
    return result;
  }

  async observeOperation(request: RepositoryProcessObservationRequest): Promise<OperationControllerObservation> {
    const repositoryRoot = await realpath(request.repositoryRoot); const matches = (await states(this.store)).filter((state) => state.reservation.operationId === request.operationId && state.reservation.action === request.action && state.reservation.targetSnapshotId === request.targetSnapshotId && state.reservation.repositoryRoot === repositoryRoot && state.reservation.manifestSha256 === request.manifestSha256.toLowerCase() && state.reservation.sessionId === (request.sessionId ?? null) && state.reservation.authorityId === (request.authorityId ?? null));
    if (matches.length !== 1) return matches.length ? active(request, "Multiple Linux process records claimed the exact operation; terminal state is ambiguous.") : { state: "not_owner", operationId: request.operationId, summary: "No exact Linux process-group record owns this operation." };
    const state = matches[0]!;
    if (state.terminal) return { state: "terminal", operationId: request.operationId, action: request.action, targetSnapshotId: request.targetSnapshotId, repositoryRoot, ...(request.sessionId ? { sessionId: request.sessionId } : {}), ...(request.authorityId ? { authorityId: request.authorityId } : {}), status: state.terminal.code === 0 ? "completed" : "failed", effectDisposition: "committed", summary: `The exact Linux process group exited with code ${state.terminal.code}.` };
    return active(request, state.start && await exactAlive(state.start) ? "The exact Linux process group remains active." : "The reserved Linux process is absent without a protected terminal record; its result is ambiguous and is not replayed.");
  }

  private async exclusiveStart<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.startQueue;
    let release!: () => void;
    this.startQueue = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }

  private handle(start: LinuxProcessStart, stdout: Readable, stderr: Readable, wait: RepositorySupervisedProcess["wait"] extends () => infer T ? T : never, recovered: boolean): RepositorySupervisedProcess {
    const handle: RepositorySupervisedProcess = { supervisorId: start.supervisorId, action: start.action as RepositorySupervisedProcess["action"], operationId: start.operationId, targetSnapshotId: start.targetSnapshotId, ...(start.sessionId ? { sessionId: start.sessionId } : {}), ...(start.authorityId ? { authorityId: start.authorityId } : {}), pid: start.pid, startedAt: start.startedAt, stdout, stderr, recovered, wait: () => wait, isAlive: () => exactAlive(start), terminateTree: async (graceful, force) => { if (!await exactAlive(start)) return; killGroup(start.pid, "SIGTERM"); if (await waitUntilDead(start, graceful)) return; if (await exactAlive(start)) killGroup(start.pid, "SIGKILL"); if (!await waitUntilDead(start, force)) throw new Error("The exact Linux process group did not terminate."); } };
    const remaining = Math.max(0, Date.parse(start.deadlineAt) - Date.now());
    const timer = setTimeout(() => { void handle.terminateTree(1_000, 1_000).catch(() => undefined); }, remaining);
    timer.unref(); void wait.finally(() => clearTimeout(timer));
    return handle;
  }
}

async function states(store: ProtectedJsonStore): Promise<readonly { reservation: LinuxProcessReservation; start?: LinuxProcessStart; terminal?: LinuxProcessTerminal }[]> { const result = new Map<string, { reservation: LinuxProcessReservation; start?: LinuxProcessStart; terminal?: LinuxProcessTerminal }>(); for (const entry of await store.readEntries<JsonValue>()) { if (entry.kind === reservationKind) { const reservation = parseReservation(entry.payload); if (result.has(reservation.supervisorId)) throw new Error("Duplicate Linux process reservation record."); result.set(reservation.supervisorId, { reservation }); } else if (entry.kind === startKind) { const start = parseStart(entry.payload); const state = result.get(start.supervisorId); if (!state || state.start || state.terminal || !sameReservation(state.reservation, start)) throw new Error("Inconsistent Linux process start record."); state.start = start; } else if (entry.kind === terminalKind) { const terminal = parseTerminal(entry.payload); const state = result.get(terminal.supervisorId); if (!state || !state.start || state.terminal) throw new Error("Inconsistent Linux process terminal record."); state.terminal = terminal; } } return [...result.values()]; }
function parseReservation(value: JsonValue): LinuxProcessReservation { if (!record(value) || typeof value.supervisorId !== "string" || !/^managed:[a-f0-9]{64}$/.test(value.supervisorId) || typeof value.operationId !== "string" || typeof value.action !== "string" || typeof value.targetSnapshotId !== "string" || typeof value.repositoryRoot !== "string" || typeof value.manifestSha256 !== "string" || typeof value.executable !== "string" || typeof value.executableSha256 !== "string" || typeof value.deadlineAt !== "string" || !Number.isFinite(Date.parse(value.deadlineAt))) throw new Error("The protected Linux process reservation record is invalid."); return value as LinuxProcessReservation; }
function parseStart(value: JsonValue): LinuxProcessStart { if (!record(value) || typeof value.supervisorId !== "string" || !/^managed:[a-f0-9]{64}$/.test(value.supervisorId) || typeof value.pid !== "number" || typeof value.procStartTicks !== "string" || typeof value.operationId !== "string" || typeof value.action !== "string" || typeof value.repositoryRoot !== "string" || typeof value.manifestSha256 !== "string" || typeof value.deadlineAt !== "string" || !Number.isFinite(Date.parse(value.deadlineAt))) throw new Error("The protected Linux process start record is invalid."); return value as LinuxProcessStart; }
function parseTerminal(value: JsonValue): LinuxProcessTerminal { if (!record(value) || typeof value.supervisorId !== "string" || typeof value.code !== "number" || value.signal !== null && typeof value.signal !== "string" || typeof value.completedAt !== "string") throw new Error("The protected Linux process terminal record is invalid."); return value as LinuxProcessTerminal; }
function validateRequest(request: RepositoryProcessStartRequest): void { if (!/^[a-f0-9]{64}$/i.test(request.manifestSha256) || !/^[a-f0-9]{64}$/i.test(request.executableSha256) || !request.operationId || !request.targetSnapshotId || request.args.length > 128 || request.timeoutMs < 1 || request.maxOutputBytes < 1 || Object.entries(request.environment).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\0]/.test(value))) throw new Error("The Linux supervised process request is invalid."); }
async function procStartTicks(pid: number): Promise<string> { const fields = (await readFile(`/proc/${pid}/stat`, "utf8")).trim().replace(/^\d+ \([^)]*\) /, "").split(" "); const value = fields[19]; if (!value || !/^[0-9]+$/.test(value)) throw new Error("Linux process identity is unavailable."); return value; }
async function waitForStartTicks(pid: number): Promise<string> { for (let i = 0; i < 40; i += 1) { try { return await procStartTicks(pid); } catch { await delay(25); } } throw new Error("The Linux process did not establish an exact start identity."); }
async function exactAlive(start: LinuxProcessStart): Promise<boolean> { try { return await procStartTicks(start.pid) === start.procStartTicks && await realpath(`/proc/${start.pid}/exe`) === start.executable; } catch { return false; } }
async function waitForExit(start: LinuxProcessStart): Promise<void> { while (await exactAlive(start)) await delay(250); }
async function waitUntilDead(start: LinuxProcessStart, timeout: number): Promise<boolean> { const end = Date.now() + timeout; while (Date.now() < end) { if (!await exactAlive(start)) return true; await delay(25); } return !await exactAlive(start); }
function killGroup(pid: number, signal: NodeJS.Signals): void { try { process.kill(-pid, signal); } catch (error) { if (!missingProcess(error)) throw error; } }
function active(request: RepositoryProcessObservationRequest, summary: string): Extract<OperationControllerObservation, { state: "active" }> { return { state: "active", operationId: request.operationId, action: request.action, targetSnapshotId: request.targetSnapshotId, repositoryRoot: request.repositoryRoot, ...(request.sessionId ? { sessionId: request.sessionId } : {}), ...(request.authorityId ? { authorityId: request.authorityId } : {}), effectDisposition: "ambiguous", summary }; }
function insideOrSame(root: string, candidate: string): boolean { const rel = relative(root, candidate); return rel === "" || rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel); }
function record(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sameReservation(reservation: LinuxProcessReservation, start: LinuxProcessStart): boolean { return ["supervisorId", "action", "operationId", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "manifestSha256", "executable", "executableSha256", "deadlineAt"].every((key) => reservation[key] === start[key]); }
function missingProcess(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ESRCH"; }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function verifiedExecutable(store: ProtectedJsonStore, requested: string, expectedSha256: string): Promise<string> {
  const source = await realpath(requested);
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  let metadata;
  try {
    metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > 512 * 1024 * 1024) throw new Error("The Linux supervised executable is not a bounded regular file.");
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  try {
    if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error("The Linux supervised executable digest changed before launch.");
    if (metadata.uid === 0 && (metadata.mode & 0o022) === 0) return source;
    const root = join(dirname(store.filePath), "verified-executables");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const canonicalRoot = await realpath(root); const rootMetadata = await lstat(canonicalRoot); const uid = process.getuid?.();
    if (uid === undefined || rootMetadata.uid !== uid || !rootMetadata.isDirectory() || (rootMetadata.mode & 0o077) !== 0) throw new Error("The verified-executable cache is not a private current-user directory.");
    const destination = join(canonicalRoot, expectedSha256);
    try { const existing = await readFile(destination); try { if (createHash("sha256").update(existing).digest("hex") !== expectedSha256) throw new Error("The verified-executable cache is inconsistent."); } finally { existing.fill(0); } }
    catch (error) {
      if (!missingFile(error)) throw error;
      const temporary = join(canonicalRoot, `.${expectedSha256}-${randomUUID()}.tmp`);
      const output = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o500);
      try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
      await rename(temporary, destination); await chmod(destination, 0o500);
    }
    const cached = await realpath(destination); const cachedMetadata = await stat(cached);
    if (!insideOrSame(canonicalRoot, cached) || !cachedMetadata.isFile() || cachedMetadata.uid !== uid || (cachedMetadata.mode & 0o277) !== 0) throw new Error("The verified executable is unsafe.");
    return cached;
  } finally { bytes.fill(0); }
}
function missingFile(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"; }
