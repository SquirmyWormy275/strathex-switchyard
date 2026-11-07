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

## Current installed and source checkpoint

Installed 6609353 passes **66 metadata/in-memory checks**: thirteen task-owner,
seven Copilot-journal, fourteen agent/helper/SDK, twelve Python, ten Cargo and
five workflow and five profile checks. Sixteen exact installed module hashes verify; all 57 saved
workflows validate. All 54 semantic workspace snapshots, selection, pending
keyboard-only conversation and frozen frontend are preserved. Fifty-three sealed
files are byte-identical; one changes only audit metadata during the update.
Dated backup, launcher readback and current plus one rollback verify. The exact
528-file, 5,230,348-byte prepared bundle is removed. The repeatable workflow
verifier independently repeats its five checks with all 54 sealed files unchanged.
No scanner process, native task, agent action, model request, account change or
hardware operation is performed.
[Installed evidence](evidence/installed-profile-identity-summary.json).

Run only the current repeatable metadata verifiers, each with
`--read-only-metadata`: `verify-task-owner-host.mjs`,
`verify-copilot-journal-host.mjs`, `verify-agent-security-host.mjs`,
`verify-python-inventory-host.mjs`, `verify-cargo-inventory-host.mjs` and
`verify-workflow-host.mjs`.
They live under `scripts/`. Their pinned source evidence must match the intended
installed modules; a mismatch requires investigation, never bypass. Older live
verifiers are outside current scope: for example, `verify-shield-host.mjs`
creates a real Codex task.

Cargo archive identity is now implemented without extraction, Cargo invocation
or package execution. Thirteen focused groups/132 distinct passes include 26
Python reference cases, six actual Linux scanner journeys and six Windows guest
doubles. Typecheck, original package bounds and exact cleanup pass. The first
composed run failed a timeout-inventory assertion; both new integration files are
now registered in the existing 120-second Linux/300-second Windows class.
[Contract](cargo-archive-identity.md),
[source evidence](evidence/cargo-archive-source-summary.json).

## Complete verification checkpoints

Complete Linux aafb476 passes **317 groups, 1,923 tests and sixteen declared
skips**, with zero failures/cancellations. The exact original manifest, commands,
deadlines and skip inventory verify, along with every child/tree retirement.
The owned checkout, nine dependency aliases, 782 generated files (11,766,823
bytes), empty temporary parent and marker are removed; all other worktrees
remain. This checkpoint includes wheel RECORD and five-shard scheduling
changes and predates Cargo archive identity and the workflow-ID correction.
[Complete receipt](evidence/linux-aafb476-complete-summary.json).

No full Linux test service or temporary marker remains from that run.

Workflow editing now rejects non-string role/step IDs and repeated dependency
edges before persistence. Two regressions reproduce the previous acceptance of
malformed JSON identities; four focused groups/72 checks now pass, including
unchanged encrypted profile, bindings and history after refusal. Read-only
compatibility checks accept all 57 saved workflows across 54 workspaces and
preserve all 54 sealed files byte-for-byte. Typecheck, original package bounds
and exact cleanup pass. Installed workflow correction acceptance now passes five additional metadata
checks; native Windows acceptance remains separate.
[Installed evidence](evidence/installed-profile-identity-summary.json). [Source and compatibility evidence](evidence/workflow-identity-source-summary.json).

The earlier 39db1fe full failure remains recorded. Five native backend jobs
preserve original group objects, measurements, child bounds, twenty-minute job
limits and the 950-second estimated-workload ceiling.
[Failed full run](evidence/linux-39db1fe-scheduling-failed-summary.json),
[scheduling correction](evidence/windows-five-shards-source-summary.json).

The last complete Windows packet `cadbccd` passes 416 groups, 2,443 tests and
204 declared skips. The overall workflow fails because a preliminary shard was
cancelled without a final receipt. Native Windows work remains source-specific:
a passing complete packet does not turn that workflow green.
[Complete packet](evidence/windows-complete-cadbccd-summary.json).

Windows workflow concurrency preserves one active full run and queues the newest
checkpoint. Superseded pending runs may be cancelled. Do not manually cancel,
retry or dispatch workflows. Queued/cancelled runs and partial output contribute
no accepted checks. Verify packet digests, source/merge trees, exact inventory,
bounds and cleanup before accepting downloaded evidence. Retain small JSON
receipts; remove downloaded archives.

## Continue independent implementation

Portable imports and local role connections now require literal string identities.
Malformed v1 imports can no longer acquire helper defaults or replace the current
encrypted arrangement. Two regressions reproduce the original defect; five
focused groups/81 checks plus six verifier guards pass. All four saved profile
documents remain compatible and all 54 sealed workspace files are unchanged.
Legacy Studio-plan migration and intentional helper defaults still work.
Typecheck, original package bounds and exact owned cleanup pass. Five installed profile checks now pass in the 66-check metadata update;
native Windows profile correction acceptance remains separate.
[Installed evidence](evidence/installed-profile-identity-summary.json).
[Source evidence](evidence/profile-identity-source-summary.json).

1. Profile-import identity correction is published and installed. Continue the
   independently executable ledger gaps with focused source and installed checks.
   Keep later Cargo/workflow focused evidence separate from complete aafb476.
   A new full run must use clean, published immutable source and a short owned
   temporary parent; verify exact final inventory/exit before removing its files.
2. Inspect available native Windows receipts. The new five-shard schedule and
   later helper, SDK, Python/Cargo work require their own final results.
   Retain original failures and distinguish guest doubles from actual guests.
3. Continue ledger gaps: broader Shield syntax/coverage and dependency
   resolution, complete archive/license inspection, publisher provenance,
   verified local vulnerability context and external observation streams.
   The current Cargo manifest parser is deliberately a closed TOML subset;
   unsupported syntax stays incomplete. Do not claim it handles all crates.
4. Keep remaining guided role/device wiring and editor activation explicit as
   unfinished implementation while frontend review is frozen. The composed
   editor proof uses real encrypted state and Linux carriers with provider and
   terminal doubles. It does not accept native TUI/account/IDE behavior.
5. Investigate new failures using exact receipts. Windows shortcut startup and a
   fixture Python startup timeout have passing follow-ups but unresolved causes.
   Do not extend deadlines or change accounts/permissions to make tests pass.

## Keep acceptance boundaries and evidence clear

No approved Microsoft work tenant is available. B122 hardware and all 27 physical
gates are unavailable. F77 physical operations are not authorized here. Windows
UAC/ordinary-user/guest and microphone/UI journeys are not established by
headless tests. The Claude/tmux attempt stopped at workspace trust and retired
its owned processes; no bypass is authorized. Installed Codex 0.167.0 remains
outside the reviewed 0.166.0 gate; generated schemas do not justify changing it.

Private receipts live under
`~/.local/state/strathex-switchyard/runtime-verification/`.
Commit small summaries to `docs/evidence`. Remove successful exact owned staging
after verified exit; preserve unrelated review artifacts, checkouts and failed
native ownership evidence. Keep original failed, interrupted and cancelled
results alongside follow-ups.

Historical details remain in [verification](verification.md) and
[the preceding continuation checkpoint](https://github.com/SquirmyWormy275/strathex-switchyard/blob/12b3c87b9a8781648450c6adecc935aeea8d5ceb/docs/switchyard-continuation.md).
