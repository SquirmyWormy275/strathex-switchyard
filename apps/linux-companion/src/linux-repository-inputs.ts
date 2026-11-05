/** Stage only reviewed bytes, using retained directory/file descriptors. */
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { repositoryInputLimits, validateRepositoryInputs } from "../../windows-companion/src/repository-inputs.ts";
import type { RepositoryExecutionRootLease, RepositoryExecutionRootProvider } from "../../windows-companion/src/repository-runtime.ts";

const stamp = (s: { dev: number | bigint; ino: number | bigint }) => `${s.dev}:${s.ino}`;
interface PrivateGitInput { readonly bytes: Uint8Array; readonly mode: "100644" | "100755" }
export class LinuxDisposableExecutionRootProvider implements RepositoryExecutionRootProvider {
  private readonly root: string;
  private readonly now: () => number;
  private readonly indexBytes?: ReadonlyMap<string, PrivateGitInput>;
  private readonly historyBytes?: ReadonlyMap<string, PrivateGitInput>;
  constructor(stateDirectory: string, { now = Date.now, indexBytes, historyBytes }: { now?: () => number; indexBytes?: ReadonlyMap<string, PrivateGitInput>; historyBytes?: ReadonlyMap<string, PrivateGitInput> } = {}) { this.root = resolve(stateDirectory, "repository-execution-roots"); this.now = now; this.indexBytes = indexBytes; this.historyBytes=historyBytes; }
  async prepare(input: Parameters<RepositoryExecutionRootProvider["prepare"]>[0]): Promise<RepositoryExecutionRootLease> {
    const repositoryRoot = await realpath(input.repositoryRoot);
    if ((this.indexBytes||this.historyBytes) && input.isolation !== "disposable") throw new Error("Private Git bytes require disposable scanner staging.");
    if (input.isolation === "repository") return { root: repositoryRoot, isolation: "repository", release: async () => undefined };
    const inputs = validateRepositoryInputs(input.inputFiles);
    if (this.indexBytes && (!["shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"].includes(input.action) || !(this.indexBytes instanceof Map) || !this.indexBytes.size || [...this.indexBytes.keys()].some(path => !path.startsWith(".switchyard-index/") || !inputs.some(file => file.path === path)))) throw new Error("Private index bytes require exact reserved inputs for the pinned Shield path; general execution is refused.");
    if (this.indexBytes && inputs.some(file => file.path.startsWith(".switchyard-index/") && !this.indexBytes!.has(file.path))) throw new Error("Every reserved input needs its private verified index bytes; worktree substitution is refused.");
    if(this.historyBytes&&(!["shield_codebase_audit","release_shield"].includes(input.action)||!(this.historyBytes instanceof Map)||!this.historyBytes.size||this.indexBytes||[...this.historyBytes.keys()].some(path=>!path.startsWith(".switchyard-history/")||!inputs.some(file=>file.path===path))))throw new Error("Private history bytes require exact reviewed historical scanner inputs; general execution is refused.");
    if(inputs.some(file=>file.path.startsWith(".switchyard-history/")&&!this.historyBytes?.has(file.path)))throw new Error("Every historical alias needs private verified bytes; worktree substitution is refused.");
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
        const index = this.indexBytes?.get(inputFile.path)??this.historyBytes?.get(inputFile.path);
        if (index) {
          if (!(index.bytes instanceof Uint8Array) || index.bytes.byteLength !== inputFile.size || !["100644", "100755"].includes(index.mode) || createHash("sha256").update(index.bytes).digest("hex") !== inputFile.sha256) throw new Error("The exact private Git bytes changed before staging.");
          total += index.bytes.byteLength; if (total > repositoryInputLimits.totalBytes) throw new Error("Reviewed execution inputs exceed their total byte bound.");
          const destination = join(staging, inputFile.path); await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          const output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, index.mode === "100755" ? 0o700 : 0o600);
          try { await output.writeFile(index.bytes); await output.sync(); } finally { await output.close(); }
          await sourceCurrent(); withinDeadline(); continue;
        }
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
