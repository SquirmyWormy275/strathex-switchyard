import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import test from "node:test";

import type { ContainmentAssessmentRequest } from "../../../packages/control-plane/src/containment-incidents.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  canonicalContainmentRemoteIdentity,
  containmentRemoteChallengeId,
  containmentRemoteDetectorManifest,
  DurableContainmentRemoteEvidenceRegistry,
  type ContainmentConfiguredRemote,
  type ContainmentRemoteEvidenceBinding,
  type ContainmentRemoteEvidenceChallenge,
  type ContainmentRemoteTrustPolicy
} from "../src/containment-remote-evidence.ts";
import {
  evaluateContainmentRemoteChallenge,
  SpawnContainmentRemoteEvaluatorGitRunner,
  type ContainmentRemoteEvaluatorGitResult,
  type ContainmentRemoteEvaluatorGitRunner
} from "../src/containment-remote-evaluator.ts";
import { runContainmentRemoteEvaluatorCli } from "../src/containment-remote-evaluator-main.ts";

const now = "2026-08-25T12:01:00.000Z";
const authorityId = "independent-remote-evaluator";
const secretValue = "NEVER_RETAIN_THIS_SECRET_VALUE";
const fakeGitDigest = "f".repeat(64);
const publicResolver = { async resolve() { return [{ address: "140.82.112.4", family: 4 as const }]; } };
const authenticator = {
  provider: "containment-remote-evaluator-test",
  async seal(hash: string) { return `test:${hash}`; },
  async verify(hash: string, tag: string) { return tag === `test:${hash}`; }
};

interface Fixture {
  readonly root: string;
  readonly challengePath: string;
  readonly privateKeyPath: string;
  readonly outputPath: string;
  readonly challenge: ContainmentRemoteEvidenceChallenge;
  readonly binding: ContainmentRemoteEvidenceBinding;
  readonly registry: DurableContainmentRemoteEvidenceRegistry;
}

async function setup(
  context: test.TestContext,
  configuredRemotes: readonly ContainmentConfiguredRemote[] = [
    { name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" },
    { name: "upstream", canonicalIdentity: "https://github.com/upstream/switchyard.git" }
  ],
  gitDigest = fakeGitDigest
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-remote-evaluator-test-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = createHash("sha256")
    .update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }))
    .digest("hex");
  const registry = new DurableContainmentRemoteEvidenceRegistry(
    new ProtectedJsonStore({ filePath: join(root, "protected.jsonl"), clock: () => now, authenticator }),
    { now: () => new Date(now), nonceFactory: () => "1".repeat(64) }
  );
  const trust: ContainmentRemoteTrustPolicy = {
    schema: "sxsy-b122.containment-remote-trust-policy", version: 2,
    purpose: "containment-remote-assessment", authorityId, keyId, publicKeyPem,
    gitExecutableSha256: gitDigest,
    detectorManifestId: containmentRemoteDetectorManifest.id,
    networkPolicy: "public-https-dns-pinned-no-redirect-v1",
    expiresAt: "2026-08-26T12:00:00.000Z"
  };
  await registry.installTrust(trust, "TEST\\Security");
  const request: ContainmentAssessmentRequest = {
    schema: "sxsy-b122.containment-assessment-request", version: 1,
    incidentId: `containment-incident:${"a".repeat(64)}`,
    repositoryRoot: resolve(root, "repository"), fenceEpoch: 7, step: "remote",
    operationId: `containment-assessment:${"b".repeat(64)}`,
    externalId: `containment-assessment:${"c".repeat(64)}`,
    egressAllowed: false, revealSecretValues: false
  };
  const binding: ContainmentRemoteEvidenceBinding = {
    request, generation: 3, targetSnapshotId: `target:${"d".repeat(64)}`,
    policyVersion: "containment-policy-9", authorityId, keyId, configuredRemotes
  };
  const challenge = await registry.issueChallenge(
    { ...binding, expiresAt: "2026-08-25T12:10:00.000Z" },
    "TEST\\Security"
  );
  const challengePath = join(root, "challenge.json");
  const privateKeyPath = join(root, "evaluator-private.pem");
  const outputPath = join(root, "signed-evidence.json");
  await writeFile(challengePath, JSON.stringify(challenge), { encoding: "utf8", mode: 0o600 });
  await writeFile(privateKeyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  return { root, challengePath, privateKeyPath, outputPath, challenge, binding, registry };
}

interface GitCall {
  readonly args: readonly string[];
  readonly cwd?: string;
}

class CompleteNamespaceGit implements ContainmentRemoteEvaluatorGitRunner {
  readonly calls: GitCall[] = [];
  readonly executableSha256 = fakeGitDigest;
  private readonly inventoryCalls = new Map<string, number>();

  constructor(
    private readonly inventories: Readonly<Record<string, readonly string[]>>,
    private readonly findings: Readonly<Record<string, string>> = {},
    private readonly inventorySequence: Readonly<Record<string, readonly (readonly string[])[]>> = {},
    private readonly integrity: Readonly<{ shallow?: boolean; promisor?: boolean; missing?: boolean; corrupt?: boolean }> = {}
  ) {}

  async run(args: readonly string[], options: Readonly<{ cwd?: string }> = {}): Promise<ContainmentRemoteEvaluatorGitResult> {
    this.calls.push({ args: [...args], ...(options.cwd ? { cwd: options.cwd } : {}) });
    const commandIndex = args.findIndex((value) => value === "ls-remote" || value === "clone" || value === "log" || value === "--version"
      || value === "rev-parse" || value === "config" || value === "rev-list" || value === "fsck");
    const command = args[commandIndex];
    if (command === "--version") return { exitCode: 0, stdout: "git version 2.51.0\n", stderr: "" };
    if (command === "ls-remote") {
      const identity = args.at(-1)!;
      const invocation = (this.inventoryCalls.get(identity) ?? 0) + 1;
      this.inventoryCalls.set(identity, invocation);
      const lines = this.inventorySequence[identity]?.[invocation - 1] ?? this.inventories[identity];
      if (!lines) return { exitCode: 1, stdout: "", stderr: `unknown remote ${secretValue}` };
      return { exitCode: 0, stdout: lines.length ? `${lines.join("\n")}\n` : "", stderr: `diagnostic ${secretValue}` };
    }
    if (command === "clone") return { exitCode: 0, stdout: "", stderr: `clone diagnostic ${secretValue}` };
    if (command === "rev-parse") return { exitCode: 0, stdout: this.integrity.shallow ? "true\n" : "false\n", stderr: "" };
    if (command === "config") return this.integrity.promisor
      ? { exitCode: 0, stdout: "remote.origin.promisor true\n", stderr: "" }
      : { exitCode: 1, stdout: "", stderr: "" };
    if (command === "rev-list") return { exitCode: 0, stdout: this.integrity.missing ? `?${"0".repeat(40)}\n` : "", stderr: "" };
    if (command === "fsck") return { exitCode: this.integrity.corrupt ? 1 : 0, stdout: "", stderr: "" };
    if (command === "log") return { exitCode: 0, stdout: this.findings[args[commandIndex + 1]!] ?? "", stderr: `scan diagnostic ${secretValue}` };
    return { exitCode: 1, stdout: "", stderr: `unexpected command ${secretValue}` };
  }
}

function evaluatorOptions(fixture: Fixture, git: ContainmentRemoteEvaluatorGitRunner, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    challengePath: fixture.challengePath, privateKeyPath: fixture.privateKeyPath,
    outputPath: fixture.outputPath, git, resolver: publicResolver,
    now: () => new Date(now), nonceFactory: () => "2".repeat(64), ...overrides
  };
}

test("host-issued challenge produces exact signed three-pass namespace evidence with path-only findings", async (context) => {
  const fixture = await setup(context);
  const origin = fixture.challenge.configuredRemotes[0]!.canonicalIdentity;
  const upstream = fixture.challenge.configuredRemotes[1]!.canonicalIdentity;
  const mainHead = "2".repeat(40);
  const tagHead = "3".repeat(40);
  const git = new CompleteNamespaceGit({
    [origin]: [`${tagHead}\trefs/tags/v1.0.0`, `${mainHead}\trefs/heads/main`],
    [upstream]: []
  }, { [mainHead]: "config/token.env\0config/token.env\0" });

  const evidence = await evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, git));

  assert.deepEqual(evidence.challenge, fixture.challenge);
  assert.equal(evidence.authorityId, authorityId);
  assert.equal(evidence.keyId, fixture.binding.keyId);
  assert.equal(evidence.namespaceComplete, true);
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.exposure, "found");
  assert.deepEqual(evidence.remoteResults.map((remote) => remote.name), ["origin", "upstream"]);
  assert.deepEqual(evidence.remoteResults[0]!.namespaceRefs, [
    { ref: "refs/heads/main", head: mainHead },
    { ref: "refs/tags/v1.0.0", head: tagHead }
  ]);
  const expectedPathDigest = createHash("sha256").update("config/token.env").digest("hex");
  assert.deepEqual(evidence.remoteResults[0]!.refResults[0]!.findings, [
    { relativePath: `redacted/${expectedPathDigest}`, pathSha256: expectedPathDigest, credentialRelated: true }
  ]);
  assert.equal(evidence.toolManifest.detectorManifest.id, containmentRemoteDetectorManifest.id);
  assert.equal(evidence.toolManifest.gitExecutableSha256, fakeGitDigest);
  assert.equal(evidence.toolManifest.evaluationProfile, "production-public-https-v1");
  assert.equal(evidence.remoteResults[1]!.namespaceComplete, true);
  assert.equal(evidence.remoteResults[1]!.refCount, 0);
  assert.deepEqual(evidence.remoteResults[1]!.namespaceRefs, []);
  assert.deepEqual(evidence.remoteResults[1]!.refResults, []);

  const inventories = git.calls.filter((call) => call.args.includes("ls-remote"));
  assert.equal(inventories.length, 6);
  for (const remote of fixture.challenge.configuredRemotes) {
    assert.equal(inventories.filter((call) => call.args.at(-1) === remote.canonicalIdentity).length, 3);
  }
  assert.ok(inventories.every((call) => call.args.includes("--refs") && !call.args.includes("--heads") && !call.args.includes("--tags")));
  assert.ok(inventories.every((call) => call.args.some((arg) => arg.startsWith("http.curloptResolve="))));
  const networkCalls = git.calls.filter((call) => call.args.includes("ls-remote") || call.args.includes("clone"));
  assert.equal(git.calls.filter((call) => call.args.includes("clone")).length, 2);
  assert.ok(networkCalls.every((call) => call.cwd?.replaceAll("\\", "/").endsWith("/clean-network-cwd")));
  assert.equal(new Set(networkCalls.map((call) => call.cwd)).size, 1);
  const scans = git.calls.filter((call) => call.args.includes("log"));
  assert.deepEqual(scans.map((call) => call.args[call.args.indexOf("log") + 1]), [mainHead, tagHead]);
  assert.ok(scans.every((call) => call.args.includes("--extended-regexp") && call.args.includes("--regexp-ignore-case")));
  for (const scan of scans) {
    const pattern = scan.args.find((argument) => argument.startsWith("-G"))!;
    assert.equal(createHash("sha256").update(pattern.slice(2)).digest("hex"), containmentRemoteDetectorManifest.patternSha256);
    assert.ok(containmentRemoteDetectorManifest.scanProfile.fixedArguments.every((argument) => scan.args.includes(argument)));
  }

  const serialized = await readFile(fixture.outputPath, "utf8");
  assert.doesNotMatch(serialized, new RegExp(secretValue));
  assert.doesNotMatch(serialized, /diagnostic|config\/token\.env/i);
  assert.deepEqual(JSON.parse(serialized), evidence);
  const imported = await fixture.registry.importEvidence(fixture.outputPath, "TEST\\Security");
  assert.equal(imported.evidenceId, evidence.evidenceId);
  assert.equal(imported.status, "available");
});

test("clean refs and an empty remote namespace produce a complete clean result", async (context) => {
  const fixture = await setup(context);
  const origin = fixture.challenge.configuredRemotes[0]!.canonicalIdentity;
  const upstream = fixture.challenge.configuredRemotes[1]!.canonicalIdentity;
  const head = "4".repeat(40);
  const pullHead = "6".repeat(40);
  const git = new CompleteNamespaceGit({ [origin]: [`${head}\trefs/heads/main`, `${pullHead}\trefs/pull/22/head`], [upstream]: [] });

  const evidence = await evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, git, { nonceFactory: () => "5".repeat(64) }));

  assert.equal(evidence.status, "passed");
  assert.equal(evidence.exposure, "none");
  assert.ok(evidence.remoteResults.every((remote) => remote.status === "passed" && remote.exposure === "none"));
  assert.equal(evidence.remoteResults[0]!.refResults[0]!.status, "passed");
  assert.deepEqual(evidence.remoteResults[0]!.namespaceRefs.map((ref) => ref.ref), ["refs/heads/main", "refs/pull/22/head"]);
  assert.deepEqual(evidence.remoteResults[0]!.refResults[0]!.findings, []);
  assert.equal(evidence.remoteResults[1]!.refCount, 0);
  assert.match(evidence.remoteResults[1]!.namespaceSha256, /^[a-f0-9]{64}$/);
  await fixture.registry.importEvidence(fixture.outputPath, "TEST\\Security");
  assert.equal((await fixture.registry.observe(fixture.binding)).state, "available");
});

test("namespace churn fails closed before ref scanning and writes no evidence", async (context) => {
  const fixture = await setup(context, [{ name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" }]);
  const identity = fixture.challenge.configuredRemotes[0]!.canonicalIdentity;
  const git = new CompleteNamespaceGit(
    { [identity]: [`${"6".repeat(40)}\trefs/heads/main`] },
    {},
    { [identity]: [
      [`${"6".repeat(40)}\trefs/heads/main`],
      [`${"7".repeat(40)}\trefs/heads/main`]
    ] }
  );

  await assert.rejects(evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, git, { nonceFactory: () => "8".repeat(64) })), /namespace changed|no evidence/i);
  assert.equal(git.calls.filter((call) => call.args.includes("ls-remote")).length, 2);
  assert.equal(git.calls.filter((call) => call.args.includes("clone")).length, 1);
  assert.equal(git.calls.filter((call) => call.args.includes("log")).length, 0);
  await assert.rejects(access(fixture.outputPath), /ENOENT/);
});

test("a custom advertised ref is scanned and late namespace churn after scanning writes no evidence", async (context) => {
  const fixture = await setup(context, [{ name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" }]);
  const identity = fixture.challenge.configuredRemotes[0]!.canonicalIdentity;
  const main = "a".repeat(40);
  const pull = "b".repeat(40);
  const first = [`${main}\trefs/heads/main`, `${pull}\trefs/pull/17/head`];
  const git = new CompleteNamespaceGit({ [identity]: first }, {}, {
    [identity]: [first, first, [`${main}\trefs/heads/main`, `${"c".repeat(40)}\trefs/pull/17/head`]]
  });

  await assert.rejects(evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, git)), /namespace changed|no evidence/i);
  assert.deepEqual(
    git.calls.filter((call) => call.args.includes("log")).map((call) => call.args[call.args.indexOf("log") + 1]),
    [main, pull]
  );
  assert.equal(git.calls.filter((call) => call.args.includes("ls-remote")).length, 3);
  await assert.rejects(access(fixture.outputPath), /ENOENT/);
});

test("shallow, promisor, missing-object, and corrupt mirrors fail closed before history scanning", async (context) => {
  for (const [name, integrity] of Object.entries({
    shallow: { shallow: true }, promisor: { promisor: true }, missing: { missing: true }, corrupt: { corrupt: true }
  })) {
    const fixture = await setup(context, [{ name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" }]);
    const identity = fixture.challenge.configuredRemotes[0]!.canonicalIdentity;
    const outputPath = join(fixture.root, `${name}-output.json`);
    const git = new CompleteNamespaceGit({ [identity]: [`${"d".repeat(40)}\trefs/heads/main`] }, {}, {}, integrity);
    await assert.rejects(evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, git, { outputPath })), /shallow|promisor|missing|corrupt|incomplete/i);
    assert.equal(git.calls.filter((call) => call.args.includes("log")).length, 0);
    await assert.rejects(access(outputPath), /ENOENT/);
  }
});

test("production evaluation rejects local and private endpoints and DNS-pins public HTTPS without ambient credentials", async (context) => {
  const fixture = await setup(context, [{ name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" }]);
  const identity = fixture.challenge.configuredRemotes[0]!.canonicalIdentity;
  const head = "d".repeat(40);
  const publicGit = new CompleteNamespaceGit({ [identity]: [`${head}\trefs/heads/main`] });
  await evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, publicGit));
  assert.ok(publicGit.calls.every((call) => !call.args.some((arg) => /credential\.helper|extraheader/i.test(arg))));
  assert.ok(publicGit.calls.filter((call) => call.args.includes("ls-remote") || call.args.includes("clone"))
    .every((call) => call.args.includes("http.followRedirects=false") && call.args.includes("http.sslVerify=true") && call.args.includes("http.proxy=")));

  const privateOutput = join(fixture.root, "private-output.json");
  await assert.rejects(evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, new CompleteNamespaceGit({ [identity]: [] }), {
    outputPath: privateOutput,
    resolver: { async resolve() { return [{ address: "127.0.0.1", family: 4 as const }]; } }
  })), /public|private|loopback|address/i);
  await assert.rejects(access(privateOutput), /ENOENT/);

  await assert.rejects(evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, new CompleteNamespaceGit({ [identity]: [] }), {
    outputPath: join(fixture.root, "ipv6-output.json"),
    resolver: { async resolve() { return [{ address: "2606:50c0:8000::154", family: 6 as const }]; } }
  })), /IPv6|IPv4-only|pin encoding/i);

  const fileChallenge = {
    ...fixture.challenge,
    configuredRemotes: [{ name: "origin", canonicalIdentity: pathToFileURL(resolve(fixture.root, "remote.git")).href }],
    evaluationProfile: "production-public-https-v1" as const
  };
  const { id: _fileId, ...fileChallengeWithoutId } = fileChallenge;
  const exactFileChallenge = { ...fileChallengeWithoutId, id: containmentRemoteChallengeId(fileChallengeWithoutId) };
  const filePath = join(fixture.root, "file-production-challenge.json");
  await writeFile(filePath, JSON.stringify(exactFileChallenge), "utf8");
  await assert.rejects(evaluateContainmentRemoteChallenge({ ...evaluatorOptions(fixture, publicGit), challengePath: filePath, outputPath: join(fixture.root, "file-output.json") }), /production.*HTTPS|remote.*policy/i);
});

test("completion-time freshness is checked after scans and an expiring challenge writes no evidence", async (context) => {
  const fixture = await setup(context, [{ name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" }]);
  const identity = fixture.challenge.configuredRemotes[0]!.canonicalIdentity;
  const git = new CompleteNamespaceGit({ [identity]: [`${"e".repeat(40)}\trefs/heads/main`] });
  let call = 0;
  const ticks = [now, now, "2026-08-25T12:11:00.000Z"];
  await assert.rejects(evaluateContainmentRemoteChallenge(evaluatorOptions(fixture, git, {
    now: () => new Date(ticks[Math.min(call++, ticks.length - 1)]!)
  })), /fresh|expired|clock/i);
  await assert.rejects(access(fixture.outputPath), /ENOENT/);
});

test("pinned Git identity is rechecked and a timed-out child tree is terminated and bounded", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-evaluator-runner-test-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const executablePath = join(root, "git-test.exe");
  await writeFile(executablePath, "fixed-git-fixture", "utf8");
  const expectedSha256 = createHash("sha256").update("fixed-git-fixture").digest("hex");
  let terminatedPid: number | undefined;
  const child = new EventEmitter() as EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough };
  child.pid = 4242; child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let spawnedEnvironment: NodeJS.ProcessEnv | undefined;
  const previousToken = process.env.GITHUB_TOKEN; const previousSshAgent = process.env.SSH_AUTH_SOCK;
  process.env.GITHUB_TOKEN = secretValue; process.env.SSH_AUTH_SOCK = "ambient-agent";
  context.after(() => {
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previousToken;
    if (previousSshAgent === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = previousSshAgent;
  });
  const runner = new SpawnContainmentRemoteEvaluatorGitRunner({
    executablePath, expectedSha256, timeoutMs: 15, terminationWaitMs: 25,
    spawnProcess: ((_command: string, _args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => { spawnedEnvironment = options.env; return child; }) as never,
    async terminateProcessTree(pid) { terminatedPid = pid; queueMicrotask(() => child.emit("close", null)); }
  });
  const started = Date.now();
  await assert.rejects(runner.run(["--version"]), /process tree.*timeout|terminated/i);
  assert.equal(terminatedPid, 4242);
  assert.ok(Date.now() - started < 1_000, "timeout and process-tree wait must remain bounded");
  assert.equal(spawnedEnvironment?.GITHUB_TOKEN, undefined);
  assert.equal(spawnedEnvironment?.SSH_AUTH_SOCK, undefined);
  assert.equal(spawnedEnvironment?.HOME, undefined);
  assert.equal(spawnedEnvironment?.GIT_TERMINAL_PROMPT, "0");

  const survivor = new EventEmitter() as EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough };
  survivor.pid = 4343; survivor.stdout = new PassThrough(); survivor.stderr = new PassThrough();
  const failingCleanupRunner = new SpawnContainmentRemoteEvaluatorGitRunner({
    executablePath, expectedSha256, timeoutMs: 15, terminationWaitMs: 20,
    spawnProcess: (() => survivor) as never,
    async terminateProcessTree() { throw new Error("termination denied"); }
  });
  let cleanupMessage = "";
  await assert.rejects(failingCleanupRunner.run(["--version"]), (error: Error) => {
    cleanupMessage = error.message;
    return /cleanup failed.*closure were not both proven/i.test(error.message);
  });
  assert.doesNotMatch(cleanupMessage, /was terminated/i);

  await writeFile(executablePath, "changed-git-fixture", "utf8");
  await assert.rejects(runner.run(["--version"]), /changed.*pinned identity/i);
});

test("packaged CLI requires an explicit pinned Git executable and exposes no local-file test switch", async () => {
  let standardOutput = ""; let standardError = "";
  const stdout = process.stdout.write; const stderr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => { standardOutput += chunk.toString(); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { standardError += chunk.toString(); return true; }) as typeof process.stderr.write;
  try {
    assert.equal(await runContainmentRemoteEvaluatorCli(["--help"]), 0);
    assert.match(standardOutput, /--git-executable <absolute-pinned-git>/);
    assert.doesNotMatch(standardOutput, /file|local|test/i);
    assert.equal(await runContainmentRemoteEvaluatorCli(["--challenge", "C:\\challenge.json", "--private-key", "C:\\key.pem", "--output", "C:\\evidence.json"]), 2);
    assert.equal(await runContainmentRemoteEvaluatorCli(["--allow-test-file-remotes", "true"]), 2);
    assert.match(standardError, /pinned Git executable/i);
    standardError = "";
    const secretPath = join(tmpdir(), `b122-${secretValue}`);
    assert.equal(await runContainmentRemoteEvaluatorCli([
      "--challenge", join(secretPath, "challenge.json"),
      "--private-key", join(secretPath, "private-key.pem"),
      "--output", join(secretPath, "evidence.json"),
      "--git-executable", join(secretPath, "git.exe")
    ]), 1);
    assert.match(standardError, /evaluation failed/i);
    assert.doesNotMatch(standardError, new RegExp(secretValue));
    assert.doesNotMatch(standardError, /challenge\.json|private-key\.pem|evidence\.json|git\.exe/i);
  } finally { process.stdout.write = stdout; process.stderr.write = stderr; }
});

test("wrong keys, malformed or identity-drifted challenges, and output replacement all fail closed", async (context) => {
  const fixture = await setup(context, [{ name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" }]);
  const identity = fixture.challenge.configuredRemotes[0]!.canonicalIdentity;
  const head = "9".repeat(40);
  const git = new CompleteNamespaceGit({ [identity]: [`${head}\trefs/heads/main`] });

  const changedChallengePath = join(fixture.root, "changed-challenge.json");
  await writeFile(changedChallengePath, JSON.stringify({ ...fixture.challenge, generation: fixture.challenge.generation + 1 }), "utf8");
  await assert.rejects(evaluateContainmentRemoteChallenge({ ...evaluatorOptions(fixture, git),
    challengePath: changedChallengePath, outputPath: join(fixture.root, "changed-output.json")
  }), /challenge.*(?:identity|binding|schema)|exact binding/i);

  const malformedChallengePath = join(fixture.root, "open-challenge.json");
  await writeFile(malformedChallengePath, JSON.stringify({ ...fixture.challenge, untrustedRemote: "https://attacker.invalid/repo.git" }), "utf8");
  await assert.rejects(evaluateContainmentRemoteChallenge({ ...evaluatorOptions(fixture, git),
    challengePath: malformedChallengePath, outputPath: join(fixture.root, "malformed-output.json")
  }), /schema|binding.*invalid/i);

  const wrongKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const wrongKeyPath = join(fixture.root, "wrong-private.pem");
  await writeFile(wrongKeyPath, wrongKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  await assert.rejects(evaluateContainmentRemoteChallenge({ ...evaluatorOptions(fixture, git),
    privateKeyPath: wrongKeyPath, outputPath: join(fixture.root, "wrong-key-output.json")
  }), /does not match.*key ID/i);

  const rsaKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaKeyPath = join(fixture.root, "rsa-private.pem");
  await writeFile(rsaKeyPath, rsaKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  await assert.rejects(evaluateContainmentRemoteChallenge({ ...evaluatorOptions(fixture, git),
    privateKeyPath: rsaKeyPath, outputPath: join(fixture.root, "rsa-output.json")
  }), /P-256/i);

  const existingOutput = join(fixture.root, "existing-output.json");
  const marker = "do-not-overwrite-this-file";
  await writeFile(existingOutput, marker, "utf8");
  await assert.rejects(evaluateContainmentRemoteChallenge({ ...evaluatorOptions(fixture, git),
    outputPath: existingOutput, nonceFactory: () => "e".repeat(64)
  }), /already exists|not overwritten/i);
  assert.equal(await readFile(existingOutput, "utf8"), marker);

  await assert.rejects(evaluateContainmentRemoteChallenge({ ...evaluatorOptions(fixture, git), outputPath: fixture.challengePath }), /must not overwrite.*input/i);
  assert.deepEqual(JSON.parse(await readFile(fixture.challengePath, "utf8")), fixture.challenge);
  for (const output of ["changed-output.json", "malformed-output.json", "wrong-key-output.json", "rsa-output.json"]) {
    await assert.rejects(access(join(fixture.root, output)), /ENOENT/);
  }
});

test("explicit test-only file remote E2E scans real Git but produces non-importable redacted evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-remote-evaluator-git-"));
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  await mkdir(work, { recursive: true });
  const executablePath = await realpath(execFileSync(process.platform === "win32" ? "where.exe" : "which", ["git"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean)!);
  const executableDigest = createHash("sha256").update(await readFile(executablePath)).digest("hex");
  const git = new SpawnContainmentRemoteEvaluatorGitRunner({ executablePath, expectedSha256: executableDigest });
  await gitOk(git, ["init"], root);
  await gitOk(git, ["config", "credential.helper", "ambient-malicious-helper"], root);
  await gitOk(git, ["config", "url.https://attacker.invalid/.insteadOf", "https://github.com/"], root);
  const cleanCwd = join(root, "clean-network-cwd-probe");
  await mkdir(cleanCwd);
  const ambientProbe = await git.run(["config", "--local", "--get", "credential.helper"], { cwd: cleanCwd });
  assert.notEqual(ambientProbe.exitCode, 0, "clean network cwd and Git ceiling must not discover malicious parent local config");
  await gitOk(git, ["init", "-b", "main"], work);
  await gitOk(git, ["config", "user.name", "B122 Remote Evaluator Test"], work);
  await gitOk(git, ["config", "user.email", "b122@example.invalid"], work);
  await gitOk(git, ["config", "commit.gpgsign", "false"], work);
  await gitOk(git, ["config", "tag.gpgSign", "false"], work);
  await mkdir(join(work, "config"), { recursive: true });
  await mkdir(join(work, "credentials"), { recursive: true });
  await mkdir(join(work, "keys"), { recursive: true });
  await writeFile(join(work, "config", "token.env"), `api_key=${secretValue}\n`, "utf8");
  await writeFile(join(work, "credentials", "GITHUB_TOKEN.txt"), `GITHUB_TOKEN=github_pat_${"A".repeat(24)}\n`, "utf8");
  await writeFile(join(work, "keys", "deploy.pem"), "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-only\n", "utf8");
  await writeFile(join(work, "README.md"), "safe fixture\n", "utf8");
  await gitOk(git, ["add", "--", "config/token.env", "credentials/GITHUB_TOKEN.txt", "keys/deploy.pem", "README.md"], work);
  await gitOk(git, ["commit", "-m", "add historical credential fixture"], work);
  await gitOk(git, ["tag", "v1.0.0"], work);
  await rm(join(work, "config", "token.env"));
  await rm(join(work, "credentials", "GITHUB_TOKEN.txt"));
  await rm(join(work, "keys", "deploy.pem"));
  await gitOk(git, ["add", "-u", "--", "config/token.env", "credentials/GITHUB_TOKEN.txt", "keys/deploy.pem"], work);
  await gitOk(git, ["commit", "-m", "remove credential fixture"], work);
  await gitOk(git, ["init", "--bare", bare], root);
  const remoteIdentity = canonicalContainmentRemoteIdentity(pathToFileURL(bare).href);
  await gitOk(git, ["push", remoteIdentity, "refs/heads/main:refs/heads/main", "refs/tags/v1.0.0:refs/tags/v1.0.0"], work);

  const fixture = await setup(context, [{ name: "origin", canonicalIdentity: "https://github.com/acme/switchyard.git" }], executableDigest);
  const { id: _productionId, ...testChallengeWithoutId } = {
    ...fixture.challenge, configuredRemotes: [{ name: "origin", canonicalIdentity: remoteIdentity }],
    evaluationProfile: "test-local-file-v1" as const, networkPolicy: "test-local-file-no-network-v1" as const
  };
  const testChallenge = { ...testChallengeWithoutId, id: containmentRemoteChallengeId(testChallengeWithoutId) };
  await writeFile(fixture.challengePath, JSON.stringify(testChallenge), "utf8");
  const evidence = await evaluateContainmentRemoteChallenge({
    challengePath: fixture.challengePath, privateKeyPath: fixture.privateKeyPath,
    outputPath: fixture.outputPath, git, allowTestFileRemotes: true,
    now: () => new Date(now), nonceFactory: () => "f".repeat(64)
  });

  assert.equal(evidence.status, "failed");
  assert.equal(evidence.remoteResults.length, 1);
  assert.deepEqual(evidence.remoteResults[0]!.namespaceRefs.map((ref) => ref.ref), ["refs/heads/main", "refs/tags/v1.0.0"]);
  const pathDigests = ["config/token.env", "credentials/GITHUB_TOKEN.txt", "keys/deploy.pem"]
    .map((path) => createHash("sha256").update(path).digest("hex"));
  assert.ok(evidence.remoteResults[0]!.refResults.every((ref) => pathDigests.every((pathSha256) => ref.findings.some((finding) => finding.pathSha256 === pathSha256 && finding.relativePath === `redacted/${pathSha256}`))));
  assert.equal(evidence.toolManifest.evaluationProfile, "test-local-file-v1");
  assert.deepEqual(evidence.toolManifest.networkBindings, []);
  const serialized = await readFile(fixture.outputPath, "utf8");
  assert.doesNotMatch(serialized, /config\/token\.env|GITHUB_TOKEN|deploy\.pem/i);
  assert.doesNotMatch(serialized, new RegExp(secretValue));
  await assert.rejects(fixture.registry.importEvidence(fixture.outputPath, "TEST\\Security"), /challenge|production|test-local/i);
});

async function gitOk(git: SpawnContainmentRemoteEvaluatorGitRunner, args: readonly string[], cwd: string): Promise<string> {
  const result = await git.run(args, { cwd });
  assert.equal(result.exitCode, 0, `${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}
