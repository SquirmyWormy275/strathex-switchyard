/** Descriptor-bound ownership for Git's conventional index lock and original index. */
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { NodeFileDigestReader } from "../../../packages/control-plane/src/git-inspector.ts";
export interface GitFileIdentity { readonly device: string; readonly inode: string; readonly birthtimeNs: string; }
export interface GitFileStamp { readonly size: string; readonly mtimeNs: string; readonly ctimeNs: string; }
export interface GitIndexPreservation {
  readonly indexPath: string;
  readonly lockPath: string;
  readonly indexIdentity: GitFileIdentity;
  readonly lockIdentity: GitFileIdentity;
  readonly originalIndexSha256: string;
  readonly lockStamp: GitFileStamp;
}
export function gitFileIdentity(s: BigIntStats): GitFileIdentity { return { device: s.dev.toString(), inode: s.ino.toString(), birthtimeNs: s.birthtimeNs.toString() }; }
export function gitFileStamp(s: BigIntStats): GitFileStamp { return { size: s.size.toString(), mtimeNs: s.mtimeNs.toString(), ctimeNs: s.ctimeNs.toString() }; }
function sameIdentity(s: BigIntStats, expected: GitFileIdentity): boolean { return s.dev.toString() === expected.device && s.ino.toString() === expected.inode && s.birthtimeNs.toString() === expected.birthtimeNs; }
export async function assertOwnedGitFile(path: string, handle: FileHandle, expected: GitFileIdentity): Promise<BigIntStats> {
  const held = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
  if (!held.isFile() || !named.isFile() || named.isSymbolicLink() || !sameIdentity(held, expected) || !sameIdentity(named, expected)) throw Object.assign(new Error("The exact owned Git file was replaced. Preserve the different file and reconcile this transaction."), { code: "GIT_INDEX_OWNERSHIP_CHANGED" });
  return held;
}
async function readIndex(path: string, handle: FileHandle, expected: GitFileIdentity, before: BigIntStats): Promise<Buffer> {
  const initial = await assertOwnedGitFile(path, handle, expected);
  if (initial.size > 32n * 1024n * 1024n || initial.size !== before.size || initial.mtimeNs !== before.mtimeNs || initial.ctimeNs !== before.ctimeNs) throw new Error("The original Git index changed or exceeds its recovery bound.");
  const bytes = Buffer.alloc(Number(initial.size)); let position = 0;
  try {
    while (position < bytes.length) { const r = await handle.read(bytes, position, Math.min(65536, bytes.length - position), position); if (!r.bytesRead) break; position += r.bytesRead; }
    const after = await assertOwnedGitFile(path, handle, expected);
    if (position !== bytes.length || after.size !== initial.size || after.mtimeNs !== initial.mtimeNs || after.ctimeNs !== initial.ctimeNs) throw new Error("The original Git index changed during read.");
    return bytes;
  } catch (error) { bytes.fill(0); throw error; }
}
/** Exact native identity, stamp and bounded bytes from one descriptor, for host recovery. */
export async function captureGitFile(path: string, maxBytes = 32 * 1024 * 1024): Promise<Readonly<{ identity: GitFileIdentity; stamp: GitFileStamp; sha256: string; bytes: Buffer }>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024) throw new Error("Choose a bounded Git recovery file size.");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const expected = gitFileIdentity(await handle.stat({ bigint: true })), stamp = await assertOwnedGitFile(path, handle, expected);
    if (stamp.size > BigInt(maxBytes)) throw new Error("The Git recovery file exceeds its bound.");
    const bytes = await readIndex(path, handle, expected, stamp);
    return { identity: expected, stamp: gitFileStamp(stamp), sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
  } finally { await handle.close(); }
}
export interface OwnedGitFileLock {
  readonly filePath: string;
  readonly identity: GitFileIdentity;
  readonly contentSha256: string;
  release(): Promise<void>;
  abandon(): Promise<void>;
}
export async function createOwnedGitFileLock(filePath: string, content: string): Promise<OwnedGitFileLock> {
  if (Buffer.byteLength(content) > 4096) throw new Error("Owned Git lock metadata exceeds its bound.");
  const handle = await open(filePath, "wx+", 0o600); let identity: GitFileIdentity | undefined;
  try {
    identity = gitFileIdentity(await handle.stat({ bigint: true })); await handle.writeFile(content); await handle.sync();
    const stamp = await assertOwnedGitFile(filePath, handle, identity), owned = identity;
    const contentSha256 = createHash("sha256").update(content).digest("hex"); let closed = false;
    const abandon = async () => { if (!closed) { closed = true; await handle.close(); } };
    return { filePath, identity: owned, contentSha256, abandon, release: async () => {
      if (closed) return;
      try { const current = await assertOwnedGitFile(filePath, handle, owned); if (current.size !== stamp.size || current.mtimeNs !== stamp.mtimeNs || current.ctimeNs !== stamp.ctimeNs) throw new Error("The owned Git lock metadata changed; preserve it for recovery."); await unlink(filePath); }
      finally { await abandon(); }
    } };
  } catch (error) { try { if (identity) { await assertOwnedGitFile(filePath, handle, identity); await unlink(filePath); } } catch { /* Preserve a replacement. */ } await handle.close(); throw error; }
}
/** Reopen only a protected, byte-identical former lease; never adopt a busy foreign lock. */
export async function reopenOwnedGitFileLock(preserved: Readonly<{ filePath: string; identity: GitFileIdentity; contentSha256: string }>): Promise<OwnedGitFileLock> {
  const handle = await open(preserved.filePath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stamp = await assertOwnedGitFile(preserved.filePath, handle, preserved.identity);
    if (stamp.size > 4096n) throw new Error("The preserved private Git lease exceeds its bound.");
    const bytes = await readIndex(preserved.filePath, handle, preserved.identity, stamp);
    try { if (createHash("sha256").update(bytes).digest("hex") !== preserved.contentSha256) throw new Error("The preserved private Git lease bytes changed. Preserve the different file."); } finally { bytes.fill(0); }
    let closed = false;
    const abandon = async () => { if (!closed) { closed = true; await handle.close(); } };
    return { ...preserved, abandon, release: async () => {
      if (closed) return;
      try { const current = await assertOwnedGitFile(preserved.filePath, handle, preserved.identity); if (current.size !== stamp.size || current.mtimeNs !== stamp.mtimeNs || current.ctimeNs !== stamp.ctimeNs) throw new Error("The preserved Git lease changed during reconciliation."); await unlink(preserved.filePath); }
      finally { await abandon(); }
    } };
  } catch (error) { await handle.close(); throw error; }
}
export class OwnedGitIndexLease {
  readonly indexPath: string;
  readonly lockPath: string;
  readonly indexIdentity: GitFileIdentity;
  readonly lockIdentity: GitFileIdentity;
  private readonly index: FileHandle;
  private readonly lock: FileHandle;
  private readonly original: BigIntStats;
  private readonly initialLock: BigIntStats;
  private originalDigest?: string;
  private indexClosed = false;
  private closed = false;
  private constructor(indexPath: string, index: FileHandle, lock: FileHandle, original: BigIntStats, lockStat: BigIntStats) {
    this.indexPath = indexPath; this.lockPath = `${indexPath}.lock`; this.index = index; this.lock = lock; this.original = original; this.initialLock = lockStat;
    this.indexIdentity = gitFileIdentity(original); this.lockIdentity = gitFileIdentity(lockStat);
  }
  static async acquire(indexPath: string, { now = Date.now, timeoutMs = 2000 } = {}): Promise<OwnedGitIndexLease> {
    const lockPath = `${indexPath}.lock`, deadline = now() + timeoutMs;
    while (true) {
      let lock: FileHandle;
      try { lock = await open(lockPath, "wx+", 0o600); }
      catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") || now() >= deadline) throw new Error("The shared Git index is busy; no mediated commit was started."); await new Promise(r => setTimeout(r, 20)); continue; }
      let index: FileHandle | undefined, lockStat: BigIntStats | undefined;
      try {
        lockStat = await lock.stat({ bigint: true });
        const named = await lstat(indexPath, { bigint: true }); if (!named.isFile() || named.isSymbolicLink()) throw new Error("The original Git index is not a regular file.");
        index = await open(indexPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        const original = await assertOwnedGitFile(indexPath, index, gitFileIdentity(named));
        await assertOwnedGitFile(lockPath, lock, gitFileIdentity(lockStat));
        return new OwnedGitIndexLease(indexPath, index, lock, original, lockStat);
      } catch (error) {
        try { if (lockStat) { await assertOwnedGitFile(lockPath, lock, gitFileIdentity(lockStat)); await unlink(lockPath); } } catch { /* Never delete a replacement lock. */ }
        await Promise.allSettled([index?.close(), lock.close()]); throw error;
      }
    }
  }
  /** The host must prove former native owners stopped and hold its resource lease first. */
  static async reopenPreserved(preserved: GitIndexPreservation): Promise<OwnedGitIndexLease> {
    if (preserved.lockPath !== `${preserved.indexPath}.lock` || !preserved.lockStamp) throw new Error("The exact preserved Git index-lock proof is unavailable.");
    const lock = await open(preserved.lockPath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); let index: FileHandle | undefined;
    try {
      const lockStat = await assertOwnedGitFile(preserved.lockPath, lock, preserved.lockIdentity), stamp = preserved.lockStamp;
      if (lockStat.size.toString() !== stamp.size || lockStat.mtimeNs.toString() !== stamp.mtimeNs || lockStat.ctimeNs.toString() !== stamp.ctimeNs) throw new Error("The preserved shared Git lock changed. Preserve it for operator recovery.");
      index = await open(preserved.indexPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const original = await assertOwnedGitFile(preserved.indexPath, index, preserved.indexIdentity), bytes = await readIndex(preserved.indexPath, index, preserved.indexIdentity, original);
      try { if (createHash("sha256").update(bytes).digest("hex") !== preserved.originalIndexSha256) throw new Error("The preserved original Git index content changed. No replacement is permitted."); } finally { bytes.fill(0); }
      const lease = new OwnedGitIndexLease(preserved.indexPath, index, lock, original, lockStat); lease.originalDigest = preserved.originalIndexSha256;
      return lease;
    } catch (error) { await Promise.allSettled([index?.close(), lock.close()]); throw error; }
  }
  async copyOriginalTo(destination: string): Promise<void> {
    if (this.closed) throw new Error("This owned Git index lease is closed.");
    const bytes = await readIndex(this.indexPath, this.index, this.indexIdentity, this.original);
    this.originalDigest = createHash("sha256").update(bytes).digest("hex");
    let output: FileHandle | undefined, identity: GitFileIdentity | undefined;
    try {
      output = await open(destination, "wx", 0o600); identity = gitFileIdentity(await output.stat({ bigint: true }));
      await output.writeFile(bytes); await output.sync(); await assertOwnedGitFile(destination, output, identity);
    } catch (error) { if (output && identity) { try { await assertOwnedGitFile(destination, output, identity); await unlink(destination); } catch { /* Preserve a different file. */ } } throw error; }
    finally { bytes.fill(0); await output?.close(); }
  }
  preservation(): GitIndexPreservation {
    if (!this.originalDigest) throw new Error("Copy and verify the original index before recording preservation.");
    return { indexPath: this.indexPath, lockPath: this.lockPath, indexIdentity: this.indexIdentity, lockIdentity: this.lockIdentity, originalIndexSha256: this.originalDigest, lockStamp: gitFileStamp(this.initialLock) };
  }
  async replaceWith(privateIndex: string, { closeOriginalBeforeRename = process.platform === "win32" } = {}): Promise<void> {
    if (this.closed) throw new Error("This owned Git index lease is closed.");
    const root = dirname(privateIndex), captured = await new NodeFileDigestReader().read(root, relative(root, privateIndex));
    try {
      const lockBefore = await assertOwnedGitFile(this.lockPath, this.lock, this.lockIdentity);
      if (lockBefore.size !== this.initialLock.size || lockBefore.mtimeNs !== this.initialLock.mtimeNs || lockBefore.ctimeNs !== this.initialLock.ctimeNs) throw new Error("The owned shared-index lock changed before replacement; preserve it for recovery.");
      const original = await readIndex(this.indexPath, this.index, this.indexIdentity, this.original); original.fill(0);
      await this.lock.truncate(0); let position = 0;
      while (position < captured.bytes.length) { const r = await this.lock.write(captured.bytes, position, captured.bytes.length - position, position); if (!r.bytesWritten) throw new Error("The owned Git index write did not complete."); position += r.bytesWritten; }
      await this.lock.chmod(Number(this.original.mode & 0o777n)); await this.lock.sync();
      const writtenStamp = await assertOwnedGitFile(this.lockPath, this.lock, this.lockIdentity);
      const verified = await readIndex(this.lockPath, this.lock, this.lockIdentity, writtenStamp);
      try { if (!verified.equals(captured.bytes)) throw new Error("The exact owned Git index bytes did not verify before replacement."); } finally { verified.fill(0); }
      const assertOriginal = (current: BigIntStats) => {
        if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, this.indexIdentity) || current.size !== this.original.size || current.mtimeNs !== this.original.mtimeNs || current.ctimeNs !== this.original.ctimeNs) throw new Error("The exact original Git index changed before atomic replacement. Preserve the different index.");
      };
      assertOriginal(await assertOwnedGitFile(this.indexPath, this.index, this.indexIdentity));
      // MoveFileEx replacement on Windows can reject an open destination.
      // Keep the verified source descriptor and conventional Git lock; release
      // only our destination handle, then recheck its named native identity.
      if (closeOriginalBeforeRename) { await this.index.close(); this.indexClosed = true; }
      for (let attempt = 0; ; attempt++) {
        assertOriginal(await lstat(this.indexPath, { bigint: true }));
        const currentLock = await assertOwnedGitFile(this.lockPath, this.lock, this.lockIdentity);
        if (currentLock.size !== writtenStamp.size || currentLock.mtimeNs !== writtenStamp.mtimeNs || currentLock.ctimeNs !== writtenStamp.ctimeNs) throw new Error("The verified replacement Git index changed before rename.");
        try { await rename(this.lockPath, this.indexPath); break; }
        catch (error) { if (!closeOriginalBeforeRename || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "") || attempt >= 5) throw error; await new Promise(r => setTimeout(r, 10 * 2 ** attempt)); }
      }
      await assertOwnedGitFile(this.indexPath, this.lock, this.lockIdentity); await this.abandon();
    } finally { captured.bytes.fill(0); }
  }
  async release(): Promise<void> {
    if (this.closed) return;
    try { const current = await assertOwnedGitFile(this.lockPath, this.lock, this.lockIdentity); if (current.size !== this.initialLock.size || current.mtimeNs !== this.initialLock.mtimeNs || current.ctimeNs !== this.initialLock.ctimeNs) throw new Error("The owned shared-index lock changed; preserve it for recovery."); await unlink(this.lockPath); }
    finally { await this.abandon(); }
  }
  async abandon(): Promise<void> { if (this.closed) return; this.closed = true; await Promise.allSettled([this.indexClosed ? undefined : this.index.close(), this.lock.close()]); }
}
