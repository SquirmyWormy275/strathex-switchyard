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

The composed editor lifecycle and recovery now pass six groups / 64 tests,
typecheck, JavaScript parse and package checks. The real protected journal records
original host/boot, directory, upstream, ingress and terminal identities. Abrupt
synthetic host loss permits exact stale-socket retirement without provider/account
access. Live hosts, unidentified spawn windows, missing original-host proof and
foreign entries remain preserved. Terminal disconnect withdraws acknowledgement
and joins exact dedicated cleanup. Signed routes and typed responses now pass seven groups / 96 tests, including
actual protected lifecycle routing and joined Suite transitions. Retained Terminal composition now passes six groups / 46 tests, including an owned
synthetic terminal process through the signed service and real carriers. Command
activation remains unfinished; native TUI compatibility is unaccepted.
[Terminal demonstration](evidence/editor-terminal-connection-summary.json).
Later stop after autonomous carrier cleanup is idempotent for the exact protected
record; five groups / 39 tests pass with actual synthetic terminal exit and
immutable refusal of substituted identities. [Evidence](evidence/editor-retired-stop-summary.json). [Routing evidence](evidence/editor-routing-summary.json).
[Recovery evidence](evidence/editor-recovery-summary.json),
[composed lifecycle](evidence/editor-connections-summary.json),
[relay](evidence/editor-relay-summary.json).

The installed CLI is now 0.167.0. Only offline schemas were generated; scratch
files are removed. Keep the existing 0.166.0 gate until actual compatibility is
accepted. No live task/account/model effect is authorized by the static check.
[Version drift](evidence/codex-0167-static-summary.json).

Windows `700e7f2` demonstrates that CREATE_NO_WINDOW fails before helper entry,
whereas DETACHED_PROCESS reaches the fixed entry marker with the same restricted
token, query-only correction and explicit creation-time Job. Both trees retire.
The unchanged restricted Node journey still fails before its eight owner checks;
ordinary Node, restricted metadata/exchange and separate filesystem/setup checks
pass. Production detached mode is not enabled because libuv skips its child Job
in that mode. Preserve containment and all acceptance assertions when fixing
launch. [Native comparison](evidence/windows-lease-console-native-summary.json).

| Area | Current state | Next boundary |
| --- | --- | --- |
| Original task owners and loading | Authenticated owner/load routes bind the original live account, repository, task, socket and process. Durable reviews prevent replay; stop/workspace/shutdown paths join owned work. [Contract](coding-task-owners.md). | Existing creation/text routes remain stdio. No new real task loading is authorized by this work. |
| Editor authorization `637a27f` | Review, issue and consume bind one editor selection and policy. A 30-second hashed permit is spent before delivery. Five groups / 59 tests pass. [Evidence](evidence/editor-authorization-summary.json). | Lost replies remain spent; a permit grants only the particular launch, not task completion or native attachment. |
| Signed editor client `2c87c03` | Exact instance/build/nonce/selection requests and replies; strict response validation; cancellation after durable consumption refuses replay. [Evidence](evidence/editor-authorization-client-summary.json). | The API bearer stays local. No automatic command registration or retries. |
| Editor launcher `1508ea9` | One exact Terminal object per review, native executable SHA-256, filesystem/focus/admission checks, retained partial effect and joined shutdown. Five groups / 54 tests, build/typecheck/CommonJS checks and cleanup pass. [Evidence](evidence/editor-terminal-launch-summary.json). | Provider/editor doubles. A later scoped return method permits idle/active metadata only for the exact consumed editor selection and focuses the retained object without another launch; five groups/60 tests pass. [Return evidence](evidence/editor-active-return-summary.json). Command wiring and real terminal process/account/task acknowledgement remain unfinished. Do not infer attachment from focus, title or process ancestry alone. |
| Installed app `5a2c324` | Release `9f70e2a8…`; six update, eleven owner/editor/severity and seven journal checks pass. All 54 non-audit semantic snapshots match; 52 sealed files are byte-identical. [Evidence](evidence/installed-cvss4-summary.json). | Backend gateway only, four unknown-owner signed refusals and offline severity checks. No active editor extension or live task. |
| Earlier complete Linux `d900499` | 248 groups, 1,600 passed tests and eleven declared skips; all exact checkout/dependency/build/temporary-parent cleanup verifies. [Receipt](evidence/linux-d900-complete-summary.json). | Marker removed. Later protocol witness/query-only correction has separate focused evidence. |
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

1. Complete Linux `0ad510e` passes 255/255 groups, 1,682 tests, eleven declared
   skips and zero failures. All exact child/tree/staging cleanup verifies and the
   marker is removed. [Receipt](evidence/linux-0ad-complete-summary.json).
   It includes journal, recovery, routing and Suite transitions; later retained
   Terminal composition and idempotent retired-stop correction have separate
   focused evidence. Do not repeat this accepted run without a relevant change.
   Before another justified run, inspect `/tmp/switchyard-full-linux-path.json`.
   Verify source, phase, process exit, root identities, receipt and every owned
   alias/build/test parent. Never broaden cleanup or relax deadlines.

2. Use the observed `700e7f2` console-mode difference to repair restricted helper
   startup while retaining explicit parent-loss containment. Detached EOF entry
   is a diagnostic, not acceptance of a lease or the original eight-check owner.
   No broader token rights, default-DACL/privilege/SID/account/runtime fallback
   is permitted. Earlier `702897d` stopped at a stale parser-count guard; its
   failed receipt and the correction from forty to fifty checks remain retained.
   [Native comparison](evidence/windows-lease-console-native-summary.json),
   [verifier correction](evidence/windows-verifier-inventory-summary.json).

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
   The new Linux ingress carrier now checks that exact peer before HTTP upgrade
   and bridges bounded masked WebSocket/JSONL frames. Eleven native synthetic
   tests plus five package checks and typecheck pass, including parent loss,
   deadline, substituted-name preservation and protocol-witness composition.
   The parent lifecycle initially passed eight behavioral cases and five package checks,
   including joined cancellation and exact uncertain cleanup. It requires caller
   ownership callbacks, which remain doubled in this cohort. The later dedicated original upstream and restricted relay pass their synthetic
   end-to-end check. The protected journal component also passes real-store tests.
   The protected lifecycle and interrupted-host recovery now compose these components.
   Signed routes, typed responses and retained Terminal composition are now connected;
   production command activation and native TUI compatibility remain next;
   no live task/IDE acknowledgement is granted. [Carrier](evidence/editor-ingress-summary.json),
   [parent lifecycle](evidence/editor-ingress-owner-summary.json).
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
