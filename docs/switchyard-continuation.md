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

## Current installed checkpoint

Published backend **167df7b125af93e46c0631b2a1b08d1ec9bec951** is normally installed.
Release: **635d0718fd18734f65e2dd2f3ab537571d55d538d35815601884a14bddd2783d**.
Rollback: **ef51ea8dbe2e8784ff5a5202cbecea3164b8e957e3a585e1046acc769a541702**.
Frontend remains **4fe51fece3b7c3034a8d0a2130030096b081a5149270648f52373a638ae413ba**,
36 assets pinned to source **a97ebe8504cfea30ff1d729470994c4633ca5169**. Private
local access is unchanged across this backend update; never publish its bearer.

The backend reports vendor Linux desktop support from one bounded metadata read.
The authenticated catalog identifies Omarchy as unsupported by the vendor's
Claude Desktop beta. It grants no app/account/task authority. The Linux executable
binding and launch/focus path remain unfinished software.

All **45 served/installation/API/state/presentation checks** and **126 metadata
checks / 66 exact module hashes** pass. All 54 workspace definitions, 57 workflows,
modes, selection, three conversations and the pending keyboard-only record remain.
53 semantic snapshots match exactly. Personal differs only by its verified
original-owner shutdown permission-revocation counter **80 → 81**. Do not restore
that counter or report full semantic equality. Nine installed verifiers pass.

Dated backup: **2026-11-09T12-49-17.934Z-830d59af-07f6-411a-8be2-1d7cdcff0ef1**.
All **577 prepared files / 5,195,702 bytes** are removed after exact ownership/hash
and independent installed-payload verification. Current plus one rollback remain.
Private receipts use **desktop-host-**. **Do not replay install or cleanup.**
[Installed result](evidence/installed-desktop-host-summary.json).

Source verification: six original integration groups pass **70 checks / one
existing skip**, final metadata group passes 19 overlapping checks, and typecheck
passes. Eighteen original package groups pass 26 tests; eight verifier guards
pass. Two regressions reproduce the missing host assessment and connected UI text.
Original receipts are copied privately; duplicate checkout receipts are removed.
[Source](evidence/linux-desktop-host-support-summary.json).

The frontend clears cancelled/invalidated app, task, device, profile, shortcut,
role and maintenance reviews. Eight distinct regressions reproduce prior stale
context; twelve original UI groups pass 103 checks with zero skips.
[Source](evidence/review-context-source-summary.json). The readable scanner
summary retains expandable exact files/hashes and closed technical metadata.
[Source](evidence/scanner-review-readable-source-summary.json).

## Complete platform acceptance and current native failure

Linux **a7958c4** passes all 376 original groups: **2,578 tests / 32 declared
skips**. Run **853cc5ea-8dfa-43bd-89d8-84a8a8215e62** and its supervisor exited
successfully. Manifest, commands, bounds, skips, serial order and cleanup verify.
Private prefix **linux-a7958c4-**. The checkout, runner, temporary parent, nine
aliases and **806 generated files / 12,507,506 bytes** are removed. All three
original worktrees remain. **No complete Linux run remains active.** Do not replay
setup, audit or cleanup. [Evidence](evidence/linux-a7958c4-complete-summary.json).

Windows **a7958c4**, run **42612174584**, passes all 25 jobs. All 23 original
worker receipts agree with collector **129150916723**, artifact **13672751496**:
**482 groups / 3,158 passes / 246 declared skips**. Original source/merge tree,
manifest, commands, limits, serial order and cleanup verify. Scanner UI took
40,875 ms and execution UI 42,128 ms against unchanged 45,000 ms limits.
Private prefix **native-a7958c4-**. No ZIP/helper binary retained. Do not repeat
these downloads/audits. [Evidence](evidence/complete-windows-a7958c4-summary.json).
Both full cohorts predate the latest frontend/backend; they do not accept it.

Later Windows **2fb81bc**, run **42615316762**, assembly job **129154818239**,
failed the PowerShell 5.1 trusted-bootstrap fixture with a counter-file sharing
violation. Artifact **13674025946** is privately retained as
**native-2fb81bc-assembly-original.json**. All 13 assembly groups are audited:
12 passed, one failed; original limits and cleanup verify. Twenty-two other
workers report success, but no complete acceptance is claimed.

Source **167df7b** changes only the fixture counter-readiness loop to tolerate
Win32 sharing/lock errors 32/33 within its original 15-second wait. Exact count,
process, staging and terminal assertions remain; production bootstrap is unchanged.
The diagnostic has no source line; the only intentional concurrent counter read
is that wait. This addresses the unguarded wait, not every possible external lock.
Two local harness groups pass 32 checks. No local PowerShell exists. Native
correction acceptance awaits normal branch-push follow-up; do not manually retry,
cancel or expand deadlines. [Failure/correction](evidence/windows-bootstrap-contention-summary.json).
Preserve earlier intermittent focus, shortcut and host-action failures in status.

Native **167df7b** worker 9, job **129170296960**, failed the Linux host-label
assertion in `client-ui.test.mjs`: the portable Linux portal double was paired
with the actual Windows catalog. Its 20-group receipt is audited (19 pass), with
unchanged bounds and exact cleanup. Private receipt:
**native-167df7b-worker9-original.json**. The fixture now selects `platform: linux`
for both ports; no production branch or assertion changed. Two local groups pass
24 checks. Normal-push native follow-up is pending.
[Evidence](evidence/client-platform-fixture-summary.json).

## Demonstration and acceptance limits

The installed app runs at **http://127.0.0.1:43177/**. Its normal launcher supplies
the existing private access. On November 9 at 12:51 UTC, supported CUA inventory
still works but selecting the existing owned review tab fails before page access:
**Cannot read properties of undefined (reading 'timeoutMs')**. Re-reading its
documentation and retrying did not restore inspection. Native app inventory is
empty. No browser graphical acceptance is claimed. Do not re-ask the user to
change Brave settings; this error occurs in the tool before page inspection.
The unrelated NIGHTWIRE tab is untouched.
The supported in-app browser alternative is unavailable (`Browser is not
available: iab`); it did not create a review tab. No bypass was used.

An older synthetic preview runs at **http://127.0.0.1:34713**, source **dfa40fb**.
Its private link is in the original local receipt. Nine checks establish the
served assets, named role, signed acknowledgement and stale-workspace refusal.
Do not replay its mutations. [Demonstration](evidence/batched-inspection-running-demo-summary.json).

Pilot editor extension **42655aa** retains 53 verified payload files and eight
module checks; actual GUI activation remains unaccepted. Native Codex 0.167
renders synthetic legacy and paginated history through production relay framing,
original cursors and one narrowed account-bracketed resume. No model prompt was
submitted; probe processes/owned roots are retired. [Contract](codex-terminal-compatibility.md).

## Continue independent work

- Publish evidence/verifier-only edits without reinstalling this completed app update.
- Follow native Windows bootstrap correction and final frontend/backend cohorts.
  Preserve the original failure; passing unrelated workers cannot accept it.
- Finish Linux Claude Desktop native binding/launch/focus through a verified
  supported installation contract. Official beta supports Ubuntu 22.04+ or
  Debian 12+, x64/arm64; this Omarchy machine is unsupported. Metadata reporting
  is implemented but is not the native adapter. No alternate app is selected.
- Resolve exact interactive attachment: Claude Code attach can restart a stopped
  session and has no verified live-only flag. Existing-window focus is not task
  attachment. Codex's narrow saved-history terminal is implemented; arbitrary
  prompts/configuration effects remain refused.
- Finish automatic native Windows scanner recipe/catalog assembly. The current
  Windows file-save boundary writes the portable process recipe, not a native
  guest manifest/catalog. This is unfinished software, not unavailable hardware.
- Continue observation,
  broader scanner coverage, managed-policy and later-platform scope in the
  requirement ledger. Separate unfinished software from hardware, tenant,
  microphone, graphical editor and browser acceptance dependencies.

The owner already authorized frontend completion. Guided setup, role/device
controls, task/account/background flows and native-app controls are connected;
visual acceptance remains blocked. Do not restore the old frontend freeze.

Prior chronological checkpoints and original failures remain in
[the previous continuation](https://github.com/SquirmyWormy275/strathex-switchyard/blob/167df7b125af93e46c0631b2a1b08d1ec9bec951/docs/switchyard-continuation.md)
and linked evidence. Treat historical “next” paragraphs as history.

## New source checkpoint awaiting installed adoption

Deleted-history permission and portable recipe assembly now pass 25 distinct
source groups / 195 tests with zero skips. The read-only scope pins exact paths,
depth, HEAD and history witness; it does not extend current/index ownership.
The Linux protected-save → fresh-permission → isolated-scan demonstration finds a
synthetic secret in a deleted file, with unchanged project bytes and exact cleanup.
The Windows Release path consumes actual Git blobs with an explicit guest double.
Two new default-bounded groups cover closed authority and frontend selection/handoff.
[Source evidence](evidence/removed-history-scope-source-summary.json).

Private original receipts use **removed-history-**; all six checkout duplicates
are removed. Preserve the original missing-feature RED, the corrected property-order
confirmation mismatch, and the test fixture that compared index bytes across its
own intentional commit. The corrected case checks exact bytes before that commit
and exact post-commit bytes after drift refusals. Do not replay receipt cleanup.

Frontend changes are `index.html`, `scanner-ui.mjs`, `authority-ui.mjs`. Publish
source, pin all 36 assets to that immutable commit, verify packaging, then perform
the ordinary backed-up update. Installed source remains **167df7b** until that
readback completes. Updated installed verifiers pin the new history modules and
Home bytes; they must run only after adopting this source. The agent metadata
verifier adds three pure checks and one exact module hash. No live task is needed.
