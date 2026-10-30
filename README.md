# Switchyard

**Give your keyboard a familiar place to return to work.**

Switchyard is a local keyboard workspace for people who move between coding
agents, editors and conversations. It starts with a ready-made arrangement:
return to your task, check progress, review work, and leave a handoff. Choose your
Model F Labs keyboard, use the recommended setup, then connect your tools.
The configurator stays behind **Customize**.

## Try the starting experience

```sh
mise exec node@24.14.0 -- npm ci --ignore-scripts
mise exec node@24.14.0 -- npm run layout:studio
```

Open the private local link printed by the app. **Home → your keyboard → Use this
setup** loads four planned controls and the *Keep my place* workflow. Browse the
catalog without an assistant account. Read/import your actual keyboard
configuration before connecting a host shortcut; a reference preset cannot
establish your current firmware or typing layout.
First use stays in keyboard-only mode. Select Personal companion in Settings
when you are ready to connect personal tools; a Work workspace uses its managed,
Copilot-only policy. Imported layouts never enable providers or recording.

- [Model F Labs configurations](docs/model-f-standard-configurations.md): 19 listed
  model/case/round combinations, 104 named references, physical options, Dvorak
  references, split boards and explicitly identified proposed designs.
- [Configuration walkthrough](docs/switchyard-configuration.md): understand a
  proposal, review an exact local connection, and restore a change.
- [Optional local runtime](docs/optional-runtime.md): install or verify the shared
  CPU voice, configuration HID and LangChain environment from pinned hashes.
- [Portable profiles](docs/portable-profiles.md): review typing/geometry assumptions,
  stable intents and migration before connecting a second computer.
- [Assignment references and legends](docs/assignment-legends.md): export saved
  controls and source-sized relegendable-cap sheets; the frontend control is pending.
- [Application packaging](docs/suite-installation.md): build the private suite
  directory, verify its contents and run it independently of the checkout.
- [Codex task bindings](docs/coding-task-bindings.md) and [Claude Code task
  bindings](docs/claude-task-bindings.md): exact native identities, actual host
  evidence and the controls still being implemented.
- [Current implementation and evidence](docs/switchyard-status.md): what runs,
  what has been checked, and what still needs implementation.
- [Full suite requirement ledger](docs/switchyard-requirements.md): every handover
  requirement, including checks that require hardware or approved accounts.
- [Earlier Omarchy tools](docs/try-switchyard.md): workflow recorder and existing
  Codex thread controls, with their own repeatable walkthrough.

## What works, and what remains

This is a **partial development suite**, built and exercised on Omarchy Linux.
The current branch combines the existing B122 control plane and Layout Studio
with a new local product shell, model catalog, configuration conversations,
protected compartments, local transcription, device transactions, custom-agent
SDK and separate Microsoft 365 Copilot adapter. Real installed-account design
requests have been exercised with Codex and Claude Code, and real custom and
LangChain example processes have exchanged authenticated intents.
The separate task backend has also created/resumed an empty read-only Codex
thread and created/stopped a tools-disabled Claude background session, with
exact identity checks and durable duplicate prevention. These host checks sent
no model prompts and do not establish completion of coding work.

These checks do not prove a finished keyboard/agent appliance. General coding-task
controls, physical role shortcut selection in the frontend, platform lifecycle acceptance, profile-library visual acceptance,
expanded device editing controls, complete device settings and final UI acceptance remain unfinished.
The complete Windows release passed 212 test/build groups at `4cab102`, including
managed startup, installer, bootstrap, portable profiles and automation checks.
The newer task/controller backend also passes native Windows tests; its complete
release is running. Interactive Windows acceptance remains open. F77 physical acceptance awaits reconnection; B122
physical acceptance and approved Microsoft tenant tests remain open. All 27 B122
acceptance gates remain **NOT ACCEPTED**. Source availability is not acceptance.

## Engineering and contribution

The repository develops an explicit intent boundary: a key asks for an operation;
a reviewed local connection decides whether that exact operation is available.
Portable layouts exclude credentials and local account/session bindings. Design
proposals stay editable, and host/device changes require separate baseline,
review, readback and restoration steps. Failures preserve a recoverable record.

Start with [the product brief](docs/switchyard-product.md), then the
[configuration decision record](docs/decisions/001-switchyard-configuration.md),
[build plan](docs/switchyard-build-plan.md) and [contribution guide](CONTRIBUTING.md).
[Attribution](ATTRIBUTION.md) preserves the keyboard/controller community's work.
No repository-wide license or public release has been approved.

The original SXSY-B122 target retains its 22-control, 65-behavior contract:
[complete specification and audit](docs/SXSY-B122-complete-key-specification-and-audit.md).
It is one hardware target within the broader Switchyard suite; the F77 is the
current pilot.

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
- `tools/layout-studio/` — the developing local product shell, offline Model F
  catalog, workflow/agent configuration, protected compartment storage and
  separately reviewed host/device configuration. See the requirement ledger for
  implementation and validation limits.
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
  configuration and authorization are present. Its separate Raw-HID simulator
  exercises all 65 assigned and 111 deliberately unassigned chord combinations,
  replay/epoch recovery, and corrupt framing without opening hardware or the
  network.
- `apps/linux-companion/` — the Linux entry point for the same durable control
  plane. It uses Secret Service-backed authenticated state, a private Unix
  socket below `XDG_RUNTIME_DIR`, exact `/proc` process identity, and a
  fail-closed Bubblewrap namespace adapter. No TCP or plaintext fallback is
  present.
- `apps/provider-adapter-host/` — an authenticated, TLS-pinned loopback host for
  the closed Claude/Codex command, observation, cancellation, Council, and
  reconciliation ports. It packages deterministic fixture backends for isolated
  verification; it does not bundle, infer, or claim live vendor authorization.
- `apps/vscode-extension/` — a VS Code bridge and lifecycle registry. It reads
  only the companion-created sealed endpoint record, may identify/focus
  approved local surfaces and route a canonical request, and does not use
  direct Run/Debug APIs as a bypass around mediation.
- `deployment/windows/` — content-verified per-user build, install, update,
  rollback, start, health, and uninstall tooling with exact-root ownership,
  crash-recovery receipts, and authenticated companion/provider shutdown.
- `deployment/linux/` — a manifest-verified portable Node bundle, reversible
  per-user systemd installation/update/rollback, hardened service unit, VS Code
  package, and narrow physical-device udev template.
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
manifest, platform isolation runtime, OS-protected credential reference, network policy,
provider handshake, external account, or scanner feed required by that route.
Absent configuration or authorization is reported as unavailable; it is never
replaced by an unreviewed fallback.

The following capabilities remain disabled by default, even though their
software policy/saga paths are represented: Council automatic mode, Repair
Mission, `lfg`, broker-enforced Merge and Direct Main, containment release,
Full Sandbox, rebuild Full Sandbox, and Quarantine. No control silently commits,
pushes, merges, force-pushes, approves a permission, or submits a prompt.

## Local development

Use the reviewed Node.js **24.14.0** runtime recorded in `.node-version` (for
example, `mise exec node@24.14.0 -- npm test`). Node 26 removed the
transformation flag used by these source tests. `npm test` runs the supported
host lane: shared and native Linux groups on Linux, and the full Windows lane
on Windows. `npm run test:all` retains the cross-host diagnostic suite and can
expose Windows-only failures on Linux. Test receipts record every group and
host skip. Tests use temporary files,
fakes, and in-memory brokers; they must never use a production database,
credentials, data, or endpoint.

```powershell
npm ci
npm test
npm run typecheck
npm run build:vscode
npm run build:companion
npm run build:linux-companion
npm run build:provider-host
```

The read-only **SXSY-B122: Show Managed Sessions** command in VS Code refreshes the authenticated companion registry and displays exact task, plan, repository, target, capability, and reported status. On Linux it also includes local Codex daemon threads as **task-bound** or **unbound** runtime rows, without changing a managed session's capability or status. It performs no host or agent action. Native ChatGPT and Claude sessions remain unknown until an authorized adapter proves their identity and observation capability.

`npm run codex:threads` gives a separate read-only [Codex thread inventory](docs/codex-thread-inventory.md) through the local App Server. It discards titles and previews and labels stored threads `not-observed`; it does not register them as verified Switchyard sessions.

`npm run codex:live` reads runtime status from an already-running current-user Codex daemon on Linux. It shows local thread IDs and status without promoting unbound threads into managed sessions.

On Linux, **SXSY-B122: Start Task-Bound Codex Thread** in VS Code creates a Codex thread for the chosen exact Git root, records Codex's returned thread ID with a short task ID, and opens that thread in a terminal. **Show Managed Sessions** displays its live local status beside the task binding; an unavailable companion target stays `unverified`. See [Codex thread inventory and binding](docs/codex-thread-inventory.md).

Before the B122 arrives, **Super+Alt+R** can toggle an opt-in local workflow study on an Omarchy workstation after installing the portable shortcut. A temporary user service counts only broad foreground app categories and time while active; it does not infer agent status. `npm run workflow -- help` lists deliberate event fields, `npm run workflow -- report` summarizes the study, and `npm run workflow -- path` shows the private log and its size. The 10 MiB log cap prevents unbounded growth. This recorder captures no prompts, code, clipboard, or window titles. See [workflow capture](docs/workflow-capture.md).

The commissioned keyboard must retain a complete standard USB typing map. On a Windows computer without Switchyard installed, ordinary keys must work immediately and the advanced controls must have no agent effect. The owner expects the B122 in **January 2027**; the current 22-control QMK overlay is not a complete typing keymap, and plug-and-type validation is scheduled after the device arrives. See the [host capability matrix](docs/platform-capability-matrix.md).

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
After `npm run build:companion`, run
`node apps/windows-companion/dist/apps/windows-companion/src/raw-hid-simulator.js --self-test`
for the hardware-independent exhaustive protocol receipt. That receipt is not
physical-device, hot-plug, Vial, LED, or ergonomic acceptance evidence.

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

- [Layout Studio quick start, profile format, and limitations](tools/layout-studio/README.md)
- [Complete specification and 27 acceptance gates](docs/SXSY-B122-complete-key-specification-and-audit.md)
- [Software-only completion audit](docs/software-only-completion-audit.md)
- [Local companion and VS Code guide](docs/local-companion.md)
- [Windows release, installation, recovery, and uninstall guide](docs/windows-release-and-installation.md)
- [Linux release, installation, recovery, and uninstall guide](docs/linux-release-and-installation.md)
- [Operational safety model](docs/operational-safety-model.md)
- [Acceptance-gate ledger](docs/acceptance-gates.md)
- [Project charter](docs/01-project-charter.md)
- [Hardware and software architecture](docs/02-system-architecture.md)
- [Workflow study protocol](docs/03-workflow-study.md)
- [August workflow reassessment](docs/workflow-reassessment-2026-10.md) and [Linux/Windows capability matrix](docs/platform-capability-matrix.md)
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
credential-reference, Raw-HID helper/simulator, Windows Sandbox guest-worker,
Linux Bubblewrap/process-group, and host-lifecycle implementations. It
does not claim physical hardware, live external authorization, pipe-ACL or
same-user adversarial acceptance, a signed release, or production readiness.
