import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  ProtectedJsonStore,
  type JournalAuthenticator,
  type JournalEntry,
  type JsonStoreTransaction
} from "../../../packages/control-plane/src/store.ts";

export const councilEventKind = "provider-host.council";

export type CouncilPhase = "pause" | "assignment" | "resume";

export interface ProviderCouncilLease {
  readonly kind: string;
  readonly resource: string;
  readonly fence: number;
}

export type ProviderCouncilResourceHostCapability =
  | "held-loopback-port" | "disposable-cache-directory" | "disposable-temp-directory"
  | "sqlite-database" | "session-fenced-credential-capability";

export interface ProviderCouncilHostedResource {
  readonly leaseId: string;
  readonly kind: "port" | "cache" | "temp" | "database" | "credential_scope";
  readonly fence: number;
  readonly declaration: string;
  readonly bindingType: "loopback-listener" | "directory" | "sqlite" | "opaque-credential-capability";
  readonly value: string;
  readonly environmentName: string;
  readonly credentialExpiresAt?: number;
}

export interface ProviderCouncilResourceHost {
  readonly schema: "sxsy-b122.council-resource-host";
  readonly version: 1;
  readonly epochId: string;
  readonly sessionId: string;
  readonly fenceDigest: string;
  readonly capabilities: readonly ProviderCouncilResourceHostCapability[];
  readonly resources: readonly ProviderCouncilHostedResource[];
  readonly environment: Readonly<Record<string, string>>;
  readonly digest: string;
}

export interface ProviderCouncilRequest {
  readonly schema: "sxsy-b122.council-phase";
  readonly version: 1;
  readonly epochId: string;
  readonly phase: CouncilPhase;
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly repositoryRoot: string;
  readonly paths?: readonly string[];
  readonly resources?: readonly string[];
  readonly assignmentDigest?: string;
  readonly worktreeRoot?: string;
  readonly branch?: string;
  readonly head?: string;
  readonly leases?: readonly ProviderCouncilLease[];
  readonly resourceHost?: ProviderCouncilResourceHost;
}

export interface ProviderCouncilAcknowledgement {
  readonly schema: "sxsy-b122.council-ack";
  readonly version: 1;
  readonly epochId: string;
  readonly phase: CouncilPhase;
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly accepted: true;
  readonly assignmentDigest?: string;
  readonly resourceHostDigest?: string;
}

export interface ProviderCouncilCleanupRequest {
  readonly schema: "sxsy-b122.council-resource-cleanup";
  readonly version: 1;
  readonly epochId: string;
  readonly sessionId: string;
  readonly targetSnapshotId: string;
  readonly resourceHostDigest: string;
  readonly outcome: "completed" | "aborted" | "cancelled";
}

export interface ProviderCouncilCleanupAcknowledgement extends Omit<ProviderCouncilCleanupRequest, "schema"> {
  readonly schema: "sxsy-b122.council-resource-cleanup-ack";
  readonly closed: true;
}

export interface SavedCouncilPhase {
  readonly key: string;
  readonly provider: "claude" | "codex";
  readonly requestDigest: string;
  readonly request: ProviderCouncilRequest;
  readonly state: "submitted" | "acknowledged" | "unresolved";
  readonly acknowledgement?: ProviderCouncilAcknowledgement;
  readonly updatedAt: string;
}

class HmacJournalAuthenticator implements JournalAuthenticator {
  readonly provider = "provider-host-hmac-sha256-v1";
  private readonly key: Buffer;

  constructor(journalAuthenticationKey: string) {
    this.key = createHash("sha256").update("sxsy-b122.provider-host-state.v1\0", "utf8").update(journalAuthenticationKey, "ascii").digest();
  }

  async seal(hash: string): Promise<string> {
    return createHmac("sha256", this.key).update(hash, "ascii").digest("hex");
  }

  async verify(hash: string, authenticationTag: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(authenticationTag)) return false;
    const expected = Buffer.from(await this.seal(hash), "hex");
    const actual = Buffer.from(authenticationTag, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

export function createProviderHostStore(filePath: string, journalAuthenticationKey: string): ProtectedJsonStore {
  if (!/^[a-f0-9]{64}$/.test(journalAuthenticationKey)) throw new Error("The provider host journal authentication key must be exactly 256 canonical bits.");
  return new ProtectedJsonStore({
    filePath,
    authenticator: new HmacJournalAuthenticator(journalAuthenticationKey),
    requireAuthenticatedProtection: true
  });
}

export async function readCouncilPhases(source: ProtectedJsonStore | JsonStoreTransaction): Promise<Map<string, SavedCouncilPhase>> {
  const result = new Map<string, SavedCouncilPhase>();
  for (const entry of await source.readEntries()) {
    if (entry.kind !== councilEventKind) continue;
    const saved = parseSavedCouncil((entry as JournalEntry<unknown>).payload);
    result.set(saved.key, saved);
  }
  return result;
}

export function councilKey(request: Pick<ProviderCouncilRequest, "epochId" | "sessionId" | "phase">): string {
  return `${request.epochId}:${request.sessionId}:${request.phase}`;
}

function parseSavedCouncil(value: unknown): SavedCouncilPhase {
  if (!record(value) || !safeId(value.key) || (value.provider !== "claude" && value.provider !== "codex")
    || !digest(value.requestDigest) || !record(value.request)
    || (value.state !== "submitted" && value.state !== "acknowledged" && value.state !== "unresolved")
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("The protected provider Council journal is malformed.");
  }
  return value as unknown as SavedCouncilPhase;
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function safeId(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 800 && !/[\0\r\n]/.test(value); }
