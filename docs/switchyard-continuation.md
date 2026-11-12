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

## Current installed checkpoint — completed, do not replay

Published source **fd13fd038c9f85112e2cf80fe2360fae517d8e27** is normally installed.
Release: **ea4ae48345d8fc658658d1074bfc553d6042bad3c0a4a384ba6d58e2c3679f85**.
Rollback: **635d0718fd18734f65e2dd2f3ab537571d55d538d35815601884a14bddd2783d**.
Frontend: **0d52f396a8e8e07a4e03b29a13a099aab4936190b6779ee81fccbc379011ec0e**,
36 assets pinned to **b0f67bc22e379aee65d479ef8e5cc6650ce9b1a6**. Three changed
assets are `index.html`, `scanner-ui.mjs`, `authority-ui.mjs`. The new immutable
frontend has its own private authenticated access; never print its bearer.

All **48 served/installation/API/state/presentation checks** and **129 metadata
checks / 67 exact module hashes** pass. Nine verifiers succeed. All 54 workspace
definitions, 57 workflows, modes, Personal selection, three conversations and the
pending keyboard-only record remain. 53 semantic snapshots and sealed files match
exactly. Personal differs only by the exact original-owner shutdown permission
revocation counter **81 → 82**, timestamp **1794230312512**. Do not restore it or
claim full semantic equality.

Backup: **2026-11-09T13-18-32.484Z-dc929254-bb4d-4048-8b53-5a11a13c816e**.
All **578 prepared files / 5,203,957 bytes** are removed after exact identities,
paths, hashes and independent installed-payload checks. Current plus one rollback
remain. Private receipts use **removed-history-installed-**. **No install or
cleanup replay.** [Installed evidence](evidence/installed-removed-history-summary.json).

The Copilot metadata verifier first stopped at its stale Home hash after six
checks. Original receipt **installed-copilot-journal-metadata-1794230330926.json**
is retained. It changed no user state. Its pin now references the tested frontend;
all seven checks pass. This verifier-only correction does not require reinstalling.
Eighteen original package groups pass 26 tests and eight verifier guards pass.
Original receipt copies are private; checkout duplicates are removed.

Linux desktop vendor support reporting remains installed. Omarchy is unsupported
by the official Claude Desktop beta; no executable/window authority is inferred.
The real Linux binding and launch/focus adapter remain unfinished software.

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
Two local harness groups pass 32 checks. No local PowerShell exists. Both native variants now pass in the audited 13-group assembly at **167df7b**,
job **129170298273**, artifact **13676378868**; PowerShell 5.1 took 74,669 ms and
pwsh 39,741 ms under their original 300,000 ms limits. Private original:
**native-167df7b-assembly-original.json**. The separate worker 9 failure still
prevents complete cohort acceptance. [Native evidence](evidence/windows-bootstrap-native-followup-summary.json).
Do not manually retry, cancel or expand deadlines. [Failure/correction](evidence/windows-bootstrap-contention-summary.json).
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
- Native Windows scanner recipe generation is committed at **a7e6fe7**: drafts
  target the Windows reviewed runner and refuse when the pinned runtime identity
  changes during assembly. Linux: 16 focused groups / 193 tests, 4 declared
  Windows-only skips; the broker proof project compiles locally. Native Windows
  execution acceptance follows the normal-push complete Windows source run.
- **35c3c61** fixes the "Switchyard Windows filesystem boundaries" regression
  that failed every run from f4dcc79 through f48c1de: f4dcc79 expanded
  `StateLeaseProtocolProof` from 50 to 53 checks, but
  `scripts/verify-windows-storage-broker.mjs` still pinned 50. The exact-count
  assertion remains. Run **42977967901** passes all filesystem, native-setup,
  restricted-exchange and storage-contract jobs. Earlier "complete Windows"
  claims referred to a different workflow and did not cover this one.
- **f114750** gives `windows-scanner-draft-execution` the sibling scanner bound
  (native group finished at 45,105/45,132 ms with no failed assertion).
  **e48e59f** accepts a link-free drive mapping for the pinned scanner runtime:
  B122 runs the bundled Node from `subst B:`, which native realpath resolves to
  `D:\a\...`. Links, junctions and identity drift still refuse. At e48e59f all
  four Windows scanner groups pass natively, including under the B122 subst
  drive (runs 43005306973, 43005306911).
- Remaining red at e48e59f was not caused by those changes. Follow-ups:
  **56f0754** runs each of the seven `scanner-ui` and seven `execution-ui`
  journeys in its own child with the unchanged 45 s default (the task-owner
  pattern); they took 31–45 s together on Windows. Locally the slowest case is
  6.6 s. The inventory test pins every case name exactly once.
  **9c81a6a** shares the link-free drive-mapping check with
  `windows-reviewed-runner.mjs` `nativePins`, now exported and exercised with
  injected capture/resolver on every OS.
  **e623329** starts the unchanged 180 ms deadline of `council-runtime` case
  11 at executor invocation; run 42991132648 spent it in durable session setup
  (checks 0 !== 1).
  `windows-host-action-consumer` case 2 (run 43005306973, shard 9) yielded
  because the queue authorization exceeded the fixture's 75 ms
  `effectTimeoutMs` on a slow runner. Not changed: raising that bound needs
  owner approval under the no-deadline-expansion rule.
- Not fixable here: Linux Claude Desktop launch/focus (vendor app absent,
  Omarchy unsupported); visual acceptance (the installed app's origin guard
  rejects every Chrome-extension navigation, including reloads, with
  "outside the local workspace origin"; the guard was not weakened). Installed
  release fd13fd0 contains the current frontend. Evidence source pins for
  task-authority, scanner-recipe-draft, windows-scanner-recipe-files and suite
  have been stale since a7e6fe7 and refresh with the next installed update.
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

## Deleted-history source and working demonstration

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

The immutable pin and normal installation are completed above. Source evidence
retains the pre-install checkpoint as history. The installed verifiers add three
pure historical-scope checks and one module hash; no live task is created. The
empty verifier filename selection **85117181-4e95-40ab-9264-65cc2ad8d338** ran no
tests and is explicitly retained as non-validation. The actual eight-case guard
group passed afterward, including after the final Copilot hash-pin correction.
