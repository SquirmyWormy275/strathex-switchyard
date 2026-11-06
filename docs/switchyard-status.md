# Switchyard implementation and acceptance

Switchyard gives a Model F keyboard stable controls for returning to tasks,
reviewing changes and handing work between tools. **The full Rev2 suite is still
a partial implementation.** The F77 is the pilot device; it does not limit scope.

The Linux backend has a passing complete test checkpoint, and a versioned
application has separately verified installed metadata checks. Later archive
identity work has focused source acceptance.
The corrected complete Linux `55515d1` run passes all 307 groups, 1,805 tests
and sixteen declared skips. Both separately scheduled npm files also pass on
native Windows; later shortcut work has separate focused acceptance.
The restricted Windows storage owner now passes all eight original checks with
verified retirement. Complete Windows release acceptance remains pending. Hardware,
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
| Complete Linux source | `55515d1`: **307 groups, 1,805 passing tests, sixteen declared skips, zero failures.** All owned children, checkout, dependency aliases and generated files were removed. [Receipt](evidence/linux-55515d1-complete-summary.json). | Provider/guest doubles remain explicit. Later shortcut and Python changes have separate focused checks. |
| Windows backend batches | `dbbcce8`: 170 of 171 groups accepted, 971 passing tests and 135 declared skips. The native lease group passes. [Receipts](evidence/windows-backend-dbbc-native-summary.json). | The older complete release also finishes 385/386 groups with 2,336 accepted tests and 195 declared skips; its sole failure is that same task-owner file timeout, excluded from accepted totals. [Complete failed receipt](evidence/windows-complete-dbbc-failed-summary.json). All 26 original cases now run independently under the same 45-second child bound; all pass locally. Native `9fde0a3` now completes all 26 independent cases: 24 pass, two declared Linux-only skips, original 45-second bounds and verified cleanup. [Native receipt](evidence/task-owner-native-summary.json). [Correction](evidence/task-owner-scenarios-source-summary.json), [independent job](evidence/pipe-buffer-and-task-source-summary.json). |
| Restricted Windows owner | `6e967a3`: **8/8 original owner checks pass**, with 68 exact QUERY-mask-8 registrations, native tree exit, token recheck, private-desktop closure and fixture/service/file retirement. All six GUI setup checks pass. [Owner receipt](evidence/windows-restricted-owner-accepted-summary.json), [setup](evidence/setup-final-native-summary.json). | This controlled native CI proof does not accept an ordinary user account, interactive UAC or actual guest journey. |
| Installation and runtime | All sixteen original Windows installation/recovery cases pass at `b600a6d`; its independent fresh runtime installs 49 packages and loads/rechecks the offline CPU model, then removes its temporary runtime. [Installation](evidence/installation-scenarios-native-summary.json), [runtime](evidence/windows-runtime-b600-native-summary.json). | These independent passes do not accept the failed complete Windows release or ordinary-user/guest journeys. |
| Latest diagnostic source | Seven focused groups pass 69 tests with five Windows-only skips. Two managed builds, 2,101 portable checks, typecheck and exact owned cleanup pass. [Receipt](evidence/worker-start-observation-source-summary.json). | Actual Windows `d15285b` passes all eight acknowledgement/refusal tests without skips. [Native receipt](evidence/worker-start-refusal-native-summary.json). The full restricted-owner journey is now separately accepted above. |
| Windows index/history/leases | Native NTFS index and history packets each pass six checks and three independent guardian exits. Both Windows scanner files pass two cases with guest execution doubled; lease groups pass 24 tests and one Linux-only skip. [Evidence](evidence/native-history-index-leases-summary.json). | Packet Git witnesses are synthetic. Actual guest, installed Windows and ordinary-user acceptance remain separate. |
| Installed app | Linux source `0cb823b` passes 26 installed owner/editor/journal/offline-severity/SPDX/OSV/archive metadata checks. All 54 workspace semantic snapshots and frozen frontend bytes are preserved. The new archive parser reads the retained offline npm fixture without extraction or execution. [Receipt](evidence/installed-npm-archive-summary.json). | This metadata update starts no scanner, task, provider or public query. Frontend and extension activation remain frozen. |
| Windows npm archive identity | Corrected `55515d1` completes ten archive tests plus eight original byte-comparison tests, each file with two original Linux-only skips inside its original 300-second bound; guest execution is doubled. [Archive](evidence/npm-archive-native-summary.json), [bytes](evidence/npm-artifact-split-native-summary.json). | Complete Windows release remains separate. Its installation lane has a new native shortcut timeout: 15/16 scenarios pass, and the failed scenario is retained. [Failure](evidence/windows-shortcut-timeout-summary.json). |

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
| Shield and supply chain | Pinned offline scans, signed advisory/rule feeds with inclusive last-affected and whole-range limits, scoped exceptions, CycloneDX inventories, npm/Python/Rust declarations and CVSS 2/3/4 scoring. [Scanner](shield-baseline-scanner.md), [Python](python-supply-chain.md), [Rust](cargo-supply-chain.md), [severity](cvss-severity.md). |
| Coding tools and editor connection | Distinct Codex/Claude task APIs, reviewed text, signed editor requests, one-use launch permits, protected lifecycle history and joined cleanup. [Native tasks](native-coding-tasks.md), [Terminal demonstration](evidence/editor-terminal-connection-summary.json), [retirement](evidence/editor-retired-stop-summary.json). |
| Observation and navigation | Native VS Code/ChatGPT focus plus separately consented deliberate, category, agent, host-action and editor metadata. [Focus](native-client-focus.md), [recording](workflow-capture.md), [editor history](editor-workflow-observation.md). |
| Installation and recovery | Versioned bundles, integrity checks, installation/update/rollback and interrupted-install recovery. [Installation](suite-installation.md), [recovery](suite-release-recovery.md). |

## Unfinished implementation

- Corrected complete Windows release verification; the separate restricted
  storage-owner journey is now accepted in controlled native CI.
  Native shortcut timeout remains under investigation. A separately identified
  cleanup race is corrected: failures join the writer's exit before removing its
  owned output, and unconfirmed exits preserve staging. Twenty-three focused
  groups/69 distinct checks pass; native acceptance is pending.
  [Cleanup evidence](evidence/shortcut-writer-retirement-source-summary.json).
- Production editor command activation and remaining guided role/device wiring.
  Frontend and command activation are deliberately frozen for owner review.
- Broader Shield coverage and dependency syntax/resolution, publisher provenance,
  complete archive contents, actual license texts and verified local vulnerability context.
  Exact Python pins now retain bounded normalized extras and process continuations
  before comments. Ten groups/106 checks and 39 independent pip/PyPA cases pass,
  including actual Linux scans and Windows guest doubles. Optional dependencies
  remain explicitly unresolved; installed/native acceptance is pending.
  [Python evidence](evidence/pypi-extras-source-summary.json).
  Selected npm archive identity comparison is implemented with bounded, non-extracting
  gzip/USTAR parsing: six groups/78 checks plus one exact alias/version check pass.
  Native Windows hit the original combined-file deadline; the corrected split
  passes 53 distinct source checks and ten native Windows tests with two declared
  Linux-only skips. The original byte-comparison lane is verified separately.
  Complete Linux `7e45654` also hits that combined-file deadline: 305/306 groups,
  1,783 accepted tests and sixteen declared skips. Owned staging was removed
  after exit verification. [Failed receipt](evidence/linux-7e45654-timeout-summary.json).
  [Artifact contract](npm-artifact-integrity.md).
  Pinned SPDX identifier membership now passes source and native Windows host
  checks (guest execution doubled), with explicit unknown
  and deprecated metadata. [Catalog](npm-license-declarations.md).
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
| Windows user/guest journeys | Headless CI does not establish interactive UAC, ordinary-user setup or complete guest behavior. The passing restricted-owner CI journey does not establish these interactive checks. |
| Claude/tmux and native task attachment | The real Claude attempt stopped at workspace trust, restored focus and retired its owned processes. No bypass, live account change or new native task is authorized here. [Receipt](evidence/installed-tmux-trust-boundary-summary.json). |
| Home/catalog and voice UI | Frontend bytes remain frozen. Visual acceptance, microphone interaction and remaining UI implementation are separate from backend tests. |

Keep source and small receipts, remove successful owned staging, and publish
regular GitHub checkpoints. Preserve the repaired native ChatGPT main window,
hidden overlay, saved artwork and desktop guard. No Seagate work is part of this task.

Historical snapshots: [8](switchyard-status-history-8.md), [7](switchyard-status-history-7.md),
[6](switchyard-status-history-6.md), [5](switchyard-status-history-5.md),
[4](switchyard-status-history-4.md), [3](switchyard-status-history-3.md),
[2](switchyard-status-history-2.md), [1](switchyard-status-history-1.md).
