# Continue the full Switchyard suite

The October 29 Rev2 assignment remains incomplete. Continue independently
executable implementation and verification. A passing subset is not completion.
Start with [current status](switchyard-status.md), the
[requirement ledger](switchyard-requirements.md), and
[verification](verification.md). Hardware/account blockers do not excuse
unfinished software.

Use the existing `feat/switchyard-configuration-loop` checkout and publish regular
checkpoints to [draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20).
Inspect Git status/history first; checkpoint hashes below are evidence, not reset
instructions. Do not merge or release.

## Preserve the user's boundaries

- Home/catalog frontend and editor command activation are frozen for owner
  review. No asset/UI changes, browser automation or reloads during backend work.
- Continue normally without delegation. Claude Code is a contingency for actual
  token exhaustion; compaction is not exhaustion.
- Use cached F77 readouts and pinned source only. No new HID, unlock, write,
  reset, flash, bootloader, solenoid or electrical operation. Preserve firmware
  Dvorak and US host input. The [26-file source audit](solenoid-capability-audit.md)
  establishes handler capabilities, not physical/electrical acceptance.
- No live login/logout/account switching, model requests, real native task
  creation/resume or installed agent enrollment/revocation/commands in backend
  checks. Use isolated synthetic providers and explicit read-only metadata.
- Keep Windows descendant token access at QUERY mask **8**. Do not widen token
  access, ACLs, SID/account rules or privileges, or add identity/runtime
  fallbacks. Only newly owned anonymous pipes receive their scoped ACLs.
- Preserve the repaired native ChatGPT main-window voice, hidden overlay, saved
  artwork and desktop guard. No Seagate, game, mount or display work.
- No new local SDK, runtime, model or dependency downloads. Use the existing
  Node 24.14.0 and `.tools/dotnet-8.0.424`. Put the actual pinned Node bin
  directory first on PATH for supervised builds; mise shims fail in isolated
  homes without project trust. Do not change trust settings.
- Normal application updates must retain a dated backup/reason and verify
  persistent-file readback. Keep current plus one rollback. Preserve all
  workspace identities, semantic snapshots, selection and frozen frontend.

## Current backend state

Published launcher checkpoint `961ecb3` composes a reviewed Windows Terminal,
signed instance requests, protected Suite state, the retained provider connection
and a real authenticated socket. The demonstration uses explicit native,
Terminal and provider doubles. It reaches an exact synthetic task acknowledgement,
refuses another launch and retires the original carrier without stopping the provider.
[Source evidence](evidence/windows-editor-launch-source-summary.json).

Windows CI for that checkpoint passes 24 of 25 groups, with 223 passing tests
in groups that completed their TAP summaries. The native endpoint fixture,
private/shared ACL and link/path checks, Windows file identity checks and seven
launcher contract cases pass. The complete lane fails in the new concurrent
launcher/Suite demonstration, then reaches its original group timeout.
[Retained failure](evidence/windows-editor-launch-native-failure-summary.json).

A controlled source regression reproduces an ownership-journal race: protected
bytes can advance before the original in-memory row is published. A simultaneous
observation incorrectly treats that interval as replacement. Reads now use the
same original transaction lease as writes. Retirement and actual replacement
still refuse access. The fixture also attempts every original cleanup after an
assertion fails, while preserving cleanup errors. Corrected Windows acceptance
must pass before calling the native failure repaired. Sixteen focused groups
pass 133 tests with five declared platform skips.
[Regression and correction](evidence/editor-journal-publication-summary.json).

The latest fully accepted native client checkpoint is `485b7c6`: twenty groups,
205 passing tests and no skips. Newer subset passes do not replace that
whole-lane result. [Native client evidence](evidence/windows-editor-client-native-summary.json).

The published `ecbb8cb` journal correction still fails four acknowledgement
assertions in the same Windows lifecycle group. The full lane has 229 passes,
four failures and no skips; fixture cleanup and natural exit now complete.
The next correction replaces the additional read-side kernel lease with an
original-handle publication queue. Writes retain every cross-process kernel
lease; reads retain fresh protected-row/target checks. Eight focused groups pass
69 tests with two skips, including held publication, replacement refusal and
failed-write outcomes. Do not declare native repair until the next lane passes.
[Failure](evidence/editor-journal-native-failure-summary.json),
[correction](evidence/editor-journal-read-queue-summary.json).

The `0594c8d` native follow-up passes the first eight lifecycle cases and fails
only test nine, the reviewed launcher acknowledgement deadline. The complete
lane has 234 passes, one failure and no skips; natural cleanup completes. The
latest correction shares overlapping original-handle checks, separated by every
queued mutation, and never caches a settled outcome. Eight focused groups pass
71 tests with two skips. Native acceptance remains pending.
[Failure](evidence/editor-journal-read-queue-native-failure-summary.json),
[correction](evidence/editor-journal-shared-observation-summary.json).

## Outstanding verification and implementation

1. Complete Linux `961ecb3` is accepted: 348 groups, 2,205 passing tests and
   32 declared skips. Its receipt is audited and exact staging removed. Do not
   restart that completed run or use it as acceptance of later journal changes.
2. Publish the shared-observation correction and audit its Windows client lane.
   Prior workflow `42365874853`, job `128383860203` is audited and still fails
   the launcher deadline. Preserve the original
   failure if another independent defect appears; do not change deadlines or
   assertions to obtain a pass.
3. Continue task-specific Windows IDE/project integration and remaining backend
   work in the requirement ledger. Editor command activation and frontend
   exposure remain frozen; completed backend components do not imply a completed
   user journey.
4. Keep native provider compatibility separate. Codex 0.167.0 is installed, but
   admission remains 0.166.0. The empty-home, network-isolated config probe now
   verifies 42 feature exclusions using only initialize/initialized/config-read.
   All original descendants and 66 generated files are retired; its marker is
   removed. Seven new feature flags default false; deferred_tool_world_state
   changes from false to true. Integrate a version-specific restriction contract
   before changing admission; native TUI/account/task acceptance remains separate.
   [Readback evidence](evidence/codex-0167-isolated-config-summary.json).
5. Maintain current software-versus-external-check distinctions. No missing
   hardware/account check can excuse an unimplemented module.

The restricted-storage follow-up at `3795217` passes eight ordinary owner
checks, eight restricted owner checks, 68 exact QUERY-only descendant
registrations, and original fixture/service removal. The relevant retirement
implementation is unchanged from the failed `47c80be` run. Its intermittent
cause therefore remains unresolved.
[Passing follow-up](evidence/restricted-storage-379-followup-summary.json),
[original failure](evidence/restricted-storage-47c80be-failure-summary.json).

## Installed application and complete-suite baseline

Installed Linux remains `edb76de`: 76 metadata/in-memory checks, 42 module hashes,
all 54 semantic workspaces, four profiles, 57 workflows, selected state, pending
keyboard-only conversation and frozen frontend preserved. Current plus one
rollback remain. No installed update is part of the journal correction.
[Installed evidence](evidence/installed-mixed-scanner-input-summary.json).

The accepted complete Linux run is `961ecb3`: 348 groups, 2,205 passes
and 32 declared platform skips. Its exact checkout, nine dependency aliases,
802 generated files (11,900,104 bytes), empty test parent and marker are removed.
The preceding accepted complete Windows run is `dc755901`: 417 groups,
2,478 passes and 207 declared skips. These revisions predate current editor work.
[Linux evidence](evidence/linux-961ecb3-complete-summary.json),
[Windows evidence](evidence/windows-complete-dc755901-summary.json).

Combined current/index/history scanner inputs, exact reviewed recipe saving,
policy/storage boundaries and their earlier installed evidence remain intact.
Historical detailed continuation notes are preserved at
[the preceding checkpoint](https://github.com/SquirmyWormy275/strathex-switchyard/blob/961ecb36036ae40f67f0685bb6bfbd6f815d10ed/docs/switchyard-continuation.md).
Use the current status and source-specific contracts before interpreting an old
“unfinished” note as the present implementation state.
