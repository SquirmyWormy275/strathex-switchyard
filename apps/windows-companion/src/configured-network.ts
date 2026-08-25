import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { readFile } from "node:fs/promises";
import { checkServerIdentity, type PeerCertificate } from "node:tls";

import type { ContainmentCheck } from "../../../packages/control-plane/src/containment.ts";
import type { EffectDisposition } from "../../../packages/control-plane/src/contracts.ts";
import { redactText } from "../../../packages/control-plane/src/redaction.ts";
import type { CredentialAdapterPort } from "./durable-credentials.ts";

const supportedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const sensitiveQueryName = /(?:^|[-_.])(access[-_.]?token|api[-_.]?key|credential|password|secret|token)(?:$|[-_.])/i;
const credentialHeaderName = /^(authorization|private-token|x-api-key|x-github-token)$/i;
const forbiddenStaticHeaderName = /^(authorization|connection|content-length|cookie|host|proxy-authorization|te|trailer|transfer-encoding|upgrade|x-api-key|x-github-token)$/i;
// Large Git packs and bounded CI artifacts legitimately exceed the historical
// 4 MiB scaffold cap. Routes remain explicitly host-capped and memory-bounded.
const maximumConfiguredBytes = 256 * 1024 * 1024;
const maximumTimeoutMs = 60_000;
const maximumCertificatePemBytes = 64 * 1024;
const tlsSha256Pattern = /^[a-f0-9]{64}$/;
const nonPublicAddresses = createNonPublicAddressBlockLists();

export interface NetworkContainmentFence {
  check(repositoryRoot: string, channel: "network"): Promise<ContainmentCheck> | ContainmentCheck;
}

export interface NetworkCredentialPolicy {
  readonly reference: string;
  readonly purpose: string;
  readonly header: string;
  readonly prefix?: string;
}

export interface ConfiguredNetworkRoute {
  readonly id: string;
  readonly method: string;
  /** Exact HTTPS origin, path, and configured query. Runtime callers cannot replace it. */
  readonly url: string;
  readonly staticHeaders?: Readonly<Record<string, string>>;
  readonly credential?: NetworkCredentialPolicy;
  readonly timeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  /** One host-owned dynamic path segment for APIs whose resource ID is selected from an attested response. */
  readonly pathParameter?: Readonly<{
    readonly name: string;
    readonly pattern: "unsigned-decimal";
    readonly suffix: string;
  }>;
  /** Signed download redirects are single-hop, credentialless, and exact-host allowlisted. */
  readonly redirects: "deny" | "single-use-signed-download";
  readonly redirectHosts?: readonly string[];
  /**
   * Absent means the existing public-Internet-only boundary. The one special
   * boundary is install-owned and accepts only a literal loopback provider host.
   */
  readonly boundary?: "provider-host-loopback";
  /** Exact peer public-key identity. Required for the loopback host. */
  readonly tlsSpkiSha256?: string;
  /** Public trust material for an install-owned self-signed loopback host. */
  readonly tlsCaCertificatePem?: string;
}

export interface ConfiguredNetworkPolicy {
  readonly version: 1;
  /** Ambient HTTP(S)_PROXY variables are never inherited by the production transport. */
  readonly proxy: "direct";
  readonly routes: readonly ConfiguredNetworkRoute[];
}

export interface ResolvedNetworkAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface NetworkAddressResolver {
  resolve(hostname: string, signal: AbortSignal): Promise<readonly ResolvedNetworkAddress[]>;
}

export interface PinnedNetworkTransportRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly resolvedAddress: ResolvedNetworkAddress;
  readonly rejectUnauthorized: true;
  readonly proxy: "direct";
  readonly signal: AbortSignal;
  readonly tlsSpkiSha256?: string;
  readonly tlsCaCertificatePem?: string;
}

export interface PinnedNetworkTransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface PinnedNetworkTransport {
  send(request: PinnedNetworkTransportRequest): Promise<PinnedNetworkTransportResponse>;
}

export interface ConfiguredNetworkRequest {
  readonly routeId: string;
  readonly repositoryRoot: string;
  readonly body?: string | Uint8Array;
  readonly pathParameters?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface ConfiguredNetworkResult {
  readonly outcome: "passed" | "failed" | "blocked" | "unavailable";
  readonly routeId: string;
  readonly detail: string;
  /** Whether the configured transport was invoked; it never guesses provider semantics. */
  readonly effectDisposition: Extract<EffectDisposition, "not_started" | "ambiguous">;
  readonly status?: number;
  /** Adapter-only response data. Receipts must retain `detail`, never this body. */
  readonly body?: Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
}

export class SystemNetworkAddressResolver implements NetworkAddressResolver {
  async resolve(hostname: string, signal: AbortSignal): Promise<readonly ResolvedNetworkAddress[]> {
    if (signal.aborted) throw new Error("Network request was cancelled before DNS resolution.");
    const answers = await lookup(hostname, { all: true, verbatim: true });
    if (signal.aborted) throw new Error("Network request was cancelled during DNS resolution.");
    return answers.map((answer) => ({ address: answer.address, family: answer.family as 4 | 6 }));
  }
}

/** Direct TLS transport with pinned DNS, explicit ports, and exact optional SPKI identity. */
export class DirectPinnedHttpsTransport implements PinnedNetworkTransport {
  async send(input: PinnedNetworkTransportRequest): Promise<PinnedNetworkTransportResponse> {
    const url = new URL(input.url);
    if (url.protocol !== "https:" || input.proxy !== "direct" || !input.rejectUnauthorized) {
      throw new Error("The production network transport requires direct verified HTTPS.");
    }
    return new Promise<PinnedNetworkTransportResponse>((resolveResponse, rejectResponse) => {
      const lookupPinned: LookupFunction = (_hostname, _options, callback) => {
        callback(null, input.resolvedAddress.address, input.resolvedAddress.family);
      };
      const hostname = unbracketedHostname(url.hostname);
      const options: RequestOptions = {
        protocol: "https:",
        hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers: input.headers,
        agent: false,
        rejectUnauthorized: true,
        ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
        lookup: lookupPinned,
        ...(input.tlsCaCertificatePem ? { ca: input.tlsCaCertificatePem } : {}),
        ...(input.tlsSpkiSha256 ? { checkServerIdentity: pinnedServerIdentity(input.tlsSpkiSha256) } : {})
      };
      let settled = false;
      const finishError = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectResponse(error);
      };
      const finishResponse = (response: PinnedNetworkTransportResponse): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveResponse(response);
      };
      const request = httpsRequest(options, (response) => {
        const chunks: Buffer[] = [];
        let length = 0;
        let exceeded = false;
        response.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > input.maxResponseBytes) {
            exceeded = true;
            request.destroy(new Error("Network response exceeded the configured output cap."));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.once("end", () => {
          if (exceeded) {
            finishError(new Error("Network response exceeded the configured output cap."));
            return;
          }
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
          }
          finishResponse({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
        });
        response.once("error", finishError);
      });
      const onAbort = (): void => { request.destroy(new Error("Network request was cancelled.")); };
      const timer = setTimeout(() => request.destroy(new Error("Network request timed out.")), input.timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", onAbort);
      };
      input.signal.addEventListener("abort", onAbort, { once: true });
      request.once("error", finishError);
      if (input.signal.aborted) onAbort();
      if (input.body) request.write(input.body);
      request.end();
    });
  }
}

/**
 * Exact-route outbound broker. Callers select a host-owned route id only;
 * method, URL, headers, proxy behavior, and credential reference are policy.
 */
export class ConfiguredHttpsNetworkBroker {
  private readonly policy: ConfiguredNetworkPolicy;
  private readonly routes: ReadonlyMap<string, ConfiguredNetworkRoute>;
  private readonly resolver: NetworkAddressResolver;
  private readonly transport: PinnedNetworkTransport;
  private readonly containment: NetworkContainmentFence;
  private readonly credentials?: CredentialAdapterPort;

  constructor(policy: ConfiguredNetworkPolicy, resolver: NetworkAddressResolver, transport: PinnedNetworkTransport, containment: NetworkContainmentFence, credentials?: CredentialAdapterPort) {
    this.policy = validatePolicy(policy);
    this.routes = new Map(this.policy.routes.map((route) => [route.id, route]));
    this.resolver = resolver;
    this.transport = transport;
    this.containment = containment;
    this.credentials = credentials;
  }

  async request(input: ConfiguredNetworkRequest): Promise<ConfiguredNetworkResult> {
    const route = this.routes.get(input.routeId);
    if (!route) return blocked(input.routeId, "No exact configured network route matches this request.");
    if (input.signal?.aborted) return blocked(route.id, "Network request was cancelled before dispatch.");
    let dispatchUrl: string;
    try { dispatchUrl = materializeRouteUrl(route, input.pathParameters); }
    catch (error) { return blocked(route.id, redactText(error instanceof Error ? error.message : "Configured path binding failed.").slice(0, 512)); }
    const body = input.body === undefined ? undefined : typeof input.body === "string" ? Buffer.from(input.body, "utf8") : new Uint8Array(input.body);
    const maximumRequestBytes = route.maxRequestBytes ?? 256 * 1024;
    if (body && body.byteLength > maximumRequestBytes) return blocked(route.id, "Network request exceeded the configured input cap.");
    if ((route.method === "GET" || route.method === "HEAD") && body?.byteLength) return blocked(route.id, `${route.method} routes cannot carry a request body.`);

    const timeoutMs = route.timeoutMs ?? 10_000;
    const controller = new AbortController();
    const onCallerAbort = (): void => controller.abort();
    input.signal?.addEventListener("abort", onCallerAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let effectStarted = false;
    try {
      await requireNetworkUncontained(this.containment, input.repositoryRoot);
      const url = new URL(dispatchUrl);
      const routeHostname = unbracketedHostname(url.hostname);
      const addresses = await this.resolver.resolve(routeHostname, controller.signal);
      const resolvedAddress = route.boundary === "provider-host-loopback"
        ? validatedProviderHostLoopbackAddresses(addresses, routeHostname)[0]!
        : validatedPublicAddresses(addresses)[0]!;
      await requireNetworkUncontained(this.containment, input.repositoryRoot);
      const dispatch = (credential?: Uint8Array) => {
        if (controller.signal.aborted) throw new Error("Network request was cancelled before the external effect.");
        const headers = { ...(route.staticHeaders ?? {}) } as Record<string, string>;
        if (route.credential) {
          if (!credential) throw new Error("The configured route requires an unavailable credential reference.");
          const clear = Buffer.from(credential).toString("utf8");
          if (!clear || clear.length > 8_192 || /[\r\n\0]/.test(clear)) throw new Error("The protected credential is invalid for an HTTP header.");
          headers[route.credential.header.toLowerCase()] = `${route.credential.prefix ?? ""}${clear}`;
        }
        return requireNetworkUncontained(this.containment, input.repositoryRoot).then(() => {
          effectStarted = true;
          return this.transport.send({
            url: dispatchUrl,
            method: route.method,
            headers,
            body,
            timeoutMs,
            maxResponseBytes: route.maxResponseBytes ?? 512 * 1024,
            resolvedAddress,
            rejectUnauthorized: true,
            proxy: "direct",
            signal: controller.signal,
            ...(route.tlsSpkiSha256 ? { tlsSpkiSha256: route.tlsSpkiSha256 } : {}),
            ...(route.tlsCaCertificatePem ? { tlsCaCertificatePem: route.tlsCaCertificatePem } : {})
          });
        });
      };
      let response = route.credential
        ? this.credentials
          ? await this.credentials.withCredential({
            reference: route.credential.reference,
            repositoryRoot: input.repositoryRoot,
            purpose: route.credential.purpose,
            ttlMs: Math.min(timeoutMs, 15_000)
          }, dispatch)
          : undefined
        : await dispatch();
      if (!response) return { outcome: "unavailable", routeId: route.id, detail: "The configured route requires a credential adapter.", effectDisposition: "not_started" };
      if (response.body.byteLength > (route.maxResponseBytes ?? 512 * 1024)) return blocked(route.id, "Network response exceeded the configured output cap.");
      if (response.status >= 300 && response.status < 400) {
        if (route.redirects !== "single-use-signed-download") return blocked(route.id, "Network redirects are denied by the exact-route policy.");
        let redirectUrl: URL;
        try { redirectUrl = validatedSignedDownloadRedirect(response, route.redirectHosts ?? []); }
        catch { return blocked(route.id, "The signed download redirect did not match the exact reviewed host policy."); }
        const redirectAddresses = await this.resolver.resolve(redirectUrl.hostname, controller.signal);
        const redirectAddress = validatedPublicAddresses(redirectAddresses)[0]!;
        await requireNetworkUncontained(this.containment, input.repositoryRoot);
        response = await this.transport.send({
          url: redirectUrl.toString(), method: "GET", headers: {}, timeoutMs,
          maxResponseBytes: route.maxResponseBytes ?? 512 * 1024,
          resolvedAddress: redirectAddress, rejectUnauthorized: true, proxy: "direct", signal: controller.signal
        });
        if (response.status >= 300 && response.status < 400) return blocked(route.id, "A second network redirect is denied.");
      }
      const common = { routeId: route.id, status: response.status, headers: safeResponseHeaders(response.headers), body: new Uint8Array(response.body), effectDisposition: "ambiguous" as const };
      return response.status >= 200 && response.status < 300
        ? { outcome: "passed", detail: `Configured network route ${route.id} completed.`, ...common }
        : { outcome: "failed", detail: `Configured network route ${route.id} returned HTTP ${response.status}.`, ...common };
    } catch (error) {
      const detail = redactText(error instanceof Error ? error.message : "Configured network route failed.").slice(0, 512);
      const failClosed = /containment|cancel|timed out|timeout|scope|lease|credential reference|public address|loopback|DNS|output cap|TLS|certificate|SPKI|pin/i.test(detail);
      return { outcome: failClosed ? "blocked" : "failed", routeId: route.id, detail, effectDisposition: effectStarted ? "ambiguous" : "not_started" };
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onCallerAbort);
      body?.fill(0);
    }
  }
}

/** Creates the only production transport/resolver composition; neither uses ambient proxies. */
export function createDirectConfiguredNetworkBroker(policy: ConfiguredNetworkPolicy, containment: NetworkContainmentFence, credentials?: CredentialAdapterPort): ConfiguredHttpsNetworkBroker {
  return new ConfiguredHttpsNetworkBroker(policy, new SystemNetworkAddressResolver(), new DirectPinnedHttpsTransport(), containment, credentials);
}

export async function loadConfiguredNetworkPolicy(filePath: string): Promise<ConfiguredNetworkPolicy> {
  const candidate: unknown = JSON.parse(await readFile(filePath, "utf8"));
  return validatePolicy(candidate);
}

function validatePolicy(candidate: unknown): ConfiguredNetworkPolicy {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Configured network policy is invalid.");
  const input = candidate as Partial<ConfiguredNetworkPolicy>;
  if (input.version !== 1 || input.proxy !== "direct" || !Array.isArray(input.routes) || input.routes.length > 256) {
    throw new Error("Configured network policy requires version 1, direct proxy policy, and a bounded route list.");
  }
  const routes = input.routes.map(validateRoute);
  const ids = new Set(routes.map((route) => route.id));
  if (ids.size !== routes.length) throw new Error("Configured network route ids must be unique.");
  return { version: 1, proxy: "direct", routes };
}

function validateRoute(candidate: unknown): ConfiguredNetworkRoute {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Configured network route is invalid.");
  const route = candidate as Partial<ConfiguredNetworkRoute>;
  const id = identifier(route.id, "network route id");
  const method = typeof route.method === "string" ? route.method.toUpperCase() : "";
  if (!supportedMethods.has(method)) throw new Error(`Configured network route ${id} uses an unsupported method.`);
  if (typeof route.url !== "string") throw new Error(`Configured network route ${id} needs an exact HTTPS URL.`);
  const boundary = route.boundary === undefined ? undefined : route.boundary;
  if (route.boundary !== undefined && route.boundary !== "provider-host-loopback") throw new Error(`Configured network route ${id} has an invalid network boundary.`);
  const url = validatedRouteUrl(route.url, boundary);
  const tlsSpkiSha256 = route.tlsSpkiSha256 === undefined ? undefined : validatedTlsSha256(route.tlsSpkiSha256, `Configured network route ${id} TLS SPKI pin`);
  const tlsCaCertificatePem = route.tlsCaCertificatePem === undefined ? undefined : validatedCertificatePem(route.tlsCaCertificatePem, id);
  if (boundary === "provider-host-loopback") {
    if (!/^provider\.|^automation\./.test(id)) throw new Error(`Configured network route ${id} cannot use the provider-host loopback boundary.`);
    if (!tlsSpkiSha256 || !tlsCaCertificatePem) throw new Error(`Configured network route ${id} requires an exact TLS SPKI pin and CA certificate for provider-host loopback.`);
  } else if (tlsCaCertificatePem !== undefined) {
    throw new Error(`Configured network route ${id} cannot replace public TLS trust material.`);
  }
  if (route.redirects !== "deny" && route.redirects !== "single-use-signed-download") throw new Error(`Configured network route ${id} has an invalid redirect policy.`);
  const staticHeaders: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(route.staticHeaders ?? {})) {
    const name = validatedHeaderName(rawName);
    if (forbiddenStaticHeaderName.test(name)) throw new Error(`Configured network route ${id} cannot configure a sensitive, routing, or hop-by-hop header.`);
    staticHeaders[name] = validatedHeaderValue(rawValue);
  }
  let credential: NetworkCredentialPolicy | undefined;
  if (route.credential !== undefined) {
    if (!route.credential || typeof route.credential !== "object") throw new Error(`Configured network route ${id} has an invalid credential policy.`);
    const header = validatedHeaderName(route.credential.header);
    if (!credentialHeaderName.test(header)) throw new Error(`Configured network route ${id} credential headers must use an explicit credential-header slot.`);
    const prefix = route.credential.prefix ?? "";
    if (prefix.length > 128 || /[\r\n\0]/.test(prefix)) throw new Error(`Configured network route ${id} has an invalid credential prefix.`);
    credential = { reference: identifier(route.credential.reference, "credential reference"), purpose: identifier(route.credential.purpose, "credential purpose"), header, ...(prefix ? { prefix } : {}) };
  }
  const timeoutMs = optionalBounded(route.timeoutMs, "network timeout", maximumTimeoutMs);
  const maxRequestBytes = optionalBounded(route.maxRequestBytes, "network request cap", maximumConfiguredBytes);
  const maxResponseBytes = optionalBounded(route.maxResponseBytes, "network response cap", maximumConfiguredBytes);
  let pathParameter: ConfiguredNetworkRoute["pathParameter"];
  if (route.pathParameter !== undefined) {
    if (!route.pathParameter || typeof route.pathParameter !== "object" || Array.isArray(route.pathParameter)) throw new Error(`Configured network route ${id} has an invalid path parameter policy.`);
    const name = identifier(route.pathParameter.name, "network path parameter name");
    if (route.pathParameter.pattern !== "unsigned-decimal") throw new Error(`Configured network route ${id} has an unsupported path parameter pattern.`);
    const suffix = route.pathParameter.suffix;
    if (typeof suffix !== "string" || !/^\/[A-Za-z0-9._~-]{1,64}(?:\/[A-Za-z0-9._~-]{1,64}){0,3}$/.test(suffix) || suffix.includes("..")) throw new Error(`Configured network route ${id} has an invalid fixed path suffix.`);
    if (url.search || !url.pathname.endsWith("/")) throw new Error(`Configured network route ${id} dynamic path bases must end in a slash and have no query.`);
    pathParameter = { name, pattern: "unsigned-decimal", suffix };
  }
  let redirectHosts: readonly string[] | undefined;
  if (route.redirects === "single-use-signed-download") {
    if (method !== "GET" || !pathParameter || !Array.isArray(route.redirectHosts) || route.redirectHosts.length < 1 || route.redirectHosts.length > 8) throw new Error(`Configured network route ${id} signed downloads require a dynamic GET route and bounded exact redirect hosts.`);
    redirectHosts = [...new Set(route.redirectHosts.map((host) => validatedExactHost(host, "redirect host")))];
    if (redirectHosts.length !== route.redirectHosts.length) throw new Error(`Configured network route ${id} redirect hosts must be unique.`);
  } else if (route.redirectHosts !== undefined) throw new Error(`Configured network route ${id} cannot declare redirect hosts while redirects are denied.`);
  return {
    id,
    method,
    url: url.toString(),
    ...(Object.keys(staticHeaders).length ? { staticHeaders } : {}),
    ...(credential ? { credential } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(maxRequestBytes ? { maxRequestBytes } : {}),
    ...(maxResponseBytes ? { maxResponseBytes } : {}),
    ...(pathParameter ? { pathParameter } : {}),
    redirects: route.redirects,
    ...(redirectHosts ? { redirectHosts } : {}),
    ...(boundary ? { boundary } : {}),
    ...(tlsSpkiSha256 ? { tlsSpkiSha256 } : {}),
    ...(tlsCaCertificatePem ? { tlsCaCertificatePem } : {})
  };
}

function materializeRouteUrl(route: ConfiguredNetworkRoute, values: Readonly<Record<string, string>> | undefined): string {
  if (!route.pathParameter) {
    if (values && Object.keys(values).length) throw new Error("The exact configured route does not accept path parameters.");
    return route.url;
  }
  const keys = Object.keys(values ?? {});
  if (keys.length !== 1 || keys[0] !== route.pathParameter.name) throw new Error("The configured dynamic route requires one exact path parameter.");
  const value = values![route.pathParameter.name];
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value)) throw new Error("The configured dynamic route path parameter is invalid.");
  const url = new URL(route.url);
  url.pathname = `${url.pathname}${value}${route.pathParameter.suffix}`;
  return url.toString();
}

function validatedSignedDownloadRedirect(response: PinnedNetworkTransportResponse, allowedHosts: readonly string[]): URL {
  if (response.status !== 302 && response.status !== 307) throw new Error("unsupported redirect status");
  const location = response.headers.location;
  if (typeof location !== "string" || !location || location.length > 8_192 || /[\r\n\0]/.test(location)) throw new Error("missing redirect location");
  let url: URL;
  try { url = new URL(location); } catch { throw new Error("invalid redirect URL"); }
  const host = validatedExactHost(url.hostname, "signed download host");
  if (!allowedHosts.includes(host) || url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash) throw new Error("untrusted redirect URL");
  const rawPath = location.split(/[?#]/, 1)[0] ?? location;
  if (!url.pathname.startsWith("/") || /%(?:2e|2f|5c)/i.test(rawPath) || url.search.length > 4_096) throw new Error("unsafe redirect path");
  return url;
}

function validatedExactHost(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 253 || value.startsWith(".") || value.endsWith(".")) throw new Error(`${label} is invalid.`);
  const host = value.toLowerCase();
  if (!host.includes(".") || host.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) throw new Error(`${label} is invalid.`);
  if (/^(?:localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|.*\.onion)$/i.test(host)) throw new Error(`${label} is invalid.`);
  return host;
}

function validatedRouteUrl(value: string, boundary?: ConfiguredNetworkRoute["boundary"]): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Configured network routes require valid exact HTTPS URLs."); }
  if (url.protocol !== "https:") throw new Error("Configured network routes require HTTPS.");
  if (url.username || url.password) throw new Error("Configured network route URLs cannot contain credentials.");
  if (url.hash) throw new Error("Configured network route URLs cannot contain fragments.");
  const hostname = unbracketedHostname(url.hostname);
  if (!hostname || hostname.endsWith(".")) throw new Error("Configured network route hosts must be exact canonical names.");
  if (boundary === "provider-host-loopback") {
    if (hostname !== "127.0.0.1" && hostname !== "::1") throw new Error("The provider-host loopback boundary requires an exact literal loopback address.");
    if (!url.port) throw new Error("The provider-host loopback boundary requires an exact explicit non-default TLS port.");
  } else if (/^(?:localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa|.*\.onion)$/i.test(hostname)) {
    throw new Error("Configured network route hosts cannot use local or special-use names.");
  }
  const rawPath = value.split(/[?#]/, 1)[0] ?? value;
  if (/%(?:2e|2f|5c)/i.test(rawPath)) throw new Error("Configured network route paths cannot contain encoded traversal or separator bytes.");
  for (const name of url.searchParams.keys()) if (sensitiveQueryName.test(name)) throw new Error("Configured network route query strings cannot carry credentials.");
  return url;
}

function validatedProviderHostLoopbackAddresses(addresses: readonly ResolvedNetworkAddress[], hostname: string): readonly ResolvedNetworkAddress[] {
  const expectedFamily = hostname === "127.0.0.1" ? 4 : hostname === "::1" ? 6 : 0;
  if (expectedFamily === 0 || addresses.length !== 1) throw new Error("The provider-host loopback boundary requires one exact literal loopback resolution.");
  const address = addresses[0]!;
  if (address.family !== expectedFamily || isIP(address.address) !== expectedFamily || address.address.toLowerCase() !== hostname) {
    throw new Error("The provider-host loopback resolution changed its exact installed address.");
  }
  return [{ address: hostname, family: expectedFamily }];
}

function validatedTlsSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !tlsSha256Pattern.test(value)) throw new Error(`${label} must be one lower-case SHA-256 digest.`);
  return value;
}

function validatedCertificatePem(value: unknown, routeId: string): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > maximumCertificatePemBytes || !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\r?\n?$/.test(value)) {
    throw new Error(`Configured network route ${routeId} has invalid bounded public TLS trust material.`);
  }
  return value;
}

function unbracketedHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1).toLowerCase() : hostname.toLowerCase();
}

function pinnedServerIdentity(expectedSha256: string): (hostname: string, certificate: PeerCertificate) => Error | undefined {
  const expected = Buffer.from(validatedTlsSha256(expectedSha256, "TLS SPKI pin"), "hex");
  return (hostname, certificate) => {
    const identityError = checkServerIdentity(hostname, certificate);
    if (identityError) return identityError;
    try {
      if (!certificate.raw?.byteLength) return new Error("The TLS peer did not provide a leaf certificate for SPKI pinning.");
      const publicKey = new X509Certificate(certificate.raw).publicKey.export({ type: "spki", format: "der" });
      const observed = createHash("sha256").update(publicKey).digest();
      return timingSafeEqual(expected, observed) ? undefined : new Error("The TLS peer SPKI identity does not match the exact configured pin.");
    } catch {
      return new Error("The TLS peer certificate could not be verified against the exact SPKI pin.");
    }
  };
}

function validatedPublicAddresses(addresses: readonly ResolvedNetworkAddress[]): readonly ResolvedNetworkAddress[] {
  if (addresses.length === 0 || addresses.length > 32) throw new Error("DNS returned no bounded public address set.");
  const unique = new Map<string, ResolvedNetworkAddress>();
  for (const address of addresses) {
    if (isIP(address.address) !== address.family || !isPublicAddress(address.address, address.family)) {
      throw new Error("DNS returned a private, local, reserved, or malformed address.");
    }
    unique.set(`${address.family}:${address.address.toLowerCase()}`, { ...address });
  }
  return [...unique.values()];
}

function isPublicAddress(address: string, family: 4 | 6): boolean {
  return family === 4
    ? !nonPublicAddresses.ipv4.check(address, "ipv4")
    : !nonPublicAddresses.ipv6.check(address, "ipv6");
}

function createNonPublicAddressBlockLists(): { readonly ipv4: BlockList; readonly ipv6: BlockList } {
  // Keep families separate: Node represents IPv4 checks as IPv4-mapped IPv6
  // internally, so a ::ffff:0:0/96 rule in a shared list would block every
  // IPv4 address instead of only mapped answers reported as IPv6.
  const ipv4 = new BlockList();
  const ipv6 = new BlockList();
  for (const [network, prefix] of [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
  ] as const) ipv4.addSubnet(network, prefix, "ipv4");
  for (const [network, prefix] of [
    ["::", 96], ["::ffff:0:0", 96], ["64:ff9b:1::", 48], ["100::", 64],
    ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
    ["fe80::", 10], ["ff00::", 8]
  ] as const) ipv6.addSubnet(network, prefix, "ipv6");
  return { ipv4, ipv6 };
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.trim())) throw new Error(`${label} is invalid.`);
  return value.trim();
}

function validatedHeaderName(value: unknown): string {
  if (typeof value !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(value)) throw new Error("Configured network header name is invalid.");
  return value.toLowerCase();
}

function validatedHeaderValue(value: unknown): string {
  if (typeof value !== "string" || value.length > 8_192 || /[\r\n\0]/.test(value)) throw new Error("Configured network header value is invalid.");
  return value;
}

function optionalBounded(value: unknown, label: string, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) throw new Error(`${label} must be 1-${maximum}.`);
  return value as number;
}

async function requireNetworkUncontained(containment: NetworkContainmentFence, repositoryRoot: string): Promise<void> {
  const check = await containment.check(repositoryRoot, "network");
  if (!check.allowed) throw new Error(`Network containment check blocked this operation: ${check.reason}`);
}

function blocked(routeId: string, detail: string): ConfiguredNetworkResult {
  return { outcome: "blocked", routeId, detail, effectDisposition: "not_started" };
}

function safeResponseHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (/^(content-type|etag|last-modified|link|retry-after|x-github-api-version|x-ratelimit-(limit|remaining|reset|resource|used))$/.test(normalized)) {
      safe[normalized] = redactText(value).slice(0, 4_096);
    }
  }
  return safe;
}
