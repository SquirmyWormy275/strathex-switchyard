import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import {
  ConfiguredHttpsNetworkBroker,
  loadConfiguredNetworkPolicy,
  type NetworkAddressResolver,
  type NetworkContainmentFence,
  type PinnedNetworkTransport,
  type PinnedNetworkTransportRequest,
  type PinnedNetworkTransportResponse
} from "../src/configured-network.ts";
import { DurableCredentialReferenceVault, type CredentialContainmentFence } from "../src/durable-credentials.ts";
import type { UserSecretProtector } from "../src/windows-secret.ts";

class MemoryProtector implements UserSecretProtector {
  readonly provider = "network-test-protector";
  private readonly values = new Map<string, Uint8Array>();
  async seal(cleartext: Uint8Array): Promise<string> { const key = `sealed-${this.values.size + 1}`; this.values.set(key, new Uint8Array(cleartext)); return key; }
  async open(sealed: string): Promise<Uint8Array> { const value = this.values.get(sealed); if (!value) throw new Error("missing"); return new Uint8Array(value); }
}

class ToggleFence implements CredentialContainmentFence, NetworkContainmentFence {
  credentialBlocked = false;
  networkBlocked = false;
  async check(_root: string, channel: "credential" | "network") {
    const blocked = channel === "credential" ? this.credentialBlocked : this.networkBlocked;
    return blocked ? { allowed: false, reason: `${channel} containment active`, fenceEpoch: 4 } : { allowed: true, reason: "clear" };
  }
}

class FakeResolver implements NetworkAddressResolver {
  readonly addresses: readonly { address: string; family: 4 | 6 }[];
  constructor(addresses: readonly { address: string; family: 4 | 6 }[]) { this.addresses = addresses; }
  async resolve(): Promise<readonly { address: string; family: 4 | 6 }[]> { return this.addresses; }
}

class RecordingTransport implements PinnedNetworkTransport {
  readonly requests: PinnedNetworkTransportRequest[] = [];
  response: { status: number; headers: Record<string, string>; body: Uint8Array } = { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{\"ok\":true}") };
  async send(request: PinnedNetworkTransportRequest) {
    this.requests.push({ ...request, headers: { ...request.headers }, body: request.body ? new Uint8Array(request.body) : undefined });
    return this.response;
  }
}

const repositoryRoot = join(tmpdir(), "sxsy-b122-network-owned-repository");
const testCertificatePem = "-----BEGIN CERTIFICATE-----\nQQ==\n-----END CERTIFICATE-----\n";
const route = {
  id: "github-create-pr",
  method: "POST",
  url: "https://api.github.com/repos/example/repo/pulls",
  staticHeaders: { accept: "application/vnd.github+json", "content-type": "application/json" },
  credential: { reference: "github-primary", purpose: "github-pr-upsert", header: "authorization", prefix: "Bearer " },
  timeoutMs: 2_000,
  maxRequestBytes: 4_096,
  maxResponseBytes: 4_096,
  redirects: "deny"
} as const;

async function fixture(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-network-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const fence = new ToggleFence();
  const vault = new DurableCredentialReferenceVault(new ProtectedJsonStore({ filePath: join(directory, "credentials.jsonl") }), new MemoryProtector(), fence);
  await vault.provision({ reference: "github-primary", scopes: [{ repositoryRoot, adapterId: "configured-network", purpose: "github-pr-upsert" }] }, Buffer.from("network-only-token", "utf8"));
  const transport = new RecordingTransport();
  const broker = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [route] }, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), transport, fence, vault.createAdapter("configured-network"));
  return { directory, fence, vault, transport, broker };
}

test("configured HTTPS route pins public DNS and injects a scoped credential only at transport dispatch", async (context) => {
  const setup = await fixture(context);
  const response = await setup.broker.request({ routeId: route.id, repositoryRoot, body: "{\"title\":\"safe\"}" });
  assert.equal(response.outcome, "passed");
  assert.equal(response.status, 200);
  assert.equal(Buffer.from(response.body!).toString("utf8"), "{\"ok\":true}");
  assert.equal(setup.transport.requests.length, 1);
  const sent = setup.transport.requests[0]!;
  assert.equal(sent.url, route.url);
  assert.deepEqual(sent.resolvedAddress, { address: "93.184.216.34", family: 4 });
  assert.equal(sent.rejectUnauthorized, true);
  assert.equal(sent.proxy, "direct");
  assert.equal(sent.headers.authorization, "Bearer network-only-token");
  assert.equal(JSON.stringify(response).includes("network-only-token"), false);
});

test("network policy rejects non-HTTPS, credential-bearing URLs, query secrets, redirects, and mismatched routes", async (context) => {
  const setup = await fixture(context);
  for (const url of [
    "http://api.github.com/repos/example/repo/pulls",
    "https://user:pass@api.github.com/repos/example/repo/pulls",
    "https://api.github.com/repos/example/repo/pulls?access_token=secret"
  ]) {
    assert.throws(() => new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [{ ...route, url }] }, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), setup.transport, setup.fence), /HTTPS|credential|query/i);
  }
  assert.throws(() => new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "environment", routes: [route] } as never, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), setup.transport, setup.fence), /proxy/i);
  assert.equal((await setup.broker.request({ routeId: "missing", repositoryRoot })).outcome, "blocked");

  setup.transport.response = { status: 302, headers: { location: "https://example.com/redirect" }, body: Buffer.alloc(0) };
  const redirected = await setup.broker.request({ routeId: route.id, repositoryRoot });
  assert.equal(redirected.outcome, "blocked");
  assert.match(redirected.detail, /redirect/i);
});

test("private, loopback, mixed, empty, and malformed DNS answers fail before transport", async (context) => {
  const setup = await fixture(context);
  for (const addresses of [
    [{ address: "127.0.0.1", family: 4 as const }],
    [{ address: "10.0.0.8", family: 4 as const }],
    [{ address: "::1", family: 6 as const }],
    [{ address: "::ffff:a00:1", family: 6 as const }],
    [{ address: "93.184.216.34", family: 4 as const }, { address: "169.254.169.254", family: 4 as const }],
    [],
    [{ address: "not-an-address", family: 4 as const }]
  ]) {
    const transport = new RecordingTransport();
    const broker = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [route] }, new FakeResolver(addresses), transport, setup.fence, setup.vault.createAdapter("configured-network"));
    const result = await broker.request({ routeId: route.id, repositoryRoot });
    assert.equal(result.outcome, "blocked");
    assert.equal(transport.requests.length, 0);
  }
});

test("the final containment recheck and deadline stop effects after DNS resolution", async (context) => {
  const setup = await fixture(context);
  let networkChecks = 0;
  const lateFence: NetworkContainmentFence = {
    async check() {
      networkChecks += 1;
      return networkChecks >= 3 ? { allowed: false, reason: "late containment", fenceEpoch: 9 } : { allowed: true, reason: "clear" };
    }
  };
  const transport = new RecordingTransport();
  const fenced = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [route] }, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), transport, lateFence, setup.vault.createAdapter("configured-network"));
  assert.equal((await fenced.request({ routeId: route.id, repositoryRoot })).outcome, "blocked");
  assert.equal(transport.requests.length, 0);

  const slow: PinnedNetworkTransport = {
    send: async (request) => new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("Network request was cancelled.")), { once: true }))
  };
  const timed = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [{ ...route, id: "short-deadline", timeoutMs: 10 }] }, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), slow, setup.fence, setup.vault.createAdapter("configured-network"));
  const result = await timed.request({ routeId: "short-deadline", repositoryRoot });
  assert.equal(result.outcome, "blocked");
  assert.match(result.detail, /cancel/i);
});

test("primary and redirect DNS resolution obey cancellation and deadline even when a resolver never settles", async (context) => {
  const setup = await fixture(context);
  let primarySignal: AbortSignal | undefined;
  let rejectPrimary: ((error: Error) => void) | undefined;
  const neverPrimary: NetworkAddressResolver = {
    resolve: async (_hostname, signal) => {
      primarySignal = signal;
      return new Promise<readonly { address: string; family: 4 | 6 }[]>((_resolve, reject) => { rejectPrimary = reject; });
    }
  };
  const primaryTransport = new RecordingTransport();
  const primary = new ConfiguredHttpsNetworkBroker(
    { version: 1, proxy: "direct", routes: [{ ...route, id: "dns-deadline", timeoutMs: 20 }] },
    neverPrimary,
    primaryTransport,
    setup.fence,
    setup.vault.createAdapter("configured-network")
  );
  const primaryResult = await Promise.race([
    primary.request({ routeId: "dns-deadline", repositoryRoot }),
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500))
  ]);
  assert.notEqual(primaryResult, "hung", "a never-settling primary DNS lookup outlived the route deadline");
  assert.equal(typeof primaryResult === "string" ? primaryResult : primaryResult.outcome, "blocked");
  assert.equal(primarySignal?.aborted, true);
  assert.equal(primaryTransport.requests.length, 0);
  rejectPrimary?.(new Error("late primary DNS failure must be consumed"));
  await new Promise((resolve) => setTimeout(resolve, 10));

  const controller = new AbortController();
  const callerResolver: NetworkAddressResolver = { resolve: async () => new Promise(() => undefined) };
  const callerBroker = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [route] }, callerResolver, new RecordingTransport(), setup.fence, setup.vault.createAdapter("configured-network"));
  const callerRequest = callerBroker.request({ routeId: route.id, repositoryRoot, signal: controller.signal });
  controller.abort();
  const callerResult = await Promise.race([callerRequest, new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500))]);
  assert.notEqual(callerResult, "hung", "caller cancellation did not settle a never-resolving primary lookup");
  assert.equal(typeof callerResult === "string" ? callerResult : callerResult.outcome, "blocked");

  let resolution = 0;
  let redirectSignal: AbortSignal | undefined;
  let rejectRedirect: ((error: Error) => void) | undefined;
  const redirectResolver: NetworkAddressResolver = {
    resolve: async (_hostname, signal) => {
      resolution += 1;
      if (resolution === 1) return [{ address: "93.184.216.34", family: 4 }];
      redirectSignal = signal;
      return new Promise<readonly { address: string; family: 4 | 6 }[]>((_resolve, reject) => { rejectRedirect = reject; });
    }
  };
  const redirectRoute = {
    ...route,
    id: "dns-redirect-deadline",
    method: "GET",
    url: "https://api.github.com/repos/example/repo/actions/jobs/",
    pathParameter: { name: "jobId", pattern: "unsigned-decimal", suffix: "/logs" },
    timeoutMs: 20,
    redirects: "single-use-signed-download",
    redirectHosts: ["results.example.net"]
  } as const;
  const redirectRequests: PinnedNetworkTransportRequest[] = [];
  const redirectTransport: PinnedNetworkTransport = {
    async send(request) {
      redirectRequests.push(request);
      return { status: 302, headers: { location: "https://results.example.net/log.txt?sig=bounded" }, body: Buffer.alloc(0) };
    }
  };
  const redirectBroker = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [redirectRoute] }, redirectResolver, redirectTransport, setup.fence, setup.vault.createAdapter("configured-network"));
  const redirectResult = await Promise.race([
    redirectBroker.request({ routeId: redirectRoute.id, repositoryRoot, pathParameters: { jobId: "44" } }),
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 500))
  ]);
  assert.notEqual(redirectResult, "hung", "a never-settling redirect DNS lookup outlived the route deadline");
  assert.equal(typeof redirectResult === "string" ? redirectResult : redirectResult.outcome, "blocked");
  assert.equal(redirectSignal?.aborted, true);
  assert.equal(redirectRequests.length, 1, "redirect DNS cancellation must happen before a second transport effect");
  rejectRedirect?.(new Error("late redirect DNS failure must be consumed"));
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("containment rechecks, cancellation, timeout, and response caps fail closed with redacted details", async (context) => {
  const setup = await fixture(context);
  setup.fence.networkBlocked = true;
  assert.equal((await setup.broker.request({ routeId: route.id, repositoryRoot })).outcome, "blocked");
  assert.equal(setup.transport.requests.length, 0);

  setup.fence.networkBlocked = false;
  setup.fence.credentialBlocked = true;
  assert.equal((await setup.broker.request({ routeId: route.id, repositoryRoot })).outcome, "blocked");
  setup.fence.credentialBlocked = false;

  setup.transport.response = { status: 200, headers: {}, body: Buffer.alloc(route.maxResponseBytes + 1, 1) };
  assert.equal((await setup.broker.request({ routeId: route.id, repositoryRoot })).outcome, "blocked");

  const controller = new AbortController();
  controller.abort();
  assert.equal((await setup.broker.request({ routeId: route.id, repositoryRoot, signal: controller.signal })).outcome, "blocked");

  const failing: PinnedNetworkTransport = { send: async () => { throw new Error("token=network-only-token host failed"); } };
  const failed = await new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [route] }, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), failing, setup.fence, setup.vault.createAdapter("configured-network")).request({ routeId: route.id, repositoryRoot });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.detail.includes("network-only-token"), false);
});

test("policy loader validates host-owned configuration without contacting the network", async (context) => {
  const setup = await fixture(context);
  const filePath = join(setup.directory, "network-policy.json");
  await writeFile(filePath, JSON.stringify({ version: 1, proxy: "direct", routes: [route] }), { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
  assert.deepEqual(await loadConfiguredNetworkPolicy(filePath), { version: 1, proxy: "direct", routes: [route] });
  if (process.platform === "linux") {
    await chmod(filePath, 0o644);
    await assert.rejects(() => loadConfiguredNetworkPolicy(filePath), /unsafe/i);
  }
});

test("an install-owned provider route admits only an exact pinned literal loopback and preserves its explicit port", async (context) => {
  const setup = await fixture(context);
  const localRoute = {
    ...route,
    id: "provider.health",
    method: "GET",
    url: "https://127.0.0.1:4747/v1/b122/health",
    boundary: "provider-host-loopback",
    tlsSpkiSha256: "a".repeat(64),
    tlsCaCertificatePem: testCertificatePem
  } as const;
  const transport = new RecordingTransport();
  const broker = new ConfiguredHttpsNetworkBroker(
    { version: 1, proxy: "direct", routes: [localRoute] },
    new FakeResolver([{ address: "127.0.0.1", family: 4 }]),
    transport,
    setup.fence,
    setup.vault.createAdapter("configured-network")
  );
  assert.equal((await broker.request({ routeId: localRoute.id, repositoryRoot })).outcome, "passed");
  assert.equal(new URL(transport.requests[0]!.url).port, "4747");
  assert.equal(transport.requests[0]!.tlsSpkiSha256, localRoute.tlsSpkiSha256);
  assert.equal(transport.requests[0]!.tlsCaCertificatePem, testCertificatePem);

  for (const addresses of [
    [{ address: "127.0.0.2", family: 4 as const }],
    [{ address: "10.0.0.8", family: 4 as const }],
    [{ address: "127.0.0.1", family: 4 as const }, { address: "::1", family: 6 as const }]
  ]) {
    const rejectedTransport = new RecordingTransport();
    const rejected = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [localRoute] }, new FakeResolver(addresses), rejectedTransport, setup.fence, setup.vault.createAdapter("configured-network"));
    assert.equal((await rejected.request({ routeId: localRoute.id, repositoryRoot })).outcome, "blocked");
    assert.equal(rejectedTransport.requests.length, 0);
  }
});

test("loopback trust cannot be request-selected or generalized to private and local destinations", async (context) => {
  const setup = await fixture(context);
  const exact = {
    ...route,
    id: "provider.health",
    method: "GET",
    url: "https://127.0.0.1:4747/v1/b122/health",
    boundary: "provider-host-loopback" as const,
    tlsSpkiSha256: "a".repeat(64),
    tlsCaCertificatePem: testCertificatePem
  };
  const construct = (candidate: unknown) => new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [candidate] } as never, new FakeResolver([{ address: "127.0.0.1", family: 4 }]), setup.transport, setup.fence);
  for (const candidate of [
    { ...exact, boundary: undefined },
    { ...exact, boundary: "provider-host-loopback", tlsSpkiSha256: undefined },
    { ...exact, boundary: "provider-host-loopback", tlsCaCertificatePem: undefined },
    { ...exact, tlsSpkiSha256: "A".repeat(64) },
    { ...exact, url: "https://localhost:4747/v1/b122/health" },
    { ...exact, url: "https://127.0.0.1/v1/b122/health" },
    { ...exact, url: "https://10.0.0.8:4747/v1/b122/health" },
    { ...exact, id: "github.graphql" },
    { ...exact, redirects: "single-use-signed-download" }
  ]) assert.throws(() => construct(candidate), /loopback|SPKI|trust|boundary|redirect/i);

  const explicitPublicPort = { ...route, url: "https://api.github.com:8443/repos/example/repo/pulls" };
  const publicTransport = new RecordingTransport();
  const publicBroker = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [explicitPublicPort] }, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), publicTransport, setup.fence, setup.vault.createAdapter("configured-network"));
  assert.equal((await publicBroker.request({ routeId: route.id, repositoryRoot })).outcome, "passed");
  assert.equal(new URL(publicTransport.requests[0]!.url).port, "8443");
});

test("one reviewed numeric resource ID may extend an exact dynamic API path without changing its host or prefix", async (context) => {
  const setup = await fixture(context);
  const dynamic = {
    ...route,
    id: "github.actions-job-log",
    method: "GET",
    url: "https://api.github.com/repos/example/repo/actions/jobs/",
    pathParameter: { name: "jobId", pattern: "unsigned-decimal", suffix: "/logs" }
  } as const;
  const transport = new RecordingTransport();
  const broker = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [dynamic] }, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), transport, setup.fence, setup.vault.createAdapter("configured-network"));
  assert.equal((await broker.request({ routeId: dynamic.id, repositoryRoot, pathParameters: { jobId: "18446744073709551615" } })).outcome, "passed");
  assert.equal(transport.requests[0]?.url, "https://api.github.com/repos/example/repo/actions/jobs/18446744073709551615/logs");
  const invalidBindings: readonly Readonly<Record<string, string>>[] = [{}, { jobId: "0" }, { jobId: "01" }, { jobId: "1/../../secrets" }, { jobId: "1", extra: "2" }];
  for (const pathParameters of invalidBindings) {
    const before = transport.requests.length;
    assert.equal((await broker.request({ routeId: dynamic.id, repositoryRoot, pathParameters })).outcome, "blocked");
    assert.equal(transport.requests.length, before);
  }
  assert.equal((await setup.broker.request({ routeId: route.id, repositoryRoot, pathParameters: { jobId: "1" } })).outcome, "blocked");
  assert.throws(() => new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [{ ...dynamic, url: "https://api.github.com/repos/example/repo/actions/jobs?x=1" }] }, new FakeResolver([{ address: "93.184.216.34", family: 4 }]), transport, setup.fence), /slash|query/i);
});

test("Actions log downloads follow at most one credentialless redirect to one exact reviewed public host", async (context) => {
  const setup = await fixture(context);
  const dynamic = {
    ...route,
    id: "github.actions-job-log",
    method: "GET",
    url: "https://api.github.com/repos/example/repo/actions/jobs/",
    pathParameter: { name: "jobId", pattern: "unsigned-decimal", suffix: "/logs" },
    redirects: "single-use-signed-download",
    redirectHosts: ["results.example.net"]
  } as const;
  const requests: PinnedNetworkTransportRequest[] = [];
  const transport: PinnedNetworkTransport = { async send(request): Promise<PinnedNetworkTransportResponse> {
    requests.push({ ...request, headers: { ...request.headers } });
    return requests.length === 1
      ? { status: 302, headers: { location: "https://results.example.net/logs/job-44.txt?sig=ephemeral" }, body: Buffer.alloc(0) }
      : { status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("real job log") };
  } };
  const resolver = new FakeResolver([{ address: "93.184.216.34", family: 4 }]);
  const broker = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [dynamic] }, resolver, transport, setup.fence, setup.vault.createAdapter("configured-network"));
  const result = await broker.request({ routeId: dynamic.id, repositoryRoot, pathParameters: { jobId: "44" } });
  assert.equal(result.outcome, "passed");
  assert.equal(Buffer.from(result.body!).toString("utf8"), "real job log");
  assert.equal(requests[0]?.headers.authorization, "Bearer network-only-token");
  assert.deepEqual(requests[1]?.headers, {}, "the signed download receives no API credential or static headers");
  assert.equal(requests[1]?.url, "https://results.example.net/logs/job-44.txt?sig=ephemeral");

  for (const location of ["https://evil.example/log", "http://results.example.net/log", "https://results.example.net/log#fragment", "https://results.example.net/%2e%2e/secret"]) {
    let calls = 0;
    const rejectedTransport: PinnedNetworkTransport = { async send() { calls += 1; return { status: 302, headers: { location }, body: Buffer.alloc(0) }; } };
    const rejected = new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [dynamic] }, resolver, rejectedTransport, setup.fence, setup.vault.createAdapter("configured-network"));
    assert.equal((await rejected.request({ routeId: dynamic.id, repositoryRoot, pathParameters: { jobId: "44" } })).outcome, "blocked");
    assert.equal(calls, 1);
  }
  assert.throws(() => new ConfiguredHttpsNetworkBroker({ version: 1, proxy: "direct", routes: [{ ...dynamic, redirectHosts: ["*.example.net"] }] }, resolver, transport, setup.fence), /redirect host/i);
});
