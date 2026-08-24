# SXSY-B122 operational safety model

> This document describes the software-only safety model implemented in this repository. It is not a claim that an ordinary terminal, an installed VS Code extension, a keyboard, or a provider desktop application is already an enforceable boundary.

Read this with the accepted [SXSY-B122-complete-key-specification-and-audit.md](SXSY-B122-complete-key-specification-and-audit.md) and the current [software-only-completion-audit.md](software-only-completion-audit.md). The specification defines intended behavior; the audit records which local mechanisms and which external evidence actually exist.

## The non-negotiable rule

**A B122 chord expresses intent. It is not authority, authentication, or permission to perform a side effect.**

Firmware, a Raw HID packet, a VS Code command, repository text, CI output, terminal output, browser content, prompts, and provider responses all begin as input. They may describe a request, but they cannot select a target, grant authority, satisfy an acceptance gate, obtain a credential, remove containment, or cause a fallback shell command to run.

The practical consequence is simple: an absent component is reported honestly. It is never replaced by an unreviewed approximation.

## Control flow and trust boundaries

Signal, VS Code chord, or local bridge request flows to the canonical protocol assignment, then through CompanionService or ControlRouter to the one CommandDispatcher catalogue entry. The durable companion endpoint hydrates session lifecycle records; when constructed by the durable bootstrap, it runs no-replay startup recovery before becoming ready. DurableMediatedExecutor loads protected session, authority, and acceptance-evidence records, resolves a fresh target only from trusted host/session identity, and writes its content-addressed TargetSnapshot into the protected ledger before dispatch. When required, a host UI attestor issues an exact-scope confirmation through the durable confirmation ledger; the token is consumed once and a bridge payload cannot assert reauthentication. The dispatcher allocates a durable operation before policy issues an operation-bound short-lived permit. Runtime governance then requires a checkpoint capture, exact checkpoint scope, read-only artifact verification, and a second complete same-ID target snapshot immediately before budget/broker dispatch. A changed, incomplete, ignored-input-unknown, or unavailable target stops the broker. Only then can a broker-class command or Plan Approval receive a running budget claim, deadline/cancellation control, and an explicit typed adapter or broker that observes the containment fence. Protected operation, receipt, audit, checkpoint, confirmation, and budget stores record the result before the control plane considers the operation settled.

The left half of this path routes and evaluates a request. The adapter/broker half is where a real side effect could occur, but only if a concrete, trusted adapter has been deliberately installed. The bundled in-memory brokers do not open a shell, fetch a URL, create a database, or contact a provider.

| Boundary | Trusted only for | Must never be trusted for |
| --- | --- | --- |
| Hardware, Raw HID, or extension bridge | Conveying a bounded, canonical chord and a selected local identity. | Authority, confirmation, target selection, acceptance evidence, or a successful action result. |
| Repository, logs, CI, browser, provider output | Diagnosis and display after redaction. | Instructions that alter policy, recipient, target, authority, or gates. |
| Session adapter handshake | The exact independently proven capabilities of that session. | Inferring that a visible terminal is Observable, Controllable, or Mediated. |
| Authority ledger and companion UI | Current exact-action/task/plan grant, scoped target/session, durable exact-scope confirmation, and host-attested reauthentication. | Interpreting untrusted text as a grant or wildcard permission. |
| Policy permit | A short-lived binding of action, durable operation, target, session, authority, and confirmation. | A reusable credential, a cross-operation replay token, or a bypass around a broker. |
| Typed broker or adapter | A narrowly registered external action or safe unavailable result. | Arbitrary shell text, provider fallback, force-push semantics, or an implicit credential. |
| Protected store | Append-only local records, hash-chain integrity checks, durable operation/containment state, and—when a reviewed host supplies one—authentication tags from a non-agent-accessible key boundary. | Proof that DPAPI/NCrypt/service authentication is actually implemented, operating-system hardening, or a substitute for external acceptance evidence. |

## Capabilities are independent, not a maturity label

A session can possess any verified combination of these capabilities:

- **Registered:** the host can identify or focus the surface.
- **Observable:** a structured adapter reports heartbeats and verified state.
- **Controllable:** an adapter can verify pause, context injection, or resume.
- **Mediated:** file, Git, process, credential, and network paths for the relevant operation are inside an enforceable broker or isolation boundary.

Managed is a routing description, not a security claim. A terminal created by VS Code, or adopted by a user, remains Registered until an adapter proves more. The extension and companion deliberately reject attempts to self-declare Mediated state. See [session-registry.ts](../packages/control-plane/src/session-registry.ts), [service.ts](../apps/windows-companion/src/service.ts), and [controller.ts](../apps/vscode-extension/src/controller.ts).

## Preconditions for consequential work

Consequential work must have all of the following immediately before it is sent to a broker:

1. A canonical, settled catalogue entry, not free-form command text.
2. An unambiguous selected target and, where required, a complete TargetSnapshot.
3. The exact capability set required by that action.
4. A current, exact-scoped, non-revoked authority grant.
5. A durable, one-time companion-UI confirmation for the exact action, target, session, and authority where the catalogue requires one.
6. Host-attested reauthentication for high-consequence work when policy requires it; a keyboard, extension, or bridge payload cannot self-attest it.
7. Current trusted passed evidence for every acceptance gate named by that high-consequence action.
8. A short-lived permit accepted by the specific broker and bound to this action, durable operation, target, session, authority, and confirmation.
9. An exact snapshot written to TargetSnapshotLedger before dispatch and, for a consequential action, re-resolved after checkpoint capture immediately before broker dispatch; it must remain complete and have the same content ID, including explicitly classified ignored inputs.
10. Where the action is risky, a trusted checkpoint capture recorded and asserted against that exact target/operation scope, with every recovery artifact read-only verified against its recorded digest immediately before broker dispatch.
11. For a broker-class command or Plan Approval, an active durable budget claim within a configured command-class limit plus operation-ID-scoped deadline/cancellation control.
12. An explicit adapter, recipe, or mutation factory; missing registration is unavailable, never a guessed command.

DurableMediatedExecutor wires DurableBudgetManager into runtime dispatch governance. The manager remains the durable admission/reconciliation record for command-class concurrency, timeout, retry, claim-count, and cost limits. Runtime governance adds a deadline schedule and operation-ID-scoped control; it may ask a reviewed host operation-control adapter to cancel or reconcile, but it never guesses a PID, sends a shell kill, or retries a process on its own.

The policy engine defaults to an empty high-consequence allowlist. The acceptance-evidence ledger defaults to a denying attestor. Consequently, Council automatic mode, Repair Mission, lfg, brokered merge/Direct Main, containment release, Full Sandbox, rebuild Full Sandbox, and Quarantine remain disabled unless a trusted host configuration and current evidence enable them.

## Durable state rather than optimistic UI

The control plane is designed around protected append-only storage outside the agent-writable repository. It records:

- session lifecycle, heartbeat, and capability evidence;
- scoped authority grants and revocations;
- content-addressed target snapshots recorded before policy/broker dispatch, plus typed receipt/audit records;
- durable confirmation issue/consume records (the bearer token itself is never journaled);
- parent/child operation sagas with idempotency keys, resource leases, and no-replay reconciliation state;
- Council epochs and acknowledgements;
- containment fence epochs and release records;
- manual-only checkpoint/recovery-artifact references and observations;
- versioned command-class budget configurations and admission/cancellation/retry claims; and
- acceptance evidence and invalidation lineage.

`ProtectedJsonStore` hash-chains these records. A host can authenticate each record hash with `JournalAuthenticator`; the durable companion bootstrap requires such an authenticator except in its explicit test-only mode. This repository supplies the interface and fail-closed wiring, not a DPAPI/NCrypt/service-key implementation. An operation has explicit states including prepared, executing, external_committed, recorded, failed, cancelling, compensating, and cancelled. If the companion loses a response after an external child could have run, it must reconcile that child; it must not restart the parent saga as a retry shortcut. Startup recovery observes pending work and never replays a broker action. Hash-chain or required authentication-tag failures fail closed. The concrete local mechanisms live in [store.ts](../packages/control-plane/src/store.ts), [confirmations.ts](../packages/control-plane/src/confirmations.ts), [operations.ts](../packages/control-plane/src/operations.ts), and [receipts.ts](../packages/control-plane/src/receipts.ts).

CheckpointLedger is intentionally not a recovery executor: it stores redacted immutable references and digests, validates them with a read-only verifier, and produces a manual-only guide that explicitly prohibits automatic restore, deletion, stashing, and overwrite. Durable runtime governance requires a trusted capture adapter, records the checkpoint, asserts its exact operation/snapshot scope, and calls its injected `RecoveryArtifactVerifier` immediately before it invokes a relevant risky broker. Missing, mismatched, or unverifiable artifacts stop that broker path. This is durable software state, not proof that every external provider has a reconciliation adapter. A provider-specific integration must supply its own read-before-retry and idempotency behavior.

## Budget, retry, and cancellation discipline

DurableBudgetManager records a versioned budget for each command class. A missing, malformed, or unlisted budget fails closed. Within DurableMediatedExecutor, its governance layer claims and starts the appropriate budget before every broker-class dispatch and Plan Approval, installs a deadline callback, and records the typed result. An admitted claim has a durable identity and limits for concurrency, timeout, attempts, claim-count window, and cost window. A duplicate press focuses the active claim rather than allocating another one; retries require an explicit failed predecessor; a timeout becomes a durable cancellation/reconciliation state; and cancellation is an explicit recorded request rather than a hidden kill command.

The manager deliberately contains no process launcher, provider call, or background retry loop. Runtime governance uses a deadline scheduler and `ExecutionControlRegistry` to signal the exact operation ID, persists cancellation before it invokes an optional host operation-control adapter, and holds an ambiguous post-dispatch result as running until reconciliation. A concrete external adapter must still propagate a cancellation request where that is actually possible and return a reconciled result. This keeps the control plane from claiming it can cancel a remote CI job, an unmediated terminal, or an external provider by itself.

## Safe adapter and broker model

Each external capability has an interface and a fail-closed default.

| Capability | Safe behavior without a real integration |
| --- | --- |
| Desktop, provider, or browser navigation | UnavailableCommandAdapter reports the missing surface and never substitutes another provider. |
| Command or process execution | InMemoryExecutionBroker accepts only a fixed executable/argument recipe, exact operation-bound permit, and registered handler; it never invokes a shell itself. |
| Git mutation | InMemoryGitBroker accepts typed mutations only, rejects force semantics, and verifies the exact action/operation/target/session/authority permit binding. Composite dispatch supplies a durable child-saga boundary to the handler; no implicit push occurs. |
| Credentials | InMemoryCredentialBroker returns an opaque scoped lease, not secret material, and only after permit/fence checks. |
| Network | InMemoryNetworkBroker uses an allowlisted test response only; it does not fetch. |
| Pipeline or Repair environment | InMemoryTestEnvironmentBroker creates a descriptor with deny-egress and a test database name, without inheriting process environment or opening a database. |
| Full Sandbox or Quarantine | UnavailableIsolationRuntime refuses to claim isolation. The in-memory variant says simulated explicitly. |
| Automation or agent workflow | InMemoryAutomationBroker runs only a registered trusted handler; otherwise no prompt or workflow is submitted. |
| Runtime governance | TargetSnapshotLedger records immutable target identity before dispatch; checkpoint capture and artifact verification, immediate complete same-ID target revalidation (including ignored inputs), durable budget admission, deadline/cancellation control, and no-replay recovery block or preserve the relevant risky/broker paths before an adapter is called. |

These classes are intentional seams for a future real Windows service, Git adapter, credential vault, CI connector, and sandbox backend. They are useful for isolated local testing precisely because they cannot silently contact a real system.

## Test-data boundary

Pipeline and Repair paths through this control plane do not inherit an ordinary terminal's environment. They need a repository-declared validation recipe and a test-environment broker that rejects configured production patterns and sensitive variables. With no verified recipe or no real isolation backend, the correct result is unavailable or blocked. This does not prevent an unmediated terminal from reaching its own environment; that bypass remains explicitly outside the claimed boundary.

This design protects the test suite itself: unit tests use fakes, in-memory brokers, and temporary protected journals. They must never use a production database, production credentials, production data, or production endpoints.

## Containment is bounded but durable

Emergency Containment is a durable policy fence for brokered Git, credential, network, and deployment paths. Activation records a new fence epoch before best-effort credential-revocation and queued-operation-cancellation hooks run. That order preserves the fact that an incident occurred even if a hook fails.

Containment does **not** claim to stop:

- a raw shell or raw Git invocation outside mediation;
- another desktop application;
- an already-running remote job; or
- a credential or service outside the configured broker boundary.

Those paths must be shown as uncontrolled. Release is a separate administrative operation: it needs an exact target, authority, confirmation, reauthentication, a reason, and an incident or credential-rotation finding. It is never released by a key press.

## Operator-visible outcomes

The companion should report one of the typed results rather than translate uncertainty into success:

| Result | Meaning |
| --- | --- |
| unavailable | No verified adapter, target, recipe, capability, or isolation runtime exists. |
| incomplete | The snapshot or evidence cannot safely be treated as complete, including when revalidation observes changed target inputs. |
| blocked | Policy, containment, authority, gate, or explicit safety rule denied the request. |
| awaiting_confirmation | The action is otherwise eligible but needs an exact companion-UI confirmation. |
| running or cancelling | A durable operation is active; an identical request should focus it rather than duplicate it. |
| failed or timed_out | The action ended without a successful durable conclusion; reconcile before retry where an external side effect might exist. |
| completed | A registered component reported its typed result. It does not by itself establish an acceptance gate. |

## What must be added before real external enablement

The repository should not turn a high-consequence feature on until its integration supplies all of the following:

1. A real, authenticated companion host with a DPAPI/NCrypt/service-backed `JournalAuthenticator` implementation and protected storage/identity model.
2. A concrete capability handshake for the specific VS Code/provider/build.
3. An OS-enforced mediated process, credential, network, test-data, and sandbox boundary, not merely a TypeScript interface or venv, with real external adapters propagating deadline/cancellation/reconciliation decisions.
4. Typed, least-privilege Git/GitHub/CI/credential/provider adapters with provider-state reconciliation and no unsafe fallback.
5. A disposable integration test harness that never sees production data or credentials.
6. Real hardware, lifecycle, adapter-degradation, failure-injection, privacy, and provider-parity testing for the relevant acceptance gates.
7. Authenticated, target-scoped, expiring gate evidence recorded in the protected ledger; invalidation must disable the feature again.

Until then, the safety model's most important behavior is restraint: it keeps software-only workflows inspectable and testable while refusing to mistake a keyboard shortcut or a local mock for control over a real external system.
