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

Latest Windows result: `a061be0` verifies the query-only child token ACL, preserves
all restrictions, denies duplicate/impersonation access and starts the original
Node image. Both legacy cold providers succeed. The original owner journey now
fails at private-state initialization, exit 2, zero of eight checks. Preserve
its fixture; investigate the bounded lease-helper diagnostic next. The source now
retains exact fixed phases/exit codes with 37 JS tests (one declared skip) and
1,965 portable managed checks; native followup is pending. [Diagnostic source](evidence/windows-state-lock-failure-source-summary.json). Do not add
rights or change accounts to clear this failure. [Receipt](evidence/windows-self-query-native-summary.json).

| Area | Current state | Next boundary |
| --- | --- | --- |
| Original task owners and loading | Authenticated owner/load routes bind the original live account, repository, task, socket and process. Durable reviews prevent replay; stop/workspace/shutdown paths join owned work. [Contract](coding-task-owners.md). | Existing creation/text routes remain stdio. No new real task loading is authorized by this work. |
| Editor authorization `637a27f` | Review, issue and consume bind one editor selection and policy. A 30-second hashed permit is spent before delivery. Five groups / 59 tests pass. [Evidence](evidence/editor-authorization-summary.json). | Lost replies remain spent; a permit grants only the particular launch, not task completion or native attachment. |
| Signed editor client `2c87c03` | Exact instance/build/nonce/selection requests and replies; strict response validation; cancellation after durable consumption refuses replay. [Evidence](evidence/editor-authorization-client-summary.json). | The API bearer stays local. No automatic command registration or retries. |
| Editor launcher `1508ea9` | One exact Terminal object per review, native executable SHA-256, filesystem/focus/admission checks, retained partial effect and joined shutdown. Five groups / 54 tests, build/typecheck/CommonJS checks and cleanup pass. [Evidence](evidence/editor-terminal-launch-summary.json). | Provider/editor doubles. A later scoped return method permits idle/active metadata only for the exact consumed editor selection and focuses the retained object without another launch; five groups/60 tests pass. [Return evidence](evidence/editor-active-return-summary.json). Command wiring and real terminal process/account/task acknowledgement remain unfinished. Do not infer attachment from focus, title or process ancestry alone. |
| Installed app `5a2c324` | Release `9f70e2a8…`; six update, eleven owner/editor/severity and seven journal checks pass. All 54 non-audit semantic snapshots match; 52 sealed files are byte-identical. [Evidence](evidence/installed-cvss4-summary.json). | Backend gateway only, four unknown-owner signed refusals and offline severity checks. No active editor extension or live task. |
| Complete Linux `d900499` | 248 groups, 1,600 passed tests and eleven declared skips; all exact checkout/dependency/build/temporary-parent cleanup verifies. [Receipt](evidence/linux-d900-complete-summary.json). | Marker removed. Later protocol witness/query-only correction has separate focused evidence. |
| Windows cold startup | `83d4139` cold native CNG APIs pass under the exact primary token. Original Node exits 134 at CSPRNG, no owner result. [Native result](evidence/windows-cold-random-native-summary.json). | Failed native software validation, not unavailable hardware. Preserve the failed fixture and unchanged acceptance assertions. |
| Windows import observation `78b640d` | Digest-verified artifacts show legacy CryptoAPI imports, no observed BCryptGenRandom import, cold CNG success and unchanged Node exit 134. [Native evidence](evidence/windows-node-rng-imports-native-summary.json). | Imports do not prove the executed branch. Earlier `164a622` build failure remains recorded; its exact cause was not recovered. |
| Cold legacy-first probe `a37751c` | Native CryptAcquireContextW fails with error 5 before generation; later CNG calls pass. Digest/source/token/process cleanup verify. [Native evidence](evidence/windows-cold-legacy-random-native-summary.json). | Exact denied provider lookup/resource remains unknown. Original Node still exits 134; failed fixture preserved. |

The latest installed update preserves all 54 workspace identities and non-audit
semantic snapshots, using a fixed pre-update retention clock. Fifty-two sealed
files remain byte-identical. The two verification workspaces receive only the
expected repository journal and restart/Claude recovery audit entries; prior
audit hashes remain under the existing retention cap. Dated launcher backups,
private endpoint, frozen Home and exact package cleanup verify. Three failed
read-only checker attempts are retained with their corrected field/hash causes.
The previous update's missing semantic snapshot is not retroactively accepted.

One old, unselected keyboard-only workspace has a pending Codex conversation from
October 30. Its workspace digest begins `f6427f379552`, and its sealed-file hash
is unchanged across the latest update. Do not select, initialize, cancel, repair
or rewrite it just to clear a preflight warning. No current owner/recording was
active in the update preflight.

CVSS 4 now matches 463,204 independently compared vectors across the declared
cohorts, with six groups / 58 tests, typecheck and package attribution checks.
The collector retains base severity separately from supplied context. Reference
code and exact staging are removed. [Source evidence](evidence/cvss-v4-summary.json).
The normal installed update and both `--read-only-metadata` verifiers now pass.
Complete Linux `d900499` and its exact cleanup now pass. Do not repeat that run,
the installed update or old live provider verifiers without a relevant new change.

## Continue independently

1. Complete Linux `d900499` and its exact cleanup are accepted; do not rerun it
   merely to repeat success. For a future coherent checkpoint inspect
   `/tmp/switchyard-full-linux-path.json` first. Verify source, phase, process exit,
   root identities, receipt and dependency aliases before cleanup. Use an owned
   home temporary parent because `/tmp` has per-user quotas. Never broaden cleanup
   or relax deadlines to turn a failure into a pass.
2. V3 native evidence at `47a49c8` verifies both user/machine default-provider
   lookups succeed (Strong provider), while default and fixed Enhanced-provider
   opens both fail with Access Denied. Later CNG succeeds; original Node remains
   exit 134 without an owner result. Source/merge/archive identity and native
   cleanup verify. [Evidence](evidence/windows-provider-lookup-native-summary.json).
   The exact denied resource during provider open remains unknown. Preserve the
   original token, provider defaults, registry, runtime image and failed fixture;
   do not substitute a broader account or entropy/runtime fallback.

   V4 at `32eba3c` now verifies all three self-token handle requests fail with
   Access Denied, including TOKEN_QUERY alone. No token/DACL mutation occurred.
   This does not establish that CryptoAPI attempted that operation. Original
   Node remains exit 134; source/merge/archive and native cleanup verify.
   [Native evidence](evidence/windows-self-token-native-summary.json).
   Read-only `d900499` metadata now verifies the same three owner/DACL entries
   on both actual suspended children: Administrators, SYSTEM and the logon SID.
   None matches the four restricting identities. This explains the direct query
   denial, but does not prove CryptoAPI's internal operation. Node remains 134;
   the original fixture is preserved. [Evidence](evidence/windows-token-security-native-summary.json).
   The query-only correction is implemented in the CI proof: exact existing-user
   TOKEN_QUERY only, original ACE byte readback, restrictions and unfinished-effect
   evidence. Two builds, 1,936 portable checks and sixteen projection tests pass.
   Native validation remains pending. Do not add duplicate/impersonation or broader
   permissions as a fallback; original Node success and all owner assertions are
   still required. [Source](evidence/windows-self-query-source-summary.json).

3. Implement native acknowledgement for the exact reviewed editor terminal and
   original owner/account/task. A separate observed connection or ordinary focus
   must not be treated as that terminal's acknowledgement. Keep UI wiring frozen;
   exercise the implementation with provider/editor doubles. Exact terminal PID,
   birth and executable observation is now connected to the consumed selection,
   with cancellation and no PID/title/ancestry fallback. Three groups / 38 tests
   plus compiled extension checks pass. This is a process witness, not connection
   or task acknowledgement. [Evidence](evidence/editor-process-summary.json).
   A bounded protocol witness now matches the exact resume reply and account
   samples before/after it, invalidating on boundary/replay/malformed frames.
   Three groups / 33 tests and package/typecheck pass with synthetic frames.
   It has no transport or forwarding authority. Connect a peer-bound stream
   before claiming attachment. [Evidence](evidence/editor-protocol-summary.json).
4. Continue other ledger requirements, including remaining Shield coverage,
   ecosystems, publisher provenance, verified local vulnerability context and workflow observation. These are
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
