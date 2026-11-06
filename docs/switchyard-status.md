# Switchyard implementation and acceptance

Switchyard gives a Model F keyboard stable controls for returning to tasks,
reviewing changes and handing work between tools. **The full Rev2 suite is still
a partial implementation.** The F77 is the pilot device; it does not limit scope.

The Linux backend has a passing complete test checkpoint, and a versioned
application is installed. The source has since gained additional tested changes.
Windows restricted-owner startup is an active software failure. Hardware,
account and visual acceptance remain separate from those implementation results.

Use the [requirement ledger](switchyard-requirements.md) for the complete scope,
[verification record](verification.md) for evidence, and
[continuation notes](switchyard-continuation.md) to resume engineering work.
The [README](../README.md) explains the product and first run.
Work is published on [draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20);
there is no merge or public release acceptance.

## Current evidence

| Boundary | Verified result | Still open |
| --- | --- | --- |
| Complete Linux source | `dad5400`: **281 groups, 1,776 passing tests, fifteen declared skips, zero failures.** All owned children, checkout, dependency aliases and generated files were removed. [Receipt](evidence/linux-dad-complete-summary.json). | Provider/guest doubles remain explicit. Later task scheduling and Windows-only diagnostics have separate focused evidence. |
| Windows backend batches | `dbbcce8`: 170 of 171 groups accepted, 971 passing tests and 135 declared skips. The native lease group passes. [Receipts](evidence/windows-backend-dbbc-native-summary.json). | One task-owner file timed out without a complete plan. All 26 original cases now run independently under the same 45-second child bound; all pass locally. Native follow-up is pending. [Correction](evidence/task-owner-scenarios-source-summary.json). |
| Restricted Windows owner | `d15285b` identifies the failure as **CreatePipe / stdin / Access Denied (5)**, after guardian readiness and the start acknowledgement. [Receipt](evidence/worker-start-native-summary.json). | **0/8 original checks accepted.** No worker is created. A candidate gives only the three new pipes explicit owner access and verifies all six handles plus unchanged token default-DACL bytes. Native acceptance is pending. [Contract](windows-private-command-pipes.md). |
| Installation and runtime | All sixteen original Windows installation/recovery cases pass at `b600a6d`; its independent fresh runtime installs 49 packages and loads/rechecks the offline CPU model, then removes its temporary runtime. [Installation](evidence/installation-scenarios-native-summary.json), [runtime](evidence/windows-runtime-b600-native-summary.json). | These independent passes do not accept the failed complete Windows release or ordinary-user/guest journeys. |
| Latest diagnostic source | Seven focused groups pass 69 tests with five Windows-only skips. Two managed builds, 2,101 portable checks, typecheck and exact owned cleanup pass. [Receipt](evidence/worker-start-observation-source-summary.json). | Actual Windows `d15285b` passes all eight acknowledgement/refusal tests without skips. [Native receipt](evidence/worker-start-refusal-native-summary.json). The original owner journey remains open. |
| Installed app | Linux source `5a2c324` has installed metadata/owner/editor/severity checks and preserves all 54 original workspace identities. [Receipt](evidence/installed-cvss4-summary.json). | Later source checks do not establish installed acceptance; frontend and extension activation remain frozen. |

Failed runs remain failed evidence. Partial test output is excluded when the
final plan is missing. Provider and guest doubles are explicitly identified in
their receipts. The [verification record](verification.md) retains the detailed
chronology; the [requirement ledger](switchyard-requirements.md) tracks the full
Rev2 scope independently of these checkpoints.

## What the backend does

| Capability | Implemented behavior and reference |
| --- | --- |
| Protected workspaces | Compartment-scoped encrypted state, fresh policy checks, bounded OS locks, exact approvals and durable replay refusal. [State locks](private-state-locking.md), [receipt authority](receipt-authority-commit.md). |
| Reviewed execution | Linux Run and pipelines bind reviewed task inputs to native guardians and disposable build workspaces. [Execution](reviewed-task-execution.md), [bounded builds](bounded-build-workspace.md). |
| Repository review | Read-only inspection, worktree/index/history witnesses and explicitly selected scanner inputs. [Inspector](inspect-cli.md), [staged inputs](staged-shield-inputs.md), [history](historical-shield-inputs.md). |
| Shield and supply chain | Pinned offline scans, signed advisory/rule feeds, scoped exceptions, CycloneDX inventories, npm/Python/Rust declarations and CVSS 2/3/4 scoring. [Scanner](shield-baseline-scanner.md), [Python](python-supply-chain.md), [Rust](cargo-supply-chain.md), [severity](cvss-severity.md). |
| Coding tools and editor connection | Distinct Codex/Claude task APIs, reviewed text, signed editor requests, one-use launch permits, protected lifecycle history and joined cleanup. [Native tasks](native-coding-tasks.md), [Terminal demonstration](evidence/editor-terminal-connection-summary.json), [retirement](evidence/editor-retired-stop-summary.json). |
| Observation and navigation | Native VS Code/ChatGPT focus plus separately consented deliberate, category, agent, host-action and editor metadata. [Focus](native-client-focus.md), [recording](workflow-capture.md), [editor history](editor-workflow-observation.md). |
| Installation and recovery | Versioned bundles, integrity checks, installation/update/rollback and interrupted-install recovery. [Installation](suite-installation.md), [recovery](suite-release-recovery.md). |

## Unfinished implementation

- Windows restricted-owner worker startup and the rest of its original owner
  journey; corrected complete Windows release verification remains pending.
- Production editor command activation and remaining guided role/device wiring.
  Frontend and command activation are deliberately frozen for owner review.
- Broader Shield coverage and dependency syntax/resolution, publisher provenance,
  artifact and license verification, and verified local vulnerability context.
- Remaining portability, controller, conversation, observation and platform work
  identified individually in the [requirement ledger](switchyard-requirements.md).
  Passing one adapter or provider does not complete those requirements.

The composed editor demonstration uses real encrypted state and Linux carriers
with a controlled provider and terminal. It verifies exact process identity,
acknowledgement, replay refusal, focus and retirement. Native TUI/account/IDE
acceptance is still open. Installed Codex 0.167.0 is outside the reviewed 0.166.0
adapter gate; static schema generation does not justify changing that gate.

## Checks requiring hardware, accounts or another permitted environment

| Check | Current boundary |
| --- | --- |
| F77 physical behavior | Cached read-only discovery and complete readout pass: VIA 9, Vial 4, three 8 × 11 layers and pinned `wcass:f77` identity. New typing/hotplug/write/readback acceptance is unperformed; no new HID, unlock, reset, flash or solenoid operation is authorized in this backend work. Preserve firmware Dvorak and US host input. [Source audit](solenoid-capability-audit.md). |
| B122 hardware and cap fit | Exact hardware is unavailable. All 27 physical gates remain open. |
| Microsoft work Copilot | No approved work tenant is available. Synthetic Graph/policy checks do not establish tenant, license or account acceptance. [Request boundary](copilot-request-recovery.md). |
| Windows user/guest journeys | Headless CI does not establish interactive UAC, ordinary-user setup or complete guest behavior. This is separate from the restricted-owner software defect above. |
| Claude/tmux and native task attachment | The real Claude attempt stopped at workspace trust, restored focus and retired its owned processes. No bypass, live account change or new native task is authorized here. [Receipt](evidence/installed-tmux-trust-boundary-summary.json). |
| Home/catalog and voice UI | Frontend bytes remain frozen. Visual acceptance, microphone interaction and remaining UI implementation are separate from backend tests. |

Keep source and small receipts, remove successful owned staging, and publish
regular GitHub checkpoints. Preserve the repaired native ChatGPT main window,
hidden overlay, saved artwork and desktop guard. No Seagate work is part of this task.

Historical snapshots: [8](switchyard-status-history-8.md), [7](switchyard-status-history-7.md),
[6](switchyard-status-history-6.md), [5](switchyard-status-history-5.md),
[4](switchyard-status-history-4.md), [3](switchyard-status-history-3.md),
[2](switchyard-status-history-2.md), [1](switchyard-status-history-1.md).
