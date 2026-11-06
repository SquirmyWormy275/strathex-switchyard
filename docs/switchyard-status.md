# Switchyard implementation and acceptance

Switchyard gives a Model F keyboard stable controls for returning to tasks,
reviewing changes and handing work between tools. **The full Rev2 suite is still
a partial implementation.** The F77 is the pilot device; it does not limit scope.

The Linux backend has a passing complete test checkpoint, and a versioned
application is installed. The source has since gained additional tested changes.
Windows restricted-owner Job creation is an active software failure. Hardware,
account and visual acceptance remain separate from those implementation results.

Use the [requirement ledger](switchyard-requirements.md) for the complete scope,
[verification record](verification.md) for evidence, and
[continuation notes](switchyard-continuation.md) to resume engineering work.
The [README](../README.md) explains the product and first run.
Work is published on [draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20);
there is no merge or public release acceptance.

## Current evidence

| Area | Verified result | What it establishes |
| --- | --- | --- |
| Complete Linux source `701f915` | **260 groups, 1,713 passed tests, eleven declared skips, zero failures.** All owned children, temporary checkout, dependency aliases and generated builds were retired. [Receipt](evidence/linux-701-complete-summary.json). | Backend integration, including editor lifecycle, retained Terminal composition and Cargo version handling. Provider/editor doubles and Windows-only skips remain explicit; this is not native account or hardware acceptance. |
| Later recording boundary `b42574f` | Nine groups / 105 tests, typecheck and exact cleanup pass. [Receipt](evidence/observation-window-summary.json). | Agent, host-action and editor metadata cannot enter a session from before its start or latest resume. Duplicate resume and a backward clock cannot lower that boundary. |
| Windows source and native CI | `4faa8a1` clears restricted state initialization and mode update. Native pipe/lease tests pass **24 checks / one declared skip**, including EOF and parent-loss cleanup. [Evidence](evidence/windows-lease-pipe-native-summary.json). | The original restricted owner now fails later at its read-only storage probe, still **zero of eight checks**. Complete owner, guest and interactive acceptance remain open. |
| Rust scanning | Nine groups / 94 checks and 146,326 independent Rust SemVer comparisons pass. Four Windows-host contracts also pass with controlled guests. [Source](evidence/cargo-semver-summary.json), [Windows](evidence/windows-cargo-contract-summary.json). | Bounded declaration and advisory matching. Actual Windows guest scanning, dependency resolution and publisher provenance remain unverified or unfinished. |
| npm prerelease scanning | Twelve groups / 101 tests, 556 grammar cases, 276,676 independent comparisons and typecheck pass. [Evidence](evidence/npm-semver-summary.json). | Collector, signed feeds, inventory and host validation preserve exact build identity. Actual Linux scans and Windows guest doubles verify receipts and cleanup; installed/native guest acceptance remains open. |
| License declaration exceptions | Seven groups / 59 tests, a 26-test engine follow-up, typecheck and exact cleanup pass. [Evidence](evidence/license-exception-declaration-summary.json). | Signed policy matches complete license/exception pairs without borrowing permission for a base or another pair. Actual Linux and Windows guest-double scans are not legal/publisher or installed acceptance. |
| Installed Linux `5a2c324` | Six update, eleven owner/editor/severity and seven journal checks pass. All 54 non-audit semantic snapshots match; 52 sealed files are byte-identical. [Receipt](evidence/installed-cvss4-summary.json). | The last accepted installed checkpoint, not the latest source. Two verification workspaces received only expected audit additions. No live task or activated editor is inferred. |

The latest restricted native result, `fb265e7b`, identifies **Access Denied in
`CreateJobObjectW`** before setup-identity readiness. The exact permission or
namespace cause remains under investigation; no access widening or fallback is
enabled. [Native evidence](evidence/windows-guardian-job-native-summary.json).

The older complete Windows release `1fc9d7f` fails **four of 366 groups**:
2,296 tests pass, eight fail and 183 are declared skips. All child/tree cleanup
verifies; complete build cleanup is not claimed. Application/recovery fixtures
used a nonexecutable helper, and two Python checks lacked their prerequisite
on the isolated PATH. [Retained failure](evidence/windows-release-1fc-failure-summary.json).
The source corrections pass eight groups / 113 tests plus 29 lane/package
follow-up checks and typecheck on Linux. Native application/installation lanes
and a newer complete release remain pending.
[Correction evidence](evidence/windows-release-prerequisite-summary.json).

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

- Windows restricted-owner Job creation and the rest of its original owner journey;\n  native application/recovery and complete release verification of the new fixture corrections.
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
