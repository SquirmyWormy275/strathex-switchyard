# SXSY-B122 software-only completion audit

> **Status:** implementation and local-test audit only. This document does **not** mark any acceptance gate as passed or make a production-readiness claim. The accepted design and gate language remain authoritative in [SXSY-B122-complete-key-specification-and-audit.md](SXSY-B122-complete-key-specification-and-audit.md).

## Purpose and evidence standard

This audit records software mechanisms now present in the repository and the local automated tests that exercise them. It deliberately distinguishes three things that must not be conflated.

| Term | Meaning in this audit |
| --- | --- |
| **Implemented mechanism** | Typed, source-controlled code exists with a defined safe failure path. |
| **Local test evidence** | An isolated unit or component test exercises a mechanism using fakes, in-memory brokers, or temporary files. |
| **Acceptance evidence** | Authenticated, target-scoped, current evidence from real hardware, operating systems, providers, or external services. None is recorded here. |

The acceptance-evidence ledger defaults to a denying attestor: local code cannot promote a gate merely because a test produced text. See [acceptance-evidence.ts](../packages/control-plane/src/acceptance-evidence.ts) and [acceptance-evidence.test.ts](../packages/control-plane/test/acceptance-evidence.test.ts).

The historical ledger and reconstructed interview notes remain traceability material. The complete specification supersedes them where they differ.

## Closed command-map coverage

The canonical software map is [command-catalog.ts](../packages/control-plane/src/command-catalog.ts). Catalogue construction asserts that its length and chord identities exactly match the protocol's 65 settled assignments. [command-catalog.test.ts](../packages/control-plane/test/command-catalog.test.ts) checks that invariant, and [dispatch.test.ts](../packages/control-plane/test/dispatch.test.ts) exercises a truthful disposition for every settled command.

Abbreviations below are N (normal), S (Shift), A (Alt), S+A (Shift+Alt), and C+S+A (Ctrl+Shift+Alt). The remaining 111 combinations are intentionally unassigned and cannot acquire a fallback behavior.

| Bank | Control | Settled chord to canonical action |
| --- | --- | --- |
| Agent | Re-anchor | N reanchor |
| Agent | Proof | N proof; S proof_adversarial |
| Agent | Option Provider | N option_provider; S option_packet |
| Agent | Plan Expander | N plan_expander |
| Agent | Plan Approval | N plan_approval |
| Agent | Handoff | N handoff; S handoff_queue; A handoff_immediate; S+A handoff_routing_default |
| Agent | Find Blocked Agent | N focus_blocked_agent; S blocker_queue |
| Agent | Find Finished Agent | N focus_finished_agent; S done_queue |
| Agent | Authority Refresh | N authority_refresh; S authority_broadcast |
| Agent | Council | N council_report; S council_automatic; A council_recommend |
| Workspace | Claude | N open_claude; S fresh_claude; A open_managed_claude_terminal |
| Workspace | ChatGPT | N open_chatgpt; S fresh_chatgpt; A open_managed_codex_terminal |
| Workspace | VS Code | N focus_vscode; S new_vscode |
| Workspace | Terminal | N focus_terminal; S focus_vscode_terminal |
| Workspace | Commit | N local_commit; S pr_upsert; A pr_merge; S+A direct_main |
| Workspace | GitHub | N github_home; S github_pr; A github_issues; S+A github_actions |
| Workspace | Compound | N compound_capture; S compound_refresh; A compound_palette; S+A lfg |
| Workspace | Run | N run_target; S debug_target; A stop_managed_run; S+A launch_web_app |
| Workspace | Voice | N open_voice; S switch_voice_provider; A bind_voice_session; S+A voice_session_picker |
| Workspace | Pipeline | N pipeline_status; S pipeline_local_gate; A pipeline_failure_trace; S+A pipeline_clean_reproduction; C+S+A repair_mission |
| Workspace | Shield | N shield_change_scan; S shield_codebase_audit; A shield_supply_chain; S+A release_shield; C+S+A emergency_containment |
| Workspace | Sandbox | N venv; S rebuild_venv; A full_sandbox; S+A rebuild_full_sandbox; C+S+A quarantine |

Containment release is deliberately **not** a keyboard chord. It is the separate containment_release administrative command and must go through companion UI review, reauthentication, exact-target confirmation, and incident-status checks.

## Software mechanism coverage

| Area | Present mechanism | Local evidence and important limit |
| --- | --- | --- |
| Protocol-to-command routing | A canonical assignment is matched before dispatch; forged/mismatched and intentionally unassigned chords are blocked. | [command-catalog.test.ts](../packages/control-plane/test/command-catalog.test.ts), [dispatch.test.ts](../packages/control-plane/test/dispatch.test.ts). This does not prove a physical keyboard emitted the signal. |
| Windows companion transport and lifecycle | A versioned local JSON-lines bridge handles registration, adoption, lifecycle updates, canonical command dispatch, confirmation requests, and durable operation-ID cancellation requests without opening a network listener. A durable endpoint hydrates protected session records and fails closed if lifecycle persistence or configured startup recovery fails; the durable bootstrap configures no-replay startup recovery before the endpoint is ready. | [service.test.ts](../apps/windows-companion/test/service.test.ts), [stdio.test.ts](../apps/windows-companion/test/stdio.test.ts), [durable-endpoint.test.ts](../apps/windows-companion/test/durable-endpoint.test.ts), [bootstrap.test.ts](../apps/windows-companion/test/bootstrap.test.ts). The service alone is not an execution boundary or a Windows service installation. |
| Raw-HID-facing router | Per-device and per-connection replay state rejects stale, repeated, ambiguous, and invalid packets; route-only and high-consequence behavior remains truthful. | [router.test.ts](../apps/windows-companion/test/router.test.ts). No real Raw HID handshake, hot-plug, sleep/resume, Vial, or keyboard has been tested. |
| VS Code lifecycle | The extension registers workspace, Git-root, terminal, and debug identities; terminal adoption is one-time and remains Registered. Only tagged-terminal creation and integrated-terminal focus are allowlisted local host actions. Run, Debug, and managed Stop stay mediated and cannot call VS Code's direct process/debug APIs. | [controller.test.ts](../apps/vscode-extension/test/controller.test.ts). Tests use a VS Code-shaped fake, not an installed extension against a live VS Code/provider build. |
| Managed sessions | Registry records independent Registered, Observable, Controllable, and Mediated capabilities, heartbeat/staleness, and never infers verified blocked or finished status. | [session-registry.ts](../packages/control-plane/src/session-registry.ts), [session-authority.test.ts](../packages/control-plane/test/session-authority.test.ts). A real adapter must prove capabilities. |
| Context and Handoff | Durable task packets bind plan, decisions, authority reference, target, documentation, references, and routing state without creating authority or execution rights. | [context-packages.ts](../packages/control-plane/src/context-packages.ts), [context-council.test.ts](../packages/control-plane/test/context-council.test.ts). |
| Target identity | TargetSnapshotFactory and the read-only Git inspector capture canonical repository state, tracked/untracked **and ignored** manifests, submodules, policy/configuration, and environment fingerprints; every present ignored input needs an explicit classification, and the safe default is `unknown`/incomplete. WorkspaceSnapshotResolver uses a selected protected session root rather than terminal text or command input. DurableMediatedExecutor records the resulting content-addressed snapshot before policy or broker dispatch, then re-resolves and compares a complete exact snapshot after checkpoint capture and immediately before budget/broker dispatch for consequential work. | [snapshot.ts](../packages/control-plane/src/snapshot.ts), [git-inspector.ts](../packages/control-plane/src/git-inspector.ts), [snapshot-ledger.ts](../packages/control-plane/src/snapshot-ledger.ts), [git-inspector.test.ts](../packages/control-plane/test/git-inspector.test.ts), [snapshot-resolver.test.ts](../packages/control-plane/test/snapshot-resolver.test.ts), [snapshot-ledger.test.ts](../packages/control-plane/test/snapshot-ledger.test.ts), [runtime.test.ts](../packages/control-plane/test/runtime.test.ts). A live multi-repository/provider race has not been exercised. |
| Authority and policy | Protected, exact-scoped, expiring, revocable authority grants bind repository, session, task, plan revision, action, and time. Policy checks target, capabilities, high-consequence gates, confirmation, and reauthentication. Untrusted input is data, never authority. | [authority.ts](../packages/control-plane/src/authority.ts), [policy.ts](../packages/control-plane/src/policy.ts), [session-authority.test.ts](../packages/control-plane/test/session-authority.test.ts), [policy.test.ts](../packages/control-plane/test/policy.test.ts). The default high-consequence allowlist is empty. |
| Durable confirmations and permits | A protected ledger issues a bearer token only once to reviewed host UI, persists only its digest, atomically consumes it, and binds it to the exact action, target snapshot, session, and authority. Reauthentication is set only by a host attestor; a bridge payload cannot self-attest. The short-lived broker permit is additionally bound to the durable operation ID. | [confirmations.ts](../packages/control-plane/src/confirmations.ts), [confirmations.test.ts](../packages/control-plane/test/confirmations.test.ts), [policy.test.ts](../packages/control-plane/test/policy.test.ts), [runtime.test.ts](../packages/control-plane/test/runtime.test.ts). No production companion UI, identity provider, or reauthentication ceremony is bundled. |
| Protected operations, receipts, and recovery | ProtectedJsonStore hash-chains records and can require a host-backed `JournalAuthenticator` tag over every record hash. The durable bootstrap rejects a hash-chain-only store outside its test-only opt-out. Parent/child sagas, idempotency keys, resource leases, typed receipts, redacted audit records, and no-replay observation/reconciliation are implemented; an unresolved external child cannot be silently replayed or terminally hidden by its parent. | [store.ts](../packages/control-plane/src/store.ts), [operations.ts](../packages/control-plane/src/operations.ts), [store-receipts.test.ts](../packages/control-plane/test/store-receipts.test.ts), [snapshot-operations.test.ts](../packages/control-plane/test/snapshot-operations.test.ts), [child-saga-recovery.test.ts](../packages/control-plane/test/child-saga-recovery.test.ts), [bootstrap.test.ts](../apps/windows-companion/test/bootstrap.test.ts). Tests use local temporary files and fake observations; no DPAPI/NCrypt implementation or provider side effect is present. |
| Checkpoints and recovery guidance | CheckpointLedger stores redacted immutable references and digests for recovery artifacts and returns a manual-only recovery guide that cannot restore, delete, stash, or overwrite work. For a risky workflow, durable runtime governance requires a trusted capture adapter, exact operation/snapshot assertion, **and a read-only RecoveryArtifactVerifier immediately before broker dispatch**. | [checkpoints.ts](../packages/control-plane/src/checkpoints.ts), [runtime.ts](../packages/control-plane/src/runtime.ts), [checkpoints.test.ts](../packages/control-plane/test/checkpoints.test.ts), [runtime.test.ts](../packages/control-plane/test/runtime.test.ts). Missing, mismatched, or unverifiable artifacts stop the broker; this is not a backup engine or automated restore path. |
| Budgets, deadlines, retries, and cancellation | DurableBudgetManager persists versioned per-command-class limits and claims; it fails closed on missing configuration and enforces concurrency, timeout, claim-count, cost, and explicit-attempt limits. Runtime governance admits and starts a claim before every broker-class command and Plan Approval, installs a deadline callback, exposes operation-ID-scoped cancellation state to adapters, and asks an optional reviewed host operation-control adapter to cancel or reconcile. It never guesses a PID, sends a shell kill, or retries an ambiguous external result. | [budgets.ts](../packages/control-plane/src/budgets.ts), [execution-control.ts](../packages/control-plane/src/execution-control.ts), [runtime.ts](../packages/control-plane/src/runtime.ts), [budgets.test.ts](../packages/control-plane/test/budgets.test.ts), [runtime.test.ts](../packages/control-plane/test/runtime.test.ts). Without a real host controller, timeout/cancellation remains visible and unresolved for reconciliation rather than claiming a remote job stopped. |
| Typed broker boundary | Execution, Git, credential, network, test-environment, automation, Council, and isolation interfaces accept typed requests and an exact permit binding (action, operation, target, session, and authority); they reject raw shell strings, force semantics, unsafe URLs, and permit replay. Composite broker calls receive a durable child-saga boundary. Missing trusted handlers are unavailable. | [brokers.ts](../packages/control-plane/src/brokers.ts), [dispatch.ts](../packages/control-plane/src/dispatch.ts), [brokers.test.ts](../packages/control-plane/test/brokers.test.ts), [child-saga-recovery.test.ts](../packages/control-plane/test/child-saga-recovery.test.ts). In-memory implementations are a safe test harness, not production adapters. |
| Council | Reporting detects conflicts. Automatic epochs require cooperative pause, Observable+Controllable+Mediated participants, leases, acknowledgements, and abort on overlap, staleness, or failure. | [council.ts](../packages/control-plane/src/council.ts), [context-council.test.ts](../packages/control-plane/test/context-council.test.ts). It does not independently manipulate worktrees or arbitrary terminals. |
| Containment | Durable fence epochs persist before revocation/cancellation hooks; brokered Git, credential, and network paths can be fenced; release requires explicit review inputs. | [containment.ts](../packages/control-plane/src/containment.ts), [durable-containment.test.ts](../packages/control-plane/test/durable-containment.test.ts). It cannot stop unmediated shells, other applications, or already-running remote jobs. |
| Adapter degradation | Desktop/provider adapters and unregistered actions return unavailable rather than silently switching products or invoking a shell. | [adapters.ts](../packages/control-plane/src/adapters.ts), [adapters.test.ts](../packages/control-plane/test/adapters.test.ts). No proprietary desktop/provider integration is claimed. |

## High-consequence paths remain disabled

The command catalogue treats the following paths as policy-gated. The default policy does not enable them, and the gate-evidence ledger has no trusted, current passed evidence in this repository. A raw keyboard event, repository file, prompt, log, or provider response cannot change that result.

| Path | Required software controls represented | Current operational result |
| --- | --- | --- |
| Council automatic | Complete target, all four participant capabilities, scoped authority, confirmation, required gates, epoch and lease safeguards. | **Blocked by default**; no real mediated multi-agent acceptance evidence. |
| PR merge and Direct Main | Complete snapshot, scoped authority, one-time confirmation, optional reauthentication, typed Git mutation, no force semantics, gate/receipt checks. | **Blocked by default**; no real GitHub, branch-protection, or exact-head evidence. |
| Full lfg loop | Mediated target/session, authority, confirmation, gate evidence, typed automation adapter, containment fence. | **Blocked by default**; no provider/Compound automation adapter is registered. |
| Repair Mission | Mediated target/session, authority, confirmation, test-environment broker, automation adapter, gate evidence. | **Blocked by default**; no isolated provider worker or real test-environment runtime is attached. |
| Emergency Containment | Policy/confirmation/gate checks, durable fence activation, cancellation and credential-revocation hook interfaces. | **Blocked by default** until gate policy permits it; even when active it covers brokered paths only. |
| Containment release | Administrative-only command, exact target, authority, confirmation, reauthentication, reason, incident/rotation status, gate checks. | **Blocked by default**; never a keyboard toggle. |
| Full Sandbox, rebuild, Quarantine | Policy/confirmation/gate checks and an isolation-runtime interface. | **Unavailable or blocked safely** without a proven OS isolation backend; the in-memory runtime labels itself simulated. |

Normal local commit, PR upsert, declared execution, validation, and security commands still require their listed policy conditions and explicit typed adapter/broker registration. No control silently commits, pushes, merges, force-pushes, grants permission, or submits a prompt.

Inside DurableMediatedExecutor, a fresh exact snapshot is written to the protected ledger before dispatch. Risky Git, environment rebuild, Council repartition, Repair Mission, and risky automation paths additionally require a trusted checkpoint-capture adapter, exact checkpoint scope assertion, and read-only verification of every recovery artifact immediately before broker dispatch. For a consequential action, governance then re-resolves and records the target again, requiring a complete snapshot with the same exact content ID immediately before budget/broker dispatch; a changed, incomplete, ignored-input-unknown, or unavailable target stops the broker. Runtime-dispatched broker classes and Plan Approval receive durable budget admission/start and an operation-ID-scoped execution control. Deadline/cancellation requests persist before an optional reviewed host controller is called; if a controller is absent or reconciliation is ambiguous, the work remains visible and non-retryable rather than being declared stopped.

## Acceptance-gate audit

Every gate below is **NOT ACCEPTED**. A local mechanism means only that the repository contains a testable design element related to the gate; it is not the gate's required real-world evidence. This supplements rather than mutates [acceptance-gates.md](acceptance-gates.md).

| # | Gate | Local mechanism or test evidence | Acceptance result and remaining evidence |
| --- | --- | --- | --- |
| 1 | Hardware identity | Closed 65-command catalogue and route validation. | **NOT ACCEPTED.** Test actual B122 key/chord emission and Windows collisions. |
| 2 | Target integrity | Snapshot model, explicit target requirement, VS Code Git-root registration, and default-incomplete handling for present ignored inputs. | **NOT ACCEPTED.** Exercise multiple repositories/windows and picker-or-stop behavior end to end. |
| 3 | State honesty | Typed states and fail-closed policy/adapter results; session-status tests. | **NOT ACCEPTED.** Verify every real UI and receipt preserves unknown, stale, unavailable, incomplete, failed, and passed distinctions. |
| 4 | Idempotency | Durable parent/child operation store, idempotency key, operation-bound permits, exact snapshot ledger, budget claim reuse, and no-replay reconciliation tests. | **NOT ACCEPTED.** Crash/restart against real provider mutations without duplicate effects. |
| 5 | Test isolation | Deny-egress disposable-environment descriptor rejects production patterns and secret names. | **NOT ACCEPTED.** Prove actual processes cannot reach production credentials, DSNs, hosts, databases, or data. |
| 6 | Authority | Exact-action/task/plan authority ledger, durable exact-scope confirmation, and policy tests for scope, expiry, revocation, one-time use, and confirmation binding. | **NOT ACCEPTED.** Authenticate the authority source and test real platform approval boundaries. |
| 7 | Target-snapshot safety | Complete-snapshot policy requirement, trusted target resolver, protected content-addressed TargetSnapshotLedger, and a second complete/same-ID target revalidation immediately before budget/broker dispatch. The local runtime test proves a changed target blocks the broker. | **NOT ACCEPTED.** Revalidate immediately before a real merge, Direct Main, and release action against real external adapters. |
| 8 | Containment honesty | Durable containment state identifies brokered versus uncontrolled paths. | **NOT ACCEPTED.** Demonstrate all claimed outbound paths and visibly report every bypass path. |
| 9 | Provider parity | Provider-specific unavailable adapters and registered-only extension adoption avoid false equivalence. | **NOT ACCEPTED.** Maintain a versioned Claude/Codex/mixed capability matrix using live adapters. |
| 10 | Council failure cases | Collision, stale-state, missing-acknowledgement, and observable-only tests. | **NOT ACCEPTED.** Cover dependencies, dirty worktrees, adapter loss, and live mediated multi-agent coordination. |
| 11 | Voice binding | Voice commands are canonical actions but require an adapter. | **NOT ACCEPTED.** No microphone, transcript, selected-session binding, redaction, or retention integration exists. |
| 12 | Isolation | An unavailable default and explicitly simulated test runtime prevent a venv claim. | **NOT ACCEPTED.** Prove filesystem, credentials, data, network, CPU, memory, and time isolation on Windows. |
| 13 | Recoverability | Manual-only CheckpointLedger persists redacted immutable recovery-artifact references and guidance; runtime requires capture, exact scope assertion, and read-only artifact verification immediately before relevant risky broker paths. Integrity/tamper and no-capture/no-verifier/no-broker behavior are locally tested. | **NOT ACCEPTED.** Capture and exercise actual preservation artifacts before real rebuild, repartition, or Repair Mission work; no automatic restoration is authorized. |
| 14 | Physical usability | None beyond logical chord definitions. | **NOT ACCEPTED.** Test legends and advanced chord ergonomics on the physical keyboard. |
| 15 | Mediation | Policy and brokers require a Mediated capability and permit before broker calls. | **NOT ACCEPTED.** Prove operating-system/process isolation prevents or discloses real raw-shell bypasses. |
| 16 | Crash reconciliation | Parent/child reconciliation is locally tested with fake observations; startup invokes no-replay recovery and an ambiguous post-dispatch budget record stays running for reconciliation rather than allowing a retry. | **NOT ACCEPTED.** Terminate after each real external child side effect and reconcile after restart. |
| 17 | Snapshot integrity | Tracked, untracked, and ignored manifests plus fingerprints can produce incomplete snapshots; protected receipts/evidence support expiry/invalidation. | **NOT ACCEPTED.** Mutate every listed staged, unstaged, untracked, ignored, submodule, tool, scanner, and advisory input after a real receipt. |
| 18 | Prompt-injection resistance | Dispatcher ignores untrusted input for target/authority; redaction and bounded bridge input are tested. | **NOT ACCEPTED.** Adversarially test docs, logs, CI, dependency, browser, and PR-comment payloads through real adapters. |
| 19 | Credential isolation | Opaque scoped leases; test environment starts with no inherited credentials; isolation runtime fails closed. | **NOT ACCEPTED.** Prove live high-risk paths lack production credentials and production DSNs. |
| 20 | Persistent containment and authenticated release | Durable store-backed fence, protected confirmation/reauthentication interfaces, cancellation/revocation hooks, and release preconditions. | **NOT ACCEPTED.** Restart companion and machine, fence actual queued work/leases, then complete a real reauthenticated release review. |
| 21 | Council epoch and lease safety | Durable epoch, acknowledgements, conflict detection, and resource leases. | **NOT ACCEPTED.** Inject live edits, conflicts, heartbeat loss, and dirty work to prove no automatic rewrite or move. |
| 22 | Transport lifecycle | Router test covers replay state, connection epochs, and device separation. | **NOT ACCEPTED.** Test real hot-plug, sleep/resume, multiple keyboards, Vial, synthetic HID, and Raw HID coexistence. |
| 23 | Adapter degradation | Unavailable adapters do not redirect; companion/extension fail closed on a missing bridge. | **NOT ACCEPTED.** Change/remove actual shell, app, and provider integrations and observe truthful downgrade. |
| 24 | Partial-failure recovery | Durable parent/child states and reconciliation abstain from replaying an ambiguous parent or child; runtime preserves a running result when governance/budget recording is ambiguous and checks recovery artifacts before risky dispatch. | **NOT ACCEPTED.** Fault-inject every real mutation stage and verify reconciliation or preserved recovery material. |
| 25 | Voice privacy and routing | No live voice surface is attached, which is safer than an unsupported claim. | **NOT ACCEPTED.** Prove consent, selection, provider switching, interruption, retention/deletion, and no cross-task leakage. |
| 26 | Untrusted URL defense | Repository recipes restrict development URLs; network broker uses a method/host allowlist. | **NOT ACCEPTED.** Exercise malicious real server/browser output and verify no unsafe URL opens. |
| 27 | Budget, retry, concurrency, cancellation | DurableBudgetManager persists command-class configuration/claims and locally tests fail-closed config, concurrency, quotas/cost, timeout, explicit retry, and cancellation states. Runtime governance schedules deadline callbacks, provides operation-ID-scoped cancellation control, requests durable cancellation before an optional host controller, and keeps ambiguous results running. | **NOT ACCEPTED.** Prove time/cost/concurrency/retry behavior and actual process/CI/sandbox cancellation end to end with real external adapters. |

## Explicitly unverified or unavailable external edges

The following are intentionally not represented as completed capabilities:

- physical B122 firmware/Raw HID identity, device handshake, LEDs, key legends, ergonomics, and transport coexistence;
- a signed or authenticated Windows service installation, a DPAPI/NCrypt/service-backed `JournalAuthenticator` implementation, and protected-store operating-system access control;
- real Claude, ChatGPT, Codex, browser, desktop, voice, GitHub, CI, scanner, credential-vault, or Compound provider adapters;
- real Git/GitHub side effects, branch protection, platform approval prompts, remote cancellation, and provider-state reconciliation;
- a Windows container, WSL, or VM isolation backend with actual network, mount, credential, data, CPU, memory, and time enforcement; and
- production credentials, production databases, production data, or production endpoints. Local tests use fakes, in-memory brokers, and temporary stores.

Before any external edge is enabled, attach a concrete adapter only through the typed broker boundary, add an isolated integration harness, collect authenticated target-scoped gate evidence, and keep the gate disabled when that evidence expires or is invalidated.

## Conclusion

The repository has the complete software command vocabulary and the source-controlled control-plane mechanisms required to route, constrain, record, recover, and test B122 intent without hardware. It is deliberately **not** an accepted hardware or production control system. Its safe default is to route low-risk local intent or report unavailable, incomplete, awaiting-confirmation, running, cancelling, timed_out, or blocked; it does not turn missing host authentication, adapters, credentials, isolation, or acceptance evidence into a successful high-consequence action.
