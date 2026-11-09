# Continue Switchyard

The October 29 Rev2 assignment remains incomplete. The owner explicitly approved
**finishing the frontend too** and wants autonomous implementation, a working
demonstration, regular GitHub checkpoints and little retained staging. Continue
from the existing `feat/switchyard-configuration-loop` checkout; do not reset it.

Read [current status](switchyard-status.md), the [requirement ledger](switchyard-requirements.md)
and [verification](verification.md). Publish reviewable checkpoints to
[draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20).
No merge, public release or visibility change is authorized.

## Preserve the operating boundaries

- Continue without delegation. Claude Code is a contingency for actual token
  exhaustion; compaction is not exhaustion.
- Use cached F77 readouts and pinned source only. No new HID/read/unlock/write,
  relock, reset, flash, bootloader, solenoid or electrical operation. Preserve
  firmware Dvorak and US host input. Source capability evidence is not physical
  acceptance.
- No live login/logout/account switching, model requests, real native task
  creation/resume or installed-agent enrollment/revocation/commands in checks.
  Isolated synthetic providers/tasks and read-only metadata remain allowed.
- Keep Windows token access at QUERY **8** and process access at **0x101000**.
  Do not widen ACLs, SID/account rules or privileges or add identity/runtime
  fallbacks. Only newly owned anonymous pipes receive their scoped ACLs.
- Preserve repaired native ChatGPT/main-window voice, hidden overlay, artwork and
  desktop guard. No Seagate, games, mounts or displays work.
- No new SDK, runtime, model or dependency downloads. Use existing Node
  **24.14.0** and `.tools/dotnet-8.0.424`. Put the actual pinned Node bin directory
  first on PATH for supervised builds; do not change mise trust.
- Normal app updates need dated backups/reasons and persistent-file readback.
  Preserve all 54 semantic workspaces, modes, Personal selection, 57 workflows,
  three conversations and the pending keyboard-only record. Keep current plus
  one rollback. A deliberate frontend change needs a new immutable bundle.
- Never manually dispatch/retry/cancel CI, expand deadlines, add skips or weaken
  assertions for a pass. Normal branch pushes schedule checks.
- Use supported CUA browser APIs only. Browser inspection currently fails before
  page loading. Do not use shell/CDP/Playwright outside CUA to bypass this or change
  Brave protections. The user's unrelated NIGHTWIRE tab stays untouched.

## Current published and installed sources

Latest source correction: acknowledged legacy `thread/read` now checks the
original account before querying and before delivery, like paginated history.
Three red cases reproduce the omission. Two focused groups pass 37; thirteen
integration groups pass 139 with one existing skip; five package checks and
typechecking pass. These counts overlap. Both direct and retained composition
use synthetic accounts; no live effect occurs. This correction still needs
normal installation, and the active full Linux `72e7c22` run predates it.
[Source evidence](evidence/codex-legacy-read-account-summary.json).

Published **72e7c22c00c7131722c0c368fe598a2785705b99** adds bounded UI phase
diagnostics. Six original groups pass 51 tests with zero skips and original
commands/bounds/cleanup. Timings overlap and must not be added. No production
performance correction is claimed. [Evidence](evidence/ui-phase-timing-source-summary.json).

Previous **6f9bacca85f2f6484878914e869671a73fe3e5fb** publishes installed receipts
and corrects the controller's stale native remote-resume argument expectation.
All 126 cases pass; deep equality remains. Native Codex rejects CLI permission
overrides; the relay still enforces read-only/on-request. Original CI/local
failures remain. [Evidence](evidence/codex-controller-argument-expectation-summary.json).

| Installed item | Identity |
| --- | --- |
| App and pilot extension source | `42655aa0667dfbf06c88c560a1098ae65543ecf2` |
| App release | `753bd9bc1f77288934602e6011465107249c95527b80d00c8985964ac6a1dd3c` |
| Single app rollback | `a171ce4545d15c0a62be9e4070dd4e45dc419305480824b4f1774b88c8e50dbb` |
| Frontend | `3265d16737fae14d99c7c5a0792af4c5e7cd743320f0abc84263bf22490770ed` |

The app passes 69 served/API and 115 installed metadata checks across 65 exact
modules. All saved semantic state above is preserved; 53 sealed files are
byte-identical and one changes only audit metadata. The extension passes 53
payload hashes and eight installed module checks. Its prior extension/registry
are preserved in dated backup `20261109T102446Z`; other registry rows are unchanged.
Actual editor GUI activation remains unaccepted.

Prepared app/editor packages totaling 6,576,128 bytes are removed after exact
identity/hash and original-guardian exit verification. **Do not replay their
update/preflight/cleanup scripts.** The installed app need not be rebuilt for
subsequent docs/test-only commits.
[App receipt](evidence/installed-paginated-terminal-summary.json),
[editor receipt](evidence/installed-editor-terminal-summary.json).

## Active full Linux run — finish and clean up

Source `72e7c22` is running all 376 original Linux groups in an owned detached
checkout, supervised by a temporary user systemd unit. It uses nine aliases to
existing dependencies and installs nothing. Exact owner, checkout, aliases,
original worktree inventory and unit are in the private runtime-verification
marker `linux-full-72e7c22-owner.json`; progress/result filenames share that prefix.

Read the marker and latest progress rather than starting another run. Progress is
not acceptance. On exit, audit the original receipt against this source's
manifest, command arguments, each effective bound, declared skips, serial
ordering, child/tree exits and cleanup. Preserve failures. Copy only the bounded
receipt/evidence needed, inventory generated files and verify all path/file
identities before removing this owned checkout, nine aliases and temporary
parent. Confirm the supervisor exited and leave all original worktrees intact.
Do not remove anything while the original run or descendants remain active.

The last accepted complete Linux source is `96ac214`: 376 groups, 2,549 passes,
32 declared skips. Its staging is already removed.
[Prior full receipt](evidence/linux-96ac214-complete-summary.json).

## Current Windows follow-up

Normal-push diagnostic source `72e7c22` scheduled complete-source run
**42602497921**, client **42602497768**, Linux release **42602497789** and Windows
release **42602497863**. Re-read status; these IDs are not passing evidence.

Predecessor `42655aa` complete-source run **42599935522** failed workers
**7** (job **129102334858**) and **11** (job **129102335061**); worker 15 passed.
Earlier `a7c3d94` likewise failed 7/11. Their later totals have not been fully
receipt-audited. Linux `42655aa` release **42599935484** failed the stale controller
expectation corrected above.

At audited source `48bf450`, client lane passes 31 groups/356 tests/zero skips.
The full run fails scanner/execution UI 45-second file deadlines and the second
repeated-focus cycle. Original source/merge tree, manifest, limits and cleanup
verify. [Original results](evidence/native-48bf450-results-summary.json).

Inspect the new original UI failures for `# fixture-timings` records. Their fixed
labels separate setup Git, query Git, guardian-ready, store initialization/
snapshot/update/authorization and HTTP. They contain only counts/timings and
emit at most eight checkpoints plus cleanup per journey. Inclusive and concurrent
phases overlap. Existing 64 KiB output and 4 KiB failure excerpts remain unchanged.
Do not infer native causes from Linux timings or change test bounds.

Retain earlier unresolved [focus retirement](evidence/native-focus-retirement-failure-summary.json),
[restricted-storage retirement](evidence/restricted-storage-47c80be-failure-summary.json),
[host-action settlement](evidence/host-action-settlement-diagnostic-summary.json)
and [shortcut input diagnostics](evidence/shortcut-input-stages-summary.json).
Later passes do not establish their cause.

## Current demonstrations and integration limits

The synthetic UI preview runs at `http://127.0.0.1:34713`, source `dfa40fb`.
Its private access link is in the original local receipt; do not publish the
bearer. It passes nine checks including exact named role, signed acknowledgement
and stale-workspace refusal. Do not replay its mutations. Older 37733/35019
previews and their owned state are retired.
[Demonstration](evidence/batched-inspection-running-demo-summary.json).

The real Codex 0.167 TUI now displays synthetic legacy and paginated saved
history through production Unix /rpc framing, restricted initialization and one
account-bracketed read-only/on-request resume. Two item pages and an older turn
are verified through original cursors. All probe processes and owned roots were
retired. Optional catalog requests return explicit local errors; prompts and
arbitrary task/config/account effects remain refused. Retained Windows logical
channels preserve their owner. [Exact contract](codex-terminal-compatibility.md).

Windows Claude Desktop review/API/frontend launch and focus controls are already
connected and installed; do not repeat that implementation. Linux Claude Desktop
has no completed verified binding/launch/focus path. Claude Code's attach command
can restart a stopped session and has no verified live-only flag; existing-window
focus is not task attachment.

## Continue independent work

1. Finish/audit the active Linux run and exact cleanup.
2. Diagnose Windows UI delays from original native measurements; correct the
   actual cause without weakening persistence, ownership or tests.
3. Continue Linux Claude Desktop and exact interactive attachment limitations
   with supported native contracts; keep missing platform evidence explicit.
4. Carry the remaining observation/scanner/managed-policy/later-platform scope
   in the ledger. Separate incremental implementation from hardware, tenant,
   microphone, graphical editor and browser acceptance.

The owner already authorized frontend completion. Guided setup, role/device
controls, task/account/background flows and native-app controls are connected;
their visual acceptance is still blocked. Do not reintroduce the old frontend
freeze or ask again for the permission already granted.

Historical checkpoints, failures and receipt links remain in
[the prior continuation record](https://github.com/SquirmyWormy275/strathex-switchyard/blob/72e7c22c00c7131722c0c368fe598a2785705b99/docs/switchyard-continuation.md).
Treat old “next” and “not installed” paragraphs there as historical, not instructions.
