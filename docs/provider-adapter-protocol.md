# SXSY-B122 Provider Adapter Protocol

This protocol is the software boundary between the installed companion and an explicitly configured provider service. A repository, terminal, prompt, or VS Code setting cannot select an endpoint. The operator installs one exact-route HTTPS policy through Windows user presence and provisions DPAPI-protected credential references separately.

The repository now ships the executable service implementation in
[`apps/provider-adapter-host`](../apps/provider-adapter-host/README.md). It is
packageable independently from the Windows companion and provides typed Claude
and Codex runtime ports, an authenticated durable journal, a credential-free
loopback fixture, and an HTTPS listener. Proprietary credentials and live
provider parity remain deployment evidence, not source-code claims.

## Installed boundary and nonclaims

The shipped host is an authenticated loopback service, not an embedded
provider implementation. Package-configurable fixture backends are health and
protocol diagnostics only: they advertise no capability and fail handshake,
execution, cancellation, and Council effects with HTTP 503. The repository's
effectful fixture is constructible only by tests and is not an installed
configuration kind.

A digest-pinned in-process provider module receives its DPAPI-opened provider
credential during construction. That boundary is not independently mediated:
the host removes `mediated` from its handshake and observation, regardless of
what the module returns, and Automatic Council fails closed. A live provider
connector can become Mediated only through a separately installed, host-owned
effects contract whose enforcement and attestation are outside the
credential-bearing module. No such proprietary connector or its acceptance
evidence is bundled or claimed by this repository.

## Capability handshake

The companion sends `sxsy-b122.provider-handshake-request` version 1 to the exact `provider.handshake.<provider>` route. It binds the request to the registered session ID, provider, complete TargetSnapshot ID, canonical repository root, branch, head, and host timestamp.

The provider must return exactly these fields:

```json
{
  "schema": "sxsy-b122.provider-handshake",
  "version": 1,
  "sessionId": "opaque-session-id",
  "provider": "codex",
  "targetSnapshotId": "64-lowercase-hex-characters",
  "repositoryRoot": "C:\\exact\\repository",
  "capabilities": ["registered", "observable", "controllable", "mediated"],
  "status": "running",
  "adapterVersion": "provider-adapter-1",
  "taskId": "task-identity",
  "planRevision": "plan-revision",
  "plannedFiles": ["src/example.ts"],
  "resources": ["port:4100"],
  "dependencies": [],
  "diffDigest": "64-lowercase-hex-characters"
}
```

`taskId` and `planRevision` may be omitted; every other field is required. `Mediated` requires `Observable` and `Controllable`; `Controllable` requires `Observable`. The companion resolves the TargetSnapshot again after the network response and installs no capability if it changed.

## Command and automation results

Provider command routes are `provider.<action>` and automation routes are `automation.<action>`. Successful HTTP transport is not command success. The body must be an exact `sxsy-b122.remote-result` version 1 record with `status`, a bounded `summary`, and optional `externalId` and `data`. Malformed, extra-field, stale, cancelled, or target-inconsistent responses fail closed.

## Automatic Council

Automatic Council uses `provider.council.<provider>`. The request is an exact `sxsy-b122.council-phase` version 1 record for `pause`, `assignment`, or `resume`, bound to an epoch, session, and TargetSnapshot. The provider returns exactly:

```json
{
  "schema": "sxsy-b122.council-ack",
  "version": 1,
  "epochId": "opaque-epoch-id",
  "phase": "pause",
  "sessionId": "opaque-session-id",
  "targetSnapshotId": "64-lowercase-hex-characters",
  "accepted": true
}
```

Any missing acknowledgement aborts the durable epoch. Assignments remain limited to provider-attested planned files and resources, and overlaps stop before pause.

Assignment and resume requests additionally carry one exact
`sxsy-b122.council-resource-host` v1 binding created by the companion. It
describes only fenced capabilities, hosted resource metadata, and the exact
environment projection; credential resources contain a non-bearer opaque
capability, never credential bytes. The host validates the binding's complete
field set and SHA-256 digest, rejects any added environment field, persists it
with the assignment, and requires the acknowledgement to echo both
`assignmentDigest` and `resourceHostDigest`. Resume must use the same two
digests. A stale or secret-bearing resource binding fails before provider
dispatch and is not journaled.

## Observation, cancellation, health, and restart recovery

The installed provider host also owns these exact authenticated endpoints:

| Route ID | Method and path | Purpose |
| --- | --- | --- |
| `provider.health` | `GET /v1/b122/health` | Authenticated listener/package readiness; it does not claim live-provider acceptance. |
| `provider.observe-session.<provider>` | `POST /v1/b122/observe/session/<provider>` | Refresh one exact session/TargetSnapshot binding. |
| `provider.observe-operation.<provider>` | `POST /v1/b122/observe/operation/<provider>` | Reconcile one durable external operation without replay. |
| `provider.cancel.<provider>` | `POST /v1/b122/cancel/<provider>` | Cancel one exact nonterminal external operation and observe its result. |
| `provider.reconcile` | `POST /v1/b122/reconcile` | Observe every unresolved host-owned operation and Council phase after restart. |

`<provider>` is exactly `claude` or `codex` for the repository-owned host.
Operation observation and cancellation bind the operation ID, external ID,
original route ID, session ID, repository root, and TargetSnapshot ID. Council
phase recovery binds the epoch, participant, phase, target, and assignment
digest. Submitted work is observed, never automatically replayed.

## Windows configuration and lifecycle contracts

The package executable is `sxsy-b122-provider-adapter-host`, compiled at
`provider-adapter-host/dist/apps/provider-adapter-host/src/main.js`. Installed
startup is exactly:

```text
node.exe <main.js> --config <absolute-provider-host.json> --lifecycle-nonce <64-lowercase-hex>
```

`provider-host.json` is exact schema `sxsy-b122.provider-host-config` version 1.
It contains `protectedStateRoot`, literal-loopback `listen`, a TLS object with
absolute certificate/private-key paths plus file and SPKI SHA-256 pins,
separate `authenticationTokenEnvelopeFile` and
`journalAuthenticationEnvelopeFile`, one absolute `stateFile`, one or two
exact provider entries, and only the optional `allowFixtureBackends` flag.
Every secret is a DPAPI CurrentUser envelope beneath the dedicated protected
LocalAppData root. TLS validation requires a matching private key, current
validity, a non-CA certificate, serverAuth EKU, and the `127.0.0.1` identity.

The provisioning tools have these stable responsibilities:

- `Protect-B122ProviderHostSecret.ps1` generates or validates the rotatable
  bearer token, stable journal key, and named provider credential envelopes.
- `New-B122LoopbackTlsIdentity.mjs` creates one non-CA 90-day loopback identity;
  `Get-B122TlsIdentity.mjs` validates certificate/key match and emits
  `sxsy-b122.tls-identity` v1.
- `New-B122ProviderHostConfiguration.ps1` creates an atomic, pinned config and
  preserves `<config>.previous`; `Restore-B122ProviderHostConfiguration.ps1`
  swaps that validated prior config back for rollback. A TLS rotation creates
  new certificate/key files, replaces the config, regenerates the network
  policy, reprovisions the sealed bearer reference, verifies health, and keeps
  the old identity until rollback is no longer required.
- `Test-B122ProviderHostConfiguration.ps1` emits
  `sxsy-b122.provider-host-configuration-validation` v1 only after schema,
  root, reparse, ACL, DPAPI-envelope, module-digest, TLS, and credential
  reference checks pass.
- `New-B122NetworkPolicy.ps1` produces the secret-free exact-route policy;
  `Provision-B122ProviderHostCompanion.mjs` transfers only the DPAPI-sealed
  bearer reference through authenticated local IPC and emits
  `sxsy-b122.provider-host-companion-provisioning-receipt` v1.
- `Manage-B122ProviderHost.ps1` provides `Start`, `Health`, `Status`, and `Stop`.
  It durably records a `starting` intent before process creation, reconciles or
  terminates exact-nonce orphans, and never selects a process by command-line
  substring. Stop requests authenticated graceful shutdown and otherwise uses
  a bounded exact-identity process-tree fallback with a no-survivor receipt.

The lifecycle record is exact `sxsy-b122.provider-host-process` v2 and is kept
under the protected configuration root. It binds state, raw lifecycle nonce,
nonce SHA-256, PID, exact Node/main/config paths, configuration SHA-256, source
commit, intent time, and process-start time. Raw nonce and bearer values never
appear in emitted receipts. Public lifecycle receipts use
`sxsy-b122.provider-host-lifecycle` v1; authenticated checks use
`sxsy-b122.provider-host-health-check` or
`sxsy-b122.provider-host-shutdown-check` v1 and bind PID, nonce digest,
configuration digest, TLS pinning, and authentication. The host health body is
`sxsy-b122.provider-host-health` v1; graceful shutdown requires an exact
`sxsy-b122.provider-host-shutdown` v1 request and returns
`sxsy-b122.provider-host-shutdown-ack` v1 only after all lifecycle bindings
match.

Generate all companion routes with
[`New-B122NetworkPolicy.ps1`](../deployment/windows/New-B122NetworkPolicy.ps1)
and an exact `-ProviderBaseUri`. The generated policy retains fixed HTTPS URLs,
one DPAPI-backed bearer credential reference, bounded request/response sizes,
and no provider redirect behavior.

## Executable release payload

The Windows release ships the provider adapter as an independent Node payload
at `provider-adapter-host/`; it is not folded into the companion process. The
bundle's `release.json` pins the host package version, its checksum inventory
binds every compiled file, and its SPDX document assigns those files to
`SPDXRef-Package-ProviderAdapterHost`. Release validation also requires the
host's package metadata and core implementation sources in the exact Git-commit
source archive. Portable smoke runs `--self-test` with the bundled Node runtime
and rejects a receipt that reports network or proprietary-credential access.

## GitHub and Git smart HTTP

The configured GitHub adapter uses four exact routes: `github.graphql`, the metadata-only `github.repository` identity route, `git.receive-pack.advertise`, and `git.receive-pack`. Public GitHub binds the API route to `api.github.com` and the repository/Git routes to `github.com`; GitHub Enterprise binds all four to its exact installed host. The repository route names the PR base repository, while the receive-pack routes name the pushed head repository, so a reviewed fork PR cannot be confused with the same branch name in another fork. The companion never reads ambient Git credentials, proxy variables, credential helpers, or `PATH`. It creates a bounded pack with a fixed absolute Git executable, refuses non-fast-forward updates, and verifies the remote ref after receive-pack. PR upsert and merge verify exact base repository, head repository/branch/SHA, base branch, and provider state before and after the GraphQL mutation. An already-merged exact PR is observed idempotently rather than merged twice. Direct Main additionally requires the high-consequence acceptance gate and a fresh complete `release_shield` receipt for the same TargetSnapshot, and is unavailable when the configured push repository is a fork.

GitHub navigation uses the same installed identity. Current-branch PR and current-head Actions controls query the authenticated GraphQL route, validate every returned URL against the exact web host/repository, and either open one exact result or return a bounded picker. Pipeline Failure Trace retrieves only bounded provider check output for the exact head, redacts it, records a protected restart-durable repeat cursor, and never treats log content as authority or an executable instruction.

Use [New-B122NetworkPolicy.ps1](../deployment/windows/New-B122NetworkPolicy.ps1) to generate a secret-free policy for review. Git smart HTTP expects a separately protected Basic-auth credential value; the credential reference stores only DPAPI-sealed bytes and scope metadata.
