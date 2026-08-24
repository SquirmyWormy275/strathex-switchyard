# STRATHEX SWITCHYARD — SXSY-B122

SXSY-B122 is a safe operator station for agentic software development.  Its
keyboard firmware is intentionally a **signal source**, not an automation
engine: repository-aware behaviour belongs in a Windows companion, VS Code
extension, and (eventually) a mediated execution broker.

## What is implemented

- `firmware/qmk/` — QMK-compatible reference transport for all 22 logical
  controls. It sends versioned raw-HID signals and does not run Git, terminals,
  prompts, or desktop automation.
- `packages/protocol/` — the canonical 22-control / 65-assignment manifest,
  packet parser, and safety classifier.
- `apps/windows-companion/` — a TypeScript control plane with anti-replay
  routing, a capability/session registry, TargetSnapshot validation, scoped
  authority, protected hash-chained receipts, durable parent/child operations,
  restart reconciliation, containment, and safe broker/adapter contracts.
- `apps/vscode-extension/` — a buildable extension that registers/adopts,
  selects, displays, and retires managed VS Code sessions and creates tagged
  managed-agent terminals. Registration is never represented as mediation.
- `docs/` — the accepted complete design, historical ledger, reconstructed
  interview notes, and a source-backed adversarial review.

## Safety posture

`Managed` identifies or routes a session. Only **Mediated** execution with
filesystem, Git, credential, network, and test-data brokers can enforce policy.
The control plane implements those broker contracts, safe local deny-by-default
implementations, deterministic test doubles, and the durable policy machinery;
it does not pretend an ordinary terminal is mediated.

The following remain disabled pending mediated execution and the applicable
adversarial acceptance gates: Council automatic mode, Repair Mission, `lfg`,
broker-enforced Merge and Direct Main, containment release, Full Sandbox, and
Quarantine. No control silently commits, pushes, merges, force-pushes, approves
permissions, or submits a prompt.

## Development

This repository uses no production database. Protocol and router tests are
pure in-memory tests:

```powershell
npm install
npm test
npm run typecheck
```

QMK compilation is intentionally not part of the default test command because
it requires the selected B122-compatible target and toolchain. See
[`firmware/qmk/README.md`](firmware/qmk/README.md) before adapting the matrix.

## Current evidence boundary

The source and isolated tests prove the static protocol, complete dispatch,
safe local policy, durable lifecycle, recovery, and VS Code extension build.
They do **not** prove hardware identity, live provider capability, Windows UI
automation, broker-enforced OS isolation, provider parity, or all 27 acceptance
gates. See [`docs/software-completion-audit.md`](docs/software-completion-audit.md)

For the concrete local companion, setup, and post-PR #4 software residual
boundary, see [`docs/local-companion.md`](docs/local-companion.md) and
[`docs/software-residual-ledger.md`](docs/software-residual-ledger.md).
for the requirement-by-requirement boundary.
