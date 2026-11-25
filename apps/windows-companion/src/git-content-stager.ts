/** Raw, snapshot-bound blob staging. Git never reopens worktree content or runs clean filters. */
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { canonicalRepositoryPath, type BrokerOutcome } from "../../../packages/control-plane/src/brokers.ts";
import type { TargetSnapshot } from "../../../packages/control-plane/src/contracts.ts";
import { GitCliInspector, NodeFileDigestReader, type FileDigestReader, type UntrackedClassification } from "../../../packages/control-plane/src/git-inspector.ts";
import { canonicalWorktreeManifest, type ManifestFile } from "../../../packages/control-plane/src/snapshot.ts";
import type { LocalGitRunner } from "./mediated-git.ts";

export interface GitContentStagerOptions {
  readonly runner: LocalGitRunner;
  readonly classifyUntracked?: (path: string) => UntrackedClassification;
  readonly classifyIgnored?: (path: string) => UntrackedClassification;
}
export class VerifiedGitContentStager {
  private readonly options: GitContentStagerOptions;
  constructor(options: GitContentStagerOptions) { this.options = options; }
  async stage(root: string, target: TargetSnapshot, paths: readonly string[], environment: Readonly<Record<string, string>>): Promise<BrokerOutcome | undefined> {
    const refused = (summary: string): BrokerOutcome => ({ status: "incomplete", summary, effectDisposition: "not_started" });
    if (!paths.length || paths.length > 256) return refused("Review 1–256 literal task-owned files before staging.");
    const reader = new NodeFileDigestReader({ maxFileBytes: 4 * 1024 * 1024 });
    let files = 0, bytes = 0;
    const count = () => { if (++files > 4096) throw new Error("Repository witness file budget exceeded."); };
    const digestReader: FileDigestReader = {
      digest: async (directory, path) => { count(); bytes += Number((await lstat(join(directory, path))).size); if (!Number.isSafeInteger(bytes) || bytes > 64 * 1024 * 1024) throw new Error("Repository witness byte budget exceeded."); return reader.digest(directory, path); },
      state: async (directory, path) => { count(); return reader.state(directory, path); }
    };
    const inspector = new GitCliInspector({
      runner: { run: (args, cwd = root) => this.options.runner.run(args, { cwd }) }, digestReader,
      // These classifications still have to reproduce the approved manifest.
      // An unmatched policy never gets silently substituted for that target.
      classifyUntracked: this.options.classifyUntracked ?? (() => "included"),
      classifyIgnored: this.options.classifyIgnored ?? (() => "included")
    });
    const inspection = await inspector.inspect(root);
    if (!inspection.repositoryRoot || await realpath(inspection.repositoryRoot) !== await realpath(root) || inspection.issues?.length || inspection.head !== target.head || inspection.indexTree !== target.indexTree || inspection.branch !== target.branch) return refused("The exact repository witness changed before private staging.");
    const tracked = canonicalWorktreeManifest(inspection.trackedFiles, "tracked"), untracked = canonicalWorktreeManifest([...(inspection.untrackedFiles ?? []), ...(inspection.ignoredFiles ?? [])], "untracked");
    if (tracked.reasons.length || untracked.reasons.length || tracked.digest !== target.trackedManifest || untracked.digest !== target.untrackedManifest) return refused("The raw worktree manifests do not match the exact reviewed target.");
    const witnesses = new Map<string, ManifestFile>();
    for (const file of [...(inspection.trackedFiles ?? []), ...(inspection.untrackedFiles ?? [])]) {
      const canonical = canonicalRepositoryPath(file.path);
      if (!canonical || witnesses.has(canonical)) return refused("A repository path has an ambiguous native spelling.");
      witnesses.set(canonical, file);
    }
    const payloads = new NodeFileDigestReader({ maxFileBytes: 524288 });
    for (const requested of paths) {
      const witness = witnesses.get(canonicalRepositoryPath(requested) ?? "");
      if (!witness?.digest) return refused("An owned path has no exact content witness in the reviewed target.");
      const indexed = await this.options.runner.run(["--literal-pathspecs", "ls-files", "--stage", "-z", "--", witness.path], { cwd: root, environment });
      if (indexed.exitCode !== 0) return refused("The reviewed private index entry is unavailable.");
      const entries = indexed.stdout.split("\0").filter(Boolean), entry = entries[0]?.match(/^(100644|100755) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([\s\S]+)$/);
      if (entries.length > 1 || entries.length === 1 && (!entry || entry[3] !== witness.path)) return refused("The owned path is not one ordinary stage-zero private index entry.");
      if (witness.state === "tracked_missing") {
        if (!entry || await payloads.state(root, witness.path) !== "missing") return refused("The reviewed tracked deletion changed before staging.");
        const result = await this.options.runner.run(["--literal-pathspecs", "update-index", "--force-remove", "--", witness.path], { cwd: root, environment });
        if (result.exitCode !== 0) return refused("The exact reviewed deletion could not be privately staged.");
        continue;
      }
      let captured: Awaited<ReturnType<NodeFileDigestReader["read"]>>;
      try { captured = await payloads.read(root, witness.path); }
      catch { return refused("Owned commit files must remain regular, unchanged and within the 512 KiB private-pipe bound."); }
      try {
        if (captured.digest !== witness.digest) return refused("An owned file changed after its reviewed content witness was captured.");
        const algorithm = target.head?.length === 64 ? "sha256" : "sha1";
        const expected = createHash(algorithm).update(`blob ${captured.bytes.length}\0`).update(captured.bytes).digest("hex");
        const blob = await this.options.runner.run(["hash-object", "-w", "--no-filters", "--stdin"], { cwd: root, environment, input: captured.bytes });
        if (blob.exitCode !== 0 || blob.stdout.trim() !== expected) return refused("The private raw blob did not match the verified file bytes.");
        // Preserve reviewed tracked modes; new files are ordinary non-executable blobs.
        const mode = entry?.[1] ?? "100644";
        const result = await this.options.runner.run(["update-index", "--add", "--cacheinfo", mode, expected, witness.path], { cwd: root, environment });
        if (result.exitCode !== 0) return refused("The exact raw blob could not be installed in the private index.");
      } finally { captured.bytes.fill(0); }
    }
    return undefined;
  }
}
