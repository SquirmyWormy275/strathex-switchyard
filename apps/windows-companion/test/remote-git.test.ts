import assert from "node:assert/strict";
import test from "node:test";

import type { GitRequest } from "../../../packages/control-plane/src/brokers.ts";
import { ConfiguredGitSmartHttpPusher, ConfiguredRemoteGitHandler, parseAdvertisement, receivePackSucceeded, type GitPackRunner, type ReviewedGitHubPort, type ReviewedRemotePusher } from "../src/remote-git.ts";
import type { DynamicConfiguredNetworkClient } from "../src/remote-adapters.ts";
import type { LocalGitRunner } from "../src/mediated-git.ts";

const pkt = (value: string): Buffer => { const body = Buffer.from(value); return Buffer.concat([Buffer.from((body.length + 4).toString(16).padStart(4, "0")), body]); };
const advertisement = (branch: string, head: string): Buffer => Buffer.concat([pkt("# service=git-receive-pack\n"), Buffer.from("0000"), pkt(`${head} HEAD\0report-status side-band-64k ofs-delta\n`), pkt(`${head} refs/heads/${branch}\n`), Buffer.from("0000")]);
const target = { id: "a".repeat(64), repositoryRoot: "C:\\repo", canonicalRemote: "https://github.com/acme/project.git", branch: "feat/test", head: "b".repeat(40), indexTree: "c".repeat(40), trackedManifest: "d".repeat(64), untrackedManifest: "e".repeat(64), submodules: {}, policyVersion: "v1", environmentFingerprint: "f".repeat(64), capturedAt: "2026-08-24T00:00:00.000Z", completeness: "complete" as const, reasons: [] };
const requestFor = (mutation: GitRequest["mutation"]): GitRequest => ({ action: mutation.kind === "pr_upsert" ? "pr_upsert" : mutation.kind === "merge_pr" ? "pr_merge" : mutation.kind === "direct_main" ? "direct_main" : "local_commit", operationId: "operation-1", target, mutation, effectGuard: { async assertCurrent() { return { allowed: true, reason: "current" }; } } });

test("Git receive-pack framing parses advertised refs and exact success", () => {
  const parsed = parseAdvertisement(advertisement("feat/test", target.head!));
  assert.equal(parsed.refs.get("refs/heads/feat/test"), target.head);
  assert.equal(parsed.capabilities.has("report-status"), true);
  const response = Buffer.concat([pkt("unpack ok\n"), pkt("ok refs/heads/feat/test\n"), Buffer.from("0000")]);
  assert.equal(receivePackSucceeded(response, "refs/heads/feat/test"), true);
  assert.equal(receivePackSucceeded(Buffer.concat([pkt("unpack ok\n"), pkt("ng refs/heads/feat/test denied\n"), Buffer.from("0000")]), "refs/heads/feat/test"), false);
});

test("smart HTTP push uses exact routes, no force, and verifies the remote head", async () => {
  const routes: string[] = [];
  const newHead = target.head!;
  const oldHead = "1".repeat(40);
  const network = { async request(input: { routeId: string }) { routes.push(input.routeId); if (input.routeId === "git.receive-pack") return { outcome: "passed", routeId: input.routeId, detail: "ok", body: Buffer.concat([pkt("unpack ok\n"), pkt("ok refs/heads/feat/test\n"), Buffer.from("0000")]) }; return { outcome: "passed", routeId: input.routeId, detail: "ok", body: advertisement("feat/test", routes.filter((route) => route === "git.receive-pack.advertise").length === 1 ? oldHead : newHead) }; } } as unknown as DynamicConfiguredNetworkClient;
  const commands: string[][] = [];
  const git: LocalGitRunner = { async run(args) { commands.push([...args]); return { exitCode: 0, stdout: "", stderr: "" }; } };
  const packer: GitPackRunner = { async pack(_root, head, exclude) { assert.equal(head, newHead); assert.equal(exclude, oldHead); return Buffer.from("PACK"); } };
  const pusher = new ConfiguredGitSmartHttpPusher(network, git, packer);
  const result = await pusher.push({ repositoryRoot: target.repositoryRoot, sourceHead: newHead, destinationBranch: "feat/test", request: requestFor({ kind: "pr_upsert", headBranch: "feat/test", baseBranch: "main" }) });
  assert.equal(result.status, "completed");
  assert.deepEqual(routes, ["git.receive-pack.advertise", "git.receive-pack", "git.receive-pack.advertise"]);
  assert.equal(commands.some((args) => args.includes("--force") || args.includes("--force-with-lease")), false);
});

test("reviewed remote Git handler pushes and upserts only the bound branch and head", async () => {
  const effects: string[] = [];
  const pusher: ReviewedRemotePusher = { async push(input) { effects.push(`push:${input.destinationBranch}:${input.sourceHead}`); return { status: "completed", summary: "pushed" }; } };
  const github: ReviewedGitHubPort = {
    async upsert(input) { effects.push(`pr:${input.headBranch}:${input.baseBranch}:${input.expectedHead}`); return { number: 12, url: "https://github.com/acme/project/pull/12", head: input.expectedHead, base: input.baseBranch, state: "OPEN" }; },
    async merge() { throw new Error("not used"); }, async defaultBranch() { return "main"; }
  };
  const result = await new ConfiguredRemoteGitHandler(pusher, github).execute(requestFor({ kind: "pr_upsert", headBranch: "feat/test", baseBranch: "main" }));
  assert.equal(result.status, "completed");
  assert.deepEqual(effects, [`push:feat/test:${target.head}`, `pr:feat/test:main:${target.head}`]);
  const wrong = await new ConfiguredRemoteGitHandler(pusher, github).execute(requestFor({ kind: "pr_upsert", headBranch: "other", baseBranch: "main" }));
  assert.equal(wrong.status, "blocked");
});

test("reviewed merge verifies the exact PR head and base through the provider port", async () => {
  const pusher: ReviewedRemotePusher = { async push() { throw new Error("not used"); } };
  const github: ReviewedGitHubPort = { async upsert() { throw new Error("not used"); }, async merge(input) { return { number: input.pullRequest, url: `https://github.com/acme/project/pull/${input.pullRequest}`, head: input.head, base: input.baseBranch, state: "MERGED" }; }, async defaultBranch() { return "main"; } };
  const result = await new ConfiguredRemoteGitHandler(pusher, github).execute(requestFor({ kind: "merge_pr", pullRequest: 9, head: target.head!, baseBranch: "main" }));
  assert.equal(result.status, "completed");
});
