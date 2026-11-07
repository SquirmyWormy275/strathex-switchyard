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

Windows editor target preparation now rechecks the original Job-owned process
against its creation time and held executable identity, then repeats the saved
load, task, account, repository and policy checks. It grants no terminal effect
or second resume. Logical editor registration stays bound to that same target.
**Thirty-three focused groups pass 104 tests with two declared platform skips**;
typecheck passes. Provider/native-query doubles are explicit in local checks.
The extended native case includes real process reinspection, protected registry
target preparation and logical editor registration; its acceptance is pending.
[Target contract](coding-task-owners.md),
[source evidence](evidence/windows-editor-target-source-summary.json).

The earlier retained editor channel passes Windows client CI at `fcfe38a`:
**fifteen groups, 155 tests and no skips**. An actual Job-backed synthetic
app server returns its retained initialization response to the logical editor;
closing that editor leaves the original task metadata connection alive.
Source/merge tree, artifact, original commands, bounds and cleanup verify.
Windows durable editor journal/recovery, Suite editor connections and VS Code
launching remain unfinished implementation.
[Native channel evidence](evidence/retained-editor-client-native-summary.json),
[editor contract](windows-editor-transport.md).

The underlying persistent process layer passes Windows client CI at `45fe70e`:
**thirteen groups, 139 tests and no skips**, including all three actual native Job
cases. Source/merge tree, artifact digest, original commands, bounds and cleanup
verify. Its 35 C# sources previously compiled offline without warnings; the exact
33-file, 1,561,459-byte compiler output is removed. No new local SDK/runtime or
dependency download was added.
[Process contract](windows-owned-stdio.md),
[native process evidence](evidence/windows-owned-stdio-native-summary.json).

The earlier editor transport and exact-task composition now pass native Windows
client CI at `f1167c9`: **twelve groups, 127 tests, no skips**. Exact source/merge
trees, artifact digest, original commands, bounds and cleanup verify. Composition
uses explicit provider/peer doubles; the separate carrier round trip uses actual
Windows process queries. This source predates the persistent process layer.
[Native composition evidence](evidence/windows-editor-connection-native-summary.json),
[editor contract](windows-editor-transport.md).

Complete Linux `edb76de` passes **330 groups, 2,074 tests and 21 declared
platform skips**, with zero failures or cancellations. Exact original inventory,
commands, bounds, skips and child/tree retirement verify. The isolated checkout,
nine dependency aliases, 788 generated files (11,809,374 bytes), empty test parent
and active marker are removed; other worktrees remain. This source includes
combined scanner inputs and Windows saving, but predates terminal/peer probes.
[Complete Linux evidence](evidence/linux-edb76de-complete-summary.json).

Windows process-only identity now passes **eight native client groups, 100 tests,
no skips**, at `dec4dd5`, including the actual synthetic process query. Exact
source/merge tree, artifact, commands and cleanup verify.
[Native process evidence](evidence/windows-terminal-process-native-summary.json).

Installed Linux `edb76de` passes **76 metadata/in-memory checks and 42 exact module
hashes** for combined scanner support. All 54 semantic workspaces, four profiles,
57 workflows, selection, pending keyboard-only conversation and frozen frontend
are preserved. Fifty-three sealed files are byte-identical; one changes audit
metadata only. Dated backup and launcher readback verify. Current plus one
rollback remain; the 538-file, 4,696,455-byte prepared bundle is removed. No live
installed scan, provider task, model/account request or hardware operation ran.
[Installed evidence](evidence/installed-mixed-scanner-input-summary.json).


Combined current, staged and historical scanner inputs are implemented. The
latest accepted results across **56 focused groups pass 348 tests with five
declared skips**, including a real Linux mixed scan, replay refusal, original
repository preservation and native/staging retirement. Typecheck and all 34
native sources compile offline with zero warnings/errors. Original bounds remain;
the owned 33-file, 1,486,912-byte compiler output and empty test parent are removed.
Mixed NTFS staging now passes at `edb76de`: two Windows groups, 20 passing
tests and one declared Linux-only skip. Source/merge trees, artifact digests,
original commands, bounds and cleanup verify. The restricted-storage follow-up
passes all eight original owner checks; its earlier intermittent cause remains
unresolved. [Native evidence](evidence/windows-mixed-scanner-native-summary.json).
[Contract](mixed-scanner-inputs.md), [source evidence](evidence/scanner-mixed-input-source-summary.json).

Windows terminal process verification now has a native read-only helper and a
supervised adapter: **15 focused groups, 192 passes and two platform skips**.
Typecheck and all 34 native sources compile offline; the owned compiler output
is removed. Native process execution now passes at `dec4dd5`. Suite/editor task attachment
remains unfinished. [Contract](windows-terminal-process.md),
[source evidence](evidence/windows-terminal-process-source-summary.json).

Windows scanner saving passes **15 native tests, no skips**, at `5ec16fe`,
including four actual NTFS cases. Source/merge tree, artifact, commands, bounds
and cleanup verify. The overall workflow failed a separate restricted-storage
owner's final retirement assertion after seven checks. That software failure
remains unresolved and its original fixture is preserved.
[Native saving evidence](evidence/windows-scanner-save-native-summary.json),
[retained failure](evidence/windows-restricted-storage-retirement-failure-summary.json).


Installed `6ab9b1e` verifies scan-draft assembly within **76 metadata/in-memory
checks and 30 exact module hashes**. All 54 semantic workspaces, selection,
pending keyboard-only conversation and frozen frontend are preserved; 53 sealed
files are byte-identical and one changes only audit metadata. All four profiles
and 57 workflows remain compatible. Dated backup and launcher readback verify;
current plus one rollback remain. The exact 533-file, 5,213,310-byte prepared
bundle is removed. No installed draft, scanner, native provider task, account/model
request or hardware operation was invoked.
[Installed evidence](evidence/installed-scanner-recipe-draft-summary.json).

Scanner setup now has an authenticated draft route that assembles the exact
engine, signed feed content, request and recipe without repository writes or
approval. It rechecks task/account/workspace, source hashes, feed trust/revocation
and expiry. The latest results across **31 focused groups pass 154 tests**,
including a real Linux scan after separately saving and approving the generated
setup. Typecheck, original bounds, package/recovery checks and owned cleanup pass.
Automatic reviewed saving, frozen frontend controls and native Windows acceptance
remain separate unfinished work or unaccepted checks.
[Contract](scanner-recipe-drafts.md),
[source evidence](evidence/scanner-recipe-draft-source-summary.json).

Installed `e1c2f38` verifies the historical-preparation and read-only index
modules within **76 metadata/in-memory checks and 27 exact module hashes**.
All 54 semantic workspaces, selection, pending keyboard-only conversation and
frozen frontend are preserved; 53 sealed files are byte-identical and one changes
only audit metadata. Dated backup and launcher readback verify. Current plus one
rollback remain, and the exact 532-file, 5,202,055-byte prepared bundle is removed.
No installed scanner, native task, model/account request or hardware operation
was performed. [Installed evidence](evidence/installed-scanner-history-review-summary.json).

Historical scanner preparation now derives bounded versions of current tracked
paths and returns exact source descriptors with explicit coverage gaps. It
preserves separate authority and execution review. A cold-index regression also
exposed that protected target capture could refresh Git's tree cache; it now
computes the tree identity from metadata without writing index or object bytes.

The latest results across **58 focused groups pass 202 tests**, including real
Linux historical-only detection, a Windows guest double, independent SHA-1 and
SHA-256 cold-index preservation, and all package/update/recovery scenarios.
Typecheck, original commands/bounds/skips and every child/tree cleanup verify;
both owned test parents are removed. Failed packaging and Unix-socket-path
receipts remain retained with their corrected follow-ups. Later checkpoints
implement recipe/feed assembly, reviewed saving and combined index/history
execution, including native NTFS staging. Frozen frontend controls and broader
historical coverage remain unfinished.
[Contract](scanner-input-inventory.md#include-bounded-history-in-the-review),
[source evidence](evidence/scanner-history-review-source-summary.json).

Automatic staged-input preparation now derives every supported tracked index
blob from the bound task, reconstructs its exact Git tree and rechecks the target
before confirmation. The authenticated API preserves separate authority and
execution reviews. Thirty-three focused groups pass 129 tests, including actual
Linux staged-only detection and a Windows guest double; typecheck, original
bounds and child/tree cleanup verify. Owned test staging is removed. Automatic
recipe/feed assembly, frontend activation and native Windows acceptance remain
separate unfinished work or unaccepted checks.
[Contract](scanner-input-inventory.md#include-staged-versions-in-the-review),
[source evidence](evidence/scanner-index-review-source-summary.json).

Installed `ba172a1` now passes 76 metadata/in-memory checks and verifies 23 exact
module hashes, including the staged-preparation source. All 54 semantic workspaces,
selection, pending keyboard-only conversation and frozen frontend are preserved;
53 sealed files are byte-identical and one changes only audit metadata. The dated
backup and launcher readback verify. Current plus one rollback remain; the exact
531-file, 5,196,099-byte prepared bundle is removed. No installed scanner, native
task, model/account request or hardware operation was performed.
[Installed evidence](evidence/installed-scanner-index-review-summary.json).

Native Windows client contracts now pass all **seven groups and 94 tests** at
`4f56477`, with no skips. Exact source/merge tree, artifact digest, original
commands/deadlines and every child/tree cleanup verify. This closes the earlier
policy-ordering regression; the failed receipt remains retained. No archive is
stored locally. Interactive Windows focus and complete Windows release acceptance
remain separate. [Native passing receipt](evidence/windows-client-4f56477-passed-summary.json).

Windows native-focus dispatch now enforces the persisted selected workspace
policy before validating a request UUID or entering platform-specific dispatch.
The original native client run at `02cc6ba` failed one of 93 tests; the same
failure was reproduced locally. Both Linux and Windows paths now refuse Work
requests with missing, malformed or valid UUIDs, including attempts to name a
Personal compartment. All final effect-boundary checks remain. Twenty-eight
focused groups pass 165 tests with one declared Linux skip; typecheck, original
bounds and child/tree cleanup verify. The later native Windows client checkpoint
passes; interactive focus remains unaccepted. Installed `9ca9f84` passes 76 metadata/in-memory checks and verifies
22 module hashes while preserving all 54 semantic workspaces and the frozen
frontend. [Installed evidence](evidence/installed-pypi-wheel-license-summary.json).
[Native failure](evidence/windows-client-02cc6ba-failed-summary.json),
[correction evidence](evidence/windows-focus-policy-source-summary.json).

The Windows Suite now supports separately reviewed ChatGPT and stable VS Code
executables, encrypted configuration, authenticated focus dispatch and durable
helper recovery. Exact PID/birth ownership is persisted before requests; uncertain
effects cannot be replayed. VS Code is available only through the focus-only
entrypoint, leaving the companion's four provider/launch profiles unchanged.
Thirty-five focused groups pass 234 tests with no skips, including seventeen
service/gateway cases. Type checking, original package bounds and the combined
helper build pass with zero warnings/errors. Owned test/build staging is removed.
Actual Windows desktop acceptance, frozen frontend controls, project selection
and task-specific IDE attachment remain unfinished.
[Contract](windows-native-focus.md),
[source evidence](evidence/windows-vscode-focus-source-summary.json).

Selected Python wheels now apply declared license policy only after matching
outer bytes, embedded identity and verified RECORD member hashes. Missing,
legacy, conflicting and private declarations stay unassessed; file-only results
export no paths. Twenty focused groups cover 167 distinct passing tests, with
six affected groups/28 passes repeated after a reproduced reserved-budget bug
was fixed. Eight actual Linux wheel journeys and eight Windows guest doubles
pass again with original bounds and verified cleanup. Typecheck and package
limits pass; staging is removed. Installed `9ca9f84` passes 76 metadata/in-memory
checks and 22 exact module hashes, including all 17 header cases and eight
wheel-license reports. All 54 semantic workspaces and frozen frontend are preserved.
Actual Windows acceptance remains separate. [Installed evidence](evidence/installed-pypi-wheel-license-summary.json).
[Contract](python-wheel-license-declarations.md),
[source evidence](evidence/pypi-wheel-license-source-summary.json).

Selected npm archives now retain their own bounded license declaration, assessed
only after matching integrity and embedded identity. Lockfile and archive policy
remain independent; disallowed obligations fail and unresolved coverage remains
explicit. Sixteen focused groups pass 146 tests, including eight actual Linux
npm archive journeys and eight Windows guest doubles. Typecheck, original bounds,
commands, skips and child/tree cleanup verify; owned staging is removed.
Installed `9ca9f84` passes 76 metadata/in-memory checks with all 54 semantic
workspaces and the frozen frontend preserved. Actual Windows execution remains
separate. [Installed evidence](evidence/installed-pypi-wheel-license-summary.json).
[Contract](npm-archive-license-declarations.md),
[source evidence](evidence/npm-archive-license-source-summary.json).

Selected Cargo archives now expose bounded package license declarations and
apply the reviewed SPDX policy only after both byte integrity and manifest
identity match. Disallowed obligations fail; permitted alternatives remain
unselected. Missing, unsupported and file-only declarations preserve coverage
gaps without exporting raw text or file paths. Fifteen focused groups pass 124
tests, including eight actual Linux scans and eight Windows guest doubles.
Typecheck, original package bounds and child/tree cleanup pass; staging is removed.
License text inspection, dependency resolution and publisher verification remain
unfinished. [Contract](cargo-license-declarations.md),
[source evidence](evidence/cargo-license-source-summary.json).

Cargo archive inspection now accepts bounded inline dependency tables such as
`serde = { version = "1", features = ["derive"] }`, nested metadata and array
tables. All 112 independent Python reference cases and ten focused groups / 96
tests pass, including six actual Linux scanner journeys and six Windows guest
doubles. Duplicate aliases, invalid delimiters, table reopening and nesting beyond
sixteen inline tables refuse admission. Original package bounds, typecheck and
child/tree cleanup verify; owned staging is removed. Dependency resolution and
broader manifest/license coverage remain unfinished.
[Contract](cargo-archive-identity.md),
[source evidence](evidence/cargo-inline-manifest-source-summary.json).

Installed `9ca9f84` passes **76 metadata/in-memory checks** and verifies 22 exact
module hashes, including all 112 Cargo manifest reference cases, eight Cargo
archive/license policy reports and eight npm archive policy reports. All 54 semantic
workspaces, selection, pending keyboard-only conversation and frozen frontend
are preserved; 53 sealed files are byte-identical and one changes only audit
metadata. All four profiles and 57 workflows remain compatible. Dated backup
and launcher readback verify; current plus one rollback remain. The exact
531-file, 5,191,760-byte prepared bundle is removed. No live scanner, provider,
account, model, keyboard or native Windows focus action was performed.
[Installed evidence](evidence/installed-pypi-wheel-license-summary.json).

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

Complete Linux `d09645a` passes **326 groups, 2,013 tests and sixteen declared
skips**, with zero failures or cancellations. The exact original inventory,
commands, deadlines, output bounds and child/tree exits verify. Its owned clean
checkout, nine dependency aliases, 788 generated files (11,803,414 bytes), empty
temporary parent and ownership marker are removed; other worktrees are preserved.
This checkpoint includes wheel-license, staged/historical preparation and the
read-only index correction. Later scanner-draft assembly has separate focused
and installed evidence.
[Complete receipt](evidence/linux-d09645a-complete-summary.json).

Complete Windows `dc755901` now passes **417 groups, 2,478 tests and 207
declared skips**. The overall workflow and all six jobs succeed. Exact source/merge
trees, packet digest, original group inventory, command arguments, bounds and
child/tree cleanup verify. Nine non-TAP build exits are checked separately.
This checkpoint predates wheel RECORD, five-job scheduling, Cargo archive
identity, workflow/profile identity and observation-context changes.
[Native receipt](evidence/windows-complete-dc755901-summary.json).

Complete Linux aafb476 passes **317 groups, 1,923 tests and sixteen declared
skips**, with zero failures/cancellations. The exact original manifest, commands,
deadlines and skip inventory verify, along with every child/tree retirement.
The owned checkout, nine dependency aliases, 782 generated files (11,766,823
bytes), empty temporary parent and marker are removed; all other worktrees
remain. This checkpoint includes wheel RECORD and five-shard scheduling
changes and predates Cargo archive identity and the workflow-ID correction.
[Complete receipt](evidence/linux-aafb476-complete-summary.json).

No full Linux test service or temporary marker remains from that run.

Complete Linux `94a0135` passes **323 groups, 1,979 tests and sixteen declared
skips**, with zero failures/cancellations. Original commands, bounds, skip
inventory and every child/tree retirement verify. The owned checkout, nine
dependency aliases, 782 generated files (11,790,322 bytes), empty temporary parent
and marker are removed; other worktrees remain. This includes the native-focus
policy correction and npm/Cargo archive work. Later Python wheel-license changes
have separate focused and installed evidence.
[Complete receipt](evidence/linux-94a0135-complete-summary.json).

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

The earlier `cadbccd` complete packet remains separately accepted, while its
overall workflow failed after a cancelled preliminary shard. The later green
`dc755901` workflow does not erase that failure.
[Earlier packet](evidence/windows-complete-cadbccd-summary.json).

Windows workflow concurrency preserves one active full run and queues the newest
checkpoint. Superseded pending runs may be cancelled. Do not manually cancel,
retry or dispatch workflows. Queued/cancelled runs and partial output contribute
no accepted checks. Verify packet digests, source/merge trees, exact inventory,
bounds and cleanup before accepting downloaded evidence. Retain small JSON
receipts; remove downloaded archives.

## Continue independent implementation

Selected observation summaries now reach the existing Codex/Claude designer only
after explicit source selection and confirmation. Twenty-eight focused groups
pass **154 distinct checks**, including authenticated local HTTP, real encrypted
state, provider doubles, final-boundary deletion and cancellation. Ordinary
requests send no observation context; work-policy export stays refused.
The first package check exceeded its original limit by 4,711 bytes. Lossless
compression of the first-party catalog index restores the bound, with all sixteen
installation/recovery scenarios passing. No upstream source or frozen frontend
bytes change. Five installed observation metadata checks pass in the 71-check update;
new native acceptance and frontend selection controls remain pending.
[Installed evidence](evidence/installed-observation-design-summary.json). [Contract](observation-assisted-design.md),
[source evidence](evidence/design-observations-source-summary.json).

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

1. Combined current/index/history support is published and installed. Continue
   exact native acceptance and remaining ledger gaps. Linux and Windows
   reviewed saving are implemented; Windows saving has native acceptance.
   Mixed NTFS staging still needs its exact native receipt. Diagnose the retained
   restricted-storage final retirement assertion without changing permissions. The
   diagnostic follow-up passes five groups/80 tests and records a fixed phase and
   owner ordinal; it has not yet identified or repaired the native cause.
2. Continue Windows project and task-specific IDE integration, broader external
   observation streams and the remaining ledger gaps. Inspect available native
   receipts separately: workflow completion alone is insufficient without exact
   source, packet, command, original bounds and cleanup verification. Native focus
   alone does not establish a project, task, account or foreground binding.
3. Keep remaining guided role/device wiring and editor activation explicit as
   unfinished implementation while frontend review is frozen. The composed
   editor proof uses real encrypted state and Linux carriers with provider and
   terminal doubles. It does not accept native TUI/account/IDE behavior.
4. Investigate new failures using exact receipts. Windows shortcut startup and a
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
