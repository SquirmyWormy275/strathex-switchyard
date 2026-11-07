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

Custom-agent role dispatch now checks the exact binding/role under the enqueue
state lease. Every deliberate binding receives a fresh identity. Shared result
history also refuses stale attribution while preserving any original queued
command. Five original regressions are retained; seven corrected cases and six
focused groups (88 passes, one declared skip) pass with both TypeScript checks.
This correction is source-only. Other provider native-effect checks and physical
active-workspace lifecycle checks still need implementation.
[Role dispatch contract](role-dispatch-binding.md).

Native Windows client source `738c1f7` is audited: workflow `42372481436`, helper
`128403277123`, client `128403448327`; exact merge tree, 25 groups, 247 passes,
zero skips and original commands/bounds/cleanup. Complete Windows release is
separate. Its small receipt ZIP was inspected in memory; no helper binary or
dependency was downloaded. [Native evidence](evidence/signed-physical-intent-native-summary.json).

Published Codex checkpoint `9c3bccf` admits exact 0.166.0 and 0.167.0 revisions,
requires 42 explicit feature exclusions and binds text review to the observed
native version. Twelve groups pass 152 tests with two skips. The actual 0.167
binary passes production argument construction and hello/config validators in an
empty owned home with network isolation. Only initialize/initialized/config-read
are sent; all original descendants and 66 generated files are retired. Both
probe roots and markers are removed. No new dependencies were downloaded.
[Version contract](codex-version-contract.md).

The Windows journal/launcher correction at `5033c18` is now natively accepted:
workflow `42366888084`, helper `128386804466`, client `128386993646` all succeed.
All 25 groups pass 237 tests with no skips; original manifest, deadlines,
permissions and child cleanup verify. This includes all nine composed lifecycle
cases and the native endpoint/file checks. Terminal/provider doubles remain
explicit. Earlier failed attempts remain linked in the accepted receipt.
[Native client evidence](evidence/windows-editor-journal-accepted-summary.json).

The journal serializes reads with durable publication, preserves all mutation
kernel leases, and shares only overlapping unfinished checks with no intervening
queued mutation. Settled results and failures are never cached. Retirement,
foreign replacement and unknown committed outcomes still refuse admission.

## Outstanding verification and implementation

1. Native Windows client `c359cdf` is audited: exact merge tree, 25 groups,
   243 tests, zero skips, original deadlines and verified cleanup. It predates
   the later status-query diagnostics. At `841618d`, the 243-test client lane
   and restricted-storage owner checks also pass; native invalid-status-request
   coverage still belongs to the pending complete backend lane.
2. Installed Linux now runs `738c1f7`, release `4cda61afefac`, with `edf66107db84`
   retained as rollback. All 54 semantic workspaces, selection, one pending
   keyboard-only conversation and frozen frontend verify. The 84 metadata/
   refusal checks cover 48 exact modules, four profiles and 57 workflows.
   Dated launcher backup and readback verify; the exact prepared 553-file,
   4,819,454-byte bundle is removed. Signed requests reject absent roles, wrong
   PID/build, stale requests and caller-selected compartments without an effect.
   No browser reload, native focus, live provider/task or hardware use occurred.
   Do not repeat this update or remove its already-removed staging again.
3. Windows project-context source is accepted in the native client lane. It
   retains the exact local workspace folder/generation, rejects replacement/
   reopen/ambiguity, retires the original carrier on departure and joins signed
   retirement before closing transport. Original failed regressions remain.
   Command activation and frontend exposure remain frozen.
4. Native Codex TUI/account/task/model acceptance remains separate. The version
   contract's real native proof covers initialization/config-read only.
5. Complete Linux `c359cdf` is audited and cleaned: 348 groups, 2,218 passes
   and 32 declared skips. Receipt `05f399ed-8f7b-4c33-8e70-e355b91ccf0e`
   preserves the original manifest, commands, deadlines and child cleanup.
   The exact checkout, nine aliases, 802 generated files (11,901,729 bytes),
   empty test parent and active marker are removed. Do not restart or reclean it.
   Later status diagnostics are outside this source.
6. Full Windows `318fafc` completed all six backend shards (232 groups, 1,355
   passes and 179 declared skips; original receipt audit passes), but the final release
   job stopped at a stale generated-documentation source digest. The checksum
   is now regenerated; all seven manual/demo outputs are byte-identical.
   Full Windows acceptance remains pending. Do not manually rerun workflows.
7. Linux workspace lifecycle now passes eleven groups/123 tests and both
   TypeScript checks. Six original regressions are retained. The signed-client,
   protected-Suite demonstration verifies both peer exit and workspace departure
   with real Linux carriers and a provider double. Original terminal/provider
   preservation, uncertain retirement refusal and owned cleanup verify.
   This source is not installed and postdates complete Linux `c359cdf`.
   Command activation and frozen frontend remain unchanged.
8. Physical CLI dispatch now uses the signed instance gateway, never the browser
   bearer token. Two regressions reproduce unsigned-listener and saved-PID faults;
   a later clock-rollback regression is also retained. Twenty-seven groups pass
   136 tests/one skip, plus one actual CLI-child case. Final focused protocol
   checks and typecheck cover the clock correction. No native key, provider or
   installed application effect was used. Installed `738c1f7` now passes eight
   additional signed refusal/metadata checks, with all workspaces preserved.
   Legacy servers refuse the new route; do not add a bearer fallback.

Restricted-storage follow-up `3795217` passes eight ordinary owner checks,
eight restricted owner checks, 68 QUERY-only descendant registrations and
original fixture/service removal. Retirement code was unchanged from failed
`47c80be`; the intermittent cause remains unresolved. No speculative guardian
process-query change has been made.
[Passing follow-up](evidence/restricted-storage-379-followup-summary.json),
[original failure](evidence/restricted-storage-47c80be-failure-summary.json).

## Installed application and complete-suite baseline

Installed Linux is `738c1f7`: 84 metadata/refusal checks, 48 module hashes,
all 54 semantic workspaces, four profiles, 57 workflows, selected state, pending
keyboard-only conversation and frozen frontend preserved. The current release
and one rollback remain; its exact prepared bundle has been removed.
[Installed evidence](evidence/installed-signed-physical-intent-summary.json).

The accepted complete Linux run is `c359cdf`: 348 groups, 2,218 passes
and 32 declared platform skips. Its exact checkout, nine dependency aliases,
802 generated files (11,901,729 bytes), empty test parent and marker are removed.
The preceding accepted complete Windows run is `dc755901`: 417 groups,
2,478 passes and 207 declared skips. The Windows revision predates current editor work; Linux includes it.
[Linux evidence](evidence/linux-c359cdf-complete-summary.json),
[Windows evidence](evidence/windows-complete-dc755901-summary.json).

Combined current/index/history scanner inputs, exact reviewed recipe saving,
policy/storage boundaries and their earlier installed evidence remain intact.
Historical detailed continuation notes are preserved at
[the preceding checkpoint](https://github.com/SquirmyWormy275/strathex-switchyard/blob/961ecb36036ae40f67f0685bb6bfbd6f815d10ed/docs/switchyard-continuation.md).
Use the current status and source-specific contracts before interpreting an old
“unfinished” note as the present implementation state.


The status-query diagnostic change preserves every existing query/access/deadline
and exit refusal. Only fixed phase and numeric native error leave the helper;
the CI owner proof appends the validated stage to its first failing ordinal.
Three focused groups/53 tests and source compilation of 36 C# files pass. The
owned four-file, 758,554-byte compile directory is removed. This is evidence
instrumentation, not a root-cause fix or native diagnostic acceptance.
