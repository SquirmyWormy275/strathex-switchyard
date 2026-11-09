# Switchyard

**Keep your place when work moves between tools.**

Switchyard turns a Model F keyboard into a set of consistent controls: return to
a task, check progress, review work and leave a handoff. Start with a recommended
layout, keep your normal typing keys, then connect the tools you actually use.
Direct configuration works without an assistant account.

The project brings Alex's workflow requirements and Model F setup into a reusable
application. The F77 is the current pilot; the B122 is a separate future physical
showcase. [See Alex's F77 setup](examples/alex-f77/README.md) and the
[product decisions](docs/switchyard-requirements.md).

**Development status:** the application runs on the pilot's Omarchy Linux
workstation. Windows software and packaging have independent test evidence.
The full suite is unfinished, and there is no approved public release.

## Try it without accounts or hardware

From a source checkout with the pinned Node **24.14.0** environment:

```sh
npm ci --ignore-scripts
node scripts/demo-switchyard-ui.mjs --synthetic
```

Open the private local link printed by the command. Choose **Home → F77 Classic →
Use this setup**, then follow the [guided walkthrough](docs/guided-setup.md).
The demo includes a synthetic keyboard readout, saved conversations and a signed
example agent. It refuses real hardware, account and desktop operations.
Ctrl+C removes its temporary state.

Home gives you a useful starting arrangement. **Customize** contains the keyboard
workbench. A reference preset is a preview: applying a real change requires
evidence of the actual keyboard and a separate review.

| Your next step | Start here |
| --- | --- |
| Use Switchyard | [Guided setup](docs/guided-setup.md), then [installation and rollback](docs/suite-installation.md) |
| See Alex's setup | [F77 pilot](examples/alex-f77/README.md) and [B122 reference](examples/alex-b122/README.md) |
| Choose your keyboard | [Model F catalog](docs/model-f-standard-configurations.md): 19 listed model/case/round combinations and 104 named references |
| Understand the evidence | [Current status](docs/switchyard-status.md) and [requirement ledger](docs/switchyard-requirements.md) |
| Develop or extend | [Documentation guide](docs/README.md), [integration contracts](integrations/README.md) and [contributing](CONTRIBUTING.md) |

## What you can do

- **Build a layout that fits your work.** Preview keys, name tool roles, discuss
  structured proposals or edit directly. Normal typing stays part of the design.
- **Connect an exact target.** Supported task, conversation, app and custom-agent
  connections have distinct capabilities. An app homepage is not a resumed task.
- **Review before acting.** Shortcuts, task permissions, repository execution and
  device changes have their own scope and confirmation. Uncertain replies remain
  visible and are not automatically repeated.
- **Keep work separate.** Personal and Work use separate protected state and
  provider policy. Work can remain Copilot-only or keyboard-only.
- **Take your preferences with you.** Portable profiles carry layout and control
  meanings; accounts, credentials and local task connections stay on the computer.
- **Refine from observation.** Opt in to supported event sources, review aggregate
  observations or voice transcripts, and use them in a design proposal.

Follow the [connected backend demonstration](docs/backend-demonstration.md) for
preset → named role → signed command → observation → revised portable profile.
It uses disposable encrypted state and needs no external account.

## Evidence and remaining work

Results belong to the specific source tested; an older passing suite does not
accept later changes.

| Scope | Verified result |
| --- | --- |
| Installed Linux application, `3222727` | 36 served assets, 33 API checks and 121 installed metadata checks; 54 semantic workspaces preserved. [Receipt](docs/evidence/installed-legacy-account-summary.json) |
| Running synthetic demonstration, `dfa40fb` | Nine checks: named connection, signed acknowledgement and stale-workspace refusal. [Receipt](docs/evidence/batched-inspection-running-demo-summary.json) |
| Native Codex terminal, synthetic provider | Real 0.167 CLI renders legacy and paginated saved transcripts through the production relay; one narrowed resume, zero model prompts. [Receipt](docs/evidence/codex-native-paginated-history-summary.json) |
| Native Linux repository inspection | Twelve real Git guardians, at most four concurrent reads, independent exit and unchanged repository bytes. [Receipt](docs/evidence/batched-inspection-source-summary.json) |
| Complete Linux suite, `72e7c22` | 376 groups, 2,574 passing tests, 32 declared skips; later account-read correction has separate scoped evidence. [Receipt](docs/evidence/linux-72e7c22-complete-summary.json) |
| Windows client lane, `3222727` | 31 groups, 362 passing tests, zero skips; later lease correction and full-suite acceptance remain separate. [Receipt](docs/evidence/native-client-3222727-summary.json) |
| Complete Windows source, `f4dcc79` | 482 groups, 3,157 passing tests, 246 declared skips; all 23 workers and native collector pass with original limits and audited cleanup. [Receipt](docs/evidence/complete-windows-f4dcc79-summary.json) |
| Earlier Windows package, `7529718` | 462 groups, 2,910 passing tests, 246 declared skips; bundle construction and smoke checks pass. [Receipt](docs/evidence/windows-package-7529718-summary.json) |

**Unfinished software:** Linux Claude Desktop focus/launch and the broader
observation and scanner capabilities tracked in the ledger. The Windows UI files
now pass their original limits, though execution retains a narrow timing margin.
Earlier repeated-focus and other intermittent native failures remain recorded.
[Retained Windows failures](docs/evidence/native-48bf450-results-summary.json).

**Separate acceptance checks:** browser task/visual review, physical F77/B122
changes, approved Microsoft tenant access, live native accounts/tasks, interactive
Windows/IDE behavior, microphone capture and printed legend fit. The browser
control connection currently fails before page loading. Synthetic checks do not
establish these results.

## How it is built

A keyboard signals intent. The host checks the selected workspace, exact target,
current policy and any required one-use review before an adapter acts.

| Area | Responsibility |
| --- | --- |
| [Layout Studio](tools/layout-studio/README.md) | Local application, keyboard workspace, guided setup and configuration |
| `packages/protocol/` | Versioned hardware signals and the canonical control vocabulary |
| `packages/control-plane/` | Target snapshots, scoped authority, durable operations and recovery |
| `apps/linux-companion/` and `apps/windows-companion/` | Platform identity, authenticated local channels and supervised execution |
| `apps/vscode-extension/` | Saved-project/task controls and exact owned-terminal selection |
| `integrations/` and `apps/provider-adapter-host/` | Explicit provider capabilities, signed custom-agent SDK and adapter contracts |
| `deployment/suite/` | Verified application bundle, installation, update, rollback and removal |
| [QMK reference](firmware/qmk/README.md) | Signal-only firmware; physical target commissioning is separate |

Lost replies cannot grant a new action. Imported profiles cannot import
credentials or approvals. Unsupported targets stay unavailable instead of typing
into an unrelated foreground window. Read the
[operational model](docs/operational-safety-model.md) for the enforcement boundary
and its limitations.

## Development

Use the pinned runtime in [.node-version](.node-version). With dependencies
installed, start the normal local application or run the supported host checks:

```sh
npm run layout:studio
npm test
npm run typecheck
```

The normal application uses persistent local state; the synthetic demo above is
the disposable starting point. Windows source checks also require the reviewed
native helper described in [private state locking](docs/private-state-locking.md).
[Build and package instructions](docs/suite-installation.md) cover both platforms.
No firmware flashing is part of these commands.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing behavior and
[the continuation record](docs/switchyard-continuation.md) before resuming the
current implementation. The [B122 specification and acceptance gates](docs/acceptance-gates.md)
remain separate from the F77 pilot.

## Attribution and publication

See [licensing status](LICENSING.md), [attribution](ATTRIBUTION.md),
[security policy](SECURITY.md) and [publication gates](docs/06-publication-gate.md).
This is an independent project, not an official product of Model F Labs, IBM,
Vial, QMK, Microsoft, OpenAI, Anthropic or other referenced vendors.
