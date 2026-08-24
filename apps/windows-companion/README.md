# Windows companion

The companion owns packet validation, anti-replay sequencing, device disconnect
cleanup, and truthful intent classification. It also provides the
provider-independent control plane: managed-session capability registry,
TargetSnapshot hashing, authority ledger, protected receipt/audit store,
idempotent parent/child operations, restart reconciliation, containment, and
execution/credential/test-environment broker interfaces.

A Raw HID adapter must provide a fresh host-vetted connection ID at each device
connection epoch; this permits a restarted firmware sequence without accepting
replays in an existing connection. The included local brokers deliberately deny
credential exposure, unverified test environments, and any filesystem, Git,
process, network, or prompt-submission mutation. `UnavailableAdapter` is the
functional safe fallback for proprietary or absent integrations, while
`DeterministicAdapter` and `DeterministicTestEnvironmentBroker` exist only for
isolated automated tests.

The current companion also has a packageable local-only service, authenticated
named-pipe/Unix-socket IPC, a real local Git snapshot/status/diff/commit/push
broker, canonical filesystem allowlists, review-bound sandbox leases, and a
declared isolated-test recipe runner. See [`../../docs/local-companion.md`](../../docs/local-companion.md)
for setup and the residual boundary. Direct-main, automatic merge, repair,
containment release, Full Sandbox, and Quarantine remain activation-gated.
