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

Concrete Windows, GitHub, provider, scanner, and isolation adapters must still
prove their own capability reports and applicable acceptance gates before an
action can activate. A registered terminal never becomes mediated by declaration.
