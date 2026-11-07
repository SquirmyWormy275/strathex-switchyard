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

The repeatable [connected backend demo](backend-demonstration.md) runs with
`node scripts/demo-switchyard-backend.mjs --synthetic`. Seven stages pass using
normal encrypted stores, authenticated API and signed SDK with a synthetic agent
and simulated second host. Four original groups/21 tests pass; original receipts
are copied privately and temporary demo state is removed. This does not change
the installed runtime or freeze boundaries. Native Windows demo acceptance is
pending. [Evidence](evidence/backend-connected-demo-summary.json).

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

- Source: `2c6497f8c2829fbd29026fe98f13de9ecade1d65`.
- Release: `ce4da39419d1bdc55565a39c8650a98ca01d45569df8585568349616bb23e83c`.
- Rollback: `d470f3d1d4ffe27a1781d201afe61cbad7ab545a07dda4849ce09b87634b7ed7`.
- Frozen frontend: `24100ef601b810efb0cda95e4fe0842d2944560734b02c4cf482c25e19150543`.
- 97 metadata/refusal checks, 57 exact module hashes; all 54 semantic workspaces,
  four profiles, 57 workflows, selection and one pending keyboard-only conversation
  preserved. 53 sealed files are byte-identical; one changes audit metadata only.
- Dated backup and launcher readback verify. Current plus one rollback remain.
  The exact temporary package, 555 files/4,846,150 bytes, is already removed.
  Do not repeat the executed installation or cleanup scripts.

The signed-intent verifier initially pinned the previous shared instance module.
It refused before dispatch and preserved state. Its gateway/server pins now use
the accepted task-choice evidence; the corrected verifier passes all eight checks.
The original failure remains in the installed evidence. Host-facing task-owner,
Copilot-journal and signed-intent verifiers must run sequentially; earlier parallel
initialization caused an independent preservation assertion failure.
[Installed receipt](evidence/installed-external-agent-consent-summary.json).

## Complete runs and native evidence

Complete Linux source `2c6497f8c2829fbd29026fe98f13de9ecade1d65` is accepted:
351 original groups, 2,312 passing tests and 32 declared platform skips. It covers
the current installed runtime, guided roles and external-agent consent.
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
groups/45 tests pass. Native correction acceptance remains pending.
[Failure and correction](evidence/complete-windows-dependency-fix-summary.json).
The original 90-minute package verification remains unchanged. Distributed source
acceptance is explicitly not package, hardware or live-account acceptance.
[Evidence](evidence/complete-windows-source-lane-summary.json).

Native `b38ff759` external-agent consent passes three original groups/51 tests,
including actual encrypted state, authenticated SDK HTTP and consent generation
fences. Providers remain doubles. [Native receipt](evidence/agent-consent-native-b38-summary.json).

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
