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

The custom-agent backend now supports reviewed revocation, credential replacement
and enrollment-generation fences for messages, claims and roles. Eight groups/86
checks pass, including encrypted-state failures and an actual authenticated HTTP
revoke/reenroll/rebind journey with two verified Node child exits. Native Windows,
installed and frontend acceptance remain separate. [Contract](custom-agent-revocation.md).

Credential workers now join exact-child retirement on timeout/error, reject
signal-only status and block concurrent replacement while exit is uncertain.
Six groups/69 checks pass, including two real controlled children, without using
live credentials. Typecheck, package bounds and owned cleanup pass. Native and
installed acceptance remain separate. [Contract](credential-worker-lifecycle.md).
Native shortcut diagnostics at `80601e9` pass all sixteen original installation
scenarios and twelve writer cases with cleanup. The intermittent ten-second
timeout did not reproduce; its cause remains open. [Evidence](evidence/shortcut-stage-diagnostics-native-summary.json).

Read [current status](switchyard-status.md) first. It separates complete Linux
checks, native Windows results, focused source checks and installed acceptance.
The [verification record](verification.md) retains historical receipts and failed
attempts; do not infer current status from an older passing checkpoint.

The installed baseline is `e7cec91d1b28c87e8ed2a92a15f3b021cd9767fe`,
release `33eed82b8249d733d3f86ec1affb6bc304ccd2c88c9caa4736d290626c455870`.
Preserve all 54 original workspace identities, the pending keyboard-only Codex
workspace, private connection information and the frozen Home bytes. The normal
versioned update passes 20 owner/journal metadata checks plus six pure in-memory
command-history checks. Exact tested module hashes verify. It starts no bundled
example, recording or provider. All 54 semantic snapshots match; 53 sealed files
are byte-identical and one changed only audit metadata. Keep the current release
and its one rollback. The 534-file prepared bundle was verified and removed.
[Receipt](evidence/installed-command-observation-summary.json).
Earlier installed `4b2daed` and `5a8d159` retain separate lifecycle/archive/extras evidence.

Latest source work closes the bundled-example uncertain-stop/replacement/shutdown
gap. Seven focused groups/72 checks pass, including real authenticated Node
readiness, restart identity and keyboard-only exits; typecheck and package bounds
pass. The exact focused temporary root is removed. Normal installed metadata/module verification now passes; native Windows and
live installed bundled-example execution remain separate. [Contract](bundled-agent-lifecycle.md).
The four Windows backend batches at `9f35961` are now digest-verified: 198 groups,
1,022 passes, 142 declared skips, no failures and all cleanup verified. Its combined
release run 42281533502 is still active. [Receipt](evidence/windows-backend-9f35961-native-summary.json).

Latest addition: custom-agent command history now retains only opted-in
queue/claim/retirement/acknowledgement metadata. Seven groups/92 checks pass with
real encrypted HTTP/bundled-agent execution, explicit provider doubles, source/
interval/exclusion/pause fences, rollback and exact cleanup. Typecheck/package
bounds pass. Keep actual completion and measured savings false. Installed pure
metadata acceptance now passes six checks within the 26-check update. Native
Windows and live installed command execution remain separate.
[Contract](agent-lifecycle-observation.md#custom-agent-command-history),
[evidence](evidence/custom-agent-command-observation-summary.json).

The Windows first installation scenario times out again at `9193471` and `4b2daed`,
with 24/25 tests passing and all child/tree cleanup verified in both packets.
The original ten-second shortcut deadline remains. Its cause is unresolved; the
earlier `9f35961` pass does not establish stability. Fixed stage diagnostics now
pass 19 groups/36 source checks (all original sixteen installation scenarios,
twelve writer cases and existing release/direct-child checks). Native follow-up
must inspect the fixed last-stage label without extending deadlines or changing
permissions. [Failure packets](evidence/windows-shortcut-recurring-timeout-summary.json),
[diagnostic evidence](evidence/shortcut-stage-diagnostics-source-summary.json).

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
   [Failed receipt](evidence/linux-7e45654-timeout-summary.json). The corrected
   complete 55515d1 run passes all 307 groups, 1,805 tests and sixteen declared
   skips. Exact owned cleanup removes its checkout, nine aliases, 782 generated
   files, temporary parent and marker; all three other worktrees remain.
   [Complete receipt](evidence/linux-55515d1-complete-summary.json). Native
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
   Its unchanged-source retry was cancelled (job 128110089870) without an accepted
   native result. The original byte-comparison file also passes
   eight native tests and two declared Linux-only skips at 55515d1.
   [Byte receipt](evidence/npm-artifact-split-native-summary.json).
   A confirmed cleanup race is now corrected without extending the original
   ten-second execution bound: failure joins direct-child retirement and only
   then removes temporary output; unconfirmed exit preserves owned staging.
   Twenty-three focused groups/69 distinct checks pass, including two actual
   controlled Node writers. Native Windows 9f35961 now passes all sixteen original
   installation/recovery scenarios plus nine writer tests: 25 passes, no skips,
   original execution deadline and verified child/tree cleanup. The older failure
   and cancelled retry remain historical; their cause is not established.
   [Native receipt](evidence/shortcut-writer-native-summary.json).
   [Source evidence](evidence/shortcut-writer-retirement-source-summary.json).
   Historical installed source 5a8d159 passes 31 permitted metadata checks.
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
   Exact Python extras and corrected continuation/comment processing now pass
   ten focused groups/106 checks and a 39-case pip/PyPA oracle. Two new actual
   Linux scans and two Windows guest-double journeys retain original state,
   receipt/replay and cleanup guarantees. Typecheck/package bounds pass. Five
   installed extras metadata checks now pass inside the 31-check update; native
   Windows `9193471` passes four composed scanner and ten artifact tests, with two
   declared Linux-only skips and guest execution doubled. [Native receipt](evidence/pypi-extras-native-summary.json).
   The complete immutable Linux run at
   `5a8d159` now passes all 308 groups: 1,823 tests, sixteen declared skips and
   zero failures. Exact cleanup removed its checkout, nine aliases, 782 generated
   files, temporary parent and marker; all three other worktrees remain.
   [Complete receipt](evidence/linux-5a8d159-complete-summary.json).
   [Evidence](evidence/pypi-extras-source-summary.json).
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
