# Switchyard implementation and acceptance

Switchyard gives Model F keyboards guided setup and stable controls for returning
to tasks, reviewing changes and handing work between tools. **The full Rev2 suite
is not finished.** The F77 is the pilot device; it does not limit the assignment.

Start with the [README](../README.md) for the product and first run, the
[requirement ledger](switchyard-requirements.md) for scope, and the
[verification record](verification.md) for detailed evidence. Work is published
on [draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20).
No merge or public release has been accepted.

The latest installed backend lists saved task names for one exact project through
signed Linux/Windows editor clients. It exposes no native session/account secrets,
makes no provider call and grants no launch permission. The chosen identity still
requires a fresh target/review/permit flow. The composed fixture passes 34 groups,
87 tests and both TypeScript checks.
[Task-choice contract](coding-task-owners.md#find-saved-tasks-for-a-project),
[source evidence](evidence/editor-task-choices-source-summary.json).

Home/catalog and editor command activation remain frozen for review. Unfinished
software and checks requiring hardware/accounts are listed separately below.
Complete Linux `7f2a52a` now passes all 351 groups: 2,302 tests and 32
declared skips. Its exact temporary checkout and 11.9 MB of generated output
are removed. The newer guided role choices have separate focused evidence.

Guided role setup now has backend choices with readable connection labels and
a saved-state digest checked before binding. It reuses the existing provider,
workspace and action limits, including Copilot-only Work. Seven groups/101 tests
pass with one declared skip and both TypeScript checks. Installed `7393da1` verifies these routes within 95 metadata/refusal checks
and 57 exact module hashes; frontend activation remains frozen.
[Contract](role-dispatch-binding.md#choose-a-saved-connection-by-name),
[evidence](evidence/role-choices-source-summary.json).

## Current evidence

Each result belongs to its exact source revision. Test totals from different
checkpoints are not cumulative acceptance of the latest suite.

| Checkpoint | Verified result | Limit |
| --- | --- | --- |
| Installed Linux `7393da1` | **95 metadata/refusal checks; 57 exact module hashes.** All 54 semantic workspaces, four profiles, 57 workflows and frozen frontend preserved. [Receipt](evidence/installed-guided-role-choices-summary.json). | Guided role choices, exact-project saved task choices, recording consent generations, persisted selection generation, consented runtime status capture, original-role/provider-effect guards, signed CLI dispatch and Codex version contract included; editor command activation remains pending; no live scanner, provider task, account/model request, native focus or hardware acceptance. |
| Native Windows client `9d230ac` | **25 groups; 250 tests; no skips.** Original manifest, commands, bounds and cleanup verified. [Receipt](evidence/editor-task-choices-native-client-summary.json). | Terminal/provider doubles remain explicit; not the complete Windows suite, runtime-observation backend groups or live authenticated Codex turns. |
| Complete Linux `7f2a52a` | **351 groups; 2,302 tests; 32 declared platform skips.** Original manifest, bounds and cleanup verified. [Receipt](evidence/linux-7f2a52a-complete-summary.json). | Covers installed runtime `9d230ac`, including consent/retirement corrections and signed project choices; the subsequent guided role choices and scheduling-data update have separate focused evidence. |
| Complete Windows `dc755901` | **417 groups; 2,478 tests; 207 declared skips.** All six jobs and overall workflow passed. [Receipt](evidence/windows-complete-dc755901-summary.json). | Predates newer archive, scheduling, profile/workflow and observation corrections. |

Complete Linux staging is removed: its exact checkout, nine dependency aliases,
803 generated files (11,907,805 bytes), empty test parent and marker. Other
worktrees remain. The journal's earlier failed Windows runs remain recorded in
the accepted receipt; the independent restricted-storage retirement failure
remains unresolved.

The latest installation preserves all four saved profiles, 57 workflows, selected
state, one pending keyboard-only conversation and the frozen frontend. All 54
semantic workspaces match; 53 sealed files are byte-identical and one changes
only audit metadata. An earlier signed-route preservation check overlapped other
metadata verifiers and failed; its sequential follow-up passed. The latest update
also retained a stale shared-gateway verifier pin failure before dispatch; after
referencing the accepted gateway evidence, all eight signed-intent checks pass. Dated backup and launcher readback verify. Only current
plus one rollback remain; the exact 555-file, 4,844,712-byte prepared bundle is
removed. The installed payload is 4,731,342 bytes across 553 files.

Windows `e5a5781` passed all six preliminary backend shards and 27 native guardian
checks, but complete bundle verification was cancelled at the 90-minute job
boundary. No final receipt was produced; the exact active test group is unknown.
Both complete-suite entry points now emit the already tested bounded progress
without changing commands, limits or skips. The runner tests pass 23 checks;
corrected complete native acceptance remains pending.
[Retained interruption](evidence/windows-backend-e5a5781-summary.json),
[reporting correction](evidence/full-suite-progress-source-summary.json).

## Earlier backend checkpoints

- **Storage retirement diagnostics:** failures now retain only a fixed status-query
  stage and numeric native error. The original query logic, access rights,
  five-second bound and unknown-retirement refusal remain. Three groups/53 tests
  and compilation of all 36 C# sources pass; native acceptance is pending.
  This does not establish or fix the intermittent cause.
  [Diagnostic evidence](evidence/runtime-status-diagnostic-source-summary.json).

- **Windows extension client:** exact Windows task/process contracts now use the
  shared signed instance transport. The actual TypeScript client completes the
  Suite/socket demonstration with an explicit native endpoint-reader double.
  Nine groups pass 86 tests with one platform skip; root and extension CommonJS
  typechecks pass. Terminal arguments use the reviewed 0.166.0 environment-token
  flag. Later native readers, process observation and reviewed launching are
  implemented; their latest native integration result is described above. [Source evidence](evidence/windows-editor-client-source-summary.json).

- **Windows editor lifecycle and signed routes:** consumed review, protected
  reservation, retained logical client, authenticated socket and exact peer
  checkpoints now compose through task acknowledgement and retirement. Thirteen
  groups pass 145 tests with five platform skips; typecheck passes. The demo uses
  real protected state, sockets and signed HTTP with explicit provider/native
  doubles. Windows host composition passes at `3795217`. The later VS Code Windows
  launcher is implemented; production command activation remains unfinished. [Source evidence](evidence/windows-editor-lifecycle-source-summary.json).
- **Windows editor recovery:** startup intents and read-only original host/query
  recovery pass native Windows CI at `6881d92`: seventeen groups, 181 tests,
  no skips. Unknown startup and observer cleanup remain uncertain.
  [Native evidence](evidence/windows-editor-recovery-native-summary.json).

- **Restricted storage remains unresolved:** run 42357835746 failed at
  `native-exit-owner-14-guardian` after seven owner checks. QUERY masks remain
  eight. The original protected installation was preserved; this is a software
  verification failure, not missing hardware/account acceptance.
  The later `3795217` run passes all eight owner checks, 68 QUERY-only
  registrations and original cleanup with unchanged retirement code; it does
  not establish the intermittent cause.
  [Failure evidence](evidence/restricted-storage-47c80be-failure-summary.json),
  [passing follow-up](evidence/restricted-storage-379-followup-summary.json).

- **Windows query-helper ownership:** original guardian/helper checkpoints precede
  worker acknowledgement and remain joined through retirement. The journal
  refuses an unretired replacement or false cleanup claim. Fourteen groups pass
  150 tests with four platform skips; typecheck passes. Native-query doubles are
  explicit locally; extended native callbacks pass at `47c80be`.
  [Contract](windows-editor-transport.md),
  [source evidence](evidence/windows-query-ownership-source-summary.json).
- **Windows editor journal contract:** native client CI passes sixteen groups,
  165 tests and no skips at `75fd0b1`. Journal-native/recovery coordinates use
  explicit doubles; actual protected state and leases execute on Windows.
  This historical journal checkpoint predates the lifecycle and recovery
  integration above and the later implemented VS Code Windows launcher. [Native evidence](evidence/windows-editor-journal-native-summary.json).
- **Windows editor target preparation:** native CI passes fifteen groups,
  159 tests and no skips at `2d1cc65`, including actual process reinspection
  and protected registry target/client registration.
  [Contract](coding-task-owners.md),
  [native evidence](evidence/windows-editor-target-native-summary.json).
- **Retained Windows editor channel:** native CI passes fifteen groups, 155 tests
  and no skips at `fcfe38a`. Closing a logical editor leaves the original task
  connection alive without claiming process exit.
  [Contract](windows-editor-transport.md),
  [native evidence](evidence/retained-editor-client-native-summary.json).
- **Windows Codex task ownership:** native client CI now passes fourteen groups,
  147 tests and no skips at `0078893`, including actual Job-backed synthetic
  configuration/task RPC and saved-identity retirement. Windows durable
  journal/recovery and Suite integration now have later evidence above;
  VS Code Windows adaptation remains unfinished.
  [Contract](coding-task-owners.md),
  [native evidence](evidence/windows-codex-owners-native-summary.json).
- **Persistent Windows process layer:** all three actual native Job cases pass at
  `45fe70e` within thirteen client groups: 139 tests, no skips. The earlier
  35-source offline compile passed; its exact compiler output is removed.
  [Contract](windows-owned-stdio.md),
  [native evidence](evidence/windows-owned-stdio-native-summary.json).
- **Windows exact-task editor protocol:** the authenticated carrier now composes
  with one retained provider client, exact Windows repository/task/account checks,
  durable acknowledgement and joined retirement. Fourteen focused groups pass
  127 tests with three platform skips; typecheck passes. Provider/native-peer
  behavior is explicitly doubled in these real-socket tests. Windows client
  acceptance passes 127 tests at `f1167c9`, with the provider/peer doubles explicit. Durable editor
  journal recovery and Suite routes have later evidence above; VS Code Windows
  launching remains unfinished.
  [Contract](windows-editor-transport.md),
  [source evidence](evidence/windows-editor-connection-source-summary.json).
- **Windows terminal connection identity:** a held accepted socket now supplies
  the exact loopback tuple; native TCP ownership is checked against the original
  process before and after image verification. Socket closure cancels and joins
  observation. Thirteen focused groups pass 172 tests with three platform skips;
  34 native sources compile offline. Nine native client groups now pass 107 tests at `89db483`, with no skips.
  [Native peer evidence](evidence/windows-terminal-peer-native-summary.json).
  Transport has separate focused evidence; task attachment remains unfinished. [Contract](windows-terminal-process.md),
  [source evidence](evidence/windows-terminal-peer-source-summary.json).
- **Combined scanner inputs:** current, staged and bounded historical versions can
  share one reviewed scan with separate provenance and authority checks. Fifty-six
  focused groups pass 348 tests with five declared skips. Actual Linux scanning
  passes; two native Windows groups pass 20 tests with one Linux-only skip,
  including actual combined NTFS staging.
  [Native evidence](evidence/windows-mixed-scanner-native-summary.json).
  [Contract](mixed-scanner-inputs.md), [evidence](evidence/scanner-mixed-input-source-summary.json).

- **Reviewed scanner setup saving:** the authenticated Linux backend now reviews,
  saves and recovers exact generated controls. A real demonstration saves through
  this API before fresh authority and execution review. Thirty-five focused groups
  pass 221 tests, including interrupted-save recovery and all installation cases.
  The package stays below its original 5 MiB limit with lossless template storage
  and identical exports. Windows saving is now connected through an owned NTFS
  helper; 41 focused groups pass 275 tests with ten platform skips. Fifteen native tests now pass at `5ec16fe`, including four actual NTFS cases.
  [Native evidence](evidence/windows-scanner-save-native-summary.json). Frozen frontend controls
  remain unfinished. [Contract](scanner-recipe-saving.md),
  [Windows evidence](evidence/windows-scanner-recipe-save-source-summary.json),
  [evidence](evidence/scanner-recipe-save-source-summary.json).
- **History preparation and read-only inspection:** bounded historical descriptors
  now come from the exact bound task. Protected capture computes Git tree identity
  without modifying cold index caches or object databases. The latest 58 focused
  groups pass 202 tests; package startup and recovery pass after the explicit
  runtime closure correction. [Contract](read-only-index-tree.md),
  [evidence](evidence/scanner-history-review-source-summary.json).
- **Staged-input preparation:** the authenticated review can derive all supported
  staged descriptors and bind their exact Git tree before confirmation. Thirty-three
  focused groups pass 129 tests with verified cleanup. Recipe/feed assembly,
  frontend controls and native Windows acceptance remain separate.
  [Contract](scanner-input-inventory.md#include-staged-versions-in-the-review),
  [evidence](evidence/scanner-index-review-source-summary.json).
- **Archive license declarations:** npm lockfile and archive obligations remain
  independent. Cargo requires matching bytes and identity; Python wheels also
  require verified RECORD hashes. Unsupported declarations and unselected OR
  alternatives retain coverage gaps. These checks do not establish license-text,
  provenance or legal approval. [npm](npm-archive-license-declarations.md),
  [Cargo](cargo-license-declarations.md), [Python wheels](python-wheel-license-declarations.md).
  Wheel coverage has 167 distinct passing tests across 20 focused groups; all six
  affected groups were rerun after a separately reproduced budget-refund defect.
- **Windows terminal identity:** a read-only native helper now verifies exact
  PID/birth, held executable bytes, current user and session. Fifteen focused
  groups pass 192 tests with two platform skips; typecheck and 34-source C#
  compilation pass. Eight native client groups now pass 100 tests at `dec4dd5`,
  including the actual process query. Suite/editor attachment
  remains unfinished. [Contract](windows-terminal-process.md).
- **Windows native focus:** reviewed ChatGPT and stable VS Code executables have
  separate protected configurations, exact helper ownership, one-use requests
  and uncertain-outcome recovery. Selected-workspace policy now precedes platform
  dispatch; the native client lane verifies the correction. The original
  [failed run](evidence/windows-client-02cc6ba-failed-summary.json) remains retained.
  [Contract](windows-native-focus.md).
- **Workflow and profile integrity:** malformed imported identities and repeated
  dependency edges are refused before persistence. Existing saved documents
  remain compatible. [Workflow evidence](evidence/workflow-identity-source-summary.json),
  [profile evidence](evidence/profile-identity-source-summary.json).
- **Observation-assisted design:** only explicitly selected and confirmed session
  summaries reach Codex/Claude design requests. Ordinary requests send no
  observation context; Work-policy export remains refused.
  [Contract](observation-assisted-design.md).

## Implemented capabilities

| Capability | Behavior and engineering reference |
| --- | --- |
| Keyboard configuration | Model F catalog and portable profiles; reviewed device proposals, protected baselines, readback/recovery and firmware capability gates. [Configuration](switchyard-configuration.md), [profiles](portable-profiles.md), [F77 source audit](solenoid-capability-audit.md). |
| Protected workspaces | Compartment-scoped encrypted state, fresh policy checks, bounded OS locks, exact approvals and durable replay refusal. [State locks](private-state-locking.md), [receipt authority](receipt-authority-commit.md). |
| Coding tools and editors | Distinct Codex/Claude task APIs, reviewed text, signed editor requests, one-use launch permits and protected lifecycle history. [Native tasks](native-coding-tasks.md), [task ownership](coding-task-owners.md), [editor demonstration](evidence/editor-terminal-connection-summary.json). |
| Custom agents | Authenticated enrollment, generation-bound commands, reviewed revocation, replacement credentials, exact retirement and recovery of uncertain outcomes. SDKs persist sequence state before sending. [Revocation and recovery](custom-agent-revocation.md), [SDK evidence](evidence/sdk-persistence-source-summary.json). |
| Reviewed execution | Exact task inputs, independent approval, supervised native processes and disposable build workspaces. [Execution](reviewed-task-execution.md), [bounded builds](bounded-build-workspace.md). |
| Repository review | Read-only inspection, worktree/index/history witnesses, explicit ignored secret inputs and reviewed generated-tree exclusions. [Inspector](inspect-cli.md), [scanner input review](scanner-input-inventory.md), [staged inputs](staged-shield-inputs.md), [history](historical-shield-inputs.md). |
| Shield and supply chain | Pinned offline scans, signed feeds, scoped exceptions, CycloneDX inventories, npm/Python/Rust declarations and CVSS 2/3/4 scoring. Results retain exact coverage gaps. [Scanner](shield-baseline-scanner.md), [Rust](cargo-supply-chain.md), [Python](python-supply-chain.md), [severity](cvss-severity.md). |
| Observation and voice | Separately consented deliberate, category, agent, host-action and editor metadata; encrypted recording state and recoverable local transcription queue. [Recording](workflow-capture.md), [editor history](editor-workflow-observation.md), [local runtime](optional-runtime.md). |
| Installation and recovery | Versioned private bundles, integrity checks, installation/update/rollback and interrupted-install recovery. [Installation](suite-installation.md), [recovery](suite-release-recovery.md). |

## Unfinished implementation

- Guided role/device wiring, editor command activation and frontend exposure.
  Home/catalog and editor activation remain frozen for owner review.
- Windows project selection and task-specific IDE attachment; native application
  focus alone does not establish a task or account binding.
- Broader Shield syntax, frontend scanner setup and broader history coverage, general
  exclusions, dependency/feature/target resolution, complete archive contents,
  license-text inspection, publisher provenance and verified local vulnerability
  context.
- Broader external observation streams and the remaining portability,
  controller and conversation requirements in the [ledger](switchyard-requirements.md).

## Checks requiring hardware, accounts or interactive access

| Check | Boundary |
| --- | --- |
| F77 physical behavior | Cached VIA 9/Vial 4 readout and pinned `wcass:f77` source checks pass. New typing, hotplug and writes remain unperformed. No new HID, unlock, reset, flash, bootloader, solenoid or electrical operation is authorized here. Preserve firmware Dvorak and US host input. |
| B122 and cap fit | Hardware is unavailable; all 27 physical gates remain open. |
| Microsoft work Copilot | No approved work tenant is available. Synthetic checks do not establish tenant, license or account acceptance. |
| Windows ordinary-user/UAC/guest behavior | Headless CI and guest doubles do not accept interactive journeys. Earlier restricted storage passes remain scoped to their revisions. The `edb76de` restricted owner passes all eight checks and cleanup with TOKEN_QUERY mask 8 unchanged; the earlier intermittent retirement cause remains unresolved. |
| Native provider/task/IDE interaction | No live login changes, model requests or new native task create/resume are authorized during backend checks. The Claude/tmux attempt stopped at trust and retired its processes. Exact Codex 0.166.0 and 0.167.0 contracts are reviewed; live authenticated task acceptance remains separate. |
| Home/catalog and microphone interaction | Frozen frontend and backend transcription evidence do not establish visual or live microphone acceptance. |

## Retained failures and unresolved causes

Windows run `42379166911` at source `6727054` reached its 20-minute
preliminary-shard budget after 39 of 40 groups completed. Its final group,
`windows-scanner-recipe-files.test.mjs`, had started but produced no final
receipt. The old fallback estimated one minute; audited `e5a5781` measured
that group at 209,833 ms. Scheduling now uses all 232 audited native measurements,
retaining the higher prior estimate where applicable. The six current batches
estimate at most 891,633 ms each; job/child deadlines, fallback, permissions and
all tests remain unchanged. Three local groups/35 tests pass. This is a scheduling
correction, not native acceptance of the current Windows tree.
[Evidence](evidence/windows-scheduling-refresh-summary.json).


The `5ec16fe` Windows workflow failed a separate restricted-storage owner check
at final native/fixture retirement after seven passing checks. The exact assertion
is not yet identified; original ownership and fixture data are preserved. Native
scanner saving passed in that workflow. This is an unresolved software/native CI
failure, not unavailable hardware or an account blocker.
[Retained failure](evidence/windows-restricted-storage-retirement-failure-summary.json).
The next native run now reports the exact owner ordinal and recorded-stop,
guardian-exit or directory-retirement step. Five source groups pass 80 tests;
all original acceptance checks and permission boundaries remain. This is a
diagnostic improvement, not a verified native repair. The separate `edb76de`
follow-up passes all eight owner checks, 68 exact QUERY-only descendant
registrations and original fixture/service removal. It predates the diagnostic
change and does not establish the intermittent cause.
[Passing follow-up](evidence/windows-mixed-scanner-native-summary.json).
[Diagnostic evidence](evidence/native-retirement-phase-source-summary.json).

The earlier complete Linux [49a5053 failure](evidence/linux-49a5053-failed-summary.json)
and [39db1fe scheduling failure](evidence/linux-39db1fe-scheduling-failed-summary.json)
remain recorded alongside later passing checkpoints. Windows
[shortcut startup](evidence/windows-shortcut-recurring-timeout-summary.json) and
[fixture Python startup](evidence/windows-fixture-registry-followup-summary.json)
have passing follow-ups, but their intermittent causes remain unresolved.
No deadline, token access, account rule or privilege was widened to obtain a pass.
Queued/cancelled runs and partial output do not count as acceptance.

The repaired native ChatGPT main-window voice, hidden overlay, saved artwork and
workstation guard remain preserved. [Continuation notes](switchyard-continuation.md)
record operating constraints and the next work. Older details remain in the
[verification record](verification.md), [history index](switchyard-status-history-8.md)
and [preceding status checkpoint](https://github.com/SquirmyWormy275/strathex-switchyard/blob/9626b556aadf1e6c3f2b99f242c58789911bf0d3/docs/switchyard-status.md).

The later consent-generation correction gives each explicit observation start or
resume a new identity, preserves duplicate recording requests, and refuses delayed
native metadata across same-clock renewals. Two original failures are retained;
eight groups pass 120 tests with no skips and an actual encrypted-state API
scenario. This source correction postdates installed `57af859` and the running
complete Linux `0c025df` check. [Evidence](evidence/consent-generation-source-summary.json).

Foreground category sampling now also binds its original persisted recording
generation. A peer pause stops the next read; stale replies and errors cannot
alter renewed consent. Three original regressions are retained; eight focused
groups pass 123 tests with no skips and independent encrypted stores. This
postdates installed `57af859` and complete Linux `0c025df`.
[Foreground consent evidence](evidence/foreground-consent-source-summary.json).

Native Windows client source `57af859` now passes 25 original groups/249 tests
with no skips; exact source/merge trees, artifact and receipt hashes, commands,
bounds and process cleanup verify. The metadata-only manifest projection's scratch
files are removed. This lane excludes the new selection/consent backend groups
and does not accept the complete Windows release.
[Native client evidence](evidence/selection-native-client-summary.json).

A further foreground-retirement regression exposed an old failure stopping a
newly resumed source while error-state persistence was delayed. The original
source is now captured and retired before that awaited write. Eight groups pass
124 tests with no skips; the original failing receipt remains. This source-only
follow-up postdates installed `eebfe05` and running full Linux `0c025df`.
[Retirement evidence](evidence/foreground-retirement-source-summary.json).

The final recording-retirement correction is now installed as `849b9b9`, release
`5ee98aa4c930`, with `3760be8d85df` retained as rollback. All 88 metadata/refusal
checks and 56 module hashes pass; all 54 semantic workspaces, four profiles,
57 workflows, selection, pending conversation and frozen frontend remain intact.
Host-facing checks ran sequentially. The dated backup/readback verify and the
exact 554-file/4,830,690-byte prepared bundle is removed.
[Installed retirement evidence](evidence/installed-foreground-retirement-summary.json).

Two additional in-memory checks now exercise the installed runtime recorder's
consent-generation replacement and exact-timestamp refusal directly. They replace
the prior 21-check agent verifier with 23 checks, bringing the accepted installed
total to 90 distinct checks at the same `849b9b9` release and 56 module hashes.
No recording, provider or foreground operation was started.
[Installed consent follow-up](evidence/installed-consent-followup-summary.json).

Complete Linux `0c025df` is audited: 350 original groups, 2,293 passing tests,
32 declared platform skips and no failures. Original manifest, commands, bounds,
progress reporting and child/process-tree exits verify. Its temporary checkout,
nine existing dependency aliases, 802 generated files (11,904,762 bytes), empty
test parent and active marker are removed. No dependencies were downloaded.
The later installed observation corrections remain explicitly separate.
[Complete Linux evidence](evidence/linux-0c025df-complete-summary.json).
