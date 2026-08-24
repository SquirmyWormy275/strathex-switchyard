# STRATHEX SWITCHYARD — SXSY-B122

SXSY-B122 is a software-only safety control plane for a proposed 22-control operator keyboard. A chord is an intent signal, never authority to change a repository, start a process, use a credential, or submit a prompt.

> **Current status:** the repository implements and locally tests the software-owned control-plane machinery. It is **not** a production control system, a hardware integration, or evidence that any of the 27 acceptance gates has passed. Every gate remains **NOT ACCEPTED**.

The accepted design has 10 left-bank agent-control keys, 12 upper-row workspace keys, 65 settled chord behaviors, and 111 intentionally unassigned chord slots. The complete behavior contract and adversarial review live in [docs/SXSY-B122-complete-key-specification-and-audit.md](docs/SXSY-B122-complete-key-specification-and-audit.md).

## What is implemented here

- `firmware/qmk/` — QMK-compatible reference firmware that emits bounded, versioned Raw HID signals only. It does not run Git, a terminal, a browser, or desktop automation.
- `packages/protocol/` — the canonical 22-control / 65-behavior manifest, packet validation, and a closed command map. Unknown, forged, and intentionally unassigned chords have no fallback action.
- `packages/control-plane/` — the TypeScript mediation model: managed-session lifecycle, exact target snapshots, authority and policy checks, durable one-time confirmations, operation/child-operation sagas, receipts, no-replay recovery, containment, budget claims, deadline/cancellation control, and typed broker interfaces.
- `apps/windows-companion/` — a local JSON-lines companion endpoint and bootstrap seam. It hydrates durable state, runs no-replay startup recovery, and requires a host-owned journal authenticator for a non-test durable companion.
- `apps/vscode-extension/` — a VS Code bridge and lifecycle registry. It may identify/focus approved local surfaces and route a canonical request; it does not use direct Run/Debug APIs as a bypass around mediation.
- `docs/` — the accepted specification, reconstructed interview history, adversarial review, operational safety model, and a source-linked software-only completion audit.

## The safety boundary

`Managed` means the companion can identify or route a session. It does **not** mean the session is trusted or mediated. A filesystem, Git, credential, process, network, test-data, or containment claim can only be enforced through a reviewed, concrete mediated adapter or broker.

For consequential work, the software path is deliberately narrow:

```text
B122 signal / extension request
  -> canonical assignment and selected registered session
  -> protected target snapshot and scoped authority
  -> durable exact-scope confirmation (when required)
  -> operation ID, policy permit, checkpoint/artifact verification
  -> budget claim, deadline/cancellation control, containment check
  -> explicitly registered typed broker or safe unavailable result
```

The supplied in-memory brokers and adapters are test harnesses. They do not open shells, use credentials, fetch URLs, create databases, mutate GitHub, or contact an AI provider.

The following capabilities remain disabled by default, even though their software policy/saga paths are represented: Council automatic mode, Repair Mission, `lfg`, broker-enforced Merge and Direct Main, containment release, Full Sandbox, rebuild Full Sandbox, and Quarantine. No control silently commits, pushes, merges, force-pushes, approves a permission, or submits a prompt.

## Local development

Use a current Node.js runtime that supports TypeScript stripping (the test scripts use `node --experimental-strip-types`). Tests use temporary files, fakes, and in-memory brokers; they must never use a production database, credentials, data, or endpoint.

```powershell
npm ci
npm test
npm run typecheck
npm run build:vscode
```

`npm run start:companion` is intentionally **not** a ready-to-use Windows service. The standalone entry point fails closed because no DPAPI/NCrypt/service-backed `JournalAuthenticator` is bundled. A reviewed host must embed `createDurableWindowsCompanion`, provide that authenticator, and supply any real adapters before a durable companion can start.

QMK compilation is not part of the default suite because it needs the selected physical B122-compatible target and toolchain. See [firmware/qmk/README.md](firmware/qmk/README.md) before adapting the matrix.

## Contributor expectations

- Treat [the complete specification](docs/SXSY-B122-complete-key-specification-and-audit.md) as authoritative; the historical ledger and reconstructed interview notes are traceability material.
- Keep the signal-only firmware boundary and the distinction between Registered, Observable, Controllable, and Mediated sessions intact.
- Add isolated automated coverage with every behavior change, and update [the software-only audit](docs/software-only-completion-audit.md) when a mechanism or its evidence boundary changes.
- Do not enable a high-consequence path on the strength of a mock, a local receipt, or a keyboard event. It needs the applicable real acceptance evidence first.
- Never put secrets, production credentials, production test data, or a production database in the repository or test harness.

## Reading map

- [Complete specification and 27 acceptance gates](docs/SXSY-B122-complete-key-specification-and-audit.md)
- [Software-only completion audit](docs/software-only-completion-audit.md)
- [Operational safety model](docs/operational-safety-model.md)
- [Acceptance-gate ledger](docs/acceptance-gates.md)
- [Documentation provenance](docs/README.md)

The audit is the current evidence boundary: it documents source-controlled mechanisms and isolated tests, not hardware, Windows service, provider, GitHub, credential-vault, isolation-runtime, or production readiness.
