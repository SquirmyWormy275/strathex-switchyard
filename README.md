# STRATHEX SWITCHYARD — SXSY-B122

SXSY-B122 is a safe operator station for agentic software development.  Its
keyboard firmware is intentionally a **signal source**, not an automation
engine: repository-aware behaviour belongs in a Windows companion, VS Code
extension, and (eventually) a mediated execution broker.

## What is in this baseline

- `firmware/qmk/` — QMK-compatible reference transport for all 22 logical
  controls. It sends versioned raw-HID signals and does not run Git, terminals,
  prompts, or desktop automation.
- `packages/protocol/` — the canonical 22-control / 65-assignment manifest,
  packet parser, and safety classifier.
- `apps/windows-companion/` — a TypeScript, preview-only router that validates
  packets, rejects stale/replayed input, and produces auditable intents. It
  never performs the requested action.
- `apps/vscode-extension/` — a TypeScript extension skeleton that records a
  managed-session registration and displays a routed intent. It makes no claim
  that an ordinary terminal is controlled.
- `docs/` — the accepted complete design, historical ledger, reconstructed
  interview notes, and a source-backed adversarial review.

## Safety posture

`Managed` identifies or routes a session. Only a future **Mediated** session
with filesystem, Git, credential, network, and test-data brokers can enforce
policy. This baseline has no such broker, so every signal is either a
non-mutating route/preview or explicitly unavailable.

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

The source and unit tests prove the static protocol and preview-only policy.
They do **not** prove hardware identity, Windows/VS Code integration,
broker-enforced isolation, provider parity, or any of the 27 acceptance gates.
Those gates are tracked in [`docs/acceptance-gates.md`](docs/acceptance-gates.md).
