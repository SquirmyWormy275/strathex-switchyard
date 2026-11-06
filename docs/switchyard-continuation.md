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

Selected npm artifact comparison now joins the existing reviewed Supply Chain
and Release paths. It compares raw bytes with one canonical SHA-512 declaration,
retains high failed mismatch findings, and keeps archive contents/publisher
identity and the complete Shield gate unverified. Thirteen groups / 89 tests are
accepted across behavior and corrected inventory checks, including six actual
Linux and six Windows guest-double scans; typecheck and owned cleanup pass.
Native Windows host follow-up is pending. [Contract](npm-artifact-integrity.md),
[evidence](evidence/npm-artifact-integrity-summary.json).

Windows `ad4d5e6` builds and executes the cold native probe. Its restricted child
with the existing TOKEN_QUERY-only allowance successfully creates/query-closes
empty anonymous, Local and Global Jobs. Original token/RNG and cleanup checks
pass. The actual setup-identity guardian still fails Job creation with error 5;
the difference in descendant context remains unresolved. No broader access or
fallback is enabled. [Native evidence](evidence/windows-cold-job-native-summary.json).

Source `3363e8b` passes the complete Linux manifest: **260 groups, 1,734
passed tests, eleven declared skips, zero failures**. Every owned child/tree,
temporary checkout, nine dependency aliases and 782 generated files (11,766,655
bytes) were retired. Installed and hardware/account acceptance remain separate.
[Linux receipt](evidence/linux-336-complete-summary.json).

The same source passes **five application and sixteen installation/recovery
tests on actual Windows**, with the same-source helper and original deadlines.
The complete Windows release, including isolated Python prerequisite verification,
is still pending. The restricted-owner Job creation failure remains open.
[Native lifecycle receipts](evidence/windows-336-lifecycle-native-summary.json).

A CI-only cold-process probe now observes anonymous, Local and Global empty Job
creation after all original RNG/token checks. It grants no rights, assigns no
process and changes no production fallback. Six groups / 78 tests, two managed
builds / 2,071 portable checks, typecheck and owned cleanup pass. Native C++
execution now confirms all three empty-Job cases while the original owner still fails. [Contract](windows-job-observation.md),
[source evidence](evidence/windows-cold-job-source-summary.json).

Windows `fb265e7b` proves `CreateJobObjectW` fails with Win32 error 5 before
setup-identity readiness. The original restricted owner remains 0/8. Do not
infer whether its object DACL or namespace caused denial and do not add broader
token/process/default-DACL/SID/privilege/account permissions or a runtime fallback.
[Native evidence](evidence/windows-guardian-job-native-summary.json).

The complete older Windows release `1fc9d7f` fails four groups (eight tests).
Two Python-dependent checks lack Python on the isolated PATH; native application
and recovery fixtures still bundle inert helper text. The source now admits one
explicit existing, version/hash-checked Python 3.13.3 test executable and bundles
the exact-source helper for actual Windows lifecycle tests. Eight groups / 113
tests plus 29 lane/package follow-up checks, typecheck and exact test cleanup
pass on Linux. Source 3363e8b now passes both native application and installation
lanes with every original check and deadline; the complete release remains pending.
[Original failure](evidence/windows-release-1fc-failure-summary.json),
[corrections](evidence/windows-release-prerequisite-summary.json).


The Windows guardian now reports only fixed pre-readiness startup phases, with
API-specific numeric codes for Job create/configure failures. The host preserves
refusal and all ownership checks; it does not turn diagnostic output into exit
or execution acceptance. Six groups / 78 tests, two managed builds / 2,006
portable checks, typecheck and exact owned cleanup pass. Native fb265e7b
identifies the Job-creation error described above. [Contract](windows-helper-startup.md),
[evidence](evidence/runtime-startup-observation-summary.json).

npm prerelease/build handling now joins collector, signed feed, scanner inventory
and strict host verification. Twelve groups / 101 tests plus 556 grammar cases
and 276,676 existing node-semver reference comparisons pass with typecheck and
exact cleanup. No new dependency, SDK, runtime or reference download.
[Contract](npm-semver.md), [evidence](evidence/npm-semver-summary.json).

Native Windows `6f2097b` reports `probe-identity-created-worker-exit`: the actual
setup-identity guardian child is created but exits before a readiness frame.
The original owner still passes zero of eight checks. Narrow the managed startup
operation without inferring a specific permission failure or widening access.
[Verified native artifact](evidence/windows-owner-probe-native-summary.json).

CI-only probe observation now labels reconcile, setup identity or broker capability
and the first failing command lifecycle stage without changing native behavior,
permissions or the eight owner assertions. Five groups / 60 tests and typecheck
pass with cleanup. Native follow-up is pending; do not infer a narrower cause
from the prior read-only-probe failure.
[Evidence](evidence/windows-owner-probe-observation-summary.json).

Windows `4faa8a1` clears restricted private-state initialization and mode update.
Its version 2 native lease tests pass **24 checks / one declared skip**, including
EOF, contention, partial input, non-pipe input refusal and parent-loss cleanup.
The restricted owner now fails later at the read-only storage probe, still zero
of eight complete owner checks. [Native result](evidence/windows-lease-pipe-native-summary.json).

Shield now supports exact declared license-and-exception pairs in signed policy.
Seven groups / 59 tests plus a 26-test engine follow-up, typecheck and exact
cleanup pass. Actual Linux scans and Windows guest doubles keep base-only and
different-exception permissions distinct; no legal or publisher verification is
claimed. [Evidence](evidence/license-exception-declaration-summary.json).

Windows `da28b5c` identifies the restricted failure as **Access Denied opening the
parent process**. The next source protocol binds worker lifetime to its private
inherited input pipe instead of that lookup. It checks EOF while idle, reading
partial frames, holding a lease and waiting for a lock, with one reader and no
new process/token rights. File identity, sharing, sequencing, Job containment and
the original eight owner assertions remain. Two managed builds / 2,006 portable
checks, five groups / 53 passes / one Windows-only skip and typecheck pass; native
acceptance is pending. [Failure and source](evidence/windows-lease-pipe-owner-source-summary.json).

Native Windows `f653827` passes both lease groups: **24 checks, one declared
Linux-only skip**, and every child/tree cleanup verifies. The separate restricted
owner still fails zero of eight checks. Its managed projection omitted the new
progress labels; that reporting gap is now corrected and all ten emitted labels
are tested through the managed projection. Two builds / 1,995 portable checks and
exact staging cleanup pass. The precise restricted-parent failure remains unknown
until the native follow-up. The client and policy workflows at `f653827` pass.
[Retained failure, native lease pass and projection correction](evidence/windows-parent-projection-summary.json).

Windows `fea2ca4` now clears canonical-path acceptance, then fails before the
parent-process check completes; the original restricted owner still passes zero
of eight checks. Ordinary owner (8), restricted metadata (13) and native exchange
(31) continue to pass. New fixed diagnostics distinguish parent open/query failures
without changing rights or containment. Two managed builds / 1,985 portable checks,
five groups / 53 passes / one Windows-only skip and typecheck pass.
A separate native lease test reached a stale diagnostic-label assertion, now
corrected to require the exact full sequence. Both failed receipts are retained;
the native follow-up is pending.
[Current Windows evidence](evidence/windows-parent-observation-summary.json).

Agent, host-action and editor recording now refuse metadata from before initial
consent or the latest resume. The encrypted interval stays monotonic across
duplicate resume and backward clock movement. Nine isolated groups / 105 tests,
typecheck and exact child/tree cleanup pass. Existing event history is retained;
no live account, native task or frontend operation runs.
[Recording-boundary evidence](evidence/observation-window-summary.json).

Windows `701f915` still fails after reading lock input, before the new canonical-path
progress marker; the parent-watch correction is therefore not an accepted fix
for that failure. The next source change resolves an existing Windows lock path
and verifies the same bigint file identity and local drive before native dispatch.
Native path guards remain unchanged. Five groups/52 passes/one Windows-only skip
and typecheck pass; native acceptance is pending.
[Retained failure and source correction](evidence/windows-canonical-lock-source-summary.json).

Editor workflow history now passes **seven groups / 84 tests**. Explicit Personal
consent records four lifecycle states in the same encrypted journal transaction,
with private correlation, pause/exclusion fences and no live attachment or
completion claim. Actual Linux carriers and controlled provider/terminal checks
verify cleanup; typecheck passes. Frontend, installed and native acceptance remain
separate. [Contract](editor-workflow-observation.md),
[evidence](evidence/editor-workflow-observation-summary.json).

Windows `1fc9d7f` clears copied-helper metadata and console initialization:
both EOF probes now reach entry and retire exact owned trees. Ordinary owner
checks (8), restricted metadata (13) and native exchange (31) pass. The original
restricted owner still fails during lock initialization after reading input,
with zero of eight checks. Both imported artifact digests verify.
[Native result](evidence/windows-pipe-native-summary.json).

The next source correction removes an unnecessary full-process-access request
from the parent watcher. It pins one handle with only birth-query and exit-wait
rights, retaining parent-loss cleanup and all original token restrictions.
Two managed builds/1,985 portable checks and five groups/49 passes/one declared
Windows-only skip pass. Native acceptance remains pending; the previous receipt
does not establish the exact post-input failure cause.
[Source evidence](evidence/windows-lease-parent-source-summary.json).

The archived Windows release test tree now builds/stages its own exact-source
state helper before verification. The previous 97a7727 run observed ENOENT;
four portable groups / 42 checks pass for the correction, but native CI remains
pending. This does not repair restricted-token helper startup.
[Evidence](evidence/windows-archived-helper-summary.json).

Cargo inventory and advisory matching now support bounded prerelease/build
versions and u64 core numbers. **Nine groups / 94 tests** and **146,326 independent
Rust SemVer comparisons** pass, including actual Linux scans and Windows guest
doubles. The Windows CI matrix has an independent Cargo lane. Typecheck and exact
owned cleanup pass. Broader syntax, resolution, licenses and provenance remain
unfinished; installed and native guest acceptance are separate.
[Contract](cargo-supply-chain.md), [current evidence](evidence/cargo-semver-summary.json),
[earlier TOML checks](evidence/cargo-supply-chain-summary.json).

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

1. Complete Linux `3363e8b` passes all 260 groups, 1,734 tests, eleven declared
   skips and zero failures. Exact owned cleanup is complete, including the marker.
   [Receipt](evidence/linux-336-complete-summary.json). Do not repeat a complete
   run without relevant changes. A future run must inspect its own marker, source,
   process exit, root identities, aliases and generated outputs before cleanup.
2. Obtain the CI-only empty-Job observations and continue the confirmed restricted
   guardian `CreateJobObjectW` error 5. No namespace/DACL cause is yet established.
   Preserve all eight original owner checks and the current TOKEN_QUERY-only mask.
   No broader token/process/default-DACL/SID/privilege/account rights or runtime
   fallback. [Diagnostic contract](windows-job-observation.md).
   Both native application/recovery lanes now pass all 21 tests; the newer complete
   Windows release and its isolated Python prerequisite remain separate.

3. The protected editor journal, signed client/routes, restricted upstream and
   retained Terminal now compose through actual Linux carriers with controlled
   provider/editor doubles. Exact PID/image, task acknowledgement, replay refusal,
   focus, disconnect and late idempotent stop have focused acceptance. Keep
   frontend/command activation frozen and do not equate synthetic wire success
   with native TUI/account/IDE acceptance. The installed 0.167.0 CLI is still
   outside the reviewed 0.166.0 gate. [Terminal proof](evidence/editor-terminal-connection-summary.json),
   [retirement](evidence/editor-retired-stop-summary.json).
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
