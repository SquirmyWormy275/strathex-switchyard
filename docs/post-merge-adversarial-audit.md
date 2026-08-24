# Post-merge adversarial audit — PR #3

**Audited revision:** `816e3d5` (PR #3 merge)  
**Scope:** software evidence only; no physical B122, proprietary provider, or
production credential was used.

## Corrected completion boundary

PR #3 completed a useful **safe control-plane foundation**, not all B122
software behaviors. The canonical manifest has all 22 controls and 65 settled
chords, and the companion can reject unsafe requests, retain operation/receipt
state, and exercise deterministic doubles. It does not yet implement a real
Windows launcher, Raw-HID host, Git/GitHub broker, provider adapter, VS Code
companion IPC, scanner, isolation runtime, or live test-environment recipe.
Those chords therefore must remain `preview`, `unavailable`, or
`disabled_pending_gates`; no document or test name may upgrade them to complete.

## Corrective hardening in the audit branch

- Reject malformed packets with any length other than the exact eight-byte
  B122 framing.
- Reject stale capability reports and capability flags for an unregistered
  surface. Apply each capability required by a chord independently: provider
  context operations require Controllable, discovery/Council reporting require
  Observable, and mutable flows require Mediated.
- Reject stale/unreachable sessions before a broker call.
- Serialize protected-store mutation in-process and atomically reserve the
  idempotency key, so concurrent identical presses create one operation and
  one broker call.
- Bind idempotency keys and child saga operations to their exact action,
  parent, and target. A reused key cannot report another action as successful.

The deterministic test suite covers every corrected failure mode. This is
necessary safety machinery, not evidence that an unavailable external adapter
works in production.

## Requirement status

| Area | Verdict | Evidence boundary |
| --- | --- | --- |
| Protocol: 22 controls, 65 assignments, unassigned chords | Complete | Static manifest and round-trip/rejection tests. Physical emission remains hardware-dependent. |
| Packet parsing and replay routing | Complete in software | Exact framing, checksum, reserved-byte, sequence, reconnect, and isolation tests. Raw-HID host lifecycle is hardware-dependent. |
| Session registration, selection, terminal-close downgrade | Complete in extension scope | Extension builds and persists registered-only session records. Companion IPC and provider handshake are incomplete. |
| Capability truth and lifecycle fail-closed behavior | Complete for local control plane | Consistency, monotonic heartbeat, stale-status, Observable, and Controllable checks are tested. Provider reports remain externally unverified. |
| Every chord's named host behavior | Incomplete | The coordinator dispatches generic intent/broker paths, but real launcher, agent, Git, GitHub, run/debug, voice, Pipeline, Shield, and Sandbox adapters are not implemented. |
| TargetSnapshot construction/revalidation | Incomplete | Hashing covers modeled fields; no trusted live Git snapshot collector or immediate pre-action revalidation adapter exists. |
| Authority, receipts, operations, and recovery | Partially complete | In-memory authority plus protected hash-chain receipts and deterministic recovery are tested. Authority/lease persistence, cross-process single-writer locking, real side-effect reconciliation, and retention are incomplete. |
| Council | Incomplete and safely gated | Planned-file overlap and in-memory leases exist; epochs, acknowledgements, dependency/resource collection, durable leases, and isolation are absent. Automatic mode is disabled. |
| Credential/network/test-data brokers | Partially complete | Safe local brokers deny; deterministic test broker advertises in-memory SQLite and denied network. There is no enforcement runtime, production DSN policy engine, or concrete scoped credential issuer. |
| Containment | Partially complete | Durable local flag and reviewed release precondition are tested. Credential revocation, queued-operation cancellation, outbound broker fencing, restart/machine proof, and an authenticated UI flow are incomplete. |
| Provider contracts and local doubles | Complete as contracts | Typed unavailable/deterministic discovery, focus, pause, and context injection are tested. Real Claude/Codex adapters require provider authorization. |
| VS Code managed execution | Incomplete | Registration/adoption is real; workspace Git state, run/debug/process registration, companion transport, and mediated execution are absent. |
| High-consequence controls | Complete only as disabled fail-closed paths | All nine high-risk chords create audited blocked operations and make no external call. Their activation gates are not passed. |

## Acceptance gates

No acceptance gate is passed by this audit. Gates 1, 14, and 22 require the
physical keyboard. Gates requiring live providers, GitHub, scanners,
credentials, CI, Windows app behavior, or a container/VM remain externally
blocked until authorized integrations exist. The remaining software gates are
not hardware-blocked, but need the incomplete concrete components listed
above; they must not be relabeled as external or hardware residuals.
