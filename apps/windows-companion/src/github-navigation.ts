import type { AdapterRequest } from "../../../packages/control-plane/src/adapters.ts";
import { createDurableAbortControl, type DurableAbortControl } from "../../../packages/control-plane/src/execution-cancellation.ts";
import { untrustedSummary } from "../../../packages/control-plane/src/redaction.ts";
import type { DynamicConfiguredNetworkClient } from "./remote-adapters.ts";
import { configuredGitRepository, type ConfiguredGitHostIdentity } from "./remote-git.ts";

export type GitHubNavigationPage = "home" | "pr" | "issues" | "actions";

export interface GitHubNavigationCandidate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly url: string;
}

export type GitHubNavigationResolution =
  | Readonly<{ kind: "open"; url: string; summary: string }>
  | Readonly<{ kind: "picker"; candidates: readonly GitHubNavigationCandidate[]; summary: string }>
  | Readonly<{ kind: "blocked" | "failed" | "unavailable"; summary: string }>;

export interface GitHubNavigationResolver {
  resolve(request: AdapterRequest, page: GitHubNavigationPage): Promise<GitHubNavigationResolution>;
}

export interface GitHubNavigationHostResolver {
  resolve(): Promise<ConfiguredGitHostIdentity>;
}

interface PullCandidate {
  readonly number: number;
  readonly url: string;
  readonly headRepository: string;
  readonly headBranch: string;
  readonly head: string;
  readonly base: string;
  readonly updatedAt: string;
}

interface RunCandidate {
  readonly id: string;
  readonly url: string;
  readonly name: string;
  readonly timestamp: string;
}

/**
 * Read-only GitHub navigator. It resolves provider identity through the
 * installed exact-route policy, never by constructing a search URL and hoping
 * it points at the intended PR or workflow run.
 */
export class ConfiguredGitHubNavigationResolver implements GitHubNavigationResolver {
  constructor(private readonly network: DynamicConfiguredNetworkClient, private readonly hosts: GitHubNavigationHostResolver) {}

  async resolve(request: AdapterRequest, page: GitHubNavigationPage): Promise<GitHubNavigationResolution> {
    if (!request.operationId || !request.target?.canonicalRemote || !request.target.branch || !request.target.head || !request.effectGuard) {
      return { kind: "unavailable", summary: "GitHub navigation requires an exact durable operation, canonical remote, branch, HEAD, and final target guard." };
    }
    let host: ConfiguredGitHostIdentity;
    try { host = await this.hosts.resolve(); }
    catch { return { kind: "unavailable", summary: "GitHub navigation requires one exact installed GitHub or GitHub Enterprise route set." }; }
    const headRepository = configuredGitRepository(request.target.canonicalRemote, host);
    if (!headRepository || headRepository.owner.toLowerCase() !== host.headOwner.toLowerCase() || headRepository.name.toLowerCase() !== host.headName.toLowerCase()) {
      return { kind: "blocked", summary: "The canonical remote does not match the exact installed GitHub head repository." };
    }
    const admissionControl = await createDurableAbortControl(request.executionControl, { fallbackDeadline: new Date(Date.now() + 30_000).toISOString() });
    const cancelled = navigationCancellation(admissionControl, "GitHub navigation stopped while checking durable cancellation.");
    admissionControl.dispose();
    if (cancelled) return cancelled;
    const current = await request.effectGuard.assertCurrent({ action: request.definition.action, operationId: request.operationId, target: request.target, ...(request.session ? { session: request.session } : {}), ...(request.authority ? { authority: request.authority } : {}) });
    if (!current.allowed) return { kind: "blocked", summary: current.reason };
    if (page === "home") return { kind: "open", url: `https://${host.host}/${host.headOwner}/${host.headName}`, summary: "Resolved the exact installed workspace repository home." };
    if (page === "issues") return { kind: "open", url: `https://${host.host}/${host.headOwner}/${host.headName}/issues`, summary: "Resolved the exact installed workspace repository issues list." };
    return page === "pr" ? this.pullRequest(request, host) : this.actions(request, host);
  }

  private async pullRequest(request: AdapterRequest, host: ConfiguredGitHostIdentity): Promise<GitHubNavigationResolution> {
    const query = "query B122NavigatePull($owner:String!,$name:String!,$head:String!){repository(owner:$owner,name:$name){pullRequests(first:20,states:OPEN,headRefName:$head,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number url headRefName headRefOid headRepository{nameWithOwner} baseRefName state updatedAt}}}}";
    const response = await this.graphql(request, { query, variables: { owner: host.owner, name: host.name, head: request.target!.branch } });
    if ("kind" in response) return response;
    try {
      const pulls = parsePulls(response.data, host, request.target!.branch!);
      if (!pulls.length) return { kind: "open", url: repositoryUrl(host, host.owner, host.name, "pulls"), summary: `No open pull request exists for ${host.headOwner}/${host.headName}:${request.target!.branch}; opening the exact repository pull-request list.` };
      if (pulls.length === 1) {
        const pull = pulls[0]!;
        return { kind: "open", url: pull.url, summary: `Resolved pull request #${pull.number} for ${pull.headRepository}:${pull.headBranch} into ${host.owner}/${host.name}:${pull.base}.` };
      }
      return {
        kind: "picker",
        summary: `${pulls.length} exact open pull requests use ${host.headOwner}/${host.headName}:${request.target!.branch}; select one instead of guessing.`,
        candidates: pulls.map((pull) => ({ id: `pull:${pull.number}`, label: `PR #${pull.number} to ${pull.base}`, description: `${pull.headRepository}:${pull.headBranch} at ${pull.head.slice(0, 12)}`, url: pull.url }))
      };
    } catch { return { kind: "failed", summary: "GitHub returned an invalid current-branch pull-request result; no destination was opened." }; }
  }

  private async actions(request: AdapterRequest, host: ConfiguredGitHostIdentity): Promise<GitHubNavigationResolution> {
    const query = "query B122NavigateActions($owner:String!,$name:String!,$oid:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$oid){... on Commit{oid statusCheckRollup{contexts(first:50){nodes{__typename ... on CheckRun{name detailsUrl startedAt completedAt}}}}}}}}";
    const response = await this.graphql(request, { query, variables: { owner: host.headOwner, name: host.headName, oid: request.target!.head } });
    if ("kind" in response) return response;
    try {
      const runs = parseRuns(response.data, host, request.target!.head!);
      if (!runs.length) {
        return { kind: "open", url: `${repositoryUrl(host, host.headOwner, host.headName, "actions")}?query=branch%3A${encodeURIComponent(request.target!.branch!)}`, summary: `No GitHub Actions run was found for exact head ${request.target!.head}; opening the exact branch-filtered Actions list.` };
      }
      if (runs.length === 1) return { kind: "open", url: runs[0]!.url, summary: `Resolved the exact current-head Actions run ${runs[0]!.id} (${runs[0]!.name}).` };
      return {
        kind: "picker", summary: `${runs.length} workflow runs apply to the exact current head; select one instead of guessing.`,
        candidates: runs.map((run) => ({ id: `run:${run.id}`, label: run.name, description: `Actions run ${run.id} at ${run.timestamp}`, url: run.url }))
      };
    } catch { return { kind: "failed", summary: "GitHub returned invalid current-head Actions identities; no destination was opened." }; }
  }

  private async graphql(request: AdapterRequest, payload: Readonly<{ query: string; variables: Readonly<Record<string, unknown>> }>): Promise<Readonly<{ data: Record<string, unknown> }> | Extract<GitHubNavigationResolution, { kind: "blocked" | "failed" | "unavailable" }>> {
    const control = await createDurableAbortControl(request.executionControl, { fallbackDeadline: new Date(Date.now() + 30_000).toISOString() });
    const preflight = navigationCancellation(control, "GitHub navigation stopped before its provider read.");
    if (preflight) { control.dispose(); return preflight; }
    let response;
    try { response = await this.network.request({ routeId: "github.graphql", repositoryRoot: request.target!.repositoryRoot, body: JSON.stringify(payload), signal: control.signal }); }
    finally { control.dispose(); }
    const interrupted = navigationCancellation(control, "GitHub navigation stopped while its provider read was in flight.");
    if (interrupted) return interrupted;
    if (response.outcome !== "passed" || !response.body) {
      const kind = response.outcome === "blocked" ? "blocked" : response.outcome === "unavailable" ? "unavailable" : "failed";
      return { kind, summary: untrustedSummary(response.detail) };
    }
    try {
      const value: unknown = JSON.parse(Buffer.from(response.body).toString("utf8"));
      if (!record(value) || Object.keys(value).length !== 1 || !record(value.data)) throw new Error("invalid envelope");
      return { data: value.data };
    } catch { return { kind: "failed", summary: "GitHub returned malformed navigation JSON; no destination was opened." }; }
  }
}

function parsePulls(data: Record<string, unknown>, host: ConfiguredGitHostIdentity, branch: string): readonly PullCandidate[] {
  const repository = requiredRecord(data, "repository"); const pulls = requiredRecord(repository, "pullRequests");
  if (!Array.isArray(pulls.nodes) || pulls.nodes.length > 20) throw new Error("invalid pulls");
  const expectedHeadRepository = `${host.headOwner}/${host.headName}`.toLowerCase();
  const result: PullCandidate[] = [];
  for (const item of pulls.nodes) {
    if (!record(item) || !Number.isSafeInteger(item.number) || (item.number as number) < 1 || !record(item.headRepository)
      || item.state !== "OPEN" || item.headRefName !== branch || !oid(item.headRefOid) || !branchName(item.baseRefName)
      || item.headRepository.nameWithOwner !== `${host.headOwner}/${host.headName}` || !timestamp(item.updatedAt)) continue;
    const url = exactPullUrl(item.url, host, host.owner, host.name, item.number as number); if (!url) throw new Error("invalid URL");
    result.push({ number: item.number as number, url, headRepository: String(item.headRepository.nameWithOwner), headBranch: branch, head: String(item.headRefOid).toLowerCase(), base: String(item.baseRefName), updatedAt: String(item.updatedAt) });
  }
  const unique = new Set<number>();
  return result.filter((item) => item.headRepository.toLowerCase() === expectedHeadRepository && !unique.has(item.number) && !!unique.add(item.number)).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.number - right.number);
}

function parseRuns(data: Record<string, unknown>, host: ConfiguredGitHostIdentity, expectedHead: string): readonly RunCandidate[] {
  const repository = requiredRecord(data, "repository"); const object = requiredRecord(repository, "object");
  if (object.oid !== expectedHead) throw new Error("wrong head");
  const rollup = object.statusCheckRollup;
  if (rollup === null) return [];
  if (!record(rollup)) throw new Error("invalid rollup");
  const contexts = requiredRecord(rollup, "contexts");
  if (!Array.isArray(contexts.nodes) || contexts.nodes.length > 50) throw new Error("invalid contexts");
  const runs = new Map<string, RunCandidate>();
  for (const item of contexts.nodes) {
    if (!record(item) || item.__typename !== "CheckRun" || !bounded(item.name, 256)) continue;
    const run = exactActionsRun(item.detailsUrl, host, host.headOwner, host.headName);
    const at = timestamp(item.completedAt) ? String(item.completedAt) : timestamp(item.startedAt) ? String(item.startedAt) : undefined;
    if (!run || !at) continue;
    const prior = runs.get(run.id);
    if (!prior || Date.parse(at) > Date.parse(prior.timestamp)) runs.set(run.id, { ...run, name: String(item.name), timestamp: at });
  }
  return [...runs.values()].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp) || left.id.localeCompare(right.id)).slice(0, 20);
}

function exactPullUrl(value: unknown, host: ConfiguredGitHostIdentity, owner: string, name: string, number: number): string | undefined {
  try { const url = new URL(String(value)); return url.protocol === "https:" && url.hostname.toLowerCase() === host.host && !url.username && !url.password && !url.search && !url.hash && url.pathname.toLowerCase() === `/${owner}/${name}/pull/${number}`.toLowerCase() ? url.toString().replace(/\/$/, "") : undefined; } catch { return undefined; }
}
function exactActionsRun(value: unknown, host: ConfiguredGitHostIdentity, owner: string, name: string): { readonly id: string; readonly url: string } | undefined {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== host.host || url.username || url.password || url.search || url.hash) return undefined;
    const escaped = `/${owner}/${name}/actions/runs/`.toLowerCase(); const lower = url.pathname.toLowerCase();
    if (!lower.startsWith(escaped)) return undefined;
    const rest = url.pathname.slice(escaped.length); const match = /^(\d{1,20})(?:\/job\/\d{1,20})?\/?$/.exec(rest);
    if (!match) return undefined;
    return { id: match[1]!, url: `https://${host.host}/${owner}/${name}/actions/runs/${match[1]}` };
  } catch { return undefined; }
}
function repositoryUrl(host: ConfiguredGitHostIdentity, owner: string, name: string, page: "pulls" | "actions"): string { return `https://${host.host}/${owner}/${name}/${page}`; }
function requiredRecord(value: Record<string, unknown>, key: string): Record<string, unknown> { if (!record(value[key])) throw new Error("missing record"); return value[key]; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function bounded(value: unknown, maximum: number): value is string { return typeof value === "string" && !!value.trim() && value.length <= maximum && !/[\0\r\n]/.test(value); }
function branchName(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) && !value.includes("..") && !value.endsWith("/"); }
function oid(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value); }
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function navigationCancellation(control: DurableAbortControl, summary: string): Readonly<{ kind: "blocked" | "unavailable"; summary: string }> | undefined {
  const reason = control.reason();
  if (!reason) return undefined;
  return { kind: reason === "unavailable" ? "unavailable" : "blocked", summary };
}
