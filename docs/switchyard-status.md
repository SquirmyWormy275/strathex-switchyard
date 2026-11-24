# Switchyard: implementation and acceptance

Switchyard gives Model F keyboards consistent controls for returning to tasks,
reviewing work and moving between tools. The application is installed and running
on the Omarchy pilot. **The full Rev2 assignment remains unfinished.** The F77 is
the pilot, not the scope limit.

Start with the [product introduction](../README.md) and
[guided setup](guided-setup.md). Developers can run the
[connected demonstration](backend-demonstration.md) without accounts or hardware.
The [requirement ledger](switchyard-requirements.md) tracks the wider scope;
[PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20) remains a draft.

## Current follow-up — November 24

Source **8dd849e** passes all six normal-push workflows: Linux release, Windows
release, complete Windows source, Windows filesystem boundaries, Windows policy
admission and client platform checks. Both complete Windows receipts contain
**499 groups / 3,182 passes / 246 declared skips**. The original commands,
deadlines and skip inventory are preserved. The nine-worker scheduling fix is
accepted; earlier failed runs remain historical evidence.
[Native and release results](evidence/backend-capacity-native-summary.json).

The workspace recovery follow-up adds a visible retry control after a failed
startup or saved-state read, and conditional keyring-unlock guidance. It preserves
unsaved layout edits and joins concurrent retries without replaying a keyboard
change, application launch or agent request. Eight existing groups pass 135 tests
with no skips; eight verifier guards and typechecking also pass. Browser visual
acceptance and the follow-up's normal-push platform checks remain separate.
[Source evidence](evidence/workspace-recovery-source-summary.json).

The next correction addresses interrupted workspace changes. Three regressions
reproduce old-layout carryover and unsaved-edit loss. Five new cases now cover
those failures, lost selection replies and subsequent reconnects; six integration
groups pass 83 tests, and two scheduling/runner groups pass 30 tests with no skips.
Original deadlines, child cleanup and typechecking pass. The normal update is verified below; complete Linux and normal-push checks
are running separately.
[Workspace-boundary evidence](evidence/workspace-boundary-source-summary.json).

The `c41807c` Windows filesystem run exposes an intermittent installation
failure: the shortcut writer times out after `script-started`, before its utility
module finishes loading. Sixteen of seventeen groups pass; the failed original
receipt, exact source tree, commands, bounds and cleanup are retained. The
follow-up removes that module import using a bounded four-path protocol and
built-in .NET COM activation. Eighteen local groups pass 34 checks with no skips;
the original ten-second limit and exact shortcut readback remain. Native Windows
acceptance is pending. The installed Linux writer is not invoked on Linux.
[Failure and correction](evidence/shortcut-startup-source-summary.json).

## What is connected

| Workflow | Current behavior and walkthrough |
| --- | --- |
| Start with your keyboard | Home recommends a usable layout. The [catalog](model-f-standard-configurations.md) contains 104 named references across 19 listed model/case/round combinations; reference geometry does not certify a physical device. |
| Configure directly or with an assistant | [Guided setup](guided-setup.md), named roles, keyboard editing, proposal review and saved design conversations share the editable model. An assistant account is optional. |
| Return to a saved coding task | [Editor commands](editor-task-controls.md) select a saved project/task, review the exact connection and return to its owned terminal. Codex 0.167 displays synthetic legacy and paginated history through the production relay. |
| Manage task text and background work | [Coding task controls](coding-task-controls.md) connect creation, reviewed text, status, exact stop and uncertain-result recovery. Native permissions and interactive attachment have separate limits. |
| Review repository work | [Scanner setup](scanner-setup-controls.md) saves reviewed control files. [Task permissions](task-permission-controls.md) and [execution](reviewed-execution-controls.md) have separate reviews. Signed feeds, results and cancellation retain their own evidence. |
| Keep work within its environment | Personal/Work policy, independent encrypted stores, [approved-work account controls](copilot-account-controls.md) and explicit handoffs are enforced. A Work label is not an OS sandbox. |
| Observe and refine | Opted-in metadata, [Claude session hooks](claude-hook-observation.md), [voice notes](voice-note-controls.md), transcript import and saved observations can inform proposals. No task-completion or measured-savings claim is inferred. |
| Connect other tools | [Custom-agent SDK](../integrations/README.md), named role controls, explicit client recipes and [native app navigation](native-app-controls.md) expose their actual capabilities. Windows Claude Desktop has separate executable review, launch and focus controls. |
| Carry preferences between computers | Versioned profile import/export keeps layout and intent meanings separate from local credentials, accounts and task bindings. |

## Installed checkpoint

The app uses source **65b5aac**; the pilot VS Code extension remains at **42655aa**.
The app release is
`dd9cc05a13cada0f5585571374b8889cc7260576674fcc4955d5950c25a6d642`;
the frontend is `9accbd4c1ca3`. Current plus one app rollback remain.

- All 578 installed payload files and 36 served assets match the release manifest.
- Two installed metadata/refusal verifiers pass 25 checks, including the exact
  current source, signed editor refusals and offline advisory/license calculations.
- All 54 workspace definitions, 57 workflows, Personal selection and three
  conversations are preserved, including the pending keyboard-only record.
  All 54 non-audit semantic snapshots match exactly. Personal appends four
  expected shutdown/startup audit entries; its permission counter remains 83.
- The extension's 53 payload files and eight installed module checks pass.
  This is the earlier extension checkpoint; graphical activation remains unaccepted.
- Dated launcher and all 55 encrypted-state/selection backups verify. The latest
  prepared app package of 579 files / 5,213,246 bytes is removed after independent
  installed-payload verification. No user backup was removed.

[App receipt](evidence/workspace-boundary-installed-summary.json),
[editor receipt](evidence/installed-editor-terminal-summary.json).

## Verification belongs to a source

The installed readable scanner review passes 58 integration checks after two
regressions reproduced stale hidden metadata. Cancellation and workspace changes
now clear both the readable summary and technical details. All 18 original
package groups pass 26 tests; eight verifier guards pass.
[Source evidence](evidence/scanner-review-readable-source-summary.json).

A later source correction brackets acknowledged legacy history reads with fresh
account checks. Three regressions reproduce the original gap; 13 integration
groups pass 139 tests with one existing skip, five package checks pass, and
typechecking passes. This correction is normally installed above and is later
than the completed full Linux run.
[Source evidence](evidence/codex-legacy-read-account-summary.json).

| Source and scope | Result |
| --- | --- |
| `a7958c4`, complete Windows source | 482 groups, 3,158 passes, 246 declared skips. All 23 workers and native collector agree; original commands, limits, source/merge tree and cleanup audited. [Receipt](evidence/complete-windows-a7958c4-summary.json) |
| `72e7c22`, complete Linux | 376 groups, 2,574 passes, 32 declared skips. Exact manifest/commands/bounds and cleanup audited; temporary checkout, nine aliases and 806 generated files removed. [Receipt](evidence/linux-72e7c22-complete-summary.json) |
| `6f9bacc`, controller correction | All 126 controller cases pass, zero skips. Exact remote-resume argument assertion corrected; production behavior and relay permissions unchanged. [Evidence](evidence/codex-controller-argument-expectation-summary.json) |
| `72e7c22`, UI phase diagnostics | Six original groups pass 51 tests, zero skips. Original bounds and cleanup verify; no Windows performance correction claimed. [Evidence](evidence/ui-phase-timing-source-summary.json) |
| `42655aa`, native terminal demonstration | Actual Codex 0.167 renders two synthetic history pages through original cursors, with one narrowed resume and no model prompt. [Contract and evidence](codex-terminal-compatibility.md) |
| `96ac214`, earlier complete Linux | 376 groups, 2,549 passes, 32 declared skips. Owned checkout and generated files removed. [Receipt](evidence/linux-96ac214-complete-summary.json) |
| `3222727`, audited Windows client | 31 groups, 362 passes, zero skips, including retained legacy-history account regressions. Predates the lease-input correction; full-suite acceptance remains separate. [Receipt](evidence/native-client-3222727-summary.json) |
| `7529718`, earlier complete Windows package | 462 groups, 2,910 passes, 246 declared skips; all eight jobs pass. This does not accept later source. [Receipt](evidence/windows-package-7529718-summary.json) |

The original Windows UI failures now have audited timing receipts: worker 7 at
`72e7c22` and worker 11 at `7317371` still exceed 45 seconds. Measurements point
to state-update/guardian waits, with short Git command durations. A source
correction removes the lease worker's 25 ms input polling delay, preserving all
file identities, ownership, durable writes and deadlines. Nine local groups pass
82 tests/one existing skip; two offline builds and 2,117 portable checks pass.
Both original UI files and the full Windows source cohort now pass with unchanged
limits. Execution UI had only 359 ms of margin at f4dcc79; a7958c4 passes
in 42,128 ms and scanner UI in 40,875 ms against unchanged 45-second bounds. The earlier repeated-focus
failure remains unresolved. [Measurements](evidence/native-ui-timing-failure-summary.json),
[correction](evidence/lease-blocking-source-summary.json).

Complete Windows source `f4dcc79` passes **482 groups, 3,157 tests and 246 declared
skips**. All 23 workers and the native collector pass; original receipts, commands,
bounds, serial order, source trees and cleanup are audited.
[Complete native evidence](evidence/complete-windows-f4dcc79-summary.json).

Complete Linux **a7958c4** passes 376 original groups: 2,578 tests and 32
declared skips. Original commands, bounds, serial order and child cleanup verify;
the temporary checkout, nine aliases and 806 generated files are removed. It
includes the account-read and historical-name corrections and predates the later
frontend changes. [Receipt](evidence/linux-a7958c4-complete-summary.json).

The synthetic running preview is separately proven at `dfa40fb`: nine checks
cover served assets, a named role, signed acknowledgement and stale-workspace
refusal. [Demonstration receipt](evidence/batched-inspection-running-demo-summary.json).

The installed frontend checkpoint clears cancelled and invalidated review context
across app launch, execution, device, profile, shortcut and role controls. Eight
regressions reproduce the original stale content; 12 original groups pass 103
checks with no skips. The first handoff fixture failure is retained separately.
The immutable frontend pin and normal installation are complete; all 36 served
assets match and the prepared package is removed.
[Evidence](evidence/review-context-source-summary.json).

The installed backend checkpoint reports Linux Claude Desktop host support in the
existing client facts. Omarchy is unsupported by the vendor beta; malformed or
unavailable metadata stays unverified. Six integration groups pass 70 checks/one
existing skip. Native executable binding and launch/focus remain unfinished.
[Source evidence](evidence/linux-desktop-host-support-summary.json).

A later Windows source cohort at **2fb81bc** failed its PowerShell 5.1 bootstrap
fixture on a sharing violation while reading the invocation counter. Its 13-group
assembly receipt, source tree, original commands/bounds and cleanup are audited;
12 groups passed. The existing counter-readiness wait now tolerates only sharing/
lock violations within its original 15 seconds. Exact count/exit assertions and
production bootstrap behavior are unchanged. Two local harness groups pass 32
checks. Both PowerShell 5.1 and pwsh variants now pass in the audited 13-group
native assembly at 167df7b; the separate UI failure still prevents complete
cohort acceptance. [Native follow-up](evidence/windows-bootstrap-native-followup-summary.json).
[Original failure and correction](evidence/windows-bootstrap-contention-summary.json).

The native **167df7b** worker 9 also exposed a UI test platform mismatch: its
Linux portal double used the Windows catalog, so the Linux host label assertion
failed. All 20 original worker groups and cleanup are audited; 19 passed. The
fixture now selects the same explicit Linux platform for both ports, retaining
every assertion. Two original local groups pass 24 checks. Native follow-up and
the complete cohort remain separate.
[Failure and fixture correction](evidence/client-platform-fixture-summary.json).

Linux release CI at `6e6a134` passes 2,591 tests with 32 declared skips,
source packaging and the real Secret Service installed smoke check. The local
495-group run was interrupted by a workstation restart at group 284 and has no
final receipt; it is not accepted. Its owned checkout is retired with the
original three worktrees preserved. The normal installed app reports ready
after restart. Saved-workspace readback then hits CREDENTIAL_PROCESS_TIMEOUT;
OS keyring unlock is requested again after this new restart. No state reset or
replacement key is used. [CI and interruption evidence](evidence/linux-ci-interruption-summary.json).

## Remaining implementation and defects

The new Windows shortcut Unicode-path case fails at `cd770c0`; its audited
18-group worker has one failure. The original generic exit diagnostic omitted
the failing stage. Failed exits now retain only the existing closed stage names,
with 13 passing local wrapper checks and unchanged execution/input/output bounds.
The native cause remains under investigation.
[Exact failure and diagnostic evidence](evidence/shortcut-exit-diagnostic-summary.json).

The `6e6a134` native follow-up reaches `shortcut-saved`. The readback now reports
fixed stages for reopening, target and arguments, while preserving every exact
comparison. Thirteen local checks pass; the differing native field remains open.
[Field diagnostic evidence](evidence/shortcut-field-diagnostic-summary.json).


Native `a7234c2` worker **138793367313**, artifact **14967253688**, reaches
`target-verified` and fails the exact arguments comparison. Its original
18-group receipt, source tree and cleanup are audited. Argument readback now
uses the documented `System.Link.Arguments` Shell property with an exact string
comparison; the native fixture also requires literal UTF-16 argument bytes in
the saved link. Thirteen local wrapper cases pass. Native acceptance is pending;
this does not yet establish whether the legacy getter or saved bytes differed.
[Property readback evidence](evidence/shortcut-property-readback-summary.json).


Native `ce240f4` worker **138804737062**, artifact **14968562418**, still
fails after `target-verified`; property readback alone does not resolve the
failure. The original 18-group receipt remains failed and audited. Arguments
are now assigned using the documented ShellLinkObject `Arguments` / `Save`
contract, followed by fresh exact property readback after releasing the writer.
All 13 local wrapper cases pass, including each ordered stage; the literal
UTF-16 file assertion and original limits remain. Native cause and acceptance
remain open. [Shell writer evidence](evidence/shortcut-shell-writer-summary.json).

The later complete Windows cohorts remain failed. At `c41807c`, worker 19 hits
the host-action test's existing 75 ms recovery-settlement limit. At `87cfc30`,
worker 11 reports a Suite handler accessing its test document after teardown.
Both original 23-group receipts retain exact source trees, commands, bounds,
declared skips, serial order and cleanup. The workspace fixture now joins its
selection/retry/refresh handlers before retiring the document and HTTP server;
all five workspace cases and fifteen unchanged host-action cases pass locally.
Typechecking passes. No runtime code, assertion or deadline changes for this
follow-up; the earlier intermittent settlement failure remains unresolved.
[Failure and fixture evidence](evidence/workspace-fixture-followup-summary.json).

Native Windows `86ca7cb` now passes all five workspace cases in the audited
23-group worker: 163 passes and 10 declared skips, with original bounds and
cleanup. The separate Unicode shortcut case still prevents complete acceptance.
[Native workspace evidence](evidence/workspace-fixture-native-summary.json).

- Linux Claude Desktop executable binding and launch/focus remain unfinished.
  Its vendor beta supports Ubuntu/Debian, while the pilot runs Omarchy and has no
  vendor desktop installation. Windows controls and Linux host metadata do not
  establish that adapter. [Vendor contract](https://code.claude.com/docs/en/desktop-linux).
- Exact interactive task attachment remains limited. Codex's reviewed terminal
  renders saved history; arbitrary prompts/configuration effects stay refused.
  Claude's attach command can restart a stopped session and has no verified
  live-only flag. Existing-window focus is a separate supported action.
- Broader observation sources, complete scanner coverage/provenance and managed
  provider containment remain tracked in the [ledger](switchyard-requirements.md).
  The implemented bounded scanner is useful evidence, not a complete audit.
- Earlier intermittent native focus, settlement and shortcut failures remain
  retained. Current source/package tests pass; this does not prove that those
  failures can never recur in an interactive environment.

Native Windows scanner recipe generation, mapped-drive runtime identity and
removed-history input assembly are implemented and included in the accepted
8dd849e platform checks. Their actual guest and installed Windows acceptance is
still separate. [Contract](removed-history-permissions.md).

## Separate acceptance dependencies

On November 24 the owner confirmed that the physical B122, an interactive
Windows host and an approved Microsoft 365 tenant are not available.

Browser task/visual review is blocked before page loading: the browser connector
requires a network policy from a newer desktop client; the built-in browser is
unavailable in this session. No browser protections were changed. Actual graphical IDE activation, live provider task and
account changes, approved Microsoft tenant/license/consent, microphone capture,
physical keyboard writes/readback and printed legend fit remain unaccepted.
These checks do not excuse unfinished software. Current work uses synthetic
providers and cached device/source evidence within the owner's boundaries.

Older chronological checkpoints and original failures remain in
[the prior status record](https://github.com/SquirmyWormy275/strathex-switchyard/blob/72e7c22c00c7131722c0c368fe598a2785705b99/docs/switchyard-status.md)
and linked evidence. They are historical results, not current next steps.
