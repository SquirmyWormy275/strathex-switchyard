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

Native Windows `cff471e` verifies the first guardian's exact QUERY-mask-8
allowance and reaches `probe-identity-created-native-self-birth`. That later
phase establishes that named Job creation/configuration cleared, but the
original owner remains **0/8**; worker and status registration were not exercised.
[Retained native evidence](evidence/windows-descendant-query-native-summary.json).
The next correction reads the guardian's creation time through Windows' current-
process pseudo handle, preserving the original birth format and permissions.
The coordinator now checks liveness through `GetExitCodeProcess`, because exit
time is undefined for a live process. Nine focused groups pass **87 tests / four
Windows-only skips**; two managed builds and **2,101 portable checks** pass.
Native acceptance of this correction remains pending.
[Source evidence](evidence/guardian-self-birth-source-summary.json).

Complete Linux `dbbcce8` is **failed**: 280 groups, 1,770 passed tests,
fifteen declared skips and two fixture write failures caused by `/tmp` user
quota exhaustion. An exact owned 18-byte write probe confirmed `EDQUOT` and was
removed. Socket fixtures now honor the isolated temporary directory, keeping the
same socket path limit. The focused recovery tests pass. All owned test children,
checkout, nine aliases and 782 generated files were retired; a corrected complete
run remains pending. [Failed run and cleanup](evidence/linux-dbbc-failed-summary.json).

A CI-only candidate now applies the existing QUERY-only token allowance to
exact descendants of the original restricted owner. Job membership, process
birth, pinned image, original restrictions and exact mask-8 readback are required.
The original two cold/Node observations, eight owner checks and ninety-second
deadline remain. Nine focused groups pass **88 tests / four declared Windows-only
skips**, a final 45-test follow-up passes, and two managed builds verify **2,101
portable checks** (30 new parser cases). Typecheck and owned cleanup pass.
Native acceptance is pending; the original owner remains **0/8**.
[Contract](windows-descendant-query.md), [source receipt](evidence/windows-descendant-query-source-summary.json).

The complete Linux run at `d551ccf` is **failed**: 278 groups, 1,767
passed tests, eleven declared skips and one crash-fixture failure. EOF cleanup
could remove the socket before the fixture substituted it. The corrected fixture
holds the exact carrier before abrupt host loss; 42 recovery/ingress tests pass.
All children, the temporary checkout, nine dependency aliases and 782 generated
files were removed. A corrected complete run remains pending.
[Failed run](evidence/linux-d551-failed-summary.json).

Windows `b600a6d` also remains a **failed complete release**. Its preliminary
backend exceeded twenty minutes and reported one lease-case failure without a
complete plan; later steps continued by design. The release build then refused
the non-scalar `TestPythonPath` argument before starting. Source now assigns all
171 preliminary backend groups exactly once across four isolated jobs, retaining
every declared child bound and a twenty-minute limit per job. Python is selected
directly from the pinned setup action, preserving version/hash/reparse checks.
The scheduling/harness/lease follow-up passes 39 tests with one Windows-only
skip; native scheduling and the reported lease failure remain unaccepted.
[Retained failure](evidence/windows-b600-release-failed-summary.json),
[correction](evidence/release-scheduling-recovery-summary.json).

Independent Windows `b600a6d` runtime installation, 49-package imports and offline
CPU model load/recheck pass, with its temporary runtime removed.
[Runtime receipt](evidence/windows-runtime-b600-native-summary.json).
This does not accept the failed backend batch or complete release.

An optional Windows worker acknowledgement now holds the exact process suspended
while its owner registers PID, birth and executable hash. Callback refusal,
cancellation and malformed or overdue acknowledgement cannot authorize execution.
Seven focused groups pass **82 tests / four declared Windows-only skips**;
27 harness follow-up tests, two managed builds, 2,071 portable proof checks,
typecheck and owned cleanup pass. Actual Windows `7dd2c36` now passes all six
native acknowledgement tests without skips. [Native receipt](evidence/windows-suspended-worker-native-summary.json).
This step grants no permissions and does not repair the original
restricted owner, which remains **0/8**.
[Contract](windows-worker-acknowledgement.md), [source evidence](evidence/windows-suspended-worker-source-summary.json).

Selected Python artifact comparison now supports exact requirements pins and
multiple declared SHA-256 alternatives through Supply Chain and Release. Fourteen
behavior/harness groups pass 98 checks; the initial packaging guard correctly
fails at 1,006 bytes above 5 MiB. Removing three implementations reached only
through erased types from the app bundle restores it to **5,096,071 bytes**;
their repository source remains unchanged. The corrected packaging, application,
sixteen installation cases and Python execution follow-up passes **19 groups /
37 tests**, with typecheck and exact cleanup. Six actual Linux and six Windows
guest-double scans retain original bytes and receipts. Native Windows host `d551ccf` now passes nine tests with two declared
Linux-only skips and verified cleanup under the original 300-second bound;
the guest remains doubled. [Native receipt](evidence/python-artifact-windows-native-summary.json).
[Contract](python-artifact-integrity.md), [evidence](evidence/python-artifact-integrity-summary.json).

Native Windows `b600a6d` now passes all sixteen original installation/recovery
cases exactly once, with unchanged assertions, original 120-second child bounds
and verified child/tree cleanup. The earlier timeout and local zero-plan attempt
remain failed evidence. The complete Windows release subsequently failed as recorded above; restricted
owner acceptance remains separate and failed.
[Native installation receipt](evidence/installation-scenarios-native-summary.json).

Native Windows `c367dff` also passes nine Cargo artifact tests with two declared
Linux-only skips under the original 300-second bound. The guest remains doubled.
[Cargo native receipt](evidence/cargo-artifact-windows-native-summary.json).

Installation scheduling now uses sixteen exact case names, each in its own
bounded child, with the original 120-second child limit and six-minute CI step.
The original test file and production code are unchanged. Nineteen groups /
48 tests pass, including every installation case exactly once and exact cleanup.
An initial regex-selector attempt selected no cases and correctly failed; that
receipt is retained. Native Windows scheduling acceptance now passes all sixteen cases; see the receipt above.
[Scheduling evidence](evidence/installation-scenarios-source-summary.json).

Windows `7e5c495` also retains a separate installation-group timeout: fifteen
case reports succeeded before the original 120-second deadline, but there was no
complete TAP plan, so the group is failed with zero accepted cases. The earlier
`3363e8b` sixteen-case acceptance remains source-specific. Independent-case scheduling now passes native acceptance above. This is a CI failure, not unavailable hardware.
[Timeout evidence](evidence/windows-installation-timeout-summary.json).

| Area | Verified result | What it establishes |
| --- | --- | --- |
| Complete Linux source `0a0dd11` | **261 groups, 1,745 passed tests, eleven declared skips, zero failures.** All owned children, temporary checkout, dependency aliases and generated builds were retired. [Receipt](evidence/linux-0a-complete-summary.json). | Backend integration, including editor lifecycle, Terminal composition, artifact-byte comparison and guardian failure reporting. Provider/editor doubles and Windows-only skips remain explicit; this is not native account or hardware acceptance. |
| Later recording boundary `b42574f` | Nine groups / 105 tests, typecheck and exact cleanup pass. [Receipt](evidence/observation-window-summary.json). | Agent, host-action and editor metadata cannot enter a session from before its start or latest resume. Duplicate resume and a backward clock cannot lower that boundary. |
| Windows source and native CI | `4faa8a1` clears restricted state initialization and mode update. Native pipe/lease tests pass **24 checks / one declared skip**, including EOF and parent-loss cleanup. [Evidence](evidence/windows-lease-pipe-native-summary.json). | The original restricted owner now fails later at its read-only storage probe, still **zero of eight checks**. Complete owner, guest and interactive acceptance remain open. |
| Rust scanning | Nine groups / 94 checks and 146,326 independent Rust SemVer comparisons pass. Four Windows-host contracts also pass with controlled guests. [Source](evidence/cargo-semver-summary.json), [Windows](evidence/windows-cargo-contract-summary.json). | Bounded declaration and advisory matching. Actual Windows guest scanning, dependency resolution and publisher provenance remain unverified or unfinished. |
| npm prerelease scanning | Twelve groups / 101 tests, 556 grammar cases, 276,676 independent comparisons and typecheck pass. [Evidence](evidence/npm-semver-summary.json). | Collector, signed feeds, inventory and host validation preserve exact build identity. Actual Linux scans and Windows guest doubles verify receipts and cleanup; installed/native guest acceptance remains open. |
| License declaration exceptions | Seven groups / 59 tests, a 26-test engine follow-up, typecheck and exact cleanup pass. [Evidence](evidence/license-exception-declaration-summary.json). | Signed policy matches complete license/exception pairs without borrowing permission for a base or another pair. Actual Linux and Windows guest-double scans are not legal/publisher or installed acceptance. |
| Installed Linux `5a2c324` | Six update, eleven owner/editor/severity and seven journal checks pass. All 54 non-audit semantic snapshots match; 52 sealed files are byte-identical. [Receipt](evidence/installed-cvss4-summary.json). | The last accepted installed checkpoint, not the latest source. Two verification workspaces received only expected audit additions. No live task or activated editor is inferred. |

The restricted native result at `fb265e7b` identifies **Access Denied in
`CreateJobObjectW`** before setup-identity readiness. The exact permission or
namespace cause remains under investigation; no access widening or fallback is
enabled. [Native evidence](evidence/windows-guardian-job-native-summary.json).

The older complete Windows release `1fc9d7f` fails **four of 366 groups**:
2,296 tests pass, eight fail and 183 are declared skips. All child/tree cleanup
verifies; complete build cleanup is not claimed. Application/recovery fixtures
used a nonexecutable helper, and two Python checks lacked their prerequisite
on the isolated PATH. [Retained failure](evidence/windows-release-1fc-failure-summary.json).
The source corrections pass eight groups / 113 tests plus 29 lane/package
follow-up checks and typecheck on Linux. Source 3363e8b additionally passes all
21 application/installation tests on actual Windows. A newer complete release
remains pending. [Native lifecycle receipts](evidence/windows-336-lifecycle-native-summary.json).
[Correction evidence](evidence/windows-release-prerequisite-summary.json).

The next CI-only empty-Job observation passes six groups / 78 tests, two managed
builds / 2,071 portable checks and typecheck, without new permissions or a
production fallback. Native ad4d5e6 creates and closes all three empty Job cases
with the existing restricted-child QUERY allowance; the actual guardian still
fails. [Native observation](evidence/windows-cold-job-native-summary.json).
[Diagnostic contract](windows-job-observation.md).

Selected npm artifact-byte comparison additionally passes 13 groups / 89 tests
across behavior and corrected inventory checks, including six actual Linux and
six Windows guest-double scans. Checksums do not establish publisher identity or
archive contents. [Contract and evidence](npm-artifact-integrity.md).

A subsequent guardian failure observation checks only its existing self-token
QUERY access after Job creation is denied. Six groups / 79 tests, two managed
builds / 2,071 portable checks and typecheck pass, with cleanup. Native 0a0dd11
confirms self-query denial in the same guardian; permissions and refusal remain unchanged.
[Native evidence](evidence/windows-guardian-query-native-summary.json).
[Source evidence](evidence/windows-guardian-query-source-summary.json).

A CI-only comparison now runs one additional cold child without the existing
QUERY allowance, then leaves the original cold/Node checks intact. It grants no
additional access. Six groups / 79 tests and managed/type checks pass. Native
comparison ties the named-Job denial to withholding that allowance in the cold
image; the actual guardian remains failed. [Native comparison](evidence/windows-unmodified-cold-native-summary.json). [Source](evidence/windows-unmodified-cold-source-summary.json).

Selected Cargo artifact-byte comparison is implemented through reviewed Supply
Chain and Release execution. Exact package/version/source binding, mismatch
findings, receipt replay and cleanup pass fifteen groups / 105 tests and a
21-test manifest-alias follow-up; typecheck passes. Four actual Linux scans and
four Windows guest-double runs preserve original bytes/index/HEAD. Native Windows host acceptance now passes nine tests and two declared Linux skips;
publisher/archive-content verification remains open.
[Contract](cargo-artifact-integrity.md), [evidence](evidence/cargo-artifact-integrity-summary.json).

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

- Windows restricted-owner Job creation and the rest of its original owner journey;
  complete release verification of the isolated Python prerequisite remains pending.
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
