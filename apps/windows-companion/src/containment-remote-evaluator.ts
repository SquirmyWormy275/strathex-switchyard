import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { lookup } from "node:dns/promises";
import { constants as fsConstants } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { stableJson } from "../../../packages/control-plane/src/store.ts";
import {
  containmentProductionRemoteEndpoint,
  containmentPublicAddress,
  containmentRemoteDetectorManifest,
  containmentRemoteEvidenceId,
  containmentRemoteEvidenceSigningPayload,
  containmentRemoteNamespaceDigest,
  validateContainmentRemoteEvidenceChallenge,
  type ContainmentRemoteEvidenceChallenge,
  type ContainmentRemoteEvidenceFinding,
  type ContainmentRemoteEvidenceRefResult,
  type ContainmentRemoteNetworkBinding,
  type ContainmentRemoteNamespaceRef,
  type ContainmentRemoteNamespaceResult,
  type SignedContainmentRemoteEvidence,
  type UnsignedContainmentRemoteEvidence
} from "./containment-remote-evidence.ts";

const maximumRefs = 256;
const maximumFindingsPerRef = 64;
const maximumFindings = 512;
const maximumOutputBytes = 1024 * 1024;
const maximumPrivateKeyBytes = 64 * 1024;
const maximumGitExecutableBytes = 128 * 1024 * 1024;
const maximumEvidenceLifetimeMs = 5 * 60_000;
const defaultGitTimeoutMs = 2 * 60_000;
const defaultTerminationWaitMs = 5_000;

export interface ContainmentRemoteEvaluatorGitResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string; }
export interface ContainmentRemoteEvaluatorGitRunner {
  readonly executableSha256: string;
  run(args: readonly string[], options?: Readonly<{ cwd?: string }>): Promise<ContainmentRemoteEvaluatorGitResult>;
}

export interface ContainmentRemoteAddressResolver {
  resolve(hostname: string): Promise<readonly Readonly<{ address: string; family: 4 | 6 }>[]>
}

export interface ContainmentRemoteEvaluatorOptions {
  readonly challengePath: string;
  readonly privateKeyPath: string;
  readonly outputPath: string;
  readonly git?: ContainmentRemoteEvaluatorGitRunner;
  readonly gitExecutablePath?: string;
  readonly resolver?: ContainmentRemoteAddressResolver;
  readonly allowTestFileRemotes?: boolean;
  readonly now?: () => Date;
  readonly nonceFactory?: () => string;
}

export interface SpawnContainmentRemoteEvaluatorGitRunnerOptions {
  readonly executablePath: string;
  readonly expectedSha256: string;
  readonly timeoutMs?: number;
  readonly terminationWaitMs?: number;
  readonly spawnProcess?: typeof spawn;
  readonly terminateProcessTree?: (pid: number, waitMs: number) => Promise<void>;
}

interface PreparedRemote {
  readonly name: string;
  readonly canonicalIdentity: string;
  readonly networkBinding?: ContainmentRemoteNetworkBinding;
  readonly gitConfiguration: readonly string[];
}

interface EvaluationRemote extends PreparedRemote {
  readonly baseline: readonly ContainmentRemoteNamespaceRef[];
  readonly mirror: string;
  readonly refResults: readonly ContainmentRemoteEvidenceRefResult[];
}

/** Production challenges permit only DNS-pinned public HTTPS. Local file remotes are test-only. */
export async function evaluateContainmentRemoteChallenge(options: ContainmentRemoteEvaluatorOptions): Promise<SignedContainmentRemoteEvidence> {
  const challengePath = absoluteFile(options.challengePath, "challenge");
  const privateKeyPath = absoluteFile(options.privateKeyPath, "private key");
  const outputPath = absoluteFile(options.outputPath, "evidence output");
  if (samePath(outputPath, challengePath) || samePath(outputPath, privateKeyPath)) throw new Error("The evaluator output must not overwrite an input file.");
  const clock = options.now ?? (() => new Date());
  const startedAt = exactClock(clock());
  const challenge = parseChallenge(await readBoundedRegularFile(challengePath, 256 * 1024, "challenge"), startedAt);
  assertChallengeFresh(challenge, startedAt, true);

  const keyBytes = await readBoundedRegularFile(privateKeyPath, maximumPrivateKeyBytes, "private key");
  let privateKey;
  try { privateKey = createPrivateKey(keyBytes); }
  finally { keyBytes.fill(0); }
  const publicKey = createPublicKey(privateKey);
  if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("The evaluator requires an ECDSA P-256 private key.");
  const keyId = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  if (keyId !== challenge.keyId) throw new Error("The evaluator private key does not match the host-issued challenge key ID.");

  const git = options.git ?? new SpawnContainmentRemoteEvaluatorGitRunner({
    executablePath: absoluteFile(options.gitExecutablePath ?? "", "Git executable"), expectedSha256: challenge.gitExecutableSha256
  });
  if (git.executableSha256 !== challenge.gitExecutableSha256) throw new Error("The evaluator Git executable does not match the host-pinned digest.");
  const versionResult = await requireGit(git, ["--version"], undefined, "The pinned evaluator Git version could not be established.");
  const gitVersion = exactGitVersion(versionResult.stdout.trim());
  const resolver = options.resolver ?? { async resolve(hostname: string) { return lookup(hostname, { all: true, verbatim: true }) as Promise<readonly Readonly<{ address: string; family: 4 | 6 }>[]>; } };
  const prepared = await Promise.all(challenge.configuredRemotes.map((remote) => prepareRemote(challenge, remote, resolver, options.allowTestFileRemotes === true)));

  const temporaryRoot = await mkdtemp(join(tmpdir(), "sxsy-b122-remote-evaluator-"));
  try {
    const networkCwd = join(temporaryRoot, "clean-network-cwd");
    await mkdir(networkCwd, { mode: 0o700 });
    const evaluations: EvaluationRemote[] = [];
    let totalFindings = 0;
    for (let index = 0; index < prepared.length; index += 1) {
      assertChallengeFresh(challenge, exactClock(clock()));
      const remote = prepared[index]!;
      const baseline = await inventory(git, remote, networkCwd);
      const mirror = join(temporaryRoot, `remote-${index + 1}`);
      await requireGit(git, [...remote.gitConfiguration, "clone", "--mirror", "--no-local", "--", remote.canonicalIdentity, mirror], networkCwd, "The exact configured remote could not be mirrored.");
      await assertMirrorIntegrity(git, mirror);
      const afterMirror = await inventory(git, remote, networkCwd);
      if (stableJson(baseline) !== stableJson(afterMirror)) throw new Error("A configured remote namespace changed during evaluation; no evidence was written.");
      const refResults: ContainmentRemoteEvidenceRefResult[] = [];
      for (const ref of baseline) {
        assertChallengeFresh(challenge, exactClock(clock()));
        const scan = await requireGit(git, [
          "log", ref.head, ...containmentRemoteDetectorManifest.scanProfile.fixedArguments,
          `${containmentRemoteDetectorManifest.scanProfile.patternOption}${containmentRemoteDetectorManifest.patterns.join("|")}`,
          ...containmentRemoteDetectorManifest.scanProfile.pathspec
        ], mirror, "A remote ref history could not be assessed completely.");
        const findings = redactedFindings(scan.stdout);
        if (findings.length > maximumFindingsPerRef) throw new Error("A remote ref has too many path-only findings for bounded evidence.");
        totalFindings += findings.length;
        if (totalFindings > maximumFindings) throw new Error("Remote evidence exceeds the bounded total finding count.");
        refResults.push(findings.length ? {
          ...ref, status: "failed", exposure: "found",
          summary: `Configured credential detectors matched content reachable in ${findings.length} redacted path(s); values and names were not retained.`, findings
        } : {
          ...ref, status: "passed", exposure: "none",
          summary: "No configured credential detector matched content in reachable history.", findings: []
        });
      }
      evaluations.push({ ...remote, baseline, mirror, refResults });
    }

    for (const remote of evaluations) {
      assertChallengeFresh(challenge, exactClock(clock()));
      const final = await inventory(git, remote, networkCwd);
      if (stableJson(remote.baseline) !== stableJson(final)) throw new Error("A configured remote namespace changed before the authoritative final inventory; no evidence was written.");
    }

    const completedAt = exactClock(clock());
    assertChallengeFresh(challenge, completedAt);
    const remoteResults: ContainmentRemoteNamespaceResult[] = evaluations.map((remote) => {
      const exposed = remote.refResults.some((result) => result.status === "failed");
      return {
        name: remote.name, canonicalIdentity: remote.canonicalIdentity, namespaceComplete: true,
        refCount: remote.baseline.length, namespaceSha256: containmentRemoteNamespaceDigest(remote.baseline), namespaceRefs: remote.baseline,
        status: exposed ? "failed" : "passed", exposure: exposed ? "found" : "none",
        summary: exposed ? "Complete advertised remote namespace contains redacted configured-detector findings." : "Complete advertised remote namespace passed the configured history detectors.",
        refResults: remote.refResults
      };
    });
    const evaluatorNonce = exactNonce(options.nonceFactory?.() ?? randomBytes(32).toString("hex"));
    if (evaluatorNonce === challenge.challengeNonce) throw new Error("The evaluator nonce must be independent from the host challenge nonce.");
    const completedMs = completedAt.getTime();
    const expiresAt = new Date(Math.min(Date.parse(challenge.expiresAt), completedMs + maximumEvidenceLifetimeMs)).toISOString();
    if (Date.parse(expiresAt) <= completedMs) throw new Error("The signed remote evidence has no remaining freshness window.");
    const exposed = remoteResults.some((remote) => remote.status === "failed");
    const toolManifest = {
      schema: "sxsy-b122.containment-remote-tool-manifest" as const, version: 1 as const,
      detectorManifest: containmentRemoteDetectorManifest, gitExecutableSha256: git.executableSha256, gitVersion,
      evaluationProfile: challenge.evaluationProfile, networkPolicy: challenge.networkPolicy,
      networkBindings: prepared.flatMap((remote) => remote.networkBinding ? [remote.networkBinding] : [])
    };
    const unsigned: UnsignedContainmentRemoteEvidence = {
      schema: "sxsy-b122.containment-remote-evidence", version: 3, purpose: "containment-remote-assessment",
      evidenceId: containmentRemoteEvidenceId(challenge.id, evaluatorNonce, challenge.authorityId, challenge.keyId),
      authorityId: challenge.authorityId, keyId: challenge.keyId, challenge, evaluatorNonce, evaluatedAt: completedAt.toISOString(), expiresAt,
      namespaceComplete: true, status: exposed ? "failed" : "passed", exposure: exposed ? "found" : "none",
      summary: exposed ? "Complete configured-remote assessment found redacted configured-detector paths." : "Every configured remote advertised-ref namespace was completely assessed.",
      toolManifest, remoteResults, signatureAlgorithm: "ecdsa-p256-sha256"
    };
    const signature = sign("sha256", containmentRemoteEvidenceSigningPayload(unsigned), privateKey).toString("base64");
    const evidence: SignedContainmentRemoteEvidence = { ...unsigned, signature };
    await writeExclusiveAtomic(outputPath, `${stableJson(evidence)}\n`);
    return evidence;
  } finally { await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}

export class SpawnContainmentRemoteEvaluatorGitRunner implements ContainmentRemoteEvaluatorGitRunner {
  readonly executableSha256: string;
  private readonly executablePath: string;
  private readonly timeoutMs: number;
  private readonly terminationWaitMs: number;
  private readonly spawnProcess: typeof spawn;
  private readonly terminateProcessTree: (pid: number, waitMs: number) => Promise<void>;

  constructor(options: SpawnContainmentRemoteEvaluatorGitRunnerOptions) {
    this.executablePath = absoluteFile(options.executablePath, "Git executable");
    this.executableSha256 = exactDigest(options.expectedSha256, "Git executable digest");
    this.timeoutMs = boundedDuration(options.timeoutMs ?? defaultGitTimeoutMs, "Git timeout");
    this.terminationWaitMs = boundedDuration(options.terminationWaitMs ?? defaultTerminationWaitMs, "Git termination wait");
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.terminateProcessTree = options.terminateProcessTree ?? terminateProcessTree;
  }

  async run(args: readonly string[], options: Readonly<{ cwd?: string }> = {}): Promise<ContainmentRemoteEvaluatorGitResult> {
    if (!args.length || args.length > 40 || args.some((arg) => typeof arg !== "string" || arg.length > 8_192 || /[\r\n\0]/.test(arg))) throw new Error("The evaluator Git request is unsafe or unbounded.");
    const executable = await readBoundedRegularFile(this.executablePath, maximumGitExecutableBytes, "Git executable");
    const observedDigest = createHash("sha256").update(executable).digest("hex");
    executable.fill(0);
    if (observedDigest !== this.executableSha256) throw new Error("The evaluator Git executable changed from the host-pinned identity.");
    const child = this.spawnProcess(this.executablePath, [...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}), shell: false, windowsHide: true,
      detached: process.platform !== "win32", env: evaluatorEnvironment(process.env, options.cwd), stdio: ["ignore", "pipe", "pipe"]
    }) as unknown as ChildProcessWithoutNullStreams;
    return this.collect(child);
  }

  private collect(child: ChildProcessWithoutNullStreams): Promise<ContainmentRemoteEvaluatorGitResult> {
    return new Promise((resolveRun, rejectRun) => {
      let stdout = ""; let stderr = ""; let exceeded = false; let settled = false; let timedOut = false; let childClosed = false;
      let closeCode: number | null = null;
      let resolveClosed!: () => void;
      const closed = new Promise<void>((resolveClose) => { resolveClosed = resolveClose; });
      const append = (current: string, chunk: Buffer) => {
        if (Buffer.byteLength(current, "utf8") >= maximumOutputBytes) { exceeded = true; return current; }
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next, "utf8") > maximumOutputBytes) { exceeded = true; return next.slice(0, maximumOutputBytes); }
        return next;
      };
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const finish = (result: () => void) => { if (!settled) { settled = true; clearTimeout(timer); result(); } };
      const timer = setTimeout(() => {
        timedOut = true;
        void (async () => {
          const pid = child.pid;
          let cleanupFailure: unknown;
          if (typeof pid === "number" && pid > 0) {
            try { await bounded(this.terminateProcessTree(pid, this.terminationWaitMs), this.terminationWaitMs, "The evaluator Git process-tree termination request exceeded its bound."); }
            catch (error) { cleanupFailure = error; }
          } else cleanupFailure = new Error("The evaluator Git process has no process-tree identity.");
          try { await bounded(closed, this.terminationWaitMs, "The evaluator Git child did not close after its process-tree termination request."); }
          catch (error) { cleanupFailure ??= error; }
          finish(() => rejectRun(new Error(cleanupFailure || !childClosed
            ? "The evaluator Git process tree timed out and cleanup failed; process-tree termination and child closure were not both proven."
            : "The evaluator Git process tree exceeded its timeout; bounded process-tree termination completed and child closure was observed.")));
        })();
      }, this.timeoutMs);
      child.once("error", () => finish(() => rejectRun(new Error("The pinned Git evaluator process could not start."))));
      child.once("close", (code) => {
        childClosed = true; closeCode = code; resolveClosed();
        if (!timedOut) finish(() => exceeded
          ? rejectRun(new Error("The evaluator Git result exceeded its output bound."))
          : resolveRun({ exitCode: closeCode ?? -1, stdout, stderr }));
      });
    });
  }
}

async function prepareRemote(challenge: ContainmentRemoteEvidenceChallenge, remote: ContainmentRemoteEvidenceChallenge["configuredRemotes"][number], resolver: ContainmentRemoteAddressResolver, allowTestFileRemotes: boolean): Promise<PreparedRemote> {
  if (challenge.evaluationProfile === "test-local-file-v1") {
    if (!allowTestFileRemotes || challenge.networkPolicy !== "test-local-file-no-network-v1" || !remote.canonicalIdentity.startsWith("file://")) throw new Error("Test-local remote evaluation is disabled unless explicitly enabled outside the packaged CLI.");
    return { ...remote, gitConfiguration: [] };
  }
  if (allowTestFileRemotes || challenge.networkPolicy !== "public-https-dns-pinned-no-redirect-v1") throw new Error("The production remote evaluator policy is inconsistent.");
  const endpoint = containmentProductionRemoteEndpoint(remote.canonicalIdentity);
  let resolved: readonly Readonly<{ address: string; family: 4 | 6 }>[];
  try { resolved = await resolver.resolve(endpoint.hostname); } catch { throw new Error("The production remote hostname could not be resolved for DNS pinning."); }
  if (resolved.some((item) => item.family !== 4 || item.address.includes(":"))) throw new Error("The production remote resolver returned IPv6; this evaluator fails closed because its Git/libcurl pin encoding is IPv4-only.");
  const addresses = [...new Set(resolved.map((item) => item.address))].sort();
  if (addresses.length < 1 || addresses.length > 8 || addresses.some((address) => !containmentPublicAddress(address))) throw new Error("The production remote did not resolve exclusively to bounded public IPv4 addresses; private, loopback, link-local, and reserved targets are rejected.");
  const networkBinding: ContainmentRemoteNetworkBinding = { remoteName: remote.name, hostname: endpoint.hostname, port: 443, addresses };
  return { ...remote, networkBinding, gitConfiguration: ["-c", `http.curloptResolve=${endpoint.hostname}:443:${addresses.join(",")}`, "-c", "http.followRedirects=false", "-c", "http.sslVerify=true", "-c", "http.proxy="] };
}

async function inventory(git: ContainmentRemoteEvaluatorGitRunner, remote: PreparedRemote, networkCwd: string): Promise<readonly ContainmentRemoteNamespaceRef[]> {
  const result = await requireGit(git, [...remote.gitConfiguration, "ls-remote", "--refs", "--", remote.canonicalIdentity], networkCwd, "The complete advertised configured-remote namespace could not be inventoried.");
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length > maximumRefs) throw new Error("A configured remote namespace exceeds the bounded ref count.");
  const refs = lines.map((line) => {
    const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t(refs\/[A-Za-z0-9._/-]+)$/.exec(line);
    if (!match) throw new Error("A configured remote returned an invalid advertised namespace entry.");
    return { ref: exactRef(match[2]!), head: match[1]! };
  }).sort((left, right) => left.ref.localeCompare(right.ref));
  if (new Set(refs.map((ref) => ref.ref)).size !== refs.length) throw new Error("A configured remote namespace contains duplicate refs.");
  return refs;
}

async function assertMirrorIntegrity(git: ContainmentRemoteEvaluatorGitRunner, mirror: string): Promise<void> {
  for (const check of containmentRemoteDetectorManifest.scanProfile.mirrorIntegrityChecks) {
    let result: ContainmentRemoteEvaluatorGitResult;
    try { result = await git.run(check.arguments, { cwd: mirror }); }
    catch { throw new Error("The mirrored remote history integrity checks could not complete; no evidence was written."); }
    if (Buffer.byteLength(result.stdout, "utf8") > maximumOutputBytes) throw new Error("The mirrored remote integrity result exceeded its bound.");
    const stdout = result.stdout.trim();
    const valid = check.expectation === "stdout-exact-false" ? result.exitCode === 0 && stdout === "false"
      : check.expectation === "exit-one-empty" ? result.exitCode === 1 && stdout === ""
        : check.expectation === "no-missing-markers" ? result.exitCode === 0 && !result.stdout.split(/\r?\n/).some((line) => line.startsWith("?"))
          : result.exitCode === 0;
    if (!valid) throw new Error("The mirrored remote is shallow, promisor-backed, missing reachable objects, corrupt, or otherwise incomplete; no evidence was written.");
  }
}

async function requireGit(git: ContainmentRemoteEvaluatorGitRunner, args: readonly string[], cwd: string | undefined, failure: string): Promise<ContainmentRemoteEvaluatorGitResult> {
  let result: ContainmentRemoteEvaluatorGitResult;
  try { result = await git.run(args, cwd ? { cwd } : undefined); } catch { throw new Error(failure); }
  if (result.exitCode !== 0 || Buffer.byteLength(result.stdout, "utf8") > maximumOutputBytes) throw new Error(failure);
  return result;
}

function parseChallenge(bytes: Uint8Array, now: Date): ContainmentRemoteEvidenceChallenge {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw new Error("The remote-evidence challenge is not JSON."); }
  try { return validateContainmentRemoteEvidenceChallenge(value, now); } catch { throw new Error("The remote-evidence challenge schema, freshness, or exact binding is invalid."); }
}

function redactedFindings(output: string): readonly ContainmentRemoteEvidenceFinding[] {
  if (Buffer.byteLength(output, "utf8") > 64 * 1024) throw new Error("Remote history path output exceeds its bound.");
  const values = output.split("\0");
  if (values.at(-1) === "") values.pop();
  const hashes = new Set<string>();
  for (const value of values) hashes.add(createHash("sha256").update(exactRelativePath(value), "utf8").digest("hex"));
  return [...hashes].sort().map((pathSha256) => ({ relativePath: `redacted/${pathSha256}`, pathSha256, credentialRelated: true }));
}

function exactRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.length > 2_048 || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..") || /[\0\r\n]/.test(normalized)) throw new Error("Remote evidence contains an unsafe finding path.");
  return normalized;
}

function exactRef(value: string): string {
  if (value.length > 512 || !/^refs\/[A-Za-z0-9._/-]+$/.test(value) || value.includes("..") || value.includes("@{") || value.endsWith(".") || value.endsWith(".lock") || value.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith(".") || part.endsWith(".lock")) || /[\0\r\n\\~^:?*[ ]/.test(value)) throw new Error("The remote namespace ref is invalid.");
  return value;
}

async function readBoundedRegularFile(path: string, maximum: number, label: string): Promise<Buffer> {
  const selected = absoluteFile(path, label);
  const before = await lstat(selected);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum) throw new Error(`The evaluator ${label} is not a bounded regular file.`);
  const canonical = await realpath(selected);
  const flags = process.platform === "win32" ? fsConstants.O_RDONLY : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
  const handle = await open(canonical, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error(`The evaluator ${label} changed before its stable handle was opened.`);
    const bytes = await handle.readFile();
    const afterHandle = await handle.stat();
    const afterPath = await lstat(canonical);
    if (bytes.byteLength !== opened.size || afterHandle.size !== opened.size || afterHandle.mtimeMs !== opened.mtimeMs || afterHandle.dev !== opened.dev || afterHandle.ino !== opened.ino || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino) { bytes.fill(0); throw new Error(`The evaluator ${label} changed while it was read.`); }
    return bytes;
  } finally { await handle.close(); }
}

async function writeExclusiveAtomic(path: string, bytes: string): Promise<void> {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try { await link(temporary, path); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new Error("The evaluator output already exists; it was not overwritten."); throw error; }
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

async function terminateProcessTree(pid: number, waitMs: number): Promise<void> {
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (!systemRoot) throw new Error("Windows process-tree termination has no fixed system root.");
    const taskkill = resolve(systemRoot, "System32", "taskkill.exe");
    const child = spawn(taskkill, ["/PID", String(pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore", env: evaluatorEnvironment(process.env) });
    const exitCode = await bounded(new Promise<number>((resolveExit, rejectExit) => {
      child.once("error", () => rejectExit(new Error("Windows process-tree termination could not start.")));
      child.once("close", (code) => resolveExit(code ?? -1));
    }), waitMs, "Windows process-tree termination exceeded its bound.");
    if (exitCode !== 0) throw new Error("Windows process-tree termination did not confirm success.");
    return;
  }
  try { process.kill(-pid, "SIGTERM"); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
    throw error;
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(250, waitMs)));
  try { process.kill(-pid, "SIGKILL"); } catch { /* already exited */ }
  await bounded(waitForProcessGroupGone(pid), waitMs, "POSIX process-tree termination did not prove the process group exited.");
}

async function waitForProcessGroupGone(pid: number): Promise<void> {
  for (;;) {
    try { process.kill(-pid, 0); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}
async function bounded<T>(promise: Promise<T>, waitMs: number, message: string): Promise<T> { let timer: NodeJS.Timeout | undefined; try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), waitMs); })]); } finally { if (timer) clearTimeout(timer); } }

function evaluatorEnvironment(source: NodeJS.ProcessEnv, cwd?: string): NodeJS.ProcessEnv {
  const inherited = ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "OS", "SystemDrive", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"];
  const environment: NodeJS.ProcessEnv = {};
  for (const wanted of inherited) { const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === wanted.toLowerCase()); if (key && source[key] !== undefined) environment[wanted] = source[key]; }
  return {
    ...environment, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_ASKPASS: "", SSH_ASKPASS: "",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_COUNT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_LFS_SKIP_SMUDGE: "1", GIT_OPTIONAL_LOCKS: "0",
    ...(cwd ? { GIT_CEILING_DIRECTORIES: dirname(resolve(cwd)) } : {})
  };
}

function assertChallengeFresh(challenge: ContainmentRemoteEvidenceChallenge, now: Date, requireHeadroom = false): void { const nowMs = now.getTime(); const issued = Date.parse(challenge.issuedAt); const expires = Date.parse(challenge.expiresAt); if (nowMs < issued - 60_000 || expires <= nowMs + (requireHeadroom ? 1_000 : 0)) throw new Error("The remote-evidence challenge is expired, clock-invalid, or no longer fresh."); }
function exactClock(value: Date): Date { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("The evaluator clock is invalid."); return new Date(value); }
function exactGitVersion(value: string): string { if (!/^git version [0-9]+\.[0-9]+\.[0-9]+(?:\.[A-Za-z0-9.-]+)?$/.test(value) || value.length > 96) throw new Error("The pinned evaluator Git version is malformed."); return value; }
function absoluteFile(value: string, label: string): string { if (typeof value !== "string" || !isAbsolute(value) || value.length > 4_096 || /[\r\n\0]/.test(value)) throw new Error(`The evaluator ${label} path is invalid.`); return resolve(value); }
function samePath(left: string, right: string): boolean { const normalized = (value: string) => resolve(value).replace(/^\\\\\?\\/, "").replaceAll("\\", "/"); const a = normalized(left); const b = normalized(right); return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b; }
function exactNonce(value: string): string { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("The evaluator nonce is invalid."); return value; }
function exactDigest(value: string, label: string): string { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`The evaluator ${label} is invalid.`); return value; }
function boundedDuration(value: number, label: string): number { if (!Number.isSafeInteger(value) || value < 10 || value > 10 * 60_000) throw new Error(`The evaluator ${label} is invalid.`); return value; }
