# SXSY-B122 Provider Adapter Protocol

This protocol is the software boundary between the installed companion and an explicitly configured provider service. A repository, terminal, prompt, or VS Code setting cannot select an endpoint. The operator installs one exact-route HTTPS policy through Windows user presence and provisions DPAPI-protected credential references separately.

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

## GitHub and Git smart HTTP

The configured GitHub adapter uses four exact routes: `github.graphql`, the metadata-only `github.repository` identity route, `git.receive-pack.advertise`, and `git.receive-pack`. Public GitHub binds the API route to `api.github.com` and the repository/Git routes to `github.com`; GitHub Enterprise binds all four to its exact installed host. The repository route names the PR base repository, while the receive-pack routes name the pushed head repository, so a reviewed fork PR cannot be confused with the same branch name in another fork. The companion never reads ambient Git credentials, proxy variables, credential helpers, or `PATH`. It creates a bounded pack with a fixed absolute Git executable, refuses non-fast-forward updates, and verifies the remote ref after receive-pack. PR upsert and merge verify exact base repository, head repository/branch/SHA, base branch, and provider state before and after the GraphQL mutation. An already-merged exact PR is observed idempotently rather than merged twice. Direct Main additionally requires the high-consequence acceptance gate and a fresh complete `release_shield` receipt for the same TargetSnapshot, and is unavailable when the configured push repository is a fork.

GitHub navigation uses the same installed identity. Current-branch PR and current-head Actions controls query the authenticated GraphQL route, validate every returned URL against the exact web host/repository, and either open one exact result or return a bounded picker. Pipeline Failure Trace retrieves only bounded provider check output for the exact head, redacts it, records a protected restart-durable repeat cursor, and never treats log content as authority or an executable instruction.

Use [New-B122NetworkPolicy.ps1](../deployment/windows/New-B122NetworkPolicy.ps1) to generate a secret-free policy for review. Git smart HTTP expects a separately protected Basic-auth credential value; the credential reference stores only DPAPI-sealed bytes and scope metadata.
