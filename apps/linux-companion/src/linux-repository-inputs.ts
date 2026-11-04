/** Stage only reviewed bytes, using retained directory/file descriptors. */
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { repositoryInputLimits, validateRepositoryInputs } from "../../windows-companion/src/repository-inputs.ts";
import type { RepositoryExecutionRootLease, RepositoryExecutionRootProvider } from "../../windows-companion/src/repository-runtime.ts";

const stamp = (s: { dev: number | bigint; ino: number | bigint }) => `${s.dev}:${s.ino}`;
export class LinuxDisposableExecutionRootProvider implements RepositoryExecutionRootProvider {
  private readonly root: string;
  private readonly now: () => number;
  constructor(stateDirectory: string, { now = Date.now }: { now?: () => number } = {}) { this.root = resolve(stateDirectory, "repository-execution-roots"); this.now = now; }
  async prepare(input: Parameters<RepositoryExecutionRootProvider["prepare"]>[0]): Promise<RepositoryExecutionRootLease> {
    const repositoryRoot = await realpath(input.repositoryRoot);
    if (input.isolation === "repository") return { root: repositoryRoot, isolation: "repository", release: async () => undefined };
    const inputs = validateRepositoryInputs(input.inputFiles);
    const deadline = this.now() + 30_000;
    const withinDeadline = () => { if (this.now() > deadline) throw new Error("Reviewed execution input staging exceeded its 30-second deadline."); };
    if (process.platform !== "linux") throw new Error("Descriptor-bound disposable input staging requires Linux.");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const parent = await lstat(this.root);
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0 || await realpath(this.root) !== this.root) throw new Error("The disposable input directory is not an exact private current-user directory.");
    const source = await open(repositoryRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW), sourceIdentity = stamp(await source.stat());
    let staging: string | undefined, stagingIdentity: string | undefined;
    async function sourceCurrent() { const s = await lstat(repositoryRoot); if (!s.isDirectory() || s.isSymbolicLink() || stamp(s) !== sourceIdentity) throw new Error("The reviewed repository root changed during input staging."); }
    async function removeOwned() {
      if (!staging) return;
      let s; try { s = await lstat(staging); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      if (!s.isDirectory() || s.isSymbolicLink() || stamp(s) !== stagingIdentity) throw new Error("Disposable staging ownership changed. Preserve the replacement directory for review.");
      await rm(staging, { recursive: true });
    }
    try {
      staging = await mkdtemp(join(this.root, "inputs-")); stagingIdentity = stamp(await lstat(staging));
      let total = 0;
      for (const inputFile of inputs) {
        withinDeadline();
        await sourceCurrent();
        const parts = inputFile.path.split("/"), directories: FileHandle[] = []; let directory = source;
        let file: FileHandle | undefined, bytes: Buffer | undefined;
        try {
          for (const part of parts.slice(0, -1)) { directory = await open(`/proc/self/fd/${directory.fd}/${part}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); directories.push(directory); }
          file = await open(`/proc/self/fd/${directory.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const before = await file.stat({ bigint: true });
          if (!before.isFile() || before.size !== BigInt(inputFile.size) || before.size > BigInt(repositoryInputLimits.fileBytes)) throw new Error("A reviewed execution input is not the exact bounded regular file.");
          // Read a fixed buffer, not a growth-following readFile on a mutable file.
          bytes = Buffer.alloc(inputFile.size); let offset = 0;
          while (offset < bytes.length) { withinDeadline(); const read = await file.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) throw new Error("A reviewed execution input became shorter."); offset += read.bytesRead; }
          const extra = Buffer.alloc(1); if ((await file.read(extra, 0, 1, bytes.length)).bytesRead) throw new Error("A reviewed execution input grew beyond its exact size.");
          const after = await file.stat({ bigint: true });
          withinDeadline();
          if (stamp(before) !== stamp(after) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || createHash("sha256").update(bytes).digest("hex") !== inputFile.sha256) throw new Error("Reviewed execution input bytes changed. Review the new digest before running.");
          total += bytes.length; if (total > repositoryInputLimits.totalBytes) throw new Error("Reviewed execution inputs exceed their total byte bound.");
          const destination = join(staging, inputFile.path); await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          const output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600 | Number(before.mode & 0o100n));
          try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
          await sourceCurrent();
        } finally { bytes?.fill(0); await file?.close(); for (const handle of directories.reverse()) await handle.close(); }
      }
      await sourceCurrent();
      withinDeadline();
      const staged = await lstat(staging); if (!staged.isDirectory() || staged.isSymbolicLink() || stamp(staged) !== stagingIdentity || await realpath(staging) !== staging) throw new Error("Disposable input staging changed before handoff.");
      return { root: staging, isolation: "disposable", protections: { productionData: "denied", ambientCredentials: "denied" }, release: removeOwned };
    } catch (error) { try { await removeOwned(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Reviewed input staging failed; replacement files were preserved."); } throw error; }
    finally { await source.close(); }
  }
}
