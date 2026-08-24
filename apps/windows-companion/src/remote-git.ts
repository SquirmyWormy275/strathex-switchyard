import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { BrokerOutcome, GitRequest } from "../../../packages/control-plane/src/brokers.ts";
import { redactText } from "../../../packages/control-plane/src/redaction.ts";
import type { DynamicConfiguredNetworkClient } from "./remote-adapters.ts";
import { SpawnLocalGitRunner, type LocalGitRunner } from "./mediated-git.ts";

const zeroOid = "0".repeat(40);
const maximumPackBytes = 4 * 1024 * 1024;

export interface SmartPushResult { readonly status: BrokerOutcome["status"]; readonly summary: string; readonly oldHead?: string; readonly newHead?: string; }
export interface ReviewedRemotePusher { push(input: Readonly<{ repositoryRoot: string; sourceHead: string; destinationBranch: string; request: GitRequest }>): Promise<SmartPushResult>; }
export interface GitHubPullRequestResult { readonly number: number; readonly url: string; readonly head: string; readonly base: string; readonly state: "OPEN" | "MERGED" | "CLOSED"; readonly title: string; readonly body: string; }
export interface ReviewedGitHubPort {
  upsert(input: Readonly<{ repositoryRoot: string; owner: string; name: string; headBranch: string; baseBranch: string; expectedHead: string; title: string; body: string; request: GitRequest }>): Promise<GitHubPullRequestResult>;
  merge(input: Readonly<{ repositoryRoot: string; owner: string; name: string; pullRequest: number; head: string; baseBranch: string; request: GitRequest }>): Promise<GitHubPullRequestResult>;
  defaultBranch(input: Readonly<{ repositoryRoot: string; owner: string; name: string; request: GitRequest }>): Promise<string>;
}
export interface DirectMainReceiptVerifier { verify(receiptId: string, targetSnapshotId: string): Promise<boolean>; }
export interface ReviewedPullRequestHostOpener { open(request: GitRequest, url: string): Promise<BrokerOutcome>; }

/** Reviewed remote Git handler; policy, permit, containment, and ownership run in InMemoryGitBroker first. */
export class ConfiguredRemoteGitHandler {
  private readonly pusher: ReviewedRemotePusher;
  private readonly github: ReviewedGitHubPort;
  private readonly receipts?: DirectMainReceiptVerifier;
  private readonly hostOpener?: ReviewedPullRequestHostOpener;
  constructor(pusher: ReviewedRemotePusher, github: ReviewedGitHubPort, receipts?: DirectMainReceiptVerifier, hostOpener?: ReviewedPullRequestHostOpener) { this.pusher = pusher; this.github = github; this.receipts = receipts; this.hostOpener = hostOpener; }

  async execute(request: GitRequest): Promise<BrokerOutcome> {
    if (!request.effectGuard || !request.target.head || !request.target.branch || !request.target.canonicalRemote) return { status: "incomplete", summary: "Remote Git mediation requires a final effect guard and an exact branch, HEAD, and canonical remote." };
    const repository = githubRepository(request.target.canonicalRemote);
    if (!repository) return { status: "blocked", summary: "The configured GitHub adapter accepts only an exact github.com canonical remote." };
    const cancellation = await cancelled(request); if (cancellation) return cancellation;
    switch (request.mutation.kind) {
      case "pr_upsert": {
        if (request.mutation.headBranch !== request.target.branch || request.mutation.headBranch === request.mutation.baseBranch || !validBranch(request.mutation.headBranch) || !validBranch(request.mutation.baseBranch)) return { status: "blocked", summary: "The reviewed PR branches do not bind the current feature branch and a distinct base." };
        const pushed = await this.child(request, "git.push-reviewed-head", async () => this.pusher.push({ repositoryRoot: request.target.repositoryRoot, sourceHead: request.target.head!, destinationBranch: request.mutation.kind === "pr_upsert" ? request.mutation.headBranch : "", request }));
        if (pushed.status !== "completed") return pushed;
        const current = await finalEffect(request); if (current) return current;
        try {
          const pull = await this.child(request, "github.pr-upsert", async () => this.github.upsert({ repositoryRoot: request.target.repositoryRoot, ...repository, headBranch: request.mutation.kind === "pr_upsert" ? request.mutation.headBranch : "", baseBranch: request.mutation.kind === "pr_upsert" ? request.mutation.baseBranch : "", title: request.mutation.kind === "pr_upsert" ? request.mutation.title : "", body: request.mutation.kind === "pr_upsert" ? request.mutation.body : "", expectedHead: request.target.head!, request }));
          if ("status" in pull) return pull;
          if (this.hostOpener) {
            const opened = await this.hostOpener.open(request, pull.url);
            return { ...opened, data: { ...opened.data, pullRequest: pull.number, url: pull.url, head: pull.head, base: pull.base, state: pull.state } };
          }
          return { status: "completed", summary: "Pushed the exact reviewed head and verified the GitHub pull request against its head, base, title, and body.", data: { pullRequest: pull.number, url: pull.url, head: pull.head, base: pull.base, state: pull.state } };
        } catch (error) { return failed(error, "GitHub PR upsert failed closed."); }
      }
      case "merge_pr": {
        const current = await finalEffect(request); if (current) return current;
        try {
          const pull = await this.child(request, "github.pr-merge", async () => this.github.merge({ repositoryRoot: request.target.repositoryRoot, ...repository, pullRequest: request.mutation.kind === "merge_pr" ? request.mutation.pullRequest : 0, head: request.mutation.kind === "merge_pr" ? request.mutation.head : "", baseBranch: request.mutation.kind === "merge_pr" ? request.mutation.baseBranch : "", request }));
          if ("status" in pull) return pull;
          return pull.state === "MERGED" ? { status: "completed", summary: "GitHub merged the exact reviewed pull request head into the reviewed base.", data: { pullRequest: pull.number, url: pull.url, head: pull.head, base: pull.base, state: pull.state } } : { status: "incomplete", summary: "GitHub did not verify the pull request as merged after the mutation." };
        } catch (error) { return failed(error, "GitHub PR merge failed closed."); }
      }
      case "direct_main": {
        if (request.mutation.branch !== request.target.branch) return { status: "blocked", summary: "Direct Main source branch does not match the exact reviewed target branch." };
        if (!this.receipts || !await this.receipts.verify(request.mutation.validationReceiptId, request.target.id)) return { status: "blocked", summary: "Direct Main requires a fresh complete Release Shield receipt bound to this exact TargetSnapshot." };
        try {
          const base = await this.github.defaultBranch({ repositoryRoot: request.target.repositoryRoot, ...repository, request });
          if (base !== "main" && base !== "master") return { status: "blocked", summary: "Direct Main requires an exact GitHub default branch named main or master." };
          const pushed = await this.child(request, "git.direct-main", async () => this.pusher.push({ repositoryRoot: request.target.repositoryRoot, sourceHead: request.target.head!, destinationBranch: base, request }));
          return pushed.status === "completed" ? { status: "completed", summary: "Advanced the exact default branch without force after the high-consequence gate and reviewed receipt were admitted.", data: { branch: base, head: request.target.head } } : pushed;
        } catch (error) { return failed(error, "Direct Main failed closed."); }
      }
      case "local_commit": return { status: "unavailable", summary: "Local commit is owned by the private-index Git handler." };
    }
  }

  private async child<T extends SmartPushResult | GitHubPullRequestResult>(request: GitRequest, action: string, effect: () => Promise<T>): Promise<T | BrokerOutcome> {
    const saga = request.childSaga;
    const child = saga ? await saga.begin({ action, idempotencyScope: `${request.mutation.kind}:${action}`, details: { target: request.target.id } }) : undefined;
    if (child && !child.mayExecute) return { status: "incomplete", summary: "A prior remote Git child operation requires reconciliation and was not replayed." };
    if (child) await saga!.markExecuting(child);
    try {
      const result = await effect();
      const success = "state" in result ? (result.state === "OPEN" || result.state === "MERGED") : result.status === "completed";
      if (child && success) { await saga!.markExternalCommitted(child, { result: "verified" }); await saga!.settle(child, "completed", { result: "verified" }); }
      else if (child) await saga!.settle(child, "ambiguous", { result: "not-verified" });
      return result;
    } catch (error) {
      if (child) await saga!.settle(child, "ambiguous", { result: "threw" }).catch(() => undefined);
      throw error;
    }
  }
}

export class ConfiguredGitSmartHttpPusher implements ReviewedRemotePusher {
  private readonly network: DynamicConfiguredNetworkClient;
  private readonly git: LocalGitRunner;
  private readonly packer: GitPackRunner;
  constructor(network: DynamicConfiguredNetworkClient, git: LocalGitRunner = new SpawnLocalGitRunner(), packer: GitPackRunner = new SpawnGitPackRunner()) { this.network = network; this.git = git; this.packer = packer; }

  async push(input: Readonly<{ repositoryRoot: string; sourceHead: string; destinationBranch: string; request: GitRequest }>): Promise<SmartPushResult> {
    if (!/^[a-f0-9]{40}$/i.test(input.sourceHead) || !validBranch(input.destinationBranch)) return { status: "blocked", summary: "Smart HTTP push requires an exact commit and safe destination branch." };
    let advertisement = await this.advertise(input.repositoryRoot, input.request);
    if ("status" in advertisement) return advertisement;
    const ref = `refs/heads/${input.destinationBranch}`;
    const oldHead = advertisement.refs.get(ref) ?? zeroOid;
    if (oldHead === input.sourceHead) return { status: "completed", summary: "The exact reviewed head is already installed on the remote branch.", oldHead, newHead: input.sourceHead };
    if (oldHead !== zeroOid) {
      const ancestor = await this.git.run(["merge-base", "--is-ancestor", oldHead, input.sourceHead], { cwd: input.repositoryRoot });
      if (ancestor.exitCode !== 0) return { status: "blocked", summary: "The remote branch cannot be proven as an ancestor of the reviewed head; non-fast-forward push was refused." };
    }
    const check = await this.git.run(["cat-file", "-e", `${input.sourceHead}^{commit}`], { cwd: input.repositoryRoot });
    if (check.exitCode !== 0) return { status: "blocked", summary: "The reviewed push head is not an exact local commit object." };
    const pack = await this.packer.pack(input.repositoryRoot, input.sourceHead, oldHead === zeroOid ? undefined : oldHead);
    const current = await finalEffect(input.request); if (current) return { status: current.status, summary: current.summary };
    const capabilities = ["report-status", ...(advertisement.capabilities.has("side-band-64k") ? ["side-band-64k"] : []), ...(advertisement.capabilities.has("ofs-delta") ? ["ofs-delta"] : []), "agent=sxsy-b122/1.0"].join(" ");
    const command = packet(`${oldHead} ${input.sourceHead} ${ref}\0${capabilities}\n`);
    const body = Buffer.concat([command, Buffer.from("0000", "ascii"), pack]);
    if (body.byteLength > maximumPackBytes) { body.fill(0); pack.fill(0); return { status: "blocked", summary: "The reviewed Git pack exceeds the configured four-megabyte transport cap." }; }
    try {
      const control = await operationSignal(input.request);
      let result;
      try { result = await this.network.request({ routeId: "git.receive-pack", repositoryRoot: input.repositoryRoot, body, signal: control.signal }); }
      finally { control.dispose(); }
      if (result.outcome !== "passed" || !result.body || !receivePackSucceeded(result.body, ref)) return { status: result.outcome === "blocked" ? "blocked" : "incomplete", summary: "The Git receive-pack result did not verify an accepted ref update." };
    } finally { body.fill(0); pack.fill(0); }
    advertisement = await this.advertise(input.repositoryRoot, input.request);
    if ("status" in advertisement) return advertisement;
    return advertisement.refs.get(ref) === input.sourceHead ? { status: "completed", summary: "Verified the exact remote branch head after a no-force smart HTTP push.", oldHead, newHead: input.sourceHead } : { status: "incomplete", summary: "The remote branch did not verify the reviewed head after receive-pack." };
  }

  private async advertise(repositoryRoot: string, request: GitRequest): Promise<AdvertisedRefs | SmartPushResult> {
    const current = await finalEffect(request); if (current) return { status: current.status, summary: current.summary };
    const control = await operationSignal(request);
    let result;
    try { result = await this.network.request({ routeId: "git.receive-pack.advertise", repositoryRoot, signal: control.signal }); }
    finally { control.dispose(); }
    if (result.outcome !== "passed" || !result.body) return { status: result.outcome === "blocked" ? "blocked" : "unavailable", summary: "The exact Git receive-pack advertisement route is unavailable." };
    try { return parseAdvertisement(result.body); } catch (error) { return failed(error, "The Git receive-pack advertisement was invalid."); }
  }
}

export interface GitPackRunner { pack(repositoryRoot: string, head: string, exclude?: string): Promise<Buffer>; }
export class SpawnGitPackRunner implements GitPackRunner {
  private readonly candidates: readonly string[];
  constructor(candidates: readonly string[] = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"]) { if (!candidates.length || candidates.some((candidate) => !isAbsolute(candidate) || !candidate.toLowerCase().endsWith("git.exe"))) throw new Error("Git packer requires fixed absolute executables."); this.candidates = [...candidates]; }
  async pack(repositoryRoot: string, head: string, exclude?: string): Promise<Buffer> {
    const executable = await fixedExecutable(this.candidates);
    const revisions = Buffer.from(`${head}\n${exclude ? `^${exclude}\n` : ""}`, "ascii");
    return new Promise<Buffer>((resolveResult, rejectResult) => {
      const child = spawn(executable, ["pack-objects", "--stdout", "--revs", "--thin", "--delta-base-offset"], { cwd: repositoryRoot, shell: false, windowsHide: true, env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", WINDIR: process.env.WINDIR ?? "C:\\Windows", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"] });
      const chunks: Buffer[] = []; let bytes = 0; let error = "";
      child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes <= maximumPackBytes) chunks.push(Buffer.from(chunk)); else child.kill(); });
      child.stderr.on("data", (chunk: Buffer) => { if (error.length < 4096) error += chunk.toString("utf8").slice(0, 4096 - error.length); });
      child.once("error", () => rejectResult(new Error("The fixed Git packer could not start.")));
      child.once("close", (code) => code === 0 && bytes <= maximumPackBytes ? resolveResult(Buffer.concat(chunks)) : rejectResult(new Error(bytes > maximumPackBytes ? "The Git pack exceeded the transport cap." : `Git pack creation failed: ${redactText(error)}`)));
      child.stdin.end(revisions);
    });
  }
}

export class ConfiguredGitHubGraphqlPort implements ReviewedGitHubPort {
  private readonly network: DynamicConfiguredNetworkClient;
  constructor(network: DynamicConfiguredNetworkClient) { this.network = network; }
  async upsert(input: Readonly<{ repositoryRoot: string; owner: string; name: string; headBranch: string; baseBranch: string; expectedHead: string; title: string; body: string; request: GitRequest }>): Promise<GitHubPullRequestResult> {
    let pull = await this.lookup(input);
    if (pull && pull.head !== input.expectedHead) throw new Error("The open pull request head does not match the reviewed pushed head.");
    if (!pull) {
      const repository = await this.graphql(input, `query B122Repository($owner:String!,$name:String!){repository(owner:$owner,name:$name){id}}`, { owner: input.owner, name: input.name });
      const repositoryId = nestedString(repository, ["repository", "id"]);
      const created = await this.graphql(input, `mutation B122CreatePull($repositoryId:ID!,$base:String!,$head:String!,$title:String!,$body:String!){createPullRequest(input:{repositoryId:$repositoryId,baseRefName:$base,headRefName:$head,title:$title,body:$body}){pullRequest{id number url headRefOid headRefName baseRefName state title body}}}`, { repositoryId, base: input.baseBranch, head: input.headBranch, title: input.title, body: input.body });
      pull = parsePull(nestedRecord(created, ["createPullRequest", "pullRequest"]));
    } else if (pull.title !== input.title || pull.body !== input.body) {
      const updated = await this.graphql(input, `mutation B122UpdatePull($id:ID!,$title:String!,$body:String!){updatePullRequest(input:{pullRequestId:$id,title:$title,body:$body}){pullRequest{id number url headRefOid headRefName baseRefName state title body}}}`, { id: pull.id, title: input.title, body: input.body });
      pull = parsePull(nestedRecord(updated, ["updatePullRequest", "pullRequest"]));
    }
    const verified = await this.lookup(input);
    if (!verified || verified.number !== pull.number || verified.head !== input.expectedHead || verified.base !== input.baseBranch || verified.state !== "OPEN" || verified.title !== input.title || verified.body !== input.body) throw new Error("GitHub did not verify the exact open pull request after upsert.");
    return verified;
  }
  async merge(input: Readonly<{ repositoryRoot: string; owner: string; name: string; pullRequest: number; head: string; baseBranch: string; request: GitRequest }>): Promise<GitHubPullRequestResult> {
    const before = await this.lookupNumber(input);
    if (!before || before.number !== input.pullRequest || before.head !== input.head || before.base !== input.baseBranch || before.state !== "OPEN") throw new Error("The GitHub pull request no longer matches the reviewed head, base, and open state.");
    if (before.isDraft || before.mergeable !== "MERGEABLE" || before.mergeStateStatus !== "CLEAN"
      || (before.reviewDecision !== null && before.reviewDecision !== "APPROVED")
      || (before.checkState !== null && before.checkState !== "SUCCESS")) {
      throw new Error("The GitHub pull request has not proven current checks, review requirements, and mergeability.");
    }
    const current = await finalEffect(input.request); if (current) throw new Error(current.summary);
    await this.graphql(input, `mutation B122MergePull($id:ID!,$head:GitObjectID!){mergePullRequest(input:{pullRequestId:$id,expectedHeadOid:$head,mergeMethod:SQUASH}){pullRequest{id number url headRefOid headRefName baseRefName state title body}}}`, { id: before.id, head: input.head });
    const after = await this.lookupNumber(input);
    if (!after || after.state !== "MERGED" || after.head !== input.head || after.base !== input.baseBranch) throw new Error("GitHub did not verify the exact pull request as merged.");
    return after;
  }
  async defaultBranch(input: Readonly<{ repositoryRoot: string; owner: string; name: string; request: GitRequest }>): Promise<string> { const data = await this.graphql(input, `query B122DefaultBranch($owner:String!,$name:String!){repository(owner:$owner,name:$name){defaultBranchRef{name}}}`, { owner: input.owner, name: input.name }); return nestedString(data, ["repository", "defaultBranchRef", "name"]); }

  private async lookup(input: Readonly<{ repositoryRoot: string; owner: string; name: string; headBranch: string; baseBranch: string; request: GitRequest }>): Promise<(GitHubPullRequestResult & { readonly id: string }) | undefined> { const data = await this.graphql(input, `query B122Pull($owner:String!,$name:String!,$head:String!,$base:String!){repository(owner:$owner,name:$name){pullRequests(first:10,states:OPEN,headRefName:$head,baseRefName:$base){nodes{id number url headRefOid headRefName baseRefName state title body}}}}`, { owner: input.owner, name: input.name, head: input.headBranch, base: input.baseBranch }); const nodes = nestedArray(data, ["repository", "pullRequests", "nodes"]); if (nodes.length > 1) throw new Error("GitHub returned multiple open pull requests for the exact head and base."); return nodes.length ? parsePull(nodes[0]!) : undefined; }
  private async lookupNumber(input: Readonly<{ repositoryRoot: string; owner: string; name: string; pullRequest: number; request: GitRequest }>): Promise<GitHubMergePullRecord | undefined> { const data = await this.graphql(input, `query B122PullNumber($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id number url headRefOid headRefName baseRefName state title body isDraft mergeable mergeStateStatus reviewDecision commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}`, { owner: input.owner, name: input.name, number: input.pullRequest }); const value = nestedOptional(data, ["repository", "pullRequest"]); if (value === null || value === undefined) return undefined; if (!record(value)) throw new Error("GitHub pull request response is not a record."); return parseMergePull(value); }
  private async graphql(input: Readonly<{ repositoryRoot: string; request: GitRequest }>, query: string, variables: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> { const current = await finalEffect(input.request); if (current) throw new Error(current.summary); const control = await operationSignal(input.request); let result; try { result = await this.network.request({ routeId: "github.graphql", repositoryRoot: input.repositoryRoot, body: JSON.stringify({ query, variables }), signal: control.signal }); } finally { control.dispose(); } if (result.outcome !== "passed" || !result.body) throw new Error("The configured GitHub GraphQL route did not complete."); let parsed: unknown; try { parsed = JSON.parse(Buffer.from(result.body).toString("utf8")); } catch { throw new Error("GitHub returned malformed JSON."); } if (!record(parsed) || !exactRoot(parsed) || !record(parsed.data)) throw new Error("GitHub returned an invalid GraphQL envelope."); return parsed.data; }
}

interface AdvertisedRefs { readonly refs: ReadonlyMap<string, string>; readonly capabilities: ReadonlySet<string>; }
export function parseAdvertisement(input: Uint8Array): AdvertisedRefs { const packets = packetLines(input); const refs = new Map<string, string>(); const capabilities = new Set<string>(); for (const packetValue of packets) { const text = packetValue.toString("utf8").replace(/\n$/, ""); if (!text || text.startsWith("# service=")) continue; const nul = text.indexOf("\0"); const refPart = nul >= 0 ? text.slice(0, nul) : text; if (nul >= 0) for (const item of text.slice(nul + 1).split(" ")) if (item) capabilities.add(item); const match = /^([a-f0-9]{40}) (HEAD|refs\/[A-Za-z0-9._\/{\}-]+)$/.exec(refPart); if (!match) throw new Error("Receive-pack advertised an invalid ref record."); if (match[2] !== "HEAD") refs.set(match[2]!, match[1]!); } if (!capabilities.has("report-status")) throw new Error("Receive-pack does not advertise report-status."); return { refs, capabilities }; }
export function receivePackSucceeded(input: Uint8Array, ref: string): boolean { const text = packetLines(input).flatMap((line) => { const value = line[0] === 1 || line[0] === 2 || line[0] === 3 ? line.subarray(1) : line; try { return packetLines(value).map((nested) => nested.toString("utf8")); } catch { return [value.toString("utf8")]; } }).join(""); return /(?:^|\n)unpack ok\n/.test(`\n${text}`) && text.includes(`ok ${ref}\n`) && !/(?:^|\n)(?:ng |unpack (?!ok))/m.test(text); }
function packet(data: string): Buffer { const bytes = Buffer.from(data, "utf8"); const length = (bytes.length + 4).toString(16).padStart(4, "0"); return Buffer.concat([Buffer.from(length, "ascii"), bytes]); }
function packetLines(input: Uint8Array): readonly Buffer[] { const source = Buffer.from(input); const result: Buffer[] = []; let offset = 0; while (offset < source.length) { if (offset + 4 > source.length) throw new Error("Truncated pkt-line header."); const length = Number.parseInt(source.subarray(offset, offset + 4).toString("ascii"), 16); if (!Number.isFinite(length)) throw new Error("Invalid pkt-line length."); offset += 4; if (length === 0) continue; if (length < 4 || offset + length - 4 > source.length) throw new Error("Invalid pkt-line frame."); result.push(source.subarray(offset, offset + length - 4)); offset += length - 4; } return result; }
function githubRepository(remote: string): { readonly owner: string; readonly name: string } | undefined { const cleaned = remote.trim().replace(/\.git$/i, ""); const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i.exec(cleaned); return match ? { owner: match[1]!, name: match[2]! } : undefined; }
function validBranch(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) && !value.includes("..") && !value.endsWith("/") && !value.startsWith("-"); }
async function fixedExecutable(candidates: readonly string[]): Promise<string> { for (const candidate of candidates) try { if ((await stat(candidate)).isFile()) return realpath(candidate); } catch { /* continue */ } throw new Error("A trusted absolute Git executable is unavailable."); }
async function finalEffect(request: GitRequest): Promise<BrokerOutcome | undefined> { const cancellation = await cancelled(request); if (cancellation) return cancellation; const result = await request.effectGuard!.assertCurrent({ action: request.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) }); return result.allowed ? undefined : { status: "incomplete", summary: result.reason }; }
async function cancelled(request: GitRequest): Promise<BrokerOutcome | undefined> { if (!request.executionControl) return undefined; if (Date.parse(request.executionControl.deadline) <= Date.now()) return { status: "timed_out", summary: "Remote Git operation exceeded its durable deadline." }; if (await request.executionControl.isCancellationRequested()) return { status: "cancelled", summary: "Remote Git operation was cancelled before the next external effect." }; return undefined; }
async function operationSignal(request: GitRequest): Promise<{ readonly signal: AbortSignal; dispose(): void }> { const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let poll: ReturnType<typeof setInterval> | undefined; const cancelledBefore = await cancelled(request); if (cancelledBefore) controller.abort(); else if (request.executionControl) { const remaining = Date.parse(request.executionControl.deadline) - Date.now(); timer = setTimeout(() => controller.abort(), Math.max(0, remaining)); poll = setInterval(() => { void request.executionControl!.isCancellationRequested().then((value) => { if (value) controller.abort(); }); }, 100); poll.unref?.(); timer.unref?.(); } return { signal: controller.signal, dispose() { if (timer) clearTimeout(timer); if (poll) clearInterval(poll); } }; }
function failed(error: unknown, fallback: string): BrokerOutcome { return { status: "failed", summary: redactText(error instanceof Error ? error.message : fallback).slice(0, 512) }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactRoot(value: Record<string, unknown>): boolean { const keys = Object.keys(value); return keys.length === 1 && keys[0] === "data"; }
function nestedOptional(value: unknown, path: readonly string[]): unknown { let current = value; for (const key of path) { if (!record(current) || !(key in current)) throw new Error("GitHub response omitted a required field."); current = current[key]; } return current; }
function nestedRecord(value: unknown, path: readonly string[]): Record<string, unknown> { const result = nestedOptional(value, path); if (!record(result)) throw new Error("GitHub response field is not a record."); return result; }
function nestedString(value: unknown, path: readonly string[]): string { const result = nestedOptional(value, path); if (typeof result !== "string" || !result || result.length > 512) throw new Error("GitHub response field is not a bounded string."); return result; }
function nestedArray(value: unknown, path: readonly string[]): readonly Record<string, unknown>[] { const result = nestedOptional(value, path); if (!Array.isArray(result) || result.length > 20 || !result.every(record)) throw new Error("GitHub response field is not a bounded record array."); return result; }
function parsePull(value: Record<string, unknown>): GitHubPullRequestResult & { readonly id: string } {
  const keys = Object.keys(value);
  if (keys.length !== 9 || !["id", "number", "url", "headRefOid", "headRefName", "baseRefName", "state", "title", "body"].every((key) => key in value)
    || typeof value.id !== "string" || !Number.isSafeInteger(value.number) || (value.number as number) <= 0
    || typeof value.url !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(value.url)
    || typeof value.headRefOid !== "string" || !/^[a-f0-9]{40}$/i.test(value.headRefOid)
    || typeof value.headRefName !== "string" || !validBranch(value.headRefName)
    || typeof value.baseRefName !== "string" || !validBranch(value.baseRefName)
    || (value.state !== "OPEN" && value.state !== "MERGED" && value.state !== "CLOSED")
    || typeof value.title !== "string" || !value.title.trim() || value.title.length > 256 || /[\r\n\0]/.test(value.title)
    || typeof value.body !== "string" || value.body.length > 16_384 || /\0/.test(value.body)) {
    throw new Error("GitHub returned an invalid exact pull-request record.");
  }
  return { id: value.id, number: value.number as number, url: value.url, head: value.headRefOid, base: value.baseRefName, state: value.state, title: value.title, body: value.body };
}

interface GitHubMergePullRecord extends GitHubPullRequestResult {
  readonly id: string;
  readonly isDraft: boolean;
  readonly mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  readonly mergeStateStatus: "BEHIND" | "BLOCKED" | "CLEAN" | "DIRTY" | "DRAFT" | "HAS_HOOKS" | "UNKNOWN" | "UNSTABLE";
  readonly reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  readonly checkState: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED" | null;
}

function parseMergePull(value: Record<string, unknown>): GitHubMergePullRecord {
  const baseKeys = ["id", "number", "url", "headRefOid", "headRefName", "baseRefName", "state", "title", "body"];
  const keys = Object.keys(value);
  if (keys.length !== 14 || ![...baseKeys, "isDraft", "mergeable", "mergeStateStatus", "reviewDecision", "commits"].every((key) => key in value)) throw new Error("GitHub returned an invalid merge-readiness record.");
  const base = parsePull(Object.fromEntries(baseKeys.map((key) => [key, value[key]])));
  if (typeof value.isDraft !== "boolean" || !["MERGEABLE", "CONFLICTING", "UNKNOWN"].includes(String(value.mergeable))
    || !["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"].includes(String(value.mergeStateStatus))
    || (value.reviewDecision !== null && !["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(String(value.reviewDecision)))) {
    throw new Error("GitHub returned invalid merge readiness state.");
  }
  const commits = nestedArray(value, ["commits", "nodes"]);
  if (commits.length !== 1) throw new Error("GitHub did not return one exact reviewed head commit.");
  const rollup = nestedOptional(commits[0], ["commit", "statusCheckRollup"]);
  let checkState: GitHubMergePullRecord["checkState"] = null;
  if (rollup !== null) {
    if (!record(rollup) || Object.keys(rollup).length !== 1 || !["SUCCESS", "FAILURE", "PENDING", "ERROR", "EXPECTED"].includes(String(rollup.state))) throw new Error("GitHub returned invalid status-check readiness.");
    checkState = rollup.state as Exclude<GitHubMergePullRecord["checkState"], null>;
  }
  return { ...base, isDraft: value.isDraft, mergeable: value.mergeable as GitHubMergePullRecord["mergeable"], mergeStateStatus: value.mergeStateStatus as GitHubMergePullRecord["mergeStateStatus"], reviewDecision: value.reviewDecision as GitHubMergePullRecord["reviewDecision"], checkState };
}
