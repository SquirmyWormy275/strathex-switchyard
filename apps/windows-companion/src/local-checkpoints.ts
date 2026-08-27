import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { CheckpointArtifact, RecoveryArtifactVerifier } from "../../../packages/control-plane/src/checkpoints.ts";
import type { CheckpointCaptureAdapter, CheckpointCaptureRequest, CheckpointCaptureResult } from "../../../packages/control-plane/src/runtime.ts";

const maximumPatchBytes = 64 * 1024 * 1024;
const maximumPlannedFileBytes = 64 * 1024 * 1024;
const maximumCheckpointBytes = 128 * 1024 * 1024;
const maximumGitErrorBytes = 8 * 1024;

export interface CheckpointGitResult {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

export interface CheckpointGitRunner {
  run(args: readonly string[], workingDirectory: string, maximumOutputBytes?: number): Promise<CheckpointGitResult>;
}

/** Fixed-executable, shell-free, bounded Git reader used only for checkpoint evidence. */
export class SpawnCheckpointGitRunner implements CheckpointGitRunner {
  private readonly candidates: readonly string[];
  private readonly timeoutMs: number;

  constructor(options: Readonly<{ candidates?: readonly string[]; timeoutMs?: number }> = {}) {
    this.candidates = options.candidates ?? [
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files\\Git\\bin\\git.exe",
      "C:\\Program Files (x86)\\Git\\cmd\\git.exe"
    ];
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!this.candidates.length || this.candidates.some((candidate) => !isAbsolute(candidate) || !candidate.toLowerCase().endsWith("git.exe"))) throw new Error("Checkpoint capture requires fixed absolute Git executables.");
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 10 * 60_000) throw new Error("Checkpoint Git timeout is outside safe bounds.");
  }

  async run(args: readonly string[], workingDirectory: string, maximumOutputBytes = maximumPatchBytes): Promise<CheckpointGitResult> {
    if (!args.length || args.some((arg) => typeof arg !== "string" || /[\r\n\0]/.test(arg))) throw new Error("Checkpoint Git arguments are invalid.");
    if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1 || maximumOutputBytes > maximumCheckpointBytes) throw new Error("Checkpoint Git output limit is invalid.");
    const executable = await this.executable();
    return new Promise<CheckpointGitResult>((resolveResult, rejectResult) => {
      const child = spawn(executable, [...args], {
        cwd: workingDirectory,
        shell: false,
        windowsHide: true,
        env: {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          WINDIR: process.env.WINDIR ?? "C:\\Windows",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "NUL",
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never",
          GIT_OPTIONAL_LOCKS: "0",
          LC_ALL: "C"
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let stderr = "";
      let exceeded = false;
      let settled = false;
      const finish = (error?: Error, result?: CheckpointGitResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectResult(error); else resolveResult(result ?? { exitCode: 1, stdout: Buffer.alloc(0), stderr: "Checkpoint Git failed." });
      };
      child.stdout.on("data", (chunk: Buffer) => {
        if (exceeded) return;
        bytes += chunk.byteLength;
        if (bytes > maximumOutputBytes) {
          exceeded = true;
          child.kill();
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < maximumGitErrorBytes) stderr += chunk.toString("utf8").slice(0, maximumGitErrorBytes - stderr.length);
      });
      child.once("error", () => finish(new Error("The fixed checkpoint Git process could not start.")));
      child.once("close", (code) => finish(undefined, {
        exitCode: exceeded ? 1 : code ?? 1,
        stdout: exceeded ? Buffer.alloc(0) : Buffer.concat(chunks),
        stderr: exceeded ? "Checkpoint Git output exceeded its fixed bound." : stderr
      }));
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("Checkpoint Git timed out."));
      }, this.timeoutMs);
      timer.unref?.();
    });
  }

  private async executable(): Promise<string> {
    for (const candidate of this.candidates) {
      try { if ((await stat(candidate)).isFile()) return realpath(candidate); } catch { /* try the next fixed host path */ }
    }
    throw new Error("A trusted absolute Git executable is unavailable for checkpoint capture.");
  }
}

export interface LocalCheckpointCaptureOptions {
  readonly stateDirectory: string;
  readonly git?: CheckpointGitRunner;
}

/**
 * Captures manual-only recovery evidence beneath host state. It never stashes,
 * restores, deletes, or overwrites repository work. The final runtime target
 * revalidation remains mandatory after capture and before any broker effect.
 */
export class LocalCheckpointCapture implements CheckpointCaptureAdapter {
  private readonly stateDirectory: string;
  private readonly git: CheckpointGitRunner;

  constructor(options: LocalCheckpointCaptureOptions) {
    if (!isAbsolute(options.stateDirectory) || /[\r\n\0]/.test(options.stateDirectory)) throw new Error("Checkpoint state requires a fixed absolute host path.");
    this.stateDirectory = resolve(options.stateDirectory, "checkpoints");
    this.git = options.git ?? new SpawnCheckpointGitRunner();
  }

  async capture(input: CheckpointCaptureRequest): Promise<CheckpointCaptureResult | undefined> {
    if (input.target.completeness !== "complete" || !/^[a-f0-9]{40}$/i.test(input.target.head ?? "")) return undefined;
    const repositoryRoot = await canonicalDirectory(input.target.repositoryRoot, "checkpoint repository");
    if (!samePath(repositoryRoot, input.target.repositoryRoot)) throw new Error("Checkpoint target does not match the canonical repository root.");
    const checkpointRoot = await ensureCanonicalDirectory(this.stateDirectory);
    const operationKey = sha256(Buffer.from(input.operationId, "utf8")).slice(0, 24);
    const folder = await mkdtemp(join(checkpointRoot, `${operationKey}-`));
    let completed = false;
    try {
      await this.assertHead(repositoryRoot, input.target.head!);
      const artifacts: CheckpointArtifact[] = [];
      let totalBytes = 0;

      const patch = await this.git.run(["diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", "HEAD", "--"], repositoryRoot, maximumPatchBytes);
      if (patch.exitCode !== 0) throw new Error("The tracked-work recovery patch could not be captured through fixed Git.");
      const patchPath = join(folder, "tracked-work.patch");
      await writeExclusive(patchPath, patch.stdout);
      totalBytes += patch.stdout.byteLength;
      artifacts.push(checkpointArtifact(`${operationKey}:tracked-patch`, "patch", patchPath, patch.stdout));

      const plannedRecords: Array<Readonly<{ path: string; state: "captured" | "absent"; artifactId?: string; sha256?: string; bytes?: number }>> = [];
      const planned = input.session?.plannedFiles ?? [];
      if (planned.length > 512 || new Set(planned).size !== planned.length) throw new Error("Checkpoint planned-file ownership is invalid or duplicated.");
      for (let index = 0; index < planned.length; index += 1) {
        const ownedPath = planned[index]!;
        const relativePath = safeRelativePath(ownedPath);
        const source = resolve(repositoryRoot, relativePath);
        if (!inside(repositoryRoot, source)) throw new Error("A planned checkpoint path escapes the repository.");
        const metadata = await lstat(source).catch((error: unknown) => isMissing(error) ? undefined : Promise.reject(error));
        if (!metadata) { plannedRecords.push({ path: relativePath, state: "absent" }); continue; }
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("A planned checkpoint path is not a regular non-symlink file.");
        const canonicalSource = await realpath(source);
        if (!inside(repositoryRoot, canonicalSource) || !samePath(canonicalSource, source)) throw new Error("A planned checkpoint path traverses a reparse point or leaves the repository.");
        if (metadata.size > maximumPlannedFileBytes || totalBytes + metadata.size > maximumCheckpointBytes) throw new Error("Checkpoint artifacts exceed the fixed local size budget.");
        const contents = await readFile(canonicalSource);
        const after = await lstat(canonicalSource);
        if (!after.isFile() || after.isSymbolicLink() || after.size !== contents.byteLength) throw new Error("A planned checkpoint file changed while it was captured.");
        const artifactId = `${operationKey}:planned:${index + 1}`;
        const destination = join(folder, `planned-${String(index + 1).padStart(4, "0")}-${sha256(Buffer.from(relativePath)).slice(0, 16)}.bin`);
        await writeExclusive(destination, contents);
        totalBytes += contents.byteLength;
        const artifact = checkpointArtifact(artifactId, "archive", destination, contents);
        artifacts.push(artifact);
        plannedRecords.push({ path: relativePath, state: "captured", artifactId, sha256: artifact.sha256, bytes: artifact.bytes });
      }

      const manifestDocument = {
        schema: "sxsy-b122.local-checkpoint",
        version: 1,
        operationId: input.operationId,
        workflow: input.workflow,
        action: input.definition.action,
        target: {
          id: input.target.id,
          repositoryRoot,
          branch: input.target.branch ?? null,
          head: input.target.head,
          indexTree: input.target.indexTree ?? null,
          trackedManifest: input.target.trackedManifest,
          untrackedManifest: input.target.untrackedManifest,
          environmentFingerprint: input.target.environmentFingerprint
        },
        plannedFiles: plannedRecords,
        manualOnly: true,
        prohibitedActions: ["automatic_restore", "delete", "stash", "overwrite"]
      };
      const manifest = Buffer.from(`${JSON.stringify(manifestDocument, null, 2)}\n`, "utf8");
      if (totalBytes + manifest.byteLength > maximumCheckpointBytes) throw new Error("Checkpoint artifacts exceed the fixed local size budget.");
      const manifestPath = join(folder, "workspace-manifest.json");
      await writeExclusive(manifestPath, manifest);
      artifacts.push(checkpointArtifact(`${operationKey}:workspace-manifest`, "workspace_manifest", manifestPath, manifest));

      await this.assertHead(repositoryRoot, input.target.head!);
      completed = true;
      return {
        reason: `Captured manual recovery artifacts before ${input.definition.title}.`,
        artifacts,
        recovery: {
          steps: [
            "Stop automated work and inspect the checkpoint manifest and patch manually.",
            "Compare every artifact digest with the protected checkpoint receipt before using it.",
            "Restore or copy any artifact only through an explicit operator-reviewed recovery procedure."
          ],
          artifactIds: artifacts.map((artifact) => artifact.id)
        }
      };
    } finally {
      if (!completed) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async assertHead(repositoryRoot: string, expected: string): Promise<void> {
    const result = await this.git.run(["rev-parse", "--verify", "HEAD"], repositoryRoot, 256);
    const actual = Buffer.from(result.stdout).toString("ascii").trim();
    if (result.exitCode !== 0 || actual !== expected) throw new Error("The checkpoint target HEAD changed or could not be verified.");
  }
}

/** Read-only verifier for artifacts created beneath the fixed host checkpoint root. */
export class LocalRecoveryArtifactVerifier implements RecoveryArtifactVerifier {
  private readonly root: string;
  constructor(stateDirectory: string) {
    if (!isAbsolute(stateDirectory) || /[\r\n\0]/.test(stateDirectory)) throw new Error("Checkpoint verification requires a fixed absolute host path.");
    this.root = resolve(stateDirectory, "checkpoints");
  }

  async verify(artifact: CheckpointArtifact): Promise<Readonly<{ available: boolean; sha256?: string; detail?: string }>> {
    try {
      if (!isAbsolute(artifact.reference) || /[\r\n\0]/.test(artifact.reference)) return { available: false, detail: "Recovery artifact reference is not a fixed host-owned path." };
      const root = await realpath(this.root);
      const sourceMetadata = await lstat(artifact.reference);
      if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink() || sourceMetadata.size > maximumCheckpointBytes) return { available: false, detail: "Recovery artifact is not a bounded regular host-owned file." };
      const source = await realpath(artifact.reference);
      if (!inside(root, source)) return { available: false, detail: "Recovery artifact is outside the host-owned checkpoint root." };
      const digest = await streamSha256(source, maximumCheckpointBytes);
      return { available: true, sha256: digest, detail: digest === artifact.sha256 ? "Recovery artifact digest verified." : "Recovery artifact digest does not match the protected checkpoint." };
    } catch {
      return { available: false, detail: "Recovery artifact is missing or unavailable beneath host-owned checkpoint state." };
    }
  }
}

function checkpointArtifact(id: string, kind: CheckpointArtifact["kind"], reference: string, contents: Uint8Array): CheckpointArtifact {
  return { id, kind, reference, sha256: sha256(contents), bytes: contents.byteLength };
}
async function writeExclusive(path: string, contents: Uint8Array): Promise<void> { await writeFile(path, contents, { flag: "wx", mode: 0o600 }); }
async function ensureCanonicalDirectory(path: string): Promise<string> { await mkdir(path, { recursive: true, mode: 0o700 }); return canonicalDirectory(path, "checkpoint state"); }
async function canonicalDirectory(path: string, label: string): Promise<string> { const value = await realpath(resolve(path)); if (!(await stat(value)).isDirectory()) throw new Error(`${label} is not a canonical directory.`); return value; }
function safeRelativePath(value: string): string {
  if (typeof value !== "string" || !value || value.length > 4_096 || /[\r\n\0]/.test(value) || isAbsolute(value)) throw new Error("A planned checkpoint path is invalid.");
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error("A planned checkpoint path escapes the repository.");
  return segments.join(sep);
}
function inside(root: string, candidate: string): boolean { const relation = relative(resolve(root), resolve(candidate)); return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation); }
function samePath(left: string, right: string): boolean { return resolve(left).replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase() === resolve(right).replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase(); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function isMissing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT"; }
async function streamSha256(path: string, maximumBytes: number): Promise<string> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new Error("Recovery artifact exceeds its fixed verification bound.");
    hash.update(buffer);
  }
  return hash.digest("hex");
}
