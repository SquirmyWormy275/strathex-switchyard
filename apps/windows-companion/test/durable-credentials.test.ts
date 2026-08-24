import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  DurableCredentialReferenceVault,
  StdinCredentialSecretReader,
  type CredentialContainmentFence,
  type CredentialSecretReader
} from "../src/durable-credentials.ts";
import type { UserSecretProtector } from "../src/windows-secret.ts";

class OpaqueTestProtector implements UserSecretProtector {
  readonly provider = "opaque-test-protector";
  private readonly values = new Map<string, Uint8Array>();
  private sequence = 0;

  async seal(cleartext: Uint8Array): Promise<string> {
    const sealed = `opaque-test-envelope-${++this.sequence}`;
    this.values.set(sealed, new Uint8Array(cleartext));
    return sealed;
  }

  async open(sealed: string): Promise<Uint8Array> {
    const value = this.values.get(sealed);
    if (!value) throw new Error("Unknown opaque test envelope.");
    return new Uint8Array(value);
  }
}

class ToggleContainment implements CredentialContainmentFence {
  blocked = false;

  async check(_repositoryRoot: string, channel: "credential") {
    assert.equal(channel, "credential");
    return this.blocked
      ? { allowed: false, reason: "Test containment is active.", fenceEpoch: 2 }
      : { allowed: true, reason: "No test containment." };
  }
}

const scope = {
  repositoryRoot: join(tmpdir(), "sxsy-b122-owned-repository"),
  adapterId: "configured-network",
  purpose: "github-pr-upsert"
} as const;

async function fixture(context: test.TestContext, now = 1_000) {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-credentials-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const filePath = join(directory, "credential-references.jsonl");
  const protector = new OpaqueTestProtector();
  const containment = new ToggleContainment();
  const clock = { value: now };
  const create = () => new DurableCredentialReferenceVault(
    new ProtectedJsonStore({ filePath }),
    protector,
    containment,
    { now: () => clock.value, idFactory: () => `lease-${clock.value}` }
  );
  return { directory, filePath, protector, containment, clock, create, vault: create() };
}

test("credential references durably persist only protected values and atomic metadata events", async (context) => {
  const setup = await fixture(context);
  const secret = Buffer.from("super-secret-value-that-must-not-reach-disk", "utf8");
  await setup.vault.provision({ reference: "github-primary", scopes: [scope] }, secret);

  const persisted = await readFile(setup.filePath, "utf8");
  assert.equal(persisted.includes(secret.toString("utf8")), false);
  assert.equal(persisted.includes("opaque-test-envelope-1"), true);
  for (const line of persisted.trim().split(/\r?\n/)) assert.doesNotThrow(() => JSON.parse(line));

  const reopened = setup.create();
  const summaries = await reopened.listReferences();
  assert.equal(summaries.length, 1);
  assert.deepEqual({ ...summaries[0], scopes: undefined }, {
    reference: "github-primary",
    protectorProvider: "opaque-test-protector",
    generation: 1,
    createdAt: "1970-01-01T00:00:01.000Z",
    updatedAt: "1970-01-01T00:00:01.000Z",
    scopes: undefined
  });
  assert.equal(summaries[0]!.scopes[0]!.adapterId, scope.adapterId);
  assert.equal(summaries[0]!.scopes[0]!.purpose, scope.purpose);
  assert.match(summaries[0]!.scopes[0]!.repositoryRoot, /sxsy-b122-owned-repository$/i);
});

test("concurrent provisioning serializes without dropping credential-reference metadata", async (context) => {
  const setup = await fixture(context);
  await Promise.all(Array.from({ length: 8 }, (_, index) => setup.vault.provision({
    reference: `provider-${index}`,
    scopes: [{ ...scope, purpose: `purpose-${index}` }]
  }, Buffer.from(`isolated-secret-${index}`, "utf8"))));
  assert.equal((await setup.create().listReferences()).length, 8);
});

test("adapter capabilities redeem opaque leases once, honor expiry, and zero the opened value", async (context) => {
  const setup = await fixture(context);
  await setup.vault.provision({ reference: "github-primary", scopes: [scope] }, Buffer.from("ephemeral-token", "utf8"));
  const network = setup.vault.createAdapter(scope.adapterId);
  const wrongAdapter = setup.vault.createAdapter("different-adapter");
  const lease = await network.acquireLease({
    reference: "github-primary",
    repositoryRoot: scope.repositoryRoot,
    purpose: scope.purpose,
    ttlMs: 500
  });

  assert.deepEqual(Object.keys(lease).sort(), ["expiresAt", "id"]);
  assert.equal(JSON.stringify(lease).includes("github-primary"), false);
  await assert.rejects(() => wrongAdapter.redeem(lease, async () => undefined), /adapter capability/i);

  let observed: Uint8Array | undefined;
  const value = await network.redeem(lease, async (cleartext) => {
    observed = cleartext;
    return Buffer.from(cleartext).toString("utf8");
  });
  assert.equal(value, "ephemeral-token");
  assert.deepEqual([...observed!], Array(observed!.length).fill(0));
  await assert.rejects(() => network.redeem(lease, async () => undefined), /used, expired, or revoked/i);

  const expiring = await network.acquireLease({ reference: "github-primary", repositoryRoot: scope.repositoryRoot, purpose: scope.purpose, ttlMs: 100 });
  setup.clock.value += 101;
  await assert.rejects(() => network.redeem(expiring, async () => undefined), /used, expired, or revoked/i);
});

test("scope, durable revocation, and containment checks fail closed at lease issue and redemption", async (context) => {
  const setup = await fixture(context);
  await setup.vault.provision({ reference: "github-primary", scopes: [scope] }, Buffer.from("ephemeral-token", "utf8"));
  const network = setup.vault.createAdapter(scope.adapterId);
  await assert.rejects(() => network.acquireLease({ reference: "github-primary", repositoryRoot: scope.repositoryRoot, purpose: "wrong-purpose" }), /scope/i);

  setup.containment.blocked = true;
  await assert.rejects(() => network.acquireLease({ reference: "github-primary", repositoryRoot: scope.repositoryRoot, purpose: scope.purpose }), /containment/i);
  setup.containment.blocked = false;
  const lease = await network.acquireLease({ reference: "github-primary", repositoryRoot: scope.repositoryRoot, purpose: scope.purpose });
  setup.containment.blocked = true;
  await assert.rejects(() => network.redeem(lease, async () => undefined), /containment/i);

  setup.containment.blocked = false;
  assert.equal(await setup.vault.revoke("github-primary", "operator rotation"), true);
  assert.equal((await setup.create().listReferences())[0]?.revokedAt, "1970-01-01T00:00:01.000Z");
  await assert.rejects(() => network.acquireLease({ reference: "github-primary", repositoryRoot: scope.repositoryRoot, purpose: scope.purpose }), /revoked|unavailable/i);
});

test("stdin/injected provisioning has no secret argument and clears reader-owned bytes", async (context) => {
  const setup = await fixture(context);
  const stdin = Readable.from([Buffer.from("stdin-only-secret\r\n", "utf8")]);
  const reader = new StdinCredentialSecretReader(stdin);
  await setup.vault.provisionFromReader({ reference: "github-primary", scopes: [scope] }, reader);
  const network = setup.vault.createAdapter(scope.adapterId);
  const value = await network.withCredential({ reference: "github-primary", repositoryRoot: scope.repositoryRoot, purpose: scope.purpose }, async (secret) => Buffer.from(secret).toString("utf8"));
  assert.equal(value, "stdin-only-secret");

  const owned = Buffer.from("reader-owned-secret", "utf8");
  const injected: CredentialSecretReader = { readSecret: async () => owned };
  await setup.vault.provisionFromReader({ reference: "second", scopes: [scope] }, injected);
  assert.deepEqual([...owned], Array(owned.length).fill(0));
});
