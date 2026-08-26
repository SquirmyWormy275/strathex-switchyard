import assert from "node:assert/strict";
import test from "node:test";

import type { ContainmentAssessmentRequest } from "../../../packages/control-plane/src/containment-incidents.ts";
import { InstalledLocalContainmentAssessmentPort } from "../src/containment-assessment.ts";
import type { LocalGitResult, LocalGitRunner } from "../src/mediated-git.ts";

class FakeGit implements LocalGitRunner {
  readonly calls: readonly string[][] = [] as string[][];
  private readonly results: LocalGitResult[];
  constructor(results: LocalGitResult[]) { this.results = [...results]; }
  async run(args: readonly string[], options: Readonly<{ cwd: string }>): Promise<LocalGitResult> {
    (this.calls as string[][]).push([...args]);
    assert.equal(options.cwd.replaceAll("\\", "/"), "C:/work/example");
    const result = this.results.shift();
    if (!result) throw new Error("unexpected Git call");
    return result;
  }
}

const ok = (stdout = ""): LocalGitResult => ({ exitCode: 0, stdout, stderr: "" });

test("working-tree assessment scans only bounded Git-observed changed paths and never returns secret values", async () => {
  const git = new FakeGit([
    ok("src/a.ts\0config/local.env\0"),
    ok("private.key\0"),
    ok("config/local.env\0")
  ]);
  const port = new InstalledLocalContainmentAssessmentPort(git);
  const result = await port.execute(request("working_tree"));
  assert.equal(result.status, "failed");
  assert.equal(result.exposure, "found");
  assert.deepEqual(result.findings.map((finding) => finding.relativePath), ["config/local.env"]);
  assert.equal(result.findings[0]?.credentialRelated, true);
  assert.doesNotMatch(JSON.stringify(result), /private\.key/);
  assert.deepEqual(git.calls[2]?.slice(0, 5), ["grep", "--no-index", "-I", "-l", "-z"]);
  assert.equal(git.calls[2]?.includes("--"), true);
});

test("history scans only local branches and tags while remote assessment preserves remote unknown truth", async () => {
  const git = new FakeGit([
    ok("config/old.env\0"),
    ok("")
  ]);
  const port = new InstalledLocalContainmentAssessmentPort(git);
  const history = await port.execute(request("history"));
  const remote = await port.execute(request("remote"));
  assert.equal(history.status, "failed");
  assert.equal(history.exposure, "found");
  assert.equal(remote.status, "incomplete");
  assert.equal(remote.exposure, "unknown");
  assert.equal(git.calls[0]?.includes("--branches"), true);
  assert.equal(git.calls[0]?.includes("--tags"), true);
  assert.equal(git.calls[0]?.includes("--all"), false);
  assert.equal(git.calls[0]?.includes("--remotes"), false);
  assert.equal(git.calls[1]?.includes("--remotes"), true);
  assert.equal(git.calls[1]?.includes("--branches"), false);
  assert.equal(git.calls[1]?.includes("--tags"), false);
  assert.equal(git.calls.flat().some((argument) => argument === "fetch" || argument === "ls-remote"), false);
});

test("assessment fails closed on oversized path sets, unsafe paths, or Git failure", async () => {
  const tooMany = Array.from({ length: 257 }, (_, index) => `path-${index}.txt`).join("\0") + "\0";
  const cases = [
    new FakeGit([ok(tooMany), ok("")]),
    new FakeGit([ok("../outside\0"), ok("")]),
    new FakeGit([{ exitCode: 2, stdout: "", stderr: "token=ghp_1234567890abcdef" }])
  ];
  for (const git of cases) {
    const result = await new InstalledLocalContainmentAssessmentPort(git).execute(request("working_tree"));
    assert.equal(result.status, "incomplete");
    assert.equal(result.exposure, "unknown");
    assert.doesNotMatch(result.summary, /ghp_1234567890abcdef/);
  }
});

test("observation re-runs only the same read-only closed request", async () => {
  const git = new FakeGit([ok(""), ok(""), ok(""), ok("")]);
  const port = new InstalledLocalContainmentAssessmentPort(git);
  const input = request("working_tree");
  const first = await port.execute(input);
  const observed = await port.observe(input);
  assert.deepEqual(observed, first);
});

function request(step: "working_tree" | "history" | "remote"): ContainmentAssessmentRequest {
  return {
    schema: "sxsy-b122.containment-assessment-request",
    version: 1,
    incidentId: `containment-incident:${"1".repeat(64)}`,
    repositoryRoot: "C:/work/example",
    fenceEpoch: 3,
    step,
    operationId: `containment-assessment:${"2".repeat(64)}`,
    externalId: `containment-assessment:${"3".repeat(64)}`,
    egressAllowed: false,
    revealSecretValues: false
  };
}
