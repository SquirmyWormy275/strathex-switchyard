# Continue the full Switchyard suite

The October 29 Rev2 assignment is incomplete. Continue independently executable
implementation and validation; a passing subset is not completion. Start with
[current status](switchyard-status.md), the [requirement ledger](switchyard-requirements.md)
and [verification](verification.md). Source-specific receipts distinguish software
checks, installed demonstrations, native failures and unavailable environments.

Use the existing `feat/switchyard-configuration-loop` checkout and keep
[draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20)
updated. Inspect `git status` and `git log`; checkpoint hashes below identify
evidence, not instructions to reset. Publish regular commits. Do not merge or release.

## Decisions to preserve

- The Home/catalog frontend is frozen for owner review. No asset/UI changes,
  browser automation or reloads during backend work.
- Claude Code is a contingency for actual token exhaustion. Continue normally;
  do not delegate. Compaction is not exhaustion.
- Use cached F77 readouts and pinned source. No new HID, unlock, write, reset,
  flash, bootloader, solenoid or electrical operation. Preserve firmware Dvorak
  and US host input. The audit verifies 26 files across two builds without
  establishing electrical limits. [Audit](solenoid-capability-audit.md).
- No live login/logout/account switching, model requests or real native task
  creation/resume in these backend checks. Use controlled provider doubles.
  Read-only account metadata has separate existing acceptance.
- Preserve native ChatGPT main-window voice, its hidden desktop overlay, saved
  pet artwork and workstation click guard. No Seagate or game changes.
- No new local SDK, runtime or model downloads. Use `mise exec node@24.14.0 -- …`
  and the existing `.tools/dotnet-8.0.424` when a managed build is needed.

## Current implementation and evidence

Read [current status](switchyard-status.md) first. It separates complete Linux
checks, native Windows results, focused source checks and installed acceptance.
The [verification record](verification.md) retains historical receipts and failed
attempts; do not infer current status from an older passing checkpoint.

The installed baseline is `0cb823bba89e788be7a7d0adfd41769c185de4cd`,
release `5b9215b2466687a90f15d935af2839927abd479ddfd34640c108dacda10b9f5a`.
Preserve all 54 original workspace identities, the pending keyboard-only Codex
workspace, private connection information and the frozen Home bytes. The
normal versioned update passed 26 metadata checks, including six pure installed
archive identity/refusal checks. All 54 semantic snapshots match; 53 sealed files
are byte-identical and one changed only audit
metadata. Keep the current release and its one rollback. The prepared bundle
was removed after manifest verification. [Receipt](evidence/installed-npm-archive-summary.json).

## Continue independently

1. Complete Linux `6e967a3` passes all 306 groups: 1,793 passing tests, sixteen
   declared skips and no failures. Its owned checkout, nine dependency aliases,
   782 generated files, temporary parent and run marker were removed; other
   worktrees were preserved. [Receipt](evidence/linux-6e967a3-complete-summary.json).
   Do not repeat a complete run without relevant changes or unresolved concerns.
   Future runs use an exact owned home-directory temporary root; this machine's
   `/tmp` user quota was exhausted. Do not alter mounts or delete unrelated data.
2. Native `6e967a3` passes all eight original restricted-owner checks. Exactly
   68 descendants (17 guardians, 17 workers, 34 status helpers) verify QUERY
   mask 8. Native tree/token/desktop readback and inner/outer fixture, service
   and file retirement pass. All six actual GUI setup checks pass separately.
   This closes the restricted startup/retirement defect in controlled CI.
   [Owner receipt](evidence/windows-restricted-owner-accepted-summary.json),
   [setup](evidence/setup-final-native-summary.json).
   Preserve the 68-request bound, status-only slots 65–68, original eight
   assertions, ninety-second deadline and exact QUERY mask 8. No broader
   token/process/default-DACL/SID/privilege/account rights or runtime fallback.
   Interactive ordinary-user/UAC/guest acceptance remains separate.
3. Verify the corrected Windows backend scheduling and full release separately.
   All 26 task-owner cases now have independent children with the original
   45-second bound; the original test assertions and two Linux-only skips remain.
   A dedicated task-owner Windows job avoids waiting for the long release
   lane. The older complete `dbbcce8` release has now finished failed: 385/386
   groups, 2,336 accepted tests and 195 declared skips, with only that original
   task-owner timeout. [Receipt](evidence/windows-complete-dbbc-failed-summary.json). Native `9fde0a3` now completes all 26 cases: 24 passes and the original
   two Linux-only skips, with exact cleanup and no extended deadlines. The earlier
   four-job run remains failed evidence; complete release acceptance is separate.
   [Task-owner receipt](evidence/task-owner-native-summary.json).
   The previously reported lease case also passes.
   [Native batches](evidence/windows-backend-dbbc-native-summary.json),
   [case scheduling](evidence/task-owner-scenarios-source-summary.json).
4. Complete Linux `6e967a3` and its exact owned cleanup are finished. The run
   marker, checkout, nine dependency aliases, 782 generated files and temporary
   parent are removed; all three other worktrees are preserved. Native Windows
   advisory source checks pass 23 tests. Composed scanner checks pass seven
   tests with eight declared Linux-only skips and guest execution doubled.
   [Scanner receipt](evidence/osv-boundaries-native-scanner-summary.json).
   The installed SPDX/OSV metadata checks now pass through the normal update.
   Selected npm archive identity now passes six isolated groups/78 checks and
   one additional alias/version case, including actual Linux execution and
   Windows guest doubles. The parser never extracts or executes members; real
   offline npm output also passes after its portable omitted-owner fields were
   accounted for. Initial failed source/zero-plan receipts remain recorded.
   [Archive evidence](evidence/npm-archive-identity-summary.json). Reconcile the
   complete Linux 7e45654 failure separately: 305/306 groups, 1,783 accepted tests,
   sixteen declared skips and the original combined artifact deadline. Exact owned
   cleanup removed its checkout, nine aliases, 782 generated files and run marker.
   [Failed receipt](evidence/linux-7e45654-timeout-summary.json). A new isolated
   complete run at 55515d1 uses the corrected split; reconcile its active marker
   before cleanup. Native
   Windows 7e45654 times out the combined artifact file at its original 300-second
   bound; all other 65 boundary jobs pass. The correction separates byte/identity
   cases into independent files and CI lanes, preserving original assertions
   and deadlines. Five distinct groups/53 checks pass across the initial scanner
   groups and corrected harness inventory; four report-bound cases also pass.
   [Scheduling evidence](evidence/npm-archive-scheduling-summary.json). Reconcile
   its native follow-up evidence. Corrected `55515d1` archive-scanner now passes
   ten native Windows tests and two declared Linux-only skips, with guest
   execution doubled and exact cleanup. [Receipt](evidence/npm-archive-native-summary.json).
   The separate installation lane fails one of sixteen scenarios during native
   shortcut creation. The original ten-second shortcut deadline remains; its
   underlying cause is not established. [Failure](evidence/windows-shortcut-timeout-summary.json).
   Its exact failed job was requested for rerun after the workflow finished;
   reconcile that separately. The original byte-comparison file also passes
   eight native tests and two declared Linux-only skips at 55515d1.
   [Byte receipt](evidence/npm-artifact-split-native-summary.json).
   A confirmed cleanup race is now corrected without extending the original
   ten-second execution bound: failure joins direct-child retirement and only
   then removes temporary output; unconfirmed exit preserves owned staging.
   Twenty-three focused groups/69 distinct checks pass, including two actual
   controlled Node writers. Windows COM/shortcut acceptance is still pending.
   [Source evidence](evidence/shortcut-writer-retirement-source-summary.json).
   Installed source is now 0cb823b, with 26 permitted metadata checks.
   Native NTFS index/history staging now each pass six original checks and
   three independent guardian exits at 6b4089c. Their Windows scanner files
   separately pass two cases each with guest doubles; leases pass 24 cases and
   one Linux-only skip. Packet Git witnesses are synthetic and no actual guest,
   installed Windows or ordinary-user journey is accepted by those receipts.
   [Native evidence](evidence/native-history-index-leases-summary.json).
   Continue other independently executable ledger requirements, including Shield
   coverage, ecosystems, publisher provenance, verified local vulnerability
   context and workflow observation. These are unfinished implementation,
   separate from unavailable hardware, accounts or interactive environments.
5. Keep frontend and editor command activation frozen. The protected editor
   journal, signed routes, restricted upstream and retained Terminal compose
   through actual Linux carriers with provider/editor doubles. Native TUI,
   account and IDE acknowledgement remain unaccepted. Installed Codex 0.167.0
   is outside the reviewed 0.166.0 gate; static schemas do not justify changing it.
   [Terminal proof](evidence/editor-terminal-connection-summary.json),
   [retirement](evidence/editor-retired-stop-summary.json).
6. Use the normal versioned update for coherent backend checkpoints and only
   permitted installed checks. Metadata verifiers require `--read-only-metadata`.
   Do not run older live task/scanner verifiers blindly: `verify-shield-host.mjs`
   creates a real Codex task and is outside current scope.

## Keep evidence small and accurate

Private receipts live under `~/.local/state/strathex-switchyard/runtime-verification/`.
Retain small summaries in `docs/evidence`; remove successful exact owned bundles,
build output and test checkouts after exit verification. Preserve existing review
artifacts and all unrelated checkouts. Failed native fixtures retain their original
ownership evidence. Do not install another SDK to inspect them locally.

Separate unaccepted environments: no approved Microsoft work tenant; B122 hardware
and all 27 physical gates unavailable; F77 physical operations not authorized;
Windows guest/UAC/ordinary-user journeys not established by headless CI. The real
Claude/tmux attempt stopped at workspace trust and restored focus/workspace while
retiring owned processes; no trust bypass is authorized.

Historical milestones and original failures remain in
[verification](verification.md) and [status history](switchyard-status-history-7.md).
