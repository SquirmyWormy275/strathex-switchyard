import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { commandForAction } from "../../../packages/control-plane/src/command-catalog.ts";
import {
  containmentIncidentReviewDigest,
  type ContainmentAssessmentEffectPort,
  type ContainmentAssessmentRequest,
  type ContainmentAssessmentResult,
  type ContainmentIncidentRecord,
  type DurableContainmentIncidentCoordinator
} from "../../../packages/control-plane/src/containment-incidents.ts";
import type { TargetResolver } from "../../../packages/control-plane/src/runtime.ts";
import type { SessionRegistry } from "../../../packages/control-plane/src/session-registry.ts";
import { stableJson } from "../../../packages/control-plane/src/store.ts";
import {
  canonicalContainmentRemoteIdentity,
  type ContainmentConfiguredRemote,
  type ContainmentRemoteEvidenceAdministration,
  type ContainmentRemoteEvidenceBinding,
  type ContainmentRemoteTrustPolicy,
  type DurableContainmentRemoteEvidenceRegistry,
  type ImportedContainmentRemoteEvidence,
  type InstalledContainmentRemoteChallenge,
  type InstalledContainmentRemoteTrust
} from "./containment-remote-evidence.ts";
import { SpawnLocalGitRunner, type LocalGitRunner } from "./mediated-git.ts";

const maximumConfiguredEndpoints = 16;
const exactDigestPattern = /^[a-f0-9]{64}$/;
const exactIncidentPattern = /^containment-incident:[a-f0-9]{64}$/;

export interface ContainmentRemoteChallengeSummary {
  readonly id: string;
  readonly incidentId: string;
  readonly generation: number;
  readonly targetSnapshotId: string;
  readonly configuredRemotes: readonly ContainmentConfiguredRemote[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly status: "active" | "used";
  readonly challengePath: string;
}

export interface ContainmentRemoteEvidenceSummary {
  readonly evidenceId: string;
  readonly challengeId: string;
  readonly documentSha256: string;
  readonly expiresAt: string;
  readonly status: "available" | "consumed";
}

export interface InstalledContainmentRemoteCoordinatorOptions {
  readonly policyVersion: string;
  readonly stateDirectory: string;
  readonly incidents: Pick<DurableContainmentIncidentCoordinator, "get">;
  readonly sessions: Pick<SessionRegistry, "get" | "list">;
  readonly targets: TargetResolver;
  readonly registry: DurableContainmentRemoteEvidenceRegistry;
  readonly administration: ContainmentRemoteEvidenceAdministration;
  readonly git?: LocalGitRunner;
  readonly now?: () => Date;
}

/**
 * Trusted installed composition for the remote assessment child. UI callers
 * can select only an incident and files; the host derives the live target,
 * generation, policy, configured endpoints, authority, and exact child IDs.
 */
export class InstalledContainmentRemoteCoordinator implements ContainmentAssessmentEffectPort {
  private readonly policyVersion: string;
  private readonly stateDirectory: string;
  private readonly incidents: InstalledContainmentRemoteCoordinatorOptions["incidents"];
  private readonly sessions: InstalledContainmentRemoteCoordinatorOptions["sessions"];
  private readonly targets: TargetResolver;
  private readonly registry: DurableContainmentRemoteEvidenceRegistry;
  private readonly administration: ContainmentRemoteEvidenceAdministration;
  private readonly git: LocalGitRunner;
  private readonly now: () => Date;

  constructor(options: InstalledContainmentRemoteCoordinatorOptions) {
    this.policyVersion = boundedIdentifier(options.policyVersion, "containment remote policy");
    this.stateDirectory = resolve(options.stateDirectory);
    this.incidents = options.incidents;
    this.sessions = options.sessions;
    this.targets = options.targets;
    this.registry = options.registry;
    this.administration = options.administration;
    this.git = options.git ?? new SpawnLocalGitRunner();
    this.now = options.now ?? (() => new Date());
  }

  async execute(request: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult> {
    if (request.step !== "remote") throw new Error("The installed remote coordinator accepts only the remote assessment child.");
    const binding = await this.bindingForRequest(request);
    if (!binding) return unresolved(request, "No active purpose-scoped signed remote-evidence authority is installed for the complete host-derived remote set.", "not_started");
    const observed = await this.registry.observe(binding);
    if (observed.state === "consumed" || observed.state === "not_required") return observed.result!;
    if (observed.state === "invalid") return unresolved(request, "Previously imported remote evidence is expired, revoked, or invalid; containment remains active.", "ambiguous");
    if (observed.state === "absent") return unresolved(request, "Signed complete-namespace remote evidence has not been imported for this exact assessment child.", "not_started");
    return (await this.registry.consume(binding)) ?? unresolved(request, "Signed complete-namespace remote evidence was not available at the durable consume boundary.", "not_started");
  }

  async observe(request: ContainmentAssessmentRequest): Promise<ContainmentAssessmentResult | undefined> {
    if (request.step !== "remote") return undefined;
    const binding = await this.bindingForRequest(request);
    if (!binding) return undefined;
    const observed = await this.registry.observe(binding);
    if (observed.state === "consumed" || observed.state === "not_required") return observed.result;
    if (observed.state === "available" || observed.state === "absent") return unresolved(request, "The signed remote-evidence effect did not start before recovery.", "not_started");
    return unresolved(request, "The signed remote-evidence effect cannot be reconciled because its trust or freshness is no longer valid.", "ambiguous");
  }

  installTrustPolicy(sourcePath: string): Promise<InstalledContainmentRemoteTrust> { return this.administration.installTrustPolicy(sourcePath); }
  listTrust(): Promise<readonly InstalledContainmentRemoteTrust[]> { return this.administration.listTrust(); }
  revokeTrust(authorityId: string, keyId: string, reason: string): Promise<InstalledContainmentRemoteTrust> { return this.administration.revokeTrust(authorityId, keyId, reason); }

  async issueChallenge(input: Readonly<{ sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string; expiresAt: string }>): Promise<ContainmentRemoteChallengeSummary> {
    const incident = await this.requireReviewedIncident(input);
    const request = remoteRequest(incident);
    const binding = await this.requireBinding(request, input.sessionId);
    const challenge = await this.administration.issueChallenge({ ...binding, expiresAt: exactTimestamp(input.expiresAt, "containment remote challenge expiry") });
    const challengePath = await this.writeChallenge(challenge);
    return { id: challenge.id, incidentId: challenge.incidentId, generation: challenge.generation, targetSnapshotId: challenge.targetSnapshotId, configuredRemotes: challenge.configuredRemotes, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt, status: "active", challengePath };
  }

  async listChallenges(): Promise<readonly ContainmentRemoteChallengeSummary[]> {
    const challenges = await this.administration.listChallenges();
    return Promise.all(challenges.map(async (challenge) => ({
      id: challenge.id, incidentId: challenge.incidentId, generation: challenge.generation, targetSnapshotId: challenge.targetSnapshotId,
      configuredRemotes: challenge.configuredRemotes, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt,
      status: challenge.status, challengePath: await this.writeChallenge(challenge)
    })));
  }

  async importEvidence(input: Readonly<{ sessionId: string; expectedIncidentId: string; expectedIncidentDigest: string; sourcePath: string }>): Promise<ContainmentRemoteEvidenceSummary> {
    const incident = await this.requireReviewedIncident(input);
    const binding = await this.requireBinding(remoteRequest(incident), input.sessionId);
    const imported = await this.administration.importEvidence(input.sourcePath);
    const observed = await this.registry.observe(binding);
    if (observed.state !== "available" || observed.evidenceId !== imported.evidenceId) throw new Error("The imported evidence is not bound to the exact current incident, generation, target, policy, and remote set.");
    return evidenceSummary(imported);
  }

  async listEvidence(): Promise<readonly ContainmentRemoteEvidenceSummary[]> { return (await this.administration.listEvidence()).map(evidenceSummary); }

  async validateRelease(input: Readonly<{ sessionId: string; incident: ContainmentIncidentRecord; expectedIncidentDigest: string }>): Promise<void> {
    if (containmentIncidentReviewDigest(input.incident) !== exactDigest(input.expectedIncidentDigest, "containment incident review")) throw new Error("The incident changed before final remote-evidence release validation.");
    const binding = await this.requireBinding(remoteRequest(input.incident), input.sessionId);
    if (binding.configuredRemotes.length === 0) {
      const observed = await this.registry.observe(binding);
      if (observed.state !== "not_required" || observed.result?.status !== "passed") throw new Error("The host-derived zero-remote release proof is unavailable.");
      return;
    }
    await this.registry.validateConsumedForRelease(binding);
  }

  private async bindingForRequest(request: ContainmentAssessmentRequest, sessionId?: string): Promise<ContainmentRemoteEvidenceBinding | undefined> {
    const incident = await this.incidents.get(request.incidentId);
    if (!incident) throw new Error("The remote assessment incident is unavailable.");
    assertRequestBinding(request, incident);
    const target = await this.currentTarget(incident, sessionId);
    const configuredRemotes = await this.configuredRemotes(target.repositoryRoot);
    const trust = configuredRemotes.length ? await this.activeTrust() : undefined;
    if (configuredRemotes.length && !trust) return undefined;
    return {
      request,
      generation: incident.assessment.generation,
      targetSnapshotId: target.id,
      policyVersion: this.policyVersion,
      authorityId: trust?.authorityId ?? "no-configured-remotes",
      keyId: trust?.keyId ?? "0".repeat(64),
      configuredRemotes
    };
  }

  private async requireBinding(request: ContainmentAssessmentRequest, sessionId: string): Promise<ContainmentRemoteEvidenceBinding> {
    const binding = await this.bindingForRequest(request, boundedIdentifier(sessionId, "containment remote session"));
    if (!binding) throw new Error("Install exactly one active purpose-scoped remote-evidence authority before issuing or importing signed evidence.");
    return binding;
  }

  private async currentTarget(incident: ContainmentIncidentRecord, sessionId?: string) {
    const candidates = sessionId ? [await this.sessions.get(sessionId)] : await this.sessions.list();
    const matching = candidates.filter((session): session is NonNullable<typeof session> => !!session && !!session.workspaceRoot
      && session.capabilities.includes("registered") && !["unknown", "stale", "unreachable"].includes(session.status)
      && samePath(session.workspaceRoot, incident.repositoryRoot));
    const exact = [];
    for (const session of matching) {
      const target = await this.targets.resolve({ definition: commandForAction("containment_release"), session });
      if (target?.completeness === "complete" && target.id === incident.assessment.targetSnapshotId && samePath(target.repositoryRoot, incident.repositoryRoot) && target.policyVersion === this.policyVersion) exact.push(target);
    }
    if (!exact.length || new Set(exact.map((target) => target.id)).size !== 1) throw new Error("No unique current complete TargetSnapshot matches the exact containment assessment generation.");
    return exact[0]!;
  }

  private async configuredRemotes(repositoryRoot: string): Promise<readonly ContainmentConfiguredRemote[]> {
    const root = await realpath(repositoryRoot);
    const top = await this.git.run(["rev-parse", "--show-toplevel"], { cwd: root });
    if (top.exitCode !== 0 || !samePath(await realpath(top.stdout.trim()), root)) throw new Error("The exact canonical repository root changed before remote inventory.");
    const listed = await this.git.run(["remote"], { cwd: root });
    if (listed.exitCode !== 0) throw new Error("The configured Git remote-name inventory is unavailable.");
    const names = listed.stdout.split(/\r?\n/).filter(Boolean).sort();
    if (names.length > maximumConfiguredEndpoints || new Set(names.map((name) => name.toLowerCase())).size !== names.length
      || names.some((name) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name))) throw new Error("The configured Git remote-name inventory is unsafe, duplicated, or unbounded.");
    const endpoints: { readonly sourceName: string; readonly identity: string }[] = [];
    for (const name of names) {
      const fetch = await this.git.run(["remote", "get-url", "--all", name], { cwd: root });
      const push = await this.git.run(["remote", "get-url", "--push", "--all", name], { cwd: root });
      if (fetch.exitCode !== 0 || push.exitCode !== 0) throw new Error("A configured Git remote endpoint inventory is unavailable.");
      const identities = [...fetch.stdout.split(/\r?\n/), ...push.stdout.split(/\r?\n/)].filter(Boolean).map(canonicalContainmentRemoteIdentity);
      if (!identities.length) throw new Error("A configured Git remote has no fixed credential-free endpoint identity.");
      for (const identity of [...new Set(identities)].sort()) endpoints.push({ sourceName: name, identity });
    }
    const unique = new Map<string, { sourceName: string; identity: string }>();
    for (const endpoint of endpoints) if (!unique.has(endpoint.identity.toLowerCase())) unique.set(endpoint.identity.toLowerCase(), endpoint);
    if (unique.size > maximumConfiguredEndpoints) throw new Error("The configured Git remote endpoint inventory exceeds its bound.");
    const perRemote = new Map<string, number>();
    for (const endpoint of unique.values()) perRemote.set(endpoint.sourceName, (perRemote.get(endpoint.sourceName) ?? 0) + 1);
    const ordinal = new Map<string, number>();
    return [...unique.values()].map((endpoint) => {
      const index = (ordinal.get(endpoint.sourceName) ?? 0) + 1;
      ordinal.set(endpoint.sourceName, index);
      return { name: perRemote.get(endpoint.sourceName) === 1 ? endpoint.sourceName : `${endpoint.sourceName}.endpoint-${index}`, canonicalIdentity: endpoint.identity };
    }).sort((left, right) => left.name.localeCompare(right.name));
  }

  private async activeTrust(): Promise<InstalledContainmentRemoteTrust | undefined> {
    const now = this.now().getTime();
    if (!Number.isFinite(now)) throw new Error("The containment remote host clock is invalid.");
    const active = (await this.registry.listTrust()).filter((trust) => trust.status === "active" && Date.parse(trust.expiresAt) > now);
    if (active.length > 1) throw new Error("More than one active purpose-scoped remote-evidence authority is installed.");
    return active[0];
  }

  private async requireReviewedIncident(input: Readonly<{ expectedIncidentId: string; expectedIncidentDigest: string }>): Promise<ContainmentIncidentRecord> {
    const incidentId = exactIncident(input.expectedIncidentId);
    const incident = await this.incidents.get(incidentId);
    if (!incident || containmentIncidentReviewDigest(incident) !== exactDigest(input.expectedIncidentDigest, "containment incident review") || incident.status === "released") throw new Error("The containment incident changed after remote-evidence review.");
    return incident;
  }

  private async writeChallenge(challenge: InstalledContainmentRemoteChallenge | Omit<InstalledContainmentRemoteChallenge, "issuedBy" | "status">): Promise<string> {
    const directory = join(this.stateDirectory, "challenges");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const fileId = challenge.id.replace(/^containment-remote-challenge:/, "");
    if (!/^[a-f0-9]{64}$/.test(fileId)) throw new Error("The remote-evidence challenge ID cannot name a host file safely.");
    const path = join(directory, `${fileId}.json`);
    const document = challengeDocument(challenge);
    try {
      if (await readFile(path, "utf8") === document) return path;
      throw new Error("The exported remote-evidence challenge path contains conflicting bytes.");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, document, { encoding: "utf8", mode: 0o600, flag: "wx" }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
    return path;
  }
}

function remoteRequest(incident: ContainmentIncidentRecord): ContainmentAssessmentRequest {
  const step = incident.steps.find((candidate) => candidate.name === "remote");
  if (!step) throw new Error("The containment incident has no exact remote assessment child.");
  return { schema: "sxsy-b122.containment-assessment-request", version: 1, incidentId: incident.id, repositoryRoot: incident.repositoryRoot, fenceEpoch: incident.fenceEpoch, step: "remote", operationId: step.operationId, externalId: step.externalId, egressAllowed: false, revealSecretValues: false };
}

function assertRequestBinding(request: ContainmentAssessmentRequest, incident: ContainmentIncidentRecord): void {
  const expected = remoteRequest(incident);
  if (request.schema !== expected.schema || request.version !== 1 || request.step !== "remote" || request.egressAllowed !== false || request.revealSecretValues !== false
    || request.incidentId !== expected.incidentId || !samePath(request.repositoryRoot, expected.repositoryRoot) || request.fenceEpoch !== expected.fenceEpoch
    || request.operationId !== expected.operationId || request.externalId !== expected.externalId) throw new Error("The remote assessment request changed its exact incident-generation child binding.");
}

function unresolved(request: ContainmentAssessmentRequest, summary: string, effectDisposition: "not_started" | "ambiguous"): ContainmentAssessmentResult {
  return { schema: "sxsy-b122.containment-assessment-result", version: 1, incidentId: request.incidentId, repositoryRoot: request.repositoryRoot, fenceEpoch: request.fenceEpoch, step: "remote", operationId: request.operationId, externalId: request.externalId, effectDisposition, status: "incomplete", exposure: "unknown", summary, findings: [] };
}

function evidenceSummary(value: ImportedContainmentRemoteEvidence): ContainmentRemoteEvidenceSummary { return { evidenceId: value.evidenceId, challengeId: value.challengeId, documentSha256: value.documentSha256, expiresAt: value.expiresAt, status: value.status }; }

function challengeDocument(value: InstalledContainmentRemoteChallenge | Omit<InstalledContainmentRemoteChallenge, "issuedBy" | "status">): string {
  const { issuedBy: _issuedBy, status: _status, evidenceId: _evidenceId, ...challenge } = value as InstalledContainmentRemoteChallenge;
  return `${stableJson(challenge)}\n`;
}

function samePath(left: string, right: string): boolean { return resolve(left).replaceAll("\\", "/").toLowerCase() === resolve(right).replaceAll("\\", "/").toLowerCase(); }
function exactIncident(value: unknown): string { if (typeof value !== "string" || !exactIncidentPattern.test(value)) throw new Error("The containment incident ID is invalid."); return value; }
function exactDigest(value: unknown, label: string): string { if (typeof value !== "string" || !exactDigestPattern.test(value)) throw new Error(`The ${label} digest is invalid.`); return value; }
function exactTimestamp(value: unknown, label: string): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`The ${label} timestamp is invalid.`); return value; }
function boundedIdentifier(value: unknown, label: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value)) throw new Error(`The ${label} is invalid.`); return value; }
