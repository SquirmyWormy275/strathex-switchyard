# Switchyard implementation and acceptance

Switchyard gives Model F keyboards stable controls for returning to tasks,
reviewing changes and handing work between tools. **The full Rev2 suite is not
finished.** The backend has working connected paths; frontend completion and
interactive acceptance remain separate. The F77 is the pilot, not the scope limit.

Start with the [product introduction](../README.md), then run the
[connected backend demonstration](backend-demonstration.md). The
[requirement ledger](switchyard-requirements.md) separates implementation from
validation. Work is published on
[draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20);
no merge or public release has been accepted.

## Guided frontend checkpoint

The Windows Claude Desktop catalog now leads directly to its native setup or
saved window controls. It distinguishes configured identity from an observed
window and keeps launch availability separate. Five groups/59 tests pass through
the authenticated API, with native/browser fixtures and zero skips. Installed
source `fc7c71f` passes 62 served/API and 107 metadata checks across 62 exact
modules. All 54 workspaces remain intact and the prepared package is removed.
Browser visual acceptance remains blocked before inspection.
[Evidence](evidence/client-native-navigation-source-summary.json).
[Installed evidence](evidence/installed-client-navigation-summary.json).

Native helper publish and own-process self-test pass at `ece17a0` within the
original 15-minute bound and QUERY 8. The exact source/merge tree verifies; no
native archive was downloaded locally. Window/shortcut acceptance remains separate.
[Native evidence](evidence/native-helper-ece17a0-summary.json).

The corresponding Windows client lane also passes all 28 groups, 287 tests and
zero skips. Its downloaded JSON receipt verifies every original command, bound,
declared skip and child cleanup against the exact source/merge tree. The ZIP was
read in memory; no Windows runtime was downloaded locally.
[Client evidence](evidence/client-native-ece17a0-summary.json).

Windows Claude Desktop now connects exact executable review, saved identity,
window focus and navigation shortcuts. Twelve groups pass 177 checks; a final
four-group UI run passes 39 with overlap. The helper builds offline with warnings
as errors and passes its portable self-test and Linux refusal. Both temporary
build copies are removed; the original incomplete staging failure is retained.
Interactive Windows image/window acceptance, Linux Claude focus and application
launch remain separate. [Controls and evidence](windows-native-focus.md).
Normal installed source `49602de` passes 61 served/API and 106 installed checks
across 62 exact module hashes, with all 54 workspaces preserved.
[Installed evidence](evidence/installed-claude-desktop-controls-summary.json).

Windows discovery now exposes the implemented shortcut bridge, fixing a disabled
frontend path. Five groups/78 checks pass without claiming keyboard layout,
native window or actual shortcut registration. [Evidence](evidence/windows-shortcut-discovery-source-summary.json).

Latest audited Linux release run `42568708712` at `947d982` failed before tests:
the unchanged pinned Bubblewrap download returned HTTP 504. No test was skipped
by changing the plan, and no manual retry was requested. The completed local
`4e3feb4` run remains separate source evidence.

Claude Code now has a separately opted-in hook observation path and an exact-session
settings preview. Ten hook cases and two UI cases pass within eight original
groups/111 checks, including actual independent Node processes and encrypted
storage. Fourteen running-preview checks pass. The original expired synthetic
fixture is retained and corrected without changing retention or bounds. No native
Claude hook/settings or visual acceptance is claimed. The normal installation
passes 58 served/API and 103 installed metadata checks across 60 exact modules.
[Setup and boundaries](claude-hook-observation.md),
[source evidence](evidence/claude-hook-source-summary.json).

Existing transcripts can now be imported as explicitly unverified text in Personal
keyboard-only mode, without microphone/runtime/provider effects. Exact request
identity prevents a lost reply from creating a duplicate or replacing later
corrections. Work import and unrelated authority fields refuse. Six added UI cases
bring the selected nine-group run to 120 passes. Normal installed source `9057de5` now passes 55 served/API checks and 100
installed metadata checks with all 54 semantic workspaces preserved. [Import evidence](evidence/transcript-import-source-summary.json).

Voice notes now expose exact saved-note history, separate correction/draft actions
and reviewed deletion. Workspace and mode changes release capture, and late
permission responses cannot start a microphone in a new workspace. Bounded
segmentation, saved-audio retry and lost replies have fourteen interaction cases,
including the full page. No live microphone or recognizer was used.
[Controls and source evidence](voice-note-controls.md).

Your tools now includes saved custom-agent inventory, separate exact revocation
and uncertain-command reviews, and owned bundled-example retirement. Eight UI
cases pass within 115 original checks; four complete-page groups pass 33 checks
with overlap, and the running synthetic preview passes thirteen. Original bounds
and cleanup verify. No installed agent action or browser visual acceptance is
claimed. [Controls and evidence](agent-maintenance-controls.md).

The owner lifted the frontend freeze and approved completing its flows. Home now
shows the next setup step; saved readouts expose source/controller evidence;
named role choices use the backend's digest-checked contract and separate reviews
for saving and dispatching. Host shortcut review can select a saved role control.
An isolated interactive demonstration is available. Browser visual acceptance is
blocked by the browser tool failing before navigation/inspection; this is not a
hardware or account limitation. The connected execution controls are described below. [Walkthrough and boundaries](guided-setup.md).

Profile import/export now has a concrete v2 review before clearing local connections,
and Settings offers digest-verified assignment references and A4/SVG legend sheets
with optional short labels. Twelve groups pass 141 tests; nine checks pass against
the running synthetic server. [Portability evidence](evidence/portability-ui-source-summary.json).
These are software checks; browser and physical print acceptance remain pending.

Activity now connects source selection, exclusions, historical session review and
pause/resume/stop/deletion. Design together can include one explicitly reviewed
aggregate summary with the next message; destination or source changes invalidate
the review. Six frontend interaction cases and the live synthetic HTTP demonstration
pass. [Observation evidence](evidence/observation-ui-source-summary.json).

The editor now registers Browse Saved Tasks, Connect Saved Task in Terminal and
Return to Connected Terminal. Seven interaction cases, TypeScript checking and a
compiled no-I/O activation check pass. Native task attachment, interactive IDE and
installed extension acceptance remain distinct. [Editor controls](editor-task-controls.md).

The keyboard workbench now exposes advertised semantic keys, macros, layout and
QMK settings, encoders, tap dances, combos, modifier overrides and alternate-repeat
rules. Manual physical-key diagnostics have separate consent, stop and verified
relock controls. Fifteen original groups pass 128 tests with zero skips, plus eight
running-server checks; the transport is synthetic. No physical device was touched.
[Controls and limits](keyboard-settings-ui.md).

Your tools now separates each documented client surface, reviews fixed launch
destinations and exposes retained launch outcomes. Recipes carry no account or
execution authority. Twelve original groups pass 131 tests with one declared
Windows skip; eight running-preview checks pass. Claude desktop's native launch
remains unfinished. [Client controls](client-controls.md).

Activity now has a collapsed reviewed-execution workbench for existing task
permissions: recipe-file hashing, concrete recipe/isolation/budget review,
separate execution and stop approvals, retained status and bounded output.
A source-only demonstration runs an actual disposable Linux program through the
authenticated API without an existing account. Named saved-task permission issuance, revalidation and revocation now have
separate frontend controls. Scanner setup now reviews generated control files,
saves them separately and hands their scope/recipe to those controls without
implicit authority or execution. [Execution controls](reviewed-execution-controls.md).

Saved design conversations now have a local history picker, separate account
binding review, explicit native status, destination-specific drafts and lost-reply
handling. Eight original groups pass 73 tests; three final interaction groups pass
23 with overlap. Eight running synthetic-preview checks pass. The complete source
lane now uses 22 software workers plus assembly after the retained original
20-worker workload check fails with the new group. Bounds and cases are unchanged.
[Conversation controls and evidence](saved-conversation-controls.md).

Your tools now connects dedicated Codex/Claude text tasks, exact existing-session
binding, separate text review/send, cancellation, retained replies and deliberate
uncertainty/recovery/deletion. Eleven interaction cases use real HTTP/encrypted
state with explicit native transport doubles. Eight original groups pass 102
tests; six final groups pass 65 with overlap. Eleven running-preview checks pass.
The original two empty-collection fixture failures remain retained. Background
task controls are connected below; exact interactive attachment remains unfinished.
[Task controls and evidence](coding-task-controls.md).

Approved-work account controls now use explicit sign-in/check/exact-stop actions,
with no background polling. Exact cancellation aborts only that pending sign-in;
a foreign workspace cannot consume or delete its device-code session. The actual
designer sends a durable UUID. Local request inventory, separate one-use outcome
review and acknowledgement preserve remote uncertainty without replay or logout.

Ten interaction cases use real HTTP/encrypted state with synthetic Microsoft
responses. Eight final original groups pass 119 tests; three other groups pass 21 with
overlap, zero skips and original bounds/cleanup verified. Fourteen running-preview
checks pass, including keyboard-only acknowledgement and replay refusal. The
original browser-fixture initialization failure remains retained.
[Account controls and evidence](copilot-account-controls.md).

The account and background controls are now installed at `00fd643`, with their
exact evidence below. Approved tenant, license and live consent checks remain
separate. Current full-platform CI and retained native host-action failures remain open.

Claude background-task controls now connect reviewed empty launch, native
identity reconciliation, separately reviewed exact stop and an existing-window
focus review. Stopped owned background tasks can enter the existing text-review
path; empty unavailable transcripts refuse without creating a replacement.
External bindings stay observation-only for stop/text. Focus does not attach,
resume or restart a task.

Eight new UI cases bring the task interaction file to nineteen cases. Eight
original groups pass 113 tests with no skips, unchanged bounds and verified
cleanup. Twelve running-preview checks pass. Native command/account/window
transports are explicit doubles; no live task, model or desktop action occurred.
[Task walkthrough](coding-task-controls.md),
[exact evidence](evidence/background-ui-source-summary.json).

Native exact interactive attachment remains implementation work. Browser visual review, live
provider/task/tenant behavior, current complete Linux/Windows and retained native
host-action failures remain separate acceptance work.

Native app controls now connect reviewed return to ChatGPT and VS Code, Windows
executable setup and retained helper retirement. Passive saved metadata starts no
native probe. A new workspace-bound focus route refuses stale reviews across two
Personal workspaces as well as Work. Nine UI cases pass within six groups/80 tests;
eleven running-preview checks pass. Original missing-Work-fixture and queued
dialog-close failures remain retained. The corrected dialog ignores an old close
event after reopening. Normal installation is verified below; visual acceptance remains separate.
[Controls and exact evidence](native-app-controls.md).

## Current broader CI failures

The `ce89c78` Linux job and one Windows source worker fail the historical workload
budget check as new frontend tests exceed the six-worker allowance. The source
now redistributes every original case across eight workers; the 20-minute worker
limit, 950,000 ms setup allowance, historical costs and all child bounds remain.
Five local groups pass 59 tests with no skips, and TypeScript checking passes.

A separate Windows host-action worker records two assertions, then reaches its
original 45-second deadline. Its cause remains unresolved. Two indefinite fixture
entry waits now use the existing two-second observer, retaining every assertion
and the 75 ms effect/coordination limit. This is failure reporting, not proof of a
production repair. Both original native receipts, exact ZIP digests, source/merge
tree and local reproduction are retained. No current full-platform pass is claimed.
[Failure evidence and scoped follow-up](evidence/ci-capacity-ce89-summary.json).

## Installed frontend verification

The normal installed application includes guided setup, portability, observation,
keyboard/client controls, permissions/scanners/feeds/execution, saved design
conversations, coding-task text/background controls and approved-work account/
recovery, exact native-app navigation, connected-agent maintenance, saved voice notes,
transcript import and Claude hook setup at source `23293d1`,
release `f9e73add`. All 36 served asset hashes and twenty-two API/inventory checks pass; eight
installed verifiers pass 103 checks across 60 exact modules. All 54 semantic
workspaces, 57 workflow definitions, modes, selection and conversation records
remain intact. Fifty-three sealed files are byte-identical; one changes audit only.

Dated launcher backups verify and the previous `ff9e2aa6` release is the single
rollback. The 574-file payload is 5,046,103 bytes; its exact prepared copy
(575 files/5,149,887 bytes) is removed after identity/hash verification. No live
account/task/model or hardware operation occurred. Visual acceptance remains
blocked before browser inspection. [Exact installed evidence](evidence/installed-claude-hook-controls-summary.json).
Earlier [agent maintenance](evidence/installed-agent-maintenance-controls-summary.json),
[native-app controls](evidence/installed-native-app-controls-summary.json),
[account/background controls](evidence/installed-lifecycle-controls-summary.json),
[34-asset](evidence/installed-task-controls-summary.json),
[32-asset](evidence/installed-scanner-controls-summary.json) and
[28-asset](evidence/installed-frontend-controls-summary.json) evidence is retained.

## A working backend journey

The repeatable demo uses the normal authenticated API, encrypted stores and
signed Node SDK. It loads the F77 Dvorak reference, binds a named connection,
dispatches a status control, records and pauses observations, saves a refined
workflow, and reviews/imports its portable profile into a second private store.
Work policy refuses personal-agent enrollment, recording and export.

All seven stages pass, alongside four original test groups/21 tests. The agent
and second host are explicit fixtures. The demo removes its temporary servers
and state. It does not establish physical keyboard, native provider/account,
interactive IDE or live microphone acceptance.
[Executed evidence](evidence/backend-connected-demo-summary.json).

The same public command and argument-refusal checks also pass on native Windows
at `864fe0d`: two tests, zero skips and exact cleanup within the original group
bound. [Native demo](evidence/backend-connected-demo-native-summary.json).

## Implemented capabilities

| Capability | Current behavior and first reference |
| --- | --- |
| Model F setup | 19 listed model/case/round combinations and 104 named references. Reviewed keyboard proposals retain baselines, readback/recovery and firmware capability limits. [Catalog](model-f-standard-configurations.md), [configuration](switchyard-configuration.md). |
| Workflows and roles | Editable process definitions, readable saved connection choices and stale-choice refusal. Listing or binding a role does not grant task execution. [Role binding](role-dispatch-binding.md). |
| Coding tools and editors | Distinct Codex/Claude task APIs, reviewed text, signed saved-project and task choices, one-use launch permits and retained ownership/recovery. [Native tasks](native-coding-tasks.md), [task ownership](coding-task-owners.md). |
| Custom agents | Authenticated enrollment, Node/Python SDKs, bounded intents, replay refusal, credential replacement, revocation and uncertain-outcome review. [SDK guide](../integrations/README.md), [recovery](custom-agent-revocation.md). |
| Microsoft 365 Copilot | Approved web/Graph routes, exact account binding, Copilot-only Work policy and durable uncertain-request recovery. Live tenant acceptance is separate. [Account contract](copilot-account-binding.md), [request recovery](copilot-request-recovery.md). |
| Protected workspaces | Compartment-scoped encrypted state, fresh policy checks, bounded OS locks, local credentials and separate Work restrictions. [State locking](private-state-locking.md). |
| Reviewed execution | Exact approved task inputs, supervised processes and disposable bounded build workspaces. [Execution](reviewed-task-execution.md), [build workspace](bounded-build-workspace.md). |
| Repository review | Read-only current/index/history inspection and scoped offline Shield scans. npm/Python/Rust inventories, signed feeds and severity scores retain explicit coverage gaps. [Inspector](inspect-cli.md), [scanner](shield-baseline-scanner.md). |
| Observation and voice | Separately consented deliberate, category, agent, host-action and editor metadata; pause/stop/deletion and recoverable local transcription. [Recording](workflow-capture.md), [local runtime](optional-runtime.md). |
| Portability and lifecycle | Reviewed profile export/import/migration, local bindings kept separate, keyboard-only import, versioned installation/update/rollback and interrupted-install recovery. [Profiles](portable-profiles.md), [installation](suite-installation.md), [recovery](suite-release-recovery.md). |

## Accepted checkpoints

Each result belongs to its exact source revision. Results from different
checkpoints are not cumulative acceptance of the latest suite.

| Scope | Verified result | What it does not establish |
| --- | --- | --- |
| Installed Linux `9266c12` | **102 metadata/refusal checks; 59 exact module hashes.** All 54 semantic workspaces, four profiles, 57 workflows, selection, pending keyboard-only conversation and frozen frontend preserved. [Evidence](evidence/installed-codex-status-consent-summary.json). | Live task/model/account operations, editor command activation, hardware or microphone acceptance. |
| Complete Linux `9266c12` | **356 groups; 2,333 passing tests; 32 declared skips.** Same source as the installed backend. Original manifest, commands, deadlines and cleanup audited; includes exact-version and both status-consent corrections. [Evidence](evidence/linux-9266c12-complete-summary.json). | Native Windows, live accounts/models, interactive UI and physical devices remain separate. Installed metadata/refusal acceptance is recorded independently. |
| Complete Linux `4e3feb4` | **375 groups; 2,483 passing tests; 32 declared skips.** Original manifest, commands, bounds, serial build order and cleanup audited. [Evidence](evidence/linux-4e3feb4-complete-summary.json). | Includes guided controls through voice notes. Later transcript import/hooks, Windows, live providers, visual UI and hardware remain separate. |
| Complete Windows package `7529718` | **462 groups; 2,910 passing tests; 246 declared skips.** Exact manifest, commands, bounds, two-child scheduling and cleanup independently audited. Full native helper publishing, portable smoke and artifact validation pass; all eight release jobs succeed. [Evidence](evidence/windows-package-7529718-summary.json). | Later frontend/editor revisions, live providers, interactive Windows/IDE, devices and microphone acceptance remain separate. The binary payload was not downloaded locally. |
| Complete Windows source `4db5948` | **462 groups; 2,910 passing tests; 246 declared skips.** All 21 original worker receipts pass an independent source/tree/tool/manifest/command/bound/cleanup audit. Native collector passes; all 23 jobs succeed. [Evidence](evidence/complete-windows-4db5948-summary.json). | The later standalone-helper compiler failure is corrected and full package construction passes at `7529718`. The alias assertions pass in the separate package test receipt; live providers, UI and hardware remain separate. |
| Complete Windows source `90fa879` | **462 groups; 2,902 passing tests; 246 declared skips.** All 21 original worker receipts and the native collector match; all 23 jobs succeed. Exact source/tree/tool identities, commands, bounds and cleanup verify. [Evidence](evidence/complete-windows-90fa879-summary.json). | Package, live-host and later Claude 2.1.319 admission. Earlier intermittent failures remain unresolved. |
| Native Windows contracts `b38ff759` | **Role/dispatch: 24 tests across two complete files. External-agent consent: 51 tests across three files.** Exact source/merge trees, original bounds and cleanup verified. [Roles](evidence/role-choices-native-b38-summary.json), [consent](evidence/agent-consent-native-b38-summary.json). | Complete Windows suite/package acceptance or live provider behavior. |
| Native Windows client `9d230ac` | **25 groups; 250 tests; zero skips.** Signed launcher composition plus native endpoint/process/socket contracts. [Evidence](evidence/editor-task-choices-native-client-summary.json). | Terminal/provider doubles do not establish interactive task handoff. |
| Earlier complete Windows `dc755901` | **417 groups; 2,478 tests; 207 declared skips.** All workflow jobs passed. [Evidence](evidence/windows-complete-dc755901-summary.json). | This revision predates later backend changes. |

The earlier installed payload contained 554 files/4,750,121 bytes. Dated backup and launcher
readback verify; current plus one rollback remain. Its exact 555-file/4,849,605-byte prepared
bundle is removed. The complete Linux checkout, nine dependency aliases and
803 generated files/11,907,805 bytes are also removed. The latest `cf3bb4c`
checkout, nine aliases and 803 generated files/11,910,385 bytes are removed too;
other worktrees remain. The earlier `9266c12` checkout, nine aliases and 803 generated files/11,910,385 bytes are also removed after verified unit exit and exact ownership checks.

## Native status and version compatibility

Codex status now uses the same recording-consent capture as Claude. Two additional retained failures showed a delayed result entering a resumed recording and its history event receiving the storage timestamp. The fix preserves the original provider time; task-status freshness was already correct. All 35 original groups/151 tests pass, including both adapters, the shared collector and all 29 task-owner scenarios. TypeScript checking passes. [Codex evidence](evidence/codex-status-consent-summary.json). Installed adoption now passes 102 metadata/refusal checks across 59 exact modules. [Installed evidence](evidence/installed-codex-status-consent-summary.json).

Claude status now preserves its native arrival time and original recording consent across delayed ownership/account checks and storage. Two retained regressions exposed recording after same-clock pause/resume and stale status being refreshed by a write delay. Seven groups/113 tests and TypeScript checking pass; the installed update passes 102 metadata/refusal checks across 59 exact modules. The connected demo also passes all seven stages with explicit synthetic providers. [Evidence](evidence/claude-status-consent-summary.json).

The task adapter now shares the designer's **exact reviewed-version list**. A retained regression showed the old range incorrectly advertised task controls for unreviewed 2.1.309. The correction passes six original groups/94 tests with zero skips, rejecting unknown versions before account inspection, task reservation or launch commands. The installed update passes 102 metadata/refusal checks across 59 exact modules, including rejection before account inspection. [Regression and correction](evidence/claude-version-admission-summary.json).

The pilot CLI is now **2.1.319**. The designer's prior exact-version guard refused
it before reading the account; that refusal is preserved. Source now admits this
exact revision alongside 2.1.308/2.1.317. Six groups/93 tests pass with zero skips,
including fresh approval after version changes and refusal of late designer
replies. Real read-only version/account/inventory/help checks confirm the local
contract and all twelve owned guardian exits. No model prompt or task operation
ran. Normal installed `1bee5a5` passes 101 metadata/refusal checks across 59 exact
modules; its own version/account reader accepts the real 2.1.319 CLI and verifies
both command guardians stopped. All saved state and frozen frontend are preserved.
[Installed compatibility](evidence/installed-claude-version-gate-summary.json).
[Source and native metadata evidence](evidence/claude-319-source-summary.json).

Claude discovery now explicitly reports that the unfinished terminal attachment
launcher is unavailable. The native attach command can restart a stopped session;
it must not be substituted for focus or status. Frontend activation and live
terminal/model acceptance remain separate.

## Earlier Windows package construction failure

The latest package at `db24634` passes **all 462 original groups/2,910 tests, with 246 declared skips**, including the helper-alias assertions. The full receipt independently verifies original commands, bounds, skips and cleanup. Release creation then fails compiling the standalone provider helper: `EditorEndpointSecurity` lacks a local Windows guard, producing CA1416 errors. Two preliminary jobs also fail with HTTP 504 before tests; they have no receipts and remain unaccepted. [Package test-stage evidence](evidence/windows-package-db24634-tests-summary.json).

The method now refuses non-Windows access before native security inspection. The identical local build changes from failure to success with warnings-as-errors retained; the portable self-test and two non-Windows endpoint refusals pass. Eight original groups pass 48 tests with one declared skip. A new early CI preflight publishes the standalone helper using the existing pinned offline toolchain and requires its native self-test before source matrices. All 34 owned build files/561,965 bytes are removed; no packages were downloaded. Native Windows publish and own-process self-test now pass at `7529718`, with exact source/merge tree and QUERY 8 verified. The voice-helper target also compiles offline without new packages; its staging is removed. Full release confirmation subsequently passed at `7529718`, as recorded above. [Native correction](evidence/provider-helper-platform-native-summary.json), [Correction evidence](evidence/provider-helper-platform-source-summary.json).

Complete package runs at `e5a5781` and `6727054` reached the existing 90-minute
job boundary without final receipts. Partial output and preliminary shards do
not count as package acceptance.
[First interruption](evidence/windows-backend-e5a5781-summary.json),
[second interruption](evidence/windows-6727054-full-interruption-summary.json).

The independent complete-source workflow retains every original group across
20 test workers and an ordered assembly worker. Its final audit requires matching
source/tool identities, complete original receipts, unchanged commands/limits/
skips and verified cleanup. Five local groups/45 tests pass.
[Workflow evidence](evidence/complete-windows-source-lane-summary.json).

The first native run at `754660e` found that the packaged TLS scenario needed
compiled provider-host files on its worker. The failed receipt and cleanup are
retained. Correction `646f2c6` puts both original TLS scenarios after the provider
build on the assembly worker; five local groups/45 tests pass. The corrected
native assembly worker passes. Twenty of 21 source workers pass; the remaining
worker fails one native-focus refusal test because the helper retirement record
is unconfirmed. The final collector correctly rejects complete acceptance.
[Dependency correction](evidence/complete-windows-dependency-fix-summary.json),
[retained focus failure](evidence/native-focus-retirement-failure-summary.json).

The package build now requests bounded paired verification: shared builds and
compiled consumers run in order, then at most two independent groups run at once.
Both public test entry points validate the option. Every original group, command,
child bound, skip rule, cleanup check and the 90-minute package limit remain.
Seven focused groups/74 tests pass; five actual backend groups/91 tests also pass
under the paired schedule. Source `90fa879` now completes every one of the 462 package groups in about 61 minutes, within the existing limit. Two native fixture assertions fail: Codex transport initialization and saved editor-helper identity. The original commands, bounds, skips and cleanup verify; package acceptance is withheld. [Original package failure](evidence/windows-package-90fa879-failure-summary.json).

The synthetic provider now works under both CommonJS and module package parents; the old bytes reproduce the disconnect under a module parent. The recovery fixture captures the canonical helper path before ownership in the SUBST build. Three local groups pass 29 tests with five declared Windows skips. Native source `4db5948` now passes both target files: 22 tests, zero skips. Their two complete worker receipts pass 48 groups/328 tests with 15 declared skips and audited commands, bounds, source/tree/tool identities and cleanup. The later alias assertions now pass in the package test stage; full release acceptance still requires the compiler correction. Production transport/recovery checks are unchanged. [Native follow-up](evidence/windows-fixture-native-4db5948-summary.json). [Fixture corrections](evidence/windows-package-fixture-corrections-summary.json), [scheduling evidence](evidence/windows-paired-verification-summary.json).

Focus retirement diagnostics now identify exit versus recording and deadline
versus rejection, without exposing callback messages. Deterministic checks prove
that a pending record is reused and no replacement starts before it finishes.
The original two-second retirement bound remains. Complete native source
`45c34e5` now passes all 460 groups and the final collector, including the focus
contract and new diagnostic tests. This is a scoped passing follow-up; the earlier
failure's root cause is still unresolved.
[Complete native follow-up](evidence/complete-windows-45c34e5-summary.json).

The later `cf3bb4c` run passes the three named project-inventory/Windows-client
groups: 17 tests, zero skips, original bounds and cleanup verified. Its full source
cohort fails a separate unavailable-application settlement observation. The
original two-second observation and 75 ms fixture coordination bound remain;
fixture teardown now always stops its consumers, and a failure reports only
bounded journal kinds/outcome tags. Two local groups/32 tests and TypeScript
checking pass. The production consumer and all deadlines are unchanged; root
cause remains unresolved. The complete native consumer fixture now passes all
15 tests at `90fa879`, with zero skips and verified original bounds/cleanup.
This accepts the scoped follow-up, not a root-cause repair or the full cohort.
[Native project checks](evidence/editor-project-choices-native-summary.json),
[retained settlement failure](evidence/host-action-settlement-diagnostic-summary.json),
[native follow-up](evidence/host-action-settlement-native-followup-summary.json).

The complete `90fa879` source workflow now passes all 462 groups, 2,902 tests
and 246 declared skips. All 21 original receipts match the independently audited
manifest and native collector; all 23 jobs succeeded. This includes project
discovery and the fixture diagnostics, and predates Claude 2.1.319 admission.
The separate Windows package job is still in progress.
[Latest complete native evidence](evidence/complete-windows-90fa879-summary.json).

## Unfinished implementation

- Complete the connected frontend journey and normal installed acceptance of the
  newer scanner, task-permission and execution controls. Guided role/device wiring,
  portable-profile review and editor command registration are implemented; the
  owner approved frontend work. Visual acceptance remains separately blocked.
- Finish exact native task attachment and provider-specific desktop controls where
  supported. Signed saved-project selection and reviewed terminal connection are
  implemented; application focus does not establish task attachment.
- Finish remaining account/task controls through reviewed forms. Signed feed/trust
  installation, revocation, removal and recovery now have connected controls.
  Extend optional external observation sources only within
  explicit session/source/destination/retention consent. Existing five-source
  recording and reviewed aggregate designer context are connected.
- Preserve explicit scanner coverage limits: broader syntax, dependency resolution,
  complete archives, license text, publisher provenance and verified local
  vulnerability context are not established by the bounded scanner. Additional
  scanner syntax must not displace required Rev2 product work.

## Checks needing hardware, accounts or interactive access

| Check | Exact remaining validation |
| --- | --- |
| F77 | Cached VIA 9/Vial 4 and pinned source checks pass. Typing, hotplug and writes are unperformed. Preserve firmware Dvorak and US host input; no new HID/reset/unlock/flash/solenoid operation is authorized in backend checks. |
| B122 and caps | Hardware is unavailable. All 27 physical gates and actual printer/cap fit remain open. F77 evidence cannot accept another device. |
| Microsoft work Copilot | No approved tenant is available. Synthetic Graph checks do not establish tenant, license, account or consent acceptance. |
| Windows desktop/UAC/guest | Headless native CI and guest doubles do not accept ordinary-user interactive journeys. |
| Native provider/task/IDE | No live login changes, model requests or new native task create/resume are authorized during backend checks. Live handoff and controlled account switching remain unaccepted. |
| UI and microphone | Frozen frontend and backend transcription evidence do not establish visual or live microphone acceptance. |

## Retained failures and history

The intermittent restricted-storage retirement failure remains unresolved despite
passing follow-ups. Native phase/error diagnostics are retained; token QUERY mask
8 and process access rights remain unchanged.
[Original failure](evidence/restricted-storage-47c80be-failure-summary.json),
[passing follow-up](evidence/restricted-storage-379-followup-summary.json),
[diagnostics](evidence/runtime-status-diagnostic-source-summary.json).

Earlier [shortcut startup](evidence/windows-shortcut-recurring-timeout-summary.json)
and [fixture startup](evidence/windows-fixture-registry-followup-summary.json)
failures also retain their scoped passing follow-ups. No assertion, skip,
deadline or permission was relaxed to obtain a pass.

The [continuation record](switchyard-continuation.md) preserves operating boundaries
and the next work. Earlier checkpoint details remain in the
[verification record](verification.md), [history index](switchyard-status-history-8.md)
and [status archive at `646f2c6`](https://github.com/SquirmyWormy275/strathex-switchyard/blob/646f2c683696d34096ca268641319b412c2de7af/docs/switchyard-status.md).
