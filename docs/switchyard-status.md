# Switchyard implementation and acceptance

Switchyard gives a Model F keyboard stable controls for returning to tasks,
reviewing changes and handing work between tools. **The full Rev2 suite is still
a partial implementation.** The F77 is the pilot device; it does not limit scope.

The Linux backend has a passing complete test checkpoint, and a versioned
application has separately verified installed metadata checks. Later archive
identity work has focused source acceptance.
The complete Linux `68bcc76` run passes all 310 groups, 1,875 tests and sixteen
declared skips, including stopped-agent recovery, foreground-helper ownership,
compact provenance and measured Windows scheduling. The later shortcut-helper
correction has separate 89-check focused and 33-check installed evidence.
The restricted Windows storage owner now passes all eight original checks with
verified retirement. Complete Windows source `9f35961` passes 414 test/build groups,
2,398 tests and 202 declared skips. Later credential and custom-agent changes have
separate acceptance. Hardware,
account and visual acceptance remain separate from those implementation results.

Use the [requirement ledger](switchyard-requirements.md) for the complete scope,
[verification record](verification.md) for evidence, and
[continuation notes](switchyard-continuation.md) to resume engineering work.
The [README](../README.md) explains the product and first run.
Work is published on [draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20);
there is no merge or public release acceptance.

## Current evidence

Normal installed aa98c91 passes **41 metadata/synthetic checks**: 13 task-owner,
seven Copilot-journal, fourteen agent/helper/SDK and seven Python-inventory checks.
Fourteen tested module hashes and both verifier hashes bind the running build.
The Python checks use 87 marker and 39 original reference cases plus fixed
in-memory reports/artifact comparisons; they evaluate no condition and start
no scanner process. All 54 semantic workspaces, selected state, pending
keyboard-only conversation and frozen frontend remain preserved; 53 sealed files
are byte-identical and one changes only audit metadata. Dated backup/readback
and current plus one rollback verify. The exact 533-file, 5,221,413-byte prepared
bundle is removed. [Installed evidence](evidence/installed-python-markers-summary.json).

Conditional Python pins now retain a private marker digest and sorted environment
variable names. Conditions are parsed without evaluation; matching declared-pin
advisories and selected artifact comparisons remain visible, with mandatory
unevaluated/unresolved gaps. Eight focused groups pass 115 checks, including
two new actual Linux scanner journeys, two Windows guest doubles and six artifact
combinations. An independent 87-case pip/PyPA fixture covers the grammar and
preprocessing. Typecheck, original package budget and owned scratch cleanup pass.
Installed metadata checks now pass separately; native Windows marker acceptance remains pending.
[Contract](python-supply-chain.md#conditional-pins),
[source evidence](evidence/pypi-markers-source-summary.json).

| Boundary | Verified result | Still open |
| --- | --- | --- |
| Complete Linux source | `68bcc76`: **310 groups, 1,875 passing tests, sixteen declared skips, zero failures.** Exact child/tree exit and owned checkout, nine aliases, 782 generated files, temporary parent and marker cleanup verify; all three other worktrees remain. [Receipt](evidence/linux-68bcc76-complete-summary.json). | Provider/guest doubles remain explicit. The later shortcut-helper correction has separate 89-check focused and 33-check installed metadata/synthetic acceptance. |
| Complete Windows release | `9f35961`: **414 groups, 2,398 passing tests, 202 declared skips, zero failures.** Archive/receipt digests, source/merge tree equality, original bounds and all child/tree cleanup verify. [Receipt](evidence/windows-complete-9f35961-summary.json). | Later credential ownership, revocation and outcome changes are outside this checkpoint. Provider/guest doubles and interactive acceptance remain separate. |
| Windows backend batches | `9f35961`: **198 groups, 1,022 passing tests, 142 declared skips, zero failures.** Four digests, source/merge tree equality and all child/tree cleanup verify. [Receipts](evidence/windows-backend-9f35961-native-summary.json). | The combined release now passes separately above. Older `dbbcce8` backend and complete-release failures remain recorded; later passing batches do not relabel them. [Historical backend](evidence/windows-backend-dbbc-native-summary.json), [complete failure](evidence/windows-complete-dbbc-failed-summary.json). |
| Restricted Windows owner | `6e967a3`: **8/8 original owner checks pass**, with 68 exact QUERY-mask-8 registrations, native tree exit, token recheck, private-desktop closure and fixture/service/file retirement. All six GUI setup checks pass. [Owner receipt](evidence/windows-restricted-owner-accepted-summary.json), [setup](evidence/setup-final-native-summary.json). | This controlled native CI proof does not accept an ordinary user account, interactive UAC or actual guest journey. |
| Installation and runtime | All sixteen original Windows installation/recovery cases pass at `b600a6d`; its independent fresh runtime installs 49 packages and loads/rechecks the offline CPU model, then removes its temporary runtime. [Installation](evidence/installation-scenarios-native-summary.json), [runtime](evidence/windows-runtime-b600-native-summary.json). | Complete Windows `9f35961` now passes separately; ordinary-user/guest journeys remain open. |
| Latest diagnostic source | Seven focused groups pass 69 tests with five Windows-only skips. Two managed builds, 2,101 portable checks, typecheck and exact owned cleanup pass. [Receipt](evidence/worker-start-observation-source-summary.json). | Actual Windows `d15285b` passes all eight acknowledgement/refusal tests without skips. [Native receipt](evidence/worker-start-refusal-native-summary.json). The full restricted-owner journey is now separately accepted above. |
| Windows index/history/leases | Native NTFS index and history packets each pass six checks and three independent guardian exits. Both Windows scanner files pass two cases with guest execution doubled; lease groups pass 24 tests and one Linux-only skip. [Evidence](evidence/native-history-index-leases-summary.json). | Packet Git witnesses are synthetic. Actual guest, installed Windows and ordinary-user acceptance remain separate. |
| Installed app | Linux source `aa98c91` passes **41 metadata/synthetic checks** and fourteen tested module hashes. All 54 semantic workspace snapshots, 53 sealed files and frozen frontend bytes verify. Only current plus one rollback remain; the complete 5,221,413-byte prepared bundle is removed. [Installed evidence](evidence/installed-python-markers-summary.json). | The Python scanner examples run in memory; no live task, scanner process, agent, account, model request or hardware operation starts. Frontend and extension activation remain frozen. |
| Windows npm archive identity | Corrected `55515d1` completes ten archive tests plus eight original byte-comparison tests, each file with two original Linux-only skips inside its original 300-second bound; guest execution is doubled. [Archive](evidence/npm-archive-native-summary.json), [bytes](evidence/npm-artifact-split-native-summary.json). | Complete Windows release remains separate. |
| Windows shortcut retirement | `80601e9` passes all sixteen original installation/recovery scenarios and twelve writer checks, no skips and verified cleanup. The fixed stage diagnostics execute with the original bounds. [Native pass](evidence/shortcut-stage-diagnostics-native-summary.json). | `9193471` and `4b2daed` each fail the first installation scenario at the original ten-second shortcut deadline: 24/25 tests pass, all cleanup verifies. The latest pass does not reproduce or establish the cause of the intermittent timeout. [Recurring failures](evidence/windows-shortcut-recurring-timeout-summary.json), [diagnostic source](evidence/shortcut-stage-diagnostics-source-summary.json). |
| Credential worker retirement | Six groups/69 checks pass, including ten worker tests and two controlled real children. Errors join exact-child retirement; unconfirmed exit blocks replacement. Installed pure synthetic checks also pass within the 27-check update. [Contract](credential-worker-lifecycle.md), [source](evidence/credential-process-source-summary.json), [installed](evidence/installed-agent-security-summary.json). | Live credential failure injection and native Windows acceptance remain separate. No user key is replaced. |

Failed runs remain failed evidence. Partial test output is excluded when the
final plan is missing. Provider and guest doubles are explicitly identified in
their receipts. The [verification record](verification.md) retains the detailed
chronology; the [requirement ledger](switchyard-requirements.md) tracks the full
Rev2 scope independently of these checkpoints.

The corrected native Windows preliminary backend now passes all 198 groups: 1,022
passing tests and 142 declared skips. Four archive digests, source/merge tree
equality and every child/tree cleanup are verified. This is separate from the
combined Windows release, which now passes 414 groups. [Backend receipts](evidence/windows-backend-9f35961-native-summary.json).

Bundled-agent retirement now preserves uncertain exact children, refuses replacement
across mode changes and reports unconfirmed shutdown. Seven groups/72 checks pass,
including two real authenticated Node sessions and confirmed exits. Installed metadata/module verification passes without starting an example. Native
Windows and live installed example acceptance remain pending.
[Contract](bundled-agent-lifecycle.md), [source evidence](evidence/bundled-example-lifecycle-source-summary.json).

Custom-agent commands now contribute opted-in queue/claim/retirement/acknowledgement
metadata, with local versus authenticated self-report provenance and no raw content.
Seven groups/92 checks pass, including actual encrypted HTTP/bundled-agent execution,
privacy, rollback and pause/replay fences. Six installed pure checks pass within
the 26-check update; native Windows and live installed command execution remain separate. [Contract](agent-lifecycle-observation.md#custom-agent-command-history),
[evidence](evidence/custom-agent-command-observation-summary.json).

## What the backend does

Automatic scanner review now gathers bounded current files, includes recognized
ignored secrets and proposes explicit generated-directory exclusions. It captures
file hashes before returning the existing one-use review; unknown ignored paths,
missing files and file/revision/account drift refuse. The new path grants nothing
and performs no scan until the separate established confirmations. Twenty-five
groups pass 100 checks, followed by five composed review cases (102 distinct
checks), including one actual Linux scanner exit and one Windows guest double.
All sixteen installation scenarios and the original package budget pass.
Installed exact-module/preflight verification now passes within 34 metadata
checks; live task/scanner use and native Windows acceptance remain separate.
[Guide](scanner-input-inventory.md), [evidence](evidence/scanner-review-source-summary.json).

Custom-agent SDKs now complete sequence persistence before transmission. Node
awaits asynchronous saves; Python accepts a synchronous persistence hook, rejects
awaitables/nested sends and keeps its validated enrollment immutable. A failed
save sends nothing and consumes its local counter; restart resumes above saved
state. Two regressions reproduce before correction. Four focused groups pass
66 distinct checks, and a final 15-check integration pass includes two actual
Python processes against controlled loopback servers. Typecheck, original
package bounds and exact cleanup pass. Installed exact-module/preflight verification passes; live-agent and native
Windows acceptance remain separate.
[SDK contract](../integrations/README.md), [source evidence](evidence/sdk-persistence-source-summary.json).

Windows shortcut helpers now retain uncertain ownership, share initialization and
bind operations to their exact native owner. Failed registration needs verified
absence or exact exit before rollback; uncertain records stay recovery-pending
and are never automatically hydrated. Six regressions pass within eight groups/
89 checks, including two real controlled children. Typecheck/package/cleanup pass;
installed synthetic checks now pass within the 33-check update; actual Windows interaction remains separate.
[Contract](windows-shortcut-helper-lifecycle.md).

Windows foreground observation now retains an uncertain exact helper, joins
overlapping stops and refuses replacement until exit. Late replies cannot survive
pause/shutdown, and Suite shutdown reports an unconfirmed owner. Ten source groups
pass 87 checks, with two controlled real Node children; a final eleven-check
foreground pass verifies recovery after exact close. Catalog provenance ships
as equivalent compact JSON to preserve the original package budget. Installed
synthetic ownership and complete provenance comparison now pass; actual native
Windows acceptance remains separate.
[Contract](foreground-helper-lifecycle.md), [evidence](evidence/foreground-owner-source-summary.json).

Authenticated custom-agent stop events now retire pending commands atomically:
unclaimed work cancels locally, claimed outcomes remain uncertain, and a fresh
session identity is required before accepting new work. Exact late acknowledgements
remain self-reports and cannot revive readiness. Three regressions fail before
correction; eight focused groups/94 tests, typecheck, package bounds and cleanup
pass. Installed pure stop/recovery checks now pass within the 30-check update;
live installed agent operation and native Windows acceptance remain separate.
[Contract](custom-agent-revocation.md#an-adapter-that-reports-stopped),
[evidence](evidence/agent-stop-retirement-source-summary.json).

Custom-agent authorization now has a reviewed revoke-and-reenroll path. Exact
roles are retired, unclaimed commands cancel locally and claimed outcomes remain
uncertain. New credentials cannot inherit old claims or role authority. Eight
groups/86 checks pass, including actual authenticated HTTP and two new bundled
Node processes with confirmed exits. Failed credential/state commits and stop
journals remain explicit. Installed pure synthetic/module checks also pass inside
the 27-check update; native Windows, live installed revocation and frontend
acceptance remain separate. [Contract](custom-agent-revocation.md),
[evidence](evidence/custom-agent-revocation-source-summary.json).

Uncertain claims from retired custom-agent sessions now have a separate one-use
review path. Reviewed records remain explicitly unverified, become eligible for
the existing bounded history retention and never resend provider commands. Five
new recovery cases pass within eight groups/91 checks, including authenticated
HTTP, late-ack races, rollback and capacity preservation. Installed pure recovery
checks also pass inside the 29-check update; live installed recovery and native
Windows acceptance remain separate.
[Contract](custom-agent-revocation.md#review-an-uncertain-claim),
[evidence](evidence/custom-agent-outcome-source-summary.json).

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

The Windows preliminary scheduler now balances exact groups using accepted native
timings and reports bounded start/exit progress. Four source groups/40 checks pass,
preserving all child limits and four twenty-minute jobs. The cancelled run remains
unaccepted; the correction still needs native Windows acceptance.
[Contract](windows-backend-scheduling.md).

- Native Windows verification of changes newer than the passing `9f35961`
  complete release; the restricted storage-owner journey is separately accepted
  in controlled native CI.
  The shortcut cleanup race is corrected: failures join the writer's exit before
  removing its owned output, and unconfirmed exits preserve staging. Twenty-three
  focused groups/69 distinct checks and all 25 native Windows checks pass.
  [Cleanup evidence](evidence/shortcut-writer-retirement-source-summary.json).
  The original shortcut startup timeout recurs in two later checkpoints; cleanup
  remains verified, but the cause is unresolved. Fixed bounded stage diagnostics
  now pass all 28 native checks without reproducing the timeout.
  [Failures](evidence/windows-shortcut-recurring-timeout-summary.json),
  [latest pass](evidence/shortcut-stage-diagnostics-native-summary.json).
- Production editor command activation and remaining guided role/device wiring.
  Frontend and command activation are deliberately frozen for owner review.
- Broader Shield coverage and dependency syntax/resolution, publisher provenance,
  complete archive contents, actual license texts and verified local vulnerability context.
  Exact Python pins now retain bounded normalized extras and process continuations
  before comments. Ten groups/106 checks and 39 independent pip/PyPA cases pass,
  including actual Linux scans and Windows guest doubles. Optional dependencies
  remain explicitly unresolved. Five installed extras metadata checks pass. Native Windows `9193471` now passes
  four composed scanner and ten artifact tests, with two declared Linux-only
  skips and guest execution doubled. [Native evidence](evidence/pypi-extras-native-summary.json).
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


Windows `cadbccd` preliminary backend shard 3 is cancelled after 20 minutes
3 seconds, with no final receipt and a failed empty artifact upload. Its elapsed
time matches the configured twenty-minute job bound; the runner log supplies no
more specific cause. No tests from that incomplete shard or exact cleanup are
accepted. The separate complete release remains active. This is a CI acceptance
gap, not a hardware/account blocker; native `9f35961` and complete local Linux
`cadbccd` keep their separate accepted results. Inspect scheduling without
extending any child/job bounds. [Evidence](evidence/windows-cad-cancelled-backend-summary.json).

Complete Linux source `49a5053` is being retried across all 311 groups, including
the later shortcut, SDK and automatic scanner-review changes. Do not replace the
accepted `68bcc76` result until its final receipt and cleanup are verified.

The first complete 49a5053 attempt ended with exec status 143 before a final
receipt. Its cause is unknown and zero groups/tests from that attempt are
accepted. The runner is absent; a scan found no processes referencing its owned
paths. Ten known scratch directories and two empty configuration files were
removed. The unchanged checkout and nine exact aliases are reused by a temporary
supervised retry with durable start/exit progress and the original child bounds.
Progress is not a final receipt. The marker changes above are later than this
immutable full-run source. [Interruption](evidence/linux-49a5053-interrupted-summary.json).
