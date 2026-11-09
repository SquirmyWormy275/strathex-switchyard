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

The app uses source **167df7b**; the pilot VS Code extension remains at **42655aa**.
The app release is
`635d0718fd18734f65e2dd2f3ab537571d55d538d35815601884a14bddd2783d`;
the frontend is `4fe51fece3b7`. Current plus one app rollback remain.

- All 36 served assets and nine installation/API/state/presentation readbacks pass.
- Nine installed verifiers pass 126 checks across 66 exact module hashes.
- All 54 workspace definitions, 57 workflows, Personal selection and three
  conversations are preserved, including the pending keyboard-only record.
  53 semantic snapshots match exactly; Personal differs only by its expected
  shutdown task-permission revocation counter, 80 → 81.
- The extension's 53 payload files and eight installed module checks pass.
  Actual graphical editor activation remains unaccepted.
- Dated launcher/editor backups verify. The latest prepared app package of
  5,195,702 bytes is removed; previous prepared editor staging was already removed.

[App receipt](evidence/installed-desktop-host-summary.json),
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
checks; actual native acceptance is pending.
[Original failure and correction](evidence/windows-bootstrap-contention-summary.json).

The native **167df7b** worker 9 also exposed a UI test platform mismatch: its
Linux portal double used the Windows catalog, so the Linux host label assertion
failed. All 20 original worker groups and cleanup are audited; 19 passed. The
fixture now selects the same explicit Linux platform for both ports, retaining
every assertion. Two original local groups pass 24 checks. Native follow-up and
the complete cohort remain separate.
[Failure and fixture correction](evidence/client-platform-fixture-summary.json).

## Remaining implementation and defects

- Bounded historical-name discovery is implemented and normally installed. Its
  native Windows follow-up passes in the complete a7958c4 cohort. Ten integration groups pass 80 tests/
  one existing skip; package/installation groups pass 26 tests, and typechecking
  passes. A new source checkpoint implements opted-in removed-path permission and
  portable recipe assembly with 195 checks across 25 groups. Its Linux scan
  finds a synthetic deleted-file secret without recreating the file. The immutable
  frontend pin and normal installation are pending at this checkpoint.
  [Contract and demonstration](removed-history-permissions.md).
- Automatic native Windows scanner recipe/catalog generation remains unfinished.
  The Windows save boundary currently writes the portable process recipe; it
  does not convert it into the separately required guest manifest/catalog. The
  existing Windows guest-double evidence uses its explicit Windows recipe.
  [Source evidence](evidence/history-path-discovery-source-summary.json).
- Preserve the narrow Windows execution-UI margin and earlier intermittent native
  focus, host-action settlement and shortcut failures. Full source acceptance
  does not establish later-source or current package acceptance.
- Finish the Linux Claude Desktop binding and launch/focus path for a verified
  supported installation. Windows controls do not establish Linux support.
- Resolve exact interactive attachment limits. Codex's reviewed terminal supports
  saved history; arbitrary prompts/configuration effects remain refused. Claude's
  attach command can restart a stopped session and has no verified live-only flag.
  Existing-window focus must not be labelled task attachment.
- Continue the broader observation, scanner coverage, managed-policy and later
  platform work explicitly tracked in the [ledger](switchyard-requirements.md).
  Optional incremental capabilities must not be described as complete.

## Separate acceptance dependencies

Browser task/visual review is blocked by the browser-control connection failing
before page inspection. Actual graphical IDE activation, live provider task and
account changes, approved Microsoft tenant/license/consent, microphone capture,
physical keyboard writes/readback and printed legend fit remain unaccepted.
These checks do not excuse unfinished software. Current work uses synthetic
providers and cached device/source evidence within the owner's boundaries.

Older chronological checkpoints and original failures remain in
[the prior status record](https://github.com/SquirmyWormy275/strathex-switchyard/blob/72e7c22c00c7131722c0c368fe598a2785705b99/docs/switchyard-status.md)
and linked evidence. They are historical results, not current next steps.
