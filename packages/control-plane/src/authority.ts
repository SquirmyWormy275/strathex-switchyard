import { randomUUID } from "node:crypto";
import type { AuthorityGrant } from "./contracts.ts";
import { jsonClone, type JournalEntry, ProtectedJsonStore } from "./store.ts";

export interface AuthorityIssue {
  readonly id?: string;
  readonly repositoryRoot: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly allowedActions: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly expiresAt: string;
  readonly issuedBy: string;
}

export interface AuthorityContext {
  readonly authorityId?: string;
  readonly repositoryRoot: string;
  readonly sessionId?: string;
  readonly taskId?: string;
  readonly planRevision?: string;
  readonly action: string;
  readonly now?: string;
}

export interface AuthorityDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly grant?: AuthorityGrant;
}

interface AuthorityIssuedEvent {
  readonly grant: AuthorityGrant;
}

interface AuthorityRevokedEvent {
  readonly authorityId: string;
  readonly revokedAt: string;
  readonly reason: string;
}

interface StoredAuthority {
  readonly grant: AuthorityGrant;
  readonly revokedAt?: string;
}

export class AuthorityLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityLedgerError";
  }
}

export class AuthorityDeniedError extends AuthorityLedgerError {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityDeniedError";
  }
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AuthorityLedgerError(`${field} must be non-empty.`);
  return normalized;
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new AuthorityLedgerError(`${field} must be a valid ISO timestamp.`);
  return parsed;
}

function normalizeRepository(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  // Drive-letter paths have Windows' case-insensitive semantics even when a
  // host-side test happens to execute them from a non-Windows process.
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function exactAction(action: string): string {
  const normalized = nonEmpty(action, "action");
  if (/[\s*?]/.test(normalized)) {
    throw new AuthorityLedgerError("Authority actions are exact names; wildcard or whitespace scopes are forbidden.");
  }
  return normalized;
}

function mapAuthorities(entries: readonly JournalEntry<unknown>[]): Map<string, StoredAuthority> {
  const grants = new Map<string, StoredAuthority>();
  for (const entry of entries) {
    if (entry.kind === "authority.issued") {
      const payload = entry.payload as AuthorityIssuedEvent;
      if (!payload?.grant || typeof payload.grant.id !== "string") throw new AuthorityLedgerError("Protected authority record is malformed.");
      grants.set(payload.grant.id, { grant: jsonClone(payload.grant) });
    }
    if (entry.kind === "authority.revoked") {
      const payload = entry.payload as AuthorityRevokedEvent;
      const existing = grants.get(payload?.authorityId);
      if (existing) grants.set(payload.authorityId, { ...existing, revokedAt: payload.revokedAt });
    }
  }
  return grants;
}

function materialize(stored: StoredAuthority): AuthorityGrant {
  return {
    ...stored.grant,
    ...(stored.revokedAt ? { revokedAt: stored.revokedAt } : {}),
    allowedActions: [...stored.grant.allowedActions],
    prohibitedActions: [...stored.grant.prohibitedActions]
  };
}

/**
 * The only local source of reusable authorization. This ledger deliberately
 * accepts neither repository content nor adapter output as grant material.
 */
export class AuthorityLedger {
  private readonly store: ProtectedJsonStore;
  private readonly clock: () => string;
  private readonly idFactory: () => string;

  constructor(store: ProtectedJsonStore, options: { readonly clock?: () => string; readonly idFactory?: () => string } = {}) {
    this.store = store;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async issue(input: AuthorityIssue): Promise<AuthorityGrant> {
    const issuedAt = this.clock();
    const expiresAt = input.expiresAt;
    if (parseTimestamp(expiresAt, "expiresAt") <= parseTimestamp(issuedAt, "issuedAt")) {
      throw new AuthorityLedgerError("Authority expiry must be later than issue time.");
    }
    const allowedActions = distinctActions(input.allowedActions);
    const prohibitedActions = distinctActions(input.prohibitedActions);
    const grant: AuthorityGrant = {
      id: nonEmpty(input.id ?? this.idFactory(), "authority id"),
      repositoryRoot: nonEmpty(input.repositoryRoot, "repositoryRoot"),
      ...(input.sessionId ? { sessionId: nonEmpty(input.sessionId, "sessionId") } : {}),
      ...(input.taskId ? { taskId: nonEmpty(input.taskId, "taskId") } : {}),
      ...(input.planRevision ? { planRevision: nonEmpty(input.planRevision, "planRevision") } : {}),
      allowedActions,
      prohibitedActions,
      expiresAt,
      issuedAt,
      issuedBy: nonEmpty(input.issuedBy, "issuedBy")
    };
    return this.store.transaction(async (transaction) => {
      const grants = mapAuthorities(await transaction.readEntries());
      if (grants.has(grant.id)) throw new AuthorityLedgerError(`Authority id already exists: ${grant.id}`);
      await transaction.append<AuthorityIssuedEvent>("authority.issued", { grant });
      return materialize({ grant });
    });
  }

  async get(authorityId: string): Promise<AuthorityGrant | undefined> {
    const stored = mapAuthorities(await this.store.readEntries()).get(authorityId);
    return stored ? materialize(stored) : undefined;
  }

  async list(): Promise<readonly AuthorityGrant[]> {
    return [...mapAuthorities(await this.store.readEntries()).values()].map(materialize);
  }

  async revoke(authorityId: string, reason: string): Promise<AuthorityGrant> {
    const revokedAt = this.clock();
    return this.store.transaction(async (transaction) => {
      const grants = mapAuthorities(await transaction.readEntries());
      const stored = grants.get(authorityId);
      if (!stored) throw new AuthorityLedgerError(`Unknown authority: ${authorityId}`);
      if (stored.revokedAt) return materialize(stored); // idempotent containment/revocation calls.
      await transaction.append<AuthorityRevokedEvent>("authority.revoked", {
        authorityId: nonEmpty(authorityId, "authorityId"),
        revokedAt,
        reason: nonEmpty(reason, "revocation reason")
      });
      return materialize({ ...stored, revokedAt });
    });
  }

  async revokeRepository(repositoryRoot: string, reason: string): Promise<readonly AuthorityGrant[]> {
    const expected = normalizeRepository(nonEmpty(repositoryRoot, "repositoryRoot"));
    const revokedAt = this.clock();
    return this.store.transaction(async (transaction) => {
      const grants = mapAuthorities(await transaction.readEntries());
      const revoked: AuthorityGrant[] = [];
      for (const stored of grants.values()) {
        if (stored.revokedAt || normalizeRepository(stored.grant.repositoryRoot) !== expected) continue;
        await transaction.append<AuthorityRevokedEvent>("authority.revoked", {
          authorityId: stored.grant.id,
          revokedAt,
          reason: nonEmpty(reason, "revocation reason")
        });
        revoked.push(materialize({ ...stored, revokedAt }));
      }
      return revoked;
    });
  }

  async evaluate(context: AuthorityContext): Promise<AuthorityDecision> {
    if (!context.authorityId) return { allowed: false, reason: "No authenticated authority grant was supplied." };
    const stored = mapAuthorities(await this.store.readEntries()).get(context.authorityId);
    if (!stored) return { allowed: false, reason: "The supplied authority grant is unknown." };
    const grant = materialize(stored);
    const now = context.now ?? this.clock();
    parseTimestamp(now, "evaluation timestamp");
    if (grant.revokedAt) return { allowed: false, reason: "The supplied authority grant has been revoked.", grant };
    if (Date.parse(grant.expiresAt) <= Date.parse(now)) return { allowed: false, reason: "The supplied authority grant has expired.", grant };
    if (normalizeRepository(grant.repositoryRoot) !== normalizeRepository(nonEmpty(context.repositoryRoot, "repositoryRoot"))) {
      return { allowed: false, reason: "The authority grant is scoped to a different repository.", grant };
    }
    for (const [label, required, actual] of [
      ["session", grant.sessionId, context.sessionId],
      ["task", grant.taskId, context.taskId],
      ["plan revision", grant.planRevision, context.planRevision]
    ] as const) {
      if (required !== undefined && required !== actual) {
        return { allowed: false, reason: `The authority grant is scoped to a different ${label}.`, grant };
      }
    }
    const action = exactAction(context.action);
    if (grant.prohibitedActions.includes(action)) return { allowed: false, reason: "The requested action is explicitly prohibited.", grant };
    if (!grant.allowedActions.includes(action)) return { allowed: false, reason: "The requested action is outside the grant's exact allowlist.", grant };
    return { allowed: true, reason: "The scoped authority grant permits this exact action.", grant };
  }

  async assertAuthorized(context: AuthorityContext): Promise<AuthorityGrant> {
    const decision = await this.evaluate(context);
    if (!decision.allowed || !decision.grant) throw new AuthorityDeniedError(decision.reason);
    return decision.grant;
  }
}

function distinctActions(actions: readonly string[]): readonly string[] {
  return [...new Set(actions.map(exactAction))];
}
