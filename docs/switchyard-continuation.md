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

| Area | Current state | Next boundary |
| --- | --- | --- |
| Original task owners and loading | Authenticated owner/load routes bind the original live account, repository, task, socket and process. Durable reviews prevent replay; stop/workspace/shutdown paths join owned work. [Contract](coding-task-owners.md). | Existing creation/text routes remain stdio. No new real task loading is authorized by this work. |
| Editor authorization `637a27f` | Review, issue and consume bind one editor selection and policy. A 30-second hashed permit is spent before delivery. Five groups / 59 tests pass. [Evidence](evidence/editor-authorization-summary.json). | Lost replies remain spent; a permit grants only the particular launch, not task completion or native attachment. |
| Signed editor client `2c87c03` | Exact instance/build/nonce/selection requests and replies; strict response validation; cancellation after durable consumption refuses replay. [Evidence](evidence/editor-authorization-client-summary.json). | The API bearer stays local. No automatic command registration or retries. |
| Editor launcher `1508ea9` | One exact Terminal object per review, native executable SHA-256, filesystem/focus/admission checks, retained partial effect and joined shutdown. Five groups / 54 tests, build/typecheck/CommonJS checks and cleanup pass. [Evidence](evidence/editor-terminal-launch-summary.json). | Provider/editor doubles. Command wiring and real terminal process/account/task acknowledgement remain unfinished. Do not infer attachment from focus, title or process ancestry alone. |
| Installed app `2c87c03` | Release `39c7b555…`; six update, ten owner/editor/severity and seven journal checks pass. [Evidence](evidence/installed-editor-authorization-summary.json). | This installs the backend gateway, not an active editor extension. Signed checks only refuse unknown owners. |
| Complete Linux `1508ea9` | 246 groups, 1,575 passed tests and eleven declared skips; all exact checkout/dependency/build/temporary-parent cleanup verifies. [Receipt](evidence/linux-1508-complete-summary.json). | Its marker is removed. Later Windows import-observation source has separate focused/native evidence. |
| Windows cold startup | `83d4139` cold native CNG APIs pass under the exact primary token. Original Node exits 134 at CSPRNG, no owner result. [Native result](evidence/windows-cold-random-native-summary.json). | Failed native software validation, not unavailable hardware. Preserve the failed fixture and unchanged acceptance assertions. |
| Windows import observation `164a622` | Existing `dumpbin` records four fixed RNG import flags and exact Node image hash. Two groups / 19 checks pass. [Source](evidence/windows-node-rng-imports-source-summary.json). | Native build failed before the original Node journey. Exact tool error was unavailable; followup pins the running image and retains bounded phase diagnostics. [Failure](evidence/windows-node-import-build-failure-summary.json). |

The latest installed update preserves all 54 workspace identities and 52 sealed
files byte-for-byte. Existing restart recovery reseals `personal` and
`profile-validation` when they are opened. Their definitions, exported package,
modes and private endpoint pass the normal comparisons. Selected sealed bytes
stay unchanged during the metadata checks. The extra assertion that all 54 files
were byte-identical failed and is retained; no full semantic pre-update snapshot
was captured. Dated launcher backups and exact package cleanup verify.

One old, unselected keyboard-only workspace has a pending Codex conversation from
October 30. Its workspace digest begins `f6427f379552`, and its sealed-file hash
is unchanged across the latest update. Do not select, initialize, cancel, repair
or rewrite it just to clear a preflight warning. No current owner/recording was
active in the update preflight.

## Continue independently

1. Complete Linux `1508ea9` and its exact cleanup are accepted; do not rerun it
   merely to repeat success. For a future coherent checkpoint inspect
   `/tmp/switchyard-full-linux-path.json` first. Verify source, phase, process exit,
   root identities, receipt and dependency aliases before cleanup. Use an owned
   home temporary parent because `/tmp` has per-user quotas. Never broaden cleanup
   or relax deadlines to turn a failure into a pass.
2. Follow up the failed `164a622` Windows import build. It produced no import or
   exchange artifact and did not retest Node startup. Import the next exact-source
   artifact only after source/merge and archive digest checks. The followup pins
   the running Node executable and retains fixed build-phase/LNK error metadata.
   Prior CNG success does not prove Node uses that path or explain the failure.
3. Implement native acknowledgement for the exact reviewed editor terminal and
   original owner/account/task. A separate observed connection or ordinary focus
   must not be treated as that terminal's acknowledgement. Keep UI wiring frozen;
   exercise the implementation with provider/editor doubles.
4. Continue other ledger requirements, including remaining Shield coverage,
   ecosystems, publisher provenance, CVSS 4 and workflow observation. These are
   unfinished software, separate from hardware/account acceptance.
5. Use the normal versioned update for coherent backend checkpoints and only
   permitted installed checks. The metadata verifiers require
   `--read-only-metadata`. Do not run older live task/scanner verifiers blindly:
   `verify-shield-host.mjs` creates a real Codex task and is outside current scope.

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
