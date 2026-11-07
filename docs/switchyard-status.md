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
| Installed Linux `526c5f2` | **102 metadata/refusal checks; 59 exact module hashes.** All 54 semantic workspaces, four profiles, 57 workflows, selection, pending keyboard-only conversation and frozen frontend preserved. [Evidence](evidence/installed-claude-version-gate-summary.json). | Live task/model/account operations, editor command activation, hardware or microphone acceptance. |
| Complete Linux `cf3bb4c` | **356 groups; 2,326 passing tests; 32 declared skips.** Original manifest, commands, deadlines and cleanup audited. Covers project inventory, connected demo, guided roles, consent fences and paired-runner contracts. [Evidence](evidence/linux-cf3bb4c-complete-summary.json). | Installed `526c5f2` has separate metadata/refusal checks; earlier native Claude metadata acceptance is retained. Native Windows, live accounts, interactive UI and physical devices remain separate. Later fixture diagnostics have their own focused evidence. |
| Complete Windows source `90fa879` | **462 groups; 2,902 passing tests; 246 declared skips.** All 21 original worker receipts and the native collector match; all 23 jobs succeed. Exact source/tree/tool identities, commands, bounds and cleanup verify. [Evidence](evidence/complete-windows-90fa879-summary.json). | Package, live-host and later Claude 2.1.319 admission. Earlier intermittent failures remain unresolved. |
| Native Windows contracts `b38ff759` | **Role/dispatch: 24 tests across two complete files. External-agent consent: 51 tests across three files.** Exact source/merge trees, original bounds and cleanup verified. [Roles](evidence/role-choices-native-b38-summary.json), [consent](evidence/agent-consent-native-b38-summary.json). | Complete Windows suite/package acceptance or live provider behavior. |
| Native Windows client `9d230ac` | **25 groups; 250 tests; zero skips.** Signed launcher composition plus native endpoint/process/socket contracts. [Evidence](evidence/editor-task-choices-native-client-summary.json). | Terminal/provider doubles do not establish interactive task handoff. |
| Earlier complete Windows `dc755901` | **417 groups; 2,478 tests; 207 declared skips.** All workflow jobs passed. [Evidence](evidence/windows-complete-dc755901-summary.json). | This revision predates later backend changes. |

The installed payload contains 554 files/4,749,455 bytes. Dated backup and launcher
readback verify; current plus one rollback remain. Its exact 555-file/4,848,939-byte prepared
bundle is removed. The complete Linux checkout, nine dependency aliases and
803 generated files/11,907,805 bytes are also removed. The latest `cf3bb4c`
checkout, nine aliases and 803 generated files/11,910,385 bytes are removed too;
other worktrees remain.

## Current Claude Code compatibility

Claude status now preserves its native arrival time and original recording consent across delayed ownership/account checks and storage. Two retained regressions exposed recording after same-clock pause/resume and stale status being refreshed by a write delay. Seven groups/113 tests and TypeScript checking pass; installed adoption is pending this source checkpoint. [Evidence](evidence/claude-status-consent-summary.json).

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

## Windows package verification still in progress

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
under the paired schedule. Native package acceptance is pending.
[Scheduling evidence](evidence/windows-paired-verification-summary.json).

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

- Guided role/device wiring, portable-profile review controls, scanner setup
  controls, editor command activation and the complete connected frontend journey.
  Home/catalog and editor activation remain frozen for owner review.
- Guided project selection and task-specific IDE attachment beyond the implemented
  scoped launch/selection contracts, and broader provider containment. The signed
  project inventory backend is implemented; picker activation remains frozen.
  37 groups/117 tests and both TypeScript checks pass.
  [Project inventory](evidence/editor-project-choices-source-summary.json).
- Additional external observation adapters and unsupported scanner coverage:
  broader history and syntax, dependency/feature/target resolution, complete
  archive contents, license text, publisher provenance and verified local
  vulnerability context. The ledger records these limits; additional scanner
  syntax must not displace the required Rev2 product work.

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
