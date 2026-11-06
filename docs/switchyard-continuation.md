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
checks, native Windows failures, focused source checks and installed acceptance.
The [verification record](verification.md) retains historical receipts and failed
attempts; do not infer current status from an older passing checkpoint.

The installed baseline remains `5a2c3243b223c657d81b190745ad43440b4e013c`,
release `9f70e2a819488f8ce04a0f5c978544f3e16a08bd6d9d47dffafa0ca2dd8b8146`.
Preserve all 54 original workspace identities, the pending keyboard-only Codex
workspace, private connection information and the frozen Home bytes. Later
source-only changes have not updated or restarted this installed application.

## Continue independently

1. Complete Linux `dad5400` passes all 281 groups: 1,776 passing tests, fifteen
   declared skips and no failures. Its owned checkout, nine dependency aliases,
   782 generated files, temporary parent and run marker were removed; other
   worktrees were preserved. [Receipt](evidence/linux-dad-complete-summary.json).
   Do not repeat a complete run without relevant changes or unresolved concerns.
   Future runs use an exact owned home-directory temporary root; this machine's
   `/tmp` user quota was exhausted. Do not alter mounts or delete unrelated data.
2. Native `2202720` accepts all 36 private-pipe checks and six ordinary setup
   preflight checks. The restricted owner now creates its worker with exact
   guardian/worker/status QUERY mask 8 verification, then fails at
   `probe-identity-return-structured-result`. The original owner remains **0/8**.
   [Native receipt](evidence/private-pipe-native-summary.json).
   Native `20dc066` reports worker DLL initialization failure, exit 3221225794
   and zero output bytes. Source defers shell32/ole32 until their effect-path calls
   and verifies the actual import tables in preflight. Inspect the native candidate
   next; its specific DLL hypothesis remains unproven.
   [Failure and correction](windows-setup-metadata-startup.md).
   Preserve all eight owner checks, the ninety-second deadline and exact QUERY
   mask 8. No broader token/process/default-DACL/SID/privilege/account rights or
   runtime fallback. [Pipe contract](windows-private-command-pipes.md).
3. Verify the corrected Windows backend scheduling and full release separately.
   All 26 task-owner cases now have independent children with the original
   45-second bound; the original test assertions and two Linux-only skips remain.
   A dedicated task-owner Windows job now avoids waiting for the long release
   lane. Native `9fde0a3` now completes all 26 cases: 24 passes and the original
   two Linux-only skips, with exact cleanup and no extended deadlines. The earlier
   four-job run remains failed evidence; complete release acceptance is separate.
   [Task-owner receipt](evidence/task-owner-native-summary.json).
   The previously reported lease case also passes.
   [Native batches](evidence/windows-backend-dbbc-native-summary.json),
   [case scheduling](evidence/task-owner-scenarios-source-summary.json).
4. Continue other independently executable ledger requirements, including Shield
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
