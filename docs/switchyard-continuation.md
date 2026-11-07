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

The latest feature is exact-project task choices. The Suite selects its active
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

- Source: `9d230acf4bdec18293f9c64424e41a25b0b59517`.
- Release: `e23a6a4687d31d148c7b5e2fcfa8243e02f34d7751f2e4b996c635c263d2eae6`.
- Rollback: `5ee98aa4c93005b9cd025e90e2347ca6605008e00f1b00830084003267efbca2`.
- Frozen frontend: `24100ef601b810efb0cda95e4fe0842d2944560734b02c4cf482c25e19150543`.
- 92 metadata/refusal checks, 56 exact module hashes; all 54 semantic workspaces,
  four profiles, 57 workflows, selection and one pending keyboard-only conversation
  preserved. 53 sealed files are byte-identical; one changes audit metadata only.
- Dated backup and launcher readback verify. Current plus one rollback remain.
  The exact temporary package, 554 files/4,835,483 bytes, is already removed.
  Do not repeat the executed installation or cleanup scripts.

The signed-intent verifier initially pinned the previous shared instance module.
It refused before dispatch and preserved state. Its gateway/server pins now use
the accepted task-choice evidence; the corrected verifier passes all eight checks.
The original failure remains in the installed evidence. Host-facing task-owner,
Copilot-journal and signed-intent verifiers must run sequentially; earlier parallel
initialization caused an independent preservation assertion failure.
[Installed receipt](evidence/installed-editor-task-choices-summary.json).

## Complete runs and native evidence

A complete Linux run is active at source
`7f2a52a064151fe2d6d80938aeefbb578098daaa`, including the task-choice and
consent changes. Its private registration is
`runtime-verification/linux-full-7f2a52a-run.json` under the application state.
Use that marker for the exact detached checkout, runner, test parent, dependency
aliases, progress/result files and systemd unit. No new dependencies were fetched.
Do not start a duplicate run. Audit the final receipt against the original
manifest/commands/bounds/skips and child cleanup, then remove only the owned
staging after verifying its identities and retaining evidence.

The last accepted complete Linux source is `0c025df`: 350 groups, 2,293
passing tests and 32 declared skips. Its exact checkout, nine aliases, 802 generated
files/11,904,762 bytes, test parent and marker are already removed.
[Complete receipt](evidence/linux-0c025df-complete-summary.json).

Native Windows client `57af859` passes 25 groups/249 tests with zero skips.
The exact source/merge trees, original deadlines, artifact hashes and cleanup
verify. Native endpoint/file/process/socket checks are distinct from explicit
Terminal/provider doubles in the composed launch tests.
[Native evidence](evidence/selection-native-client-summary.json).

Windows `e5a5781` passes all six preliminary shards: 232 groups, 1,356 passes,
179 declared skips. Documentation/PDF, native guardian, reviewed-input and fresh
runtime stages also pass. Full release run `42371446132` was cancelled at its
90-minute job boundary without a final receipt; the exact active group/cause is
unknown. No current complete Windows acceptance follows from those preliminary
passes. Bounded complete-suite progress reporting is now wired in.
[Interruption evidence](evidence/windows-backend-e5a5781-summary.json).

Later Windows run `42379166911` at source `6727054` was last observed with
five preliminary shards passing, shard six cancelled, and full release still
running. Re-read its actual status before reporting a result. Never manually
dispatch, cancel, retry or expand deadlines to turn a partial run into acceptance.

Earlier complete Windows `dc755901` passes 417 groups/2,478 tests with 207
declared skips. It predates subsequent changes. The intermittent restricted-storage
retirement failure remains unresolved despite passing follow-ups; retain native
phase/error diagnostics and keep all process/token permissions unchanged.

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
