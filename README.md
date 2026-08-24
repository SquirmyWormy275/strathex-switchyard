# STRATHEX SWITCHYARD — SXSY-B122

> Route attention. Direct agents. Keep the operator in command.

SXSY-B122 is a software-only safety control plane for a proposed 22-control
operator keyboard for agentic software development. Its target platform is a
Model F Labs B122 with a programmable Leyden Jar/Vial/QMK lineage, but the
physical keyboard and its integration are not validated by this repository.

**Current status:** the repository contains the hardware-independent B122
implementation: the canonical protocol and firmware/Raw-HID host source; the
mutually authenticated, single-instance Windows companion; the VS Code
operator and provisioning surfaces; durable mediation, receipts, recovery,
containment, and Council; host-attested repository recipes; DPAPI credential
references; exact-route HTTPS; configured provider, GitHub/Git/CI and scanner
adapters; the Windows Sandbox guest/helper boundary; and reproducible per-user
release tooling. Source availability is **not** production, hardware, provider,
or acceptance evidence. Every one of the 27 gates remains **NOT ACCEPTED**.

The accepted design has 10 left-bank agent-control keys, 12 upper-row workspace
keys, 65 settled chord behaviors, and 111 intentionally unassigned chord slots.
The complete behavior contract and adversarial review live in
[docs/SXSY-B122-complete-key-specification-and-audit.md](docs/SXSY-B122-complete-key-specification-and-audit.md).

## What this project is

Agentic development spreads work across editors, terminals, repositories,
worktrees, browser sessions, and multiple coding agents. SWITCHYARD explores a
stable physical vocabulary for supervisory actions—route attention, inspect
work, hand off context, interrupt, review, and approve only within a known
boundary—rather than a macro layer that grants ambient authority.

A keyboard chord is an intent signal, never authority to change a repository,
start a process, use a credential, or submit a prompt. The physical device
conveys a bounded signal; a reviewed host decides whether a concrete action is
safe and available in the current context.

## What is implemented here

- `firmware/qmk/` — QMK-compatible reference firmware that emits bounded,
  versioned Raw HID signals only. It does not run Git, a terminal, a browser,
  or desktop automation.
- `packages/protocol/` — the canonical 22-control / 65-behavior manifest,
  packet validation, and a closed command map. Unknown, forged, and
  intentionally unassigned chords have no fallback action.
- `packages/control-plane/` — the TypeScript mediation model: managed-session
  lifecycle, exact target snapshots, authority and policy checks, durable
  one-time confirmations, operation/child-operation sagas, receipts,
  no-replay recovery, containment, budget claims, deadline/cancellation
  control, and typed broker interfaces.
- `apps/windows-companion/` — a local named-pipe companion and bootstrap seam.
  On Windows it uses a DPAPI CurrentUser-protected journal and endpoint token,
  mutual challenge/response authentication, and strict single-instance state.
  It hydrates durable state and runs no-replay startup recovery without opening
  TCP. Host-attested registries connect reviewed repository recipes, Windows
  Sandbox, credential references, exact-route HTTPS, provider handshakes,
  GitHub/Git, CI, scanner, and Council adapters when their required local
  configuration and authorization are present.
- `apps/vscode-extension/` — a VS Code bridge and lifecycle registry. It reads
  only the companion-created sealed endpoint record, may identify/focus
  approved local surfaces and route a canonical request, and does not use
  direct Run/Debug APIs as a bypass around mediation.
- `docs/` — the accepted specification, reconstructed interview history,
  adversarial review, project charter, attribution records, operational safety
  model, and source-linked software-only completion audit.

## The safety boundary

`Managed` means the companion can identify or route a session. It does **not**
mean the session is trusted or mediated. A filesystem, Git, credential, process,
network, test-data, or containment claim can only be enforced through a
reviewed, concrete mediated adapter or broker.

```text
B122 signal / extension request
  -> canonical assignment and selected registered session
  -> protected target snapshot and scoped authority
  -> durable exact-scope confirmation (when required)
  -> operation ID, policy permit, checkpoint/artifact verification
  -> budget claim, deadline/cancellation control, containment check
  -> explicitly registered typed broker or safe unavailable result
```

The in-memory brokers and adapters are test harnesses and never contact a real
system. The installed composition also contains concrete, fail-closed adapters.
Those adapters can act only after the operator installs the exact repository
manifest, Windows feature/helper, DPAPI credential reference, network policy,
provider handshake, external account, or scanner feed required by that route.
Absent configuration or authorization is reported as unavailable; it is never
replaced by an unreviewed fallback.

The following capabilities remain disabled by default, even though their
software policy/saga paths are represented: Council automatic mode, Repair
Mission, `lfg`, broker-enforced Merge and Direct Main, containment release,
Full Sandbox, rebuild Full Sandbox, and Quarantine. No control silently commits,
pushes, merges, force-pushes, approves a permission, or submits a prompt.

## Local development

Use a current Node.js runtime that supports TypeScript transformation (the test
scripts use `node --experimental-transform-types`). Tests use temporary files,
fakes, and in-memory brokers; they must never use a production database,
credentials, data, or endpoint.

```powershell
npm ci
npm test
npm run typecheck
npm run build:vscode
```

`npm run start:companion` starts the reviewed per-user companion, not a Windows
service or service-account boundary. The standalone entry point supplies the
reviewed Git-mutation queue and the configured adapter registries described
above. It still does not establish independent named-pipe ACL acceptance,
same-user adversary resistance, or production authorization. Uninstalled or
unauthorized integrations fail closed. See
[the local companion guide](docs/local-companion.md).

QMK compilation is not part of the default suite because it needs the selected
physical B122-compatible target and toolchain. See
[firmware/qmk/README.md](firmware/qmk/README.md) before adapting the matrix.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a contribution. In
particular:

- Treat [the complete specification](docs/SXSY-B122-complete-key-specification-and-audit.md)
  as authoritative; the historical ledger and reconstructed interview notes are
  traceability material.
- Keep the signal-only firmware boundary and the distinction between Registered,
  Observable, Controllable, and Mediated sessions intact.
- Add isolated automated coverage with every behavior change, and update
  [the software-only audit](docs/software-only-completion-audit.md) when a
  mechanism or its evidence boundary changes.
- Do not enable a high-consequence path on the strength of a mock, a local
  receipt, or a keyboard event. It needs the applicable real acceptance evidence
  first.
- Never put secrets, production credentials, production test data, or a
  production database in the repository or test harness.

## Documentation, attribution, and governance

- [Complete specification and 27 acceptance gates](docs/SXSY-B122-complete-key-specification-and-audit.md)
- [Software-only completion audit](docs/software-only-completion-audit.md)
- [Local companion and VS Code guide](docs/local-companion.md)
- [Operational safety model](docs/operational-safety-model.md)
- [Acceptance-gate ledger](docs/acceptance-gates.md)
- [Project charter](docs/01-project-charter.md)
- [Hardware and software architecture](docs/02-system-architecture.md)
- [Workflow study protocol](docs/03-workflow-study.md)
- [Control taxonomy requirements](docs/04-control-taxonomy.md)
- [Publication roadmap](docs/05-roadmap.md) and [publication gate](docs/06-publication-gate.md)
- [Documentation provenance](docs/README.md)
- [Attribution register](ATTRIBUTION.md), [source bibliography](docs/references/bibliography.md),
  [licensing status](LICENSING.md), [security policy](SECURITY.md), and
  [third-party material policy](third-party/README.md)

STRATHEX SWITCHYARD is an independent community project and is not affiliated
with, sponsored by, or endorsed by Model F Labs, IBM, Vial, QMK, Microsoft,
OpenAI, Anthropic, or any other referenced project or company.

The audit is the current evidence boundary: it documents source-controlled
mechanisms and isolated tests, including the configured provider/GitHub,
credential-reference, Raw-HID-helper, and Windows Sandbox implementations. It
does not claim physical hardware, live external authorization, pipe-ACL or
same-user adversarial acceptance, a signed release, or production readiness.
