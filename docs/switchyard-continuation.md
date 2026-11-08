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

## Current native status and version work

Codex status now uses the same recording-consent capture as Claude. Two additional retained failures showed a delayed result entering a resumed recording and its history event receiving the storage timestamp. The fix preserves the original provider time; task-status freshness was already correct. All 35 original groups/151 tests pass, including both adapters, the shared collector and all 29 task-owner scenarios. TypeScript checking passes. [Codex evidence](evidence/codex-status-consent-summary.json). The normal installed update at `9266c12` passes 102 metadata/refusal checks across 59 exact modules; its exact prepared bundle is removed. Keep the original failing receipts. No native task/model operation is authorized by these checks.

The latest source correction preserves Claude status arrival time and the recording generation captured before inventory. Two original failures are retained; seven original groups/113 tests and typecheck pass. Installed source `6337263` passes 102 metadata/refusal checks across 59 exact modules; the connected seven-stage synthetic demonstration passes and its temporary state is removed. No recording or native task is started by this correction. [Evidence](evidence/claude-status-consent-summary.json).

The later task-adapter admission fix now uses that same exact list instead of a broad version range. Preserve the original failing 2.1.309 discovery regression and the corrected six-group/94-test receipt. Source and typecheck pass. Installed source `526c5f2` passes 102 metadata/refusal checks across 59 exact modules, including the new pure task-version refusal. Its exact prepared bundle is removed. No live task operation is authorized by this correction. [Evidence](evidence/claude-version-admission-summary.json).

The installed native CLI has updated to 2.1.319. Its original exact designer
version refusal is retained. The source now admits exactly 2.1.308, 2.1.317 and
2.1.319; unknown versions and changes across approval/response still refuse.
Six original groups/93 tests and typecheck pass. Actual read-only metadata/help
checks verify twelve guardian exits in total, with no prompts, task creation,
resume or login changes. Normal installed source `1bee5a5` now accepts the real native version/account
through its own module; both command guardians verify stopped. [Evidence](evidence/claude-319-source-summary.json).

Claude native attach can restart a stopped session and exposes no verified
live-only flag. Discovery now states that the attachment launcher remains
unfinished and grants no launch/attachment authority. Do not wire it into focus
or status. The live native terminal path remains an implementation/acceptance gap.

## Current backend state

The latest backend addition is read-only saved-project discovery. Both typed editor
clients use a signed empty selection; the Suite chooses the active workspace and
lists exact roots/distinct task counts from eligible protected owners. It shares
task-choice eligibility and preserves fresh review. No provider inspection, task
operation, state write or directory crawl occurs. Picker and command activation
remain frozen. [Contract](coding-task-owners.md#find-eligible-saved-projects),
37 focused groups/117 tests, zero skips, and both TypeScript checks pass.
[source evidence](evidence/editor-project-choices-source-summary.json).

The repeatable [connected backend demo](backend-demonstration.md) runs with
`node scripts/demo-switchyard-backend.mjs --synthetic`. Seven stages pass using
normal encrypted stores, authenticated API and signed SDK with a synthetic agent
and simulated second host. Four original groups/21 tests pass; original receipts
are copied privately and temporary demo state is removed. This does not change
the installed runtime or freeze boundaries. The same public command passes two native Windows tests at `864fe0d` with
zero skips and exact cleanup; see [native evidence](evidence/backend-connected-demo-native-summary.json). [Evidence](evidence/backend-connected-demo-summary.json).

The latest source correction preserves external-agent report time and recording
generation across Node/Python SDK queues and encrypted-state waits. Nine groups/
141 tests pass; a signed HTTP demonstration composes two real encrypted stores.
Two original failing consent regressions are retained. The new `agent-consent`
Windows lane selects the three complete original contract files; native
acceptance at `b38ff759` passes all three original groups/51 tests with exact commands, bounds and cleanup. The normal installed update passes 97 metadata/refusal checks across 57 exact modules.
[Evidence](evidence/external-agent-consent-source-summary.json).

The latest source feature is guided role choices: readable saved connection labels
and a digest-checked local binding route. It preserves selected-workspace, policy,
original session/capability, role and prior-binding identity. Seven groups/101 tests
pass with one declared platform skip and both TypeScript checks. It is installed at `2c6497f`; all 97 metadata/refusal checks and 57 exact
module hashes pass, including the pure role contracts and installed route refusals.
[Contract](role-dispatch-binding.md#choose-a-saved-connection-by-name),
[source evidence](evidence/role-choices-source-summary.json).

The preceding feature is exact-project task choices. The Suite selects its active
workspace, checks persisted selection identity and lists bounded saved task labels
with original owner/load/task IDs. It reads encrypted state without native
inspection or writes. Both typed editor clients validate the signed result.
The chosen row still needs the existing target/review/issue/consume flow.
Frontend picker and command activation remain unfinished and frozen.

Source `9d230ac` passes 34 isolated groups/87 tests, zero skips, and both
TypeScript checks. The demonstration composes the real encrypted Suite and signed
HTTP server with a synthetic provider. Scope, stale bindings, same-name workspace
reselection, response substitution and endpoint replacement all have coverage.
[Contract](coding-task-owners.md#find-saved-tasks-for-a-project),
[source evidence](evidence/editor-task-choices-source-summary.json).

The preceding consent fixes prevent queued runtime events or foreground failures
from crossing pause/resume generations, including an identical clock value.
Original-source retirement happens before delayed error persistence can overlap
a replacement. Eight groups/124 tests and installed metadata checks cover them.
[Consent evidence](evidence/consent-generation-source-summary.json),
[retirement evidence](evidence/foreground-retirement-source-summary.json).

## Installed checkpoint

- Source: `9266c1248af9a8f8c8bd355b5b0b150bcc957e0e`.
- Release: `0c71eced8cddd1d184b430947fbe11f79a791c3328ea1a99cc21af714facc297`.
- Rollback: `8aa0cc4c80cfd45c1c48c0725139be7a1e1870fb2bbc749ecd849d026100d1dc`.
- Frozen frontend: `24100ef601b810efb0cda95e4fe0842d2944560734b02c4cf482c25e19150543`.
- 102 metadata/refusal checks, 59 exact module hashes; all 54 semantic workspaces,
  four profiles, 57 workflows, selection and one pending keyboard-only conversation
  preserved. 53 sealed files are byte-identical; one changes audit metadata only.
- The earlier installed native Claude version/account check accepts 2.1.319 with both
  owned guardians independently stopped; no prompt/task/login operation occurred.
- Dated backup and launcher readback verify. Current plus one rollback remain.
  Installed payload: 554 files/4,750,121 bytes. The exact temporary package,
  555 files/4,849,605 bytes, is removed.
  Do not repeat executed installation or cleanup scripts.

The selected personal workspace returns a complete empty project inventory without
native observation or task authority. Unauthenticated and malformed requests
refuse. Source and native contracts cover populated inventory separately.
Host-facing task-owner, Copilot-journal and signed-intent verifiers run sequentially.
[Installed receipt](evidence/installed-codex-status-consent-summary.json).

## Complete runs and native evidence

Complete Linux source `9266c1248af9a8f8c8bd355b5b0b150bcc957e0e` is accepted:
356 original groups, 2,333 passing tests and 32 declared skips. Receipt
`e19a2513-00d0-4f53-b1b1-726f467955f4` retains the original manifest, commands,
limits and verified child cleanup. The corrected unit exited zero. Its exact
checkout, nine dependency aliases, 803 generated files/11,910,385 bytes, empty
test parent and active marker are removed; other worktrees are preserved.
The temporary wrapper's original syntax failure preceded every test and remains
retained. No complete Linux run is active. Do not rerun executed start, audit or
cleanup scripts. The reusable private template now uses whole-token placeholder
replacement and syntax-checks the wrapper before starting it.
[Latest complete Linux evidence](evidence/linux-9266c12-complete-summary.json).

Complete Windows source `90fa879d776c0b7756f66d37180fb8c3049b3fc4` is accepted:
462 original groups, 2,902 passes and 246 declared skips. All 23 jobs of run
42397684980 passed. All 21 raw receipts were independently audited and matched
exactly to the native collector (job 128484849308; artifact 13584933078).
Only bounded JSON remains locally; 86,995 bytes of worker ZIPs plus the 2,607-byte
collector ZIP were read in memory. No archives are retained. This includes project
discovery and settlement-fixture diagnostics; later Claude 2.1.319 admission and
the separate Windows package remain outside that checkpoint. Original intermittent
focus, storage and settlement failures remain unresolved.
[Complete native evidence](evidence/complete-windows-90fa879-summary.json).
The earlier `45c34e5` result remains in its
[historical evidence](evidence/complete-windows-45c34e5-summary.json).

Complete Linux `cf3bb4c` now passes 356 original groups, 2,326 tests and 32 declared
skips. Receipt `2121c57b-7a65-4b1a-b0a8-33f24666ce70` retains original commands,
bounds, manifest and exact cleanup. Its unit exited zero. The temporary checkout,
nine dependency aliases, 803 generated files/11,910,385 bytes, empty test parent
and run marker are removed. No complete Linux run is active. A temporary runner
syntax failure before any group started is retained separately; it was corrected
without changing a test or bound. Do not rerun executed start/audit/cleanup scripts.
[Latest Linux evidence](evidence/linux-cf3bb4c-complete-summary.json).

Complete Linux source `2c6497f8c2829fbd29026fe98f13de9ecade1d65` is accepted:
351 original groups, 2,312 passing tests and 32 declared platform skips. It covers
the preceding installed runtime, guided roles and external-agent consent.
Receipt `4be21e52-4d54-4cea-b06e-944b3aaee8fe` retains original manifest,
commands, bounds, skip counts and child/tree cleanup. The exact checkout, nine
dependency aliases, 803 generated files/11,907,805 bytes, empty test parent and
run marker are removed. No complete Linux run is active. Do not rerun any
executed audit, installation or cleanup script.
[Complete receipt](evidence/linux-2c6497f-complete-summary.json).

The Windows filesystem workflow now has an independent `role-choices` contract
lane using the complete original role-dispatch group. Existing helper, deadlines,
skip expectations and concurrency rules are unchanged. Two local groups/33 tests
pass; native acceptance of this new lane remains pending. Normal branch events
schedule it; no manual workflow dispatch is needed.
[Lane evidence](evidence/role-choices-windows-lane-summary.json).

That native lane at `f74a380` subsequently hit its unchanged 45-second whole-file
child deadline. Receipt `d489d6df-793c-4bfa-abe9-68ec083e4e72` preserves the failure
and verified cleanup; partial TAP output is not group acceptance. Guided setup
and dispatch now occupy two complete files with all 24 assertion bodies and the
shared encrypted fixture preserved. Each keeps the original child deadline and
zero skips. Six local groups/64 tests pass. Native `b38ff759` now passes both complete files, all 24 tests, and original cleanup within the unchanged 45-second child bounds. [Native receipt](evidence/role-choices-native-b38-summary.json).
[Isolation evidence](evidence/role-contract-isolation-summary.json).

Native Windows client `9d230ac` passes 25 groups/250 tests with zero skips.
The exact source/merge trees, original deadlines, artifact hashes and cleanup
verify. Native endpoint/file/process/socket checks are distinct from explicit
Terminal/provider doubles in the composed launch tests.
[Native evidence](evidence/editor-task-choices-native-client-summary.json).

Windows `e5a5781` passes all six preliminary shards: 232 groups, 1,356 passes,
179 declared skips. Documentation/PDF, native guardian, reviewed-input and fresh
runtime stages also pass. Full release run `42371446132` was cancelled at its
90-minute job boundary without a final receipt; the exact active group/cause is
unknown. No current complete Windows acceptance follows from those preliminary
passes. Bounded complete-suite progress reporting is now wired in.
[Interruption evidence](evidence/windows-backend-e5a5781-summary.json).

Later Windows run `42379166911` at source `6727054` has five passing
preliminary shards and shard six cancelled at its 20-minute budget. Logs show
39/40 groups completed; the final Windows scanner-file group had started, with
no final receipt. The complete release job also reached its 90-minute boundary without a final
receipt or retained progress event; its last active group remains unknown.
[Full interruption](evidence/windows-6727054-full-interruption-summary.json).

The scheduling fixture now uses 232 audited `e5a5781` native measurements,
retaining a higher prior estimate for any existing group. Current batches estimate
at most 891,633 ms; six jobs, 20-minute job limits, all original child bounds and
the 60-second unknown-group fallback are unchanged. Three groups/35 tests pass.
The accepted complete Linux run predates this scheduling-data change.
[Scheduling evidence](evidence/windows-scheduling-refresh-summary.json).
Re-read actual remote status before reporting a result. Never manually dispatch,
cancel, retry or expand deadlines to turn a partial run into acceptance.

Earlier complete Windows `dc755901` passes 417 groups/2,478 tests with 207
declared skips. It predates subsequent changes. The intermittent restricted-storage
retirement failure remains unresolved despite passing follow-ups; retain native
phase/error diagnostics and keep all process/token permissions unchanged.

## Complete Windows source workflow

Source `754660e0c97bd115eb229b536240671a9dbfd863` adds an independent
complete-source workflow: 20 test workers and an ordered assembly worker retain
every original manifest group. Builds, PowerShell verification and the compiled
companion/editor consumers stay together. The collector requires all 21 exact
same-source/toolchain receipts, unchanged commands/child limits/skips and cleanup.
Five local groups/45 tests pass; both new YAML files parse with existing tools.
Native run `42390824164` exposed one dependency failure in worker 11: the
packaged TLS test could not find the compiled provider-host `dist`. The original
failed receipt and cleanup are retained. Both original TLS scenarios now move
with the existing companion/editor build consumers onto the assembly worker; five local
groups/45 tests pass. Native `646f2c6` assembly now passes; 20 of 21 workers pass.
The remaining worker fails one focus refusal because its original helper retirement
record is unconfirmed; the final collector rejects acceptance.
[Retained failure](evidence/native-focus-retirement-failure-summary.json).
[Failure and correction](evidence/complete-windows-dependency-fix-summary.json).
The original 90-minute package bound remains. The package now invokes
`npm test -- --windows-pairs`: ordered builds/compiled consumers followed by at
most two independent children, all original groups and bounds retained. Both public
CLI entry points validate arguments. Seven groups/74 tests and five concurrently
executed backend groups/91 tests pass, along with TypeScript checking. Original
failed fixture expectations are retained privately. The `90fa879` package run completes all 462 groups in about 61 minutes but fails two native fixture assertions. Preserve [the audited original failure](evidence/windows-package-90fa879-failure-summary.json). Local fixture corrections pass three groups/29 tests with five declared platform skips; [native package confirmation remains pending](evidence/windows-package-fixture-corrections-summary.json). Do not dispatch retries, widen bounds or weaken the canonical saved-helper guard. Distributed source acceptance is not package, hardware or live-account acceptance. [Paired evidence](evidence/windows-paired-verification-summary.json).

Focus retirement now reports only fixed phase/reason tags. A deterministic original
two-second deadline test retains the pending write and blocks replacement until
that exact write completes. No Windows root-cause repair is claimed; use new native
evidence to distinguish record deadlines from rejection. Keep original bounds,
permissions and refusal assertions. The installed runtime now includes these diagnostics at `90fa879`.
[Evidence](evidence/complete-windows-source-lane-summary.json).

Native `b38ff759` external-agent consent passes three original groups/51 tests,
including actual encrypted state, authenticated SDK HTTP and consent generation
fences. Providers remain doubles. [Native receipt](evidence/agent-consent-native-b38-summary.json).

## Latest native settlement failure

The `cf3bb4c` project inventory passes three named native groups/17 tests, zero
skips. [Native project evidence](evidence/editor-project-choices-native-summary.json).
The complete source cohort fails worker 4 at the unavailable-application test in
`windows-host-action-consumer.test.ts`: the original two-second observation expires.
Its 22-group receipt has 132 passes, one failure and 14 declared skips; commands,
45-second group bound and cleanup verify. The original journal phase is unknown.

The fixture now stops every consumer before removing its directory, including
assertion failures. Timeout evidence exposes only counts, journal kinds and closed
outcome tags. All original assertions, 75 ms coordination/effect bound and
2,000 ms observation bound remain. Two focused groups/32 tests and TypeScript
checking pass. The first typecheck rejected `toReversed` under the existing lib;
a copied array plus `reverse` fixes that without compiler changes. This is a
fixture lifecycle/diagnostic correction, not a production root-cause repair.
[Failure evidence](evidence/host-action-settlement-diagnostic-summary.json).

Native `90fa879` worker 4 now passes the complete original host-action consumer
file: 15 tests, zero skips, original 45-second group bound and exact cleanup.
The 22-group worker receipt, source/merge tree and in-memory ZIP digest verify;
only this named group is accepted here. The old failure remains unresolved.
[Native follow-up](evidence/host-action-settlement-native-followup-summary.json).

## Continue independently executable work

Use the [requirement ledger](switchyard-requirements.md) as scope. Guided role/device
controls, production editor activation/task attachment and broader supported
external observation streams remain implementation work. Portability, controller
and conversation backend paths have substantial existing coverage; identify the
specific missing behavior before adding a new subsystem. Additional Shield syntax
coverage is not a separate requirement in the handover and must not displace the
required suite.

Keep account/tenant, interactive Windows, microphone and physical F77/B122 checks
separate from unfinished software. A synthetic provider or metadata-only installed
check does not accept a real native task, live conversation, UI journey or device
transaction. Follow the boundaries above while finishing independent work.

Publish tested source and evidence regularly on the existing branch/draft PR.
Keep claims tied to exact revisions, retain original failures, preserve the
frontend review artifacts and remove only verified owned temporary staging.
