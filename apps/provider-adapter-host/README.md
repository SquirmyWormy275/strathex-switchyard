# SXSY-B122 Provider Adapter Host

This package is the executable provider-side implementation of the
[SXSY-B122 provider adapter protocol](../../docs/provider-adapter-protocol.md).
It accepts only authenticated, bounded, exact-route HTTPS requests and exposes
pluggable Claude and Codex runtime ports. It is not an LLM and it never treats
provider or repository text as authority.

## What ships

- exact v1 handshake, typed workflow command, automation, Council
  pause/assignment/resume, session observation, operation observation,
  cancellation, health, and restart-reconciliation endpoints;
- a hash-chained HMAC-authenticated durable journal for sessions, operation
  idempotency, results, cancellations, and Council phase acknowledgements;
- pre- and post-effect session/TargetSnapshot verification;
- exact Council resource-host validation and digest echoing; assignment and
  resume accept only the companion's fenced non-secret environment projection;
- constant-time 256-bit bearer-token authentication, TLS 1.2+, a 64 KiB
  request cap, a 60-second request deadline, exact paths, and no redirects;
- concrete `ClaudeProviderAdapterBackend` and `CodexProviderAdapterBackend`
  wrappers around one typed `ProviderRuntimePort` boundary;
- a digest-pinned, self-contained ESM module loader. The exact verified module
  bytes are imported from memory, so replacing the file after verification
  cannot change the evaluated code;
- an explicitly enabled, credential-free loopback fixture backend for tests and
  installation diagnostics. Fixture results are labelled and are never
  provider-acceptance evidence.

## Build, test, and package

From the repository root:

```powershell
npm run build:provider-host
node --experimental-transform-types --test apps/provider-adapter-host/test/*.test.ts
npm run package:provider-host:dry-run
node --experimental-transform-types apps/provider-adapter-host/src/main.ts --self-test
```

The package executable is `sxsy-b122-provider-adapter-host`.

The verified Windows release places the independently runnable payload under
`provider-adapter-host/` beside the companion. It includes the compiled host,
package metadata, and this guide, and uses the bundle's reviewed Node runtime:

```powershell
.\runtime\node.exe .\provider-adapter-host\dist\apps\provider-adapter-host\src\main.js --self-test
```

The release builder requires that credential-free self-test, inventories every
provider-host file in `SHA256SUMS.json`, assigns those files to the dedicated
`SPDXRef-Package-ProviderAdapterHost` SBOM package, records the exact host
version in `release.json`, and verifies the package's implementation sources in
the pinned-commit source archive. The self-test proves only authenticated state
and fixture composition; it neither reads proprietary credentials nor opens a
provider network connection.

## Configuration

The installed lifecycle manager starts the host with one absolute,
current-user-protected configuration and one fresh 256-bit lifecycle nonce:

```powershell
sxsy-b122-provider-adapter-host --config C:\Users\operator\AppData\Local\STRATHEX\switchyard\provider-host\provider-host.json --lifecycle-nonce <64-lowercase-hex>
```

The nonce is held only in the protected lifecycle record. It is represented in
health and logs only by SHA-256. `Manage-B122ProviderHost.ps1` is the supported
Start/Health/Status/Stop entry point; it writes the crash-reconcilable starting
intent before launching the process and performs authenticated graceful
shutdown before an exact-identity process-tree fallback.

Exact configuration shape:

```json
{
  "schema": "sxsy-b122.provider-host-config",
  "version": 1,
  "protectedStateRoot": "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host",
  "listen": { "host": "127.0.0.1", "port": 4747 },
  "tls": {
    "certificateFile": "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host\\loopback-certificate.pem",
    "privateKeyFile": "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host\\loopback-private-key.pem",
    "certificateSha256": "64-lowercase-hex-characters",
    "privateKeySha256": "64-lowercase-hex-characters",
    "tlsSpkiSha256": "64-lowercase-hex-characters"
  },
  "authenticationTokenEnvelopeFile": "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host\\authentication-token.envelope.json",
  "journalAuthenticationEnvelopeFile": "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host\\journal-authentication.envelope.json",
  "stateFile": "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host\\provider-state.jsonl",
  "providers": [
    {
      "provider": "codex",
      "kind": "module",
      "modulePath": "C:\\reviewed\\codex-provider.mjs",
      "moduleSha256": "64-lowercase-hex-characters",
      "credentialEnvelopeFile": "C:\\Users\\operator\\AppData\\Local\\STRATHEX\\switchyard\\provider-host\\codex-credential.envelope.json",
      "options": { "deployment": "reviewed-deployment-id" }
    }
  ]
}
```

The authentication token, independent durable-journal key, and module
credentials are exact DPAPI CurrentUser envelopes under the protected root.
The validator requires that root and every private file be owned by the current
Windows user, have inheritance disabled at the root, and grant access only to
that user and SYSTEM. TLS is exact loopback-only, non-CA, currently valid,
serverAuth EKU-bearing, SPKI-pinned, digest-pinned, and matched to its private
key. Environment variables, `PATH`, proxy variables, repository files, and
request bodies never select a module or credential.

A provider module exports:

```js
export async function createB122ProviderRuntimePort({ provider, credential, options }) {
  return {
    provider,
    handshake,
    execute,
    observeSession,
    observeOperation,
    cancelOperation,
    council,
    observeCouncil,
    shutdown
  };
}
```

The installed module must be self-contained ESM (it may use `node:` built-ins,
but not relative imports) because the host evaluates the exact bytes that
matched `moduleSha256`. Every method must return the typed exact binding defined
in [`src/backends.ts`](src/backends.ts), and `shutdown(signal)` must settle
within the host's fixed deadline. Missing credentials, a digest mismatch, a
malformed result, target churn, or an unavailable observation fails closed.

An in-process module receives the provider credential needed to construct its
runtime port. It therefore cannot attest the host's `mediated` capability.
The host strips that capability from module handshakes and observations, and
Automatic Council remains unavailable for those modules. A future live
connector may become Mediated only behind a separate host-owned effects API
whose enforcement and attestation do not trust provider-module claims; that
external connector is not included or claimed here.

## Fixture diagnostics

Fixture mode requires both `"allowFixtureBackends": true` and an exact loopback
listener (`127.0.0.1` or `::1`):

```json
{ "provider": "codex", "kind": "fixture" }
```

Package-configurable fixture endpoints are diagnostic-only: health works, but
handshake, execution, cancellation, and Council return a bounded fail-closed
error and expose no capability. The effectful fixture exists only behind an
in-process test constructor and cannot be selected by installed configuration.

`--self-test` performs no network or proprietary-credential access. Production
TLS, DNS, certificates, firewall policy, provider credentials, and live
Claude/Codex behavior require separately authorized deployment evidence; this
package does not claim those external facts.

## Durable recovery rules

The host writes `submitted` before any provider effect. A lost result is never
replayed. On restart, `reconcile()` and `POST /v1/b122/reconcile` observe the
provider's exact external operation or Council phase and settle only an exact
acknowledgement. Reusing an operation or phase identity with changed content is
rejected. The rotatable bearer token is cryptographically independent from the
stable DPAPI-protected journal key, so authentication or TLS rotation does not
invalidate durable recovery. TLS replacement uses a new certificate/key path;
the previous exact configuration remains rollback-valid until the operator
retires its identity and re-pins the companion policy.
