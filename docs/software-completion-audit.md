# B122 software-foundation audit (superseded by post-merge audit)

**Audit date:** 2026-08-23  
**Authority:** `SXSY-B122-complete-key-specification-and-audit.md`  
**Scope:** software that can be implemented and deterministically tested without the physical B122, an installed proprietary provider, or production credentials.

> **Historical point-in-time record:** this document predates the completed
> hardware-independent implementation. It describes the earlier safe
> control-plane foundation and must not be read as current source capability.
> See [`software-only-completion-audit.md`](software-only-completion-audit.md)
> for the current mechanism/evidence boundary. The historical PR #3 findings
> remain in [`post-merge-adversarial-audit.md`](post-merge-adversarial-audit.md).

## What is implemented

The Windows companion control plane now provides a provider-independent session registry; honest Registered/Observable/Controllable/Mediated capability reporting; target snapshot capture and revalidation; authority validation; protected append-only hash-chained receipts; durable idempotent parent/child operations; restart reconciliation; containment; audited redaction; and safe execution, credential, and test-environment broker contracts. Its default local adapters fail closed. Deterministic adapters and an in-memory isolated-test environment support automated tests without devices, provider accounts, production credentials, network access, or production databases.

The VS Code extension persists registration/adoption, selection, managed-agent terminal creation, lifecycle downgrade on terminal close, and capability/status display. It deliberately creates Registered-only sessions: an adapter evidence report is required to mark a session Observable, Controllable, or Mediated.

Provider adapters have a complete discovery/focus/pause/context-injection contract, with safe unavailable and deterministic implementations. Context and review packages are typed and bound to a target digest. Council machinery reports planned-file conflicts and only leases independent paths when every participant is running, Observable, Controllable, and Mediated; its automatic key chord stays gated.

## Dispatch audit — all settled chord assignments

`packages/protocol/src/b122.ts` remains the single canonical manifest: 22 controls, 65 settled chord assignments, and 111 intentionally unassigned slots. `OperationCoordinator.dispatch` covers every assignment as a generic safe route or broker request; it does **not** itself implement the named Windows, provider, Git, GitHub, scanner, voice, or isolation behaviors. The safe local broker returns `unavailable`; it does not perform filesystem, Git, credentials, process, network, or prompt-submission actions. High-consequence controls first receive a durable blocked operation and audit entry, then remain activation-gated.

| Control | Settled modes covered | Software result |
| --- | --- | --- |
| Re-anchor | Normal | Mediated request with authority/snapshot/receipt lifecycle |
| Proof | Normal, Shift | Mediated self-audit/adversarial-review request lifecycle |
| Option Provider | Normal, Shift | Mediated five-option/decision-packet request lifecycle |
| Plan Expander | Normal | Mediated ranked-alternatives request lifecycle |
| Plan Approval | Normal | Scoped-authority and selected-session execution lifecycle |
| Handoff | Normal, Shift, Alt, Shift+Alt | Durable mediated packet path plus safe visible focus/default routes |
| Find Blocked / Finished | Normal, Shift | Observable registry discovery and safe queue routes |
| Authority Refresh | Normal, Shift | Versioned scoped authority validation/broadcast request lifecycle |
| Council | Normal, Shift, Alt | Conflict/plan lifecycle; Shift has durable gated-operation machinery and remains disabled |
| Claude / ChatGPT | Normal, Shift, Alt | Safe route plus managed terminal-registration integration |
| VS Code / Terminal | Normal, Shift | Safe visible routing and VS Code terminal integration |
| Commit | Normal, Shift, Alt, Shift+Alt | Broker lifecycle; Merge and Direct Main are durably gated |
| GitHub | Normal, Shift, Alt, Shift+Alt | Non-mutating navigation routes |
| Compound | Normal, Shift, Alt, Shift+Alt | Broker/preview paths; `lfg` is durably gated |
| Run | Normal, Shift, Alt, Shift+Alt | Brokered process lifecycle contract (safe local broker unavailable) |
| Voice | Normal, Shift, Alt, Shift+Alt | Provider-neutral route/binding contract; unavailable adapters fail closed |
| Pipeline | Normal, Shift, Alt, Shift+Alt, Ctrl+Shift+Alt | Brokered isolated-test contract; Repair Mission is durably gated |
| Shield | Normal, Shift, Alt, Shift+Alt, Ctrl+Shift+Alt | Scanner/receipt contract; containment workflow is durably gated |
| Sandbox | Normal, Shift, Alt, Shift+Alt, Ctrl+Shift+Alt | Isolation contract; Full Sandbox and Quarantine are durably gated |

All Ctrl, Ctrl+Shift, and Ctrl+Alt combinations not listed in the authoritative matrix return the explicit `unassigned` result. They do not fall through to a neighboring action.

## Safety and recovery audit

| Requirement | Evidence in software test suite |
| --- | --- |
| TargetSnapshot covers dirty/policy/environment inputs | Snapshot-digest tests change tracked and untracked inputs with unchanged HEAD |
| Managed is not Mediated | Registry accepts no inferred capability; invalid finished report is rejected |
| 65 assignments / unassigned slots | Every settled assignment dispatches; unassigned control returns `unassigned` |
| Durable idempotency and receipts | Duplicate operation keys focus existing durable operation; receipts are hash-chained |
| Parent/child sagas and recovery | Child IDs persist under parent; executing operation reconciles on restart |
| Authority and target revalidation | Missing authority and changed snapshot block before execution |
| Containment | State persists in protected store; release requires reauthentication and a reason |
| Broker isolation | Safe local credential/test/execution brokers deny access; deterministic test broker exposes only in-memory SQLite and denied-network markers |
| Adapter degradation | Unavailable adapter returns typed `unavailable`, never a false success |
| High-risk gating | Council automatic, Merge, Direct Main, `lfg`, Repair Mission, containment action, Full Sandbox, rebuild, and Quarantine create blocked/audited/receipted operations and make no external call |

## Residual items that cannot be claimed complete yet

These are deliberately not hidden by the control plane:

- Physical key mapping, HID lifecycle, chord ergonomics, Raw HID coexistence, firmware/device identity, LEDs, and all gate-1/14/22 evidence require the actual keyboard.
- VS Code can register and select sessions, but proving provider state, pause/context injection, or Mediation requires a real Claude/Codex adapter and provider authorization. Unmanaged surfaces remain unknown.
- Windows app launching, native voice entry/binding, GitHub API/CLI mutation, CI, scanner feeds, credential issuance, container/WSL/VM enforcement, live test recipes, and hosted provider parity require locally authorized external integrations. The contracts and safe unavailable behavior are implemented; activation is not claimed.
- The 27 acceptance gates have software harness coverage where possible, but are not globally marked passed: the evidence document must not substitute deterministic tests for hardware, provider, security-scanner, production-isolation, or operational observations.
- No software path silently submits prompts, approves permissions, commits, pushes, merges, force-pushes, releases containment, or uses production data/credentials.
