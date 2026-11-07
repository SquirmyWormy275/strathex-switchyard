# Switchyard implementation and acceptance

Switchyard gives Model F keyboards guided setup and stable controls for returning
to tasks, reviewing changes and handing work between tools. **The full Rev2 suite
is not finished.** The F77 is the pilot device; it does not limit the assignment.

Start with the [README](../README.md) for the product and first run, the
[requirement ledger](switchyard-requirements.md) for scope, and the
[verification record](verification.md) for source-specific evidence.
Work is published on [draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20).
No merge or public release has been accepted.

## Current checkpoints

Windows native-focus dispatch now enforces the persisted selected workspace
policy before validating a request UUID or entering platform-specific dispatch.
The original native client run at `02cc6ba` failed one of 93 tests; the same
failure was reproduced locally. Both Linux and Windows paths now refuse Work
requests with missing, malformed or valid UUIDs, including attempts to name a
Personal compartment. All final effect-boundary checks remain. Twenty-eight
focused groups pass 165 tests with one declared Linux skip; typecheck, original
bounds and child/tree cleanup verify. Actual Windows follow-up acceptance remains
pending. [Native failure](evidence/windows-client-02cc6ba-failed-summary.json),
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

Selected npm archives now retain their own bounded license declaration, assessed
only after matching integrity and embedded identity. Lockfile and archive policy
remain independent; disallowed obligations fail and unresolved coverage remains
explicit. Sixteen focused groups pass 146 tests, including eight actual Linux
npm archive journeys and eight Windows guest doubles. Typecheck, original bounds,
commands, skips and child/tree cleanup verify; owned staging is removed.
Installed `b6f788b` passes 74 metadata/in-memory checks with all 54 semantic
workspaces and the frozen frontend preserved. Actual Windows execution remains
separate. [Installed evidence](evidence/installed-npm-archive-license-summary.json).
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

Complete Linux `97ef7d6` passes **322 groups, 1,965 tests and sixteen declared
skips**, with zero failures/cancellations. Original commands, bounds, skip
inventory and every child/tree retirement verify. The owned checkout, nine
dependency aliases, 782 generated files (11,785,816 bytes), empty temporary parent
and marker are removed; other worktrees remain. This includes Cargo array tables
and the Windows ChatGPT service tested through doubles. Later VS Code focus and
Cargo archive changes have separate focused evidence. A temporary wrapper syntax
failure occurred before any test and is retained in the record.
[Complete receipt](evidence/linux-97ef7d6-complete-summary.json).

| Checkpoint | Completed result | What it does not establish |
| --- | --- | --- |
| Complete Linux `97ef7d6` | **322 groups, 1,965 passing tests, sixteen declared skips**; exact original inventory, commands, bounds and cleanup. [Receipt](evidence/linux-97ef7d6-complete-summary.json). | Later VS Code focus and Cargo archive changes have separate focused evidence. |
| Complete Windows `dc755901` | **417 groups, 2,478 passing tests and 207 declared skips**; all six jobs and the overall workflow succeed, with exact packet/source/merge inventory, bounds and cleanup. [Receipt](evidence/windows-complete-dc755901-summary.json). | Predates wheel RECORD, five-job scheduling, Cargo archive and workflow/profile/observation corrections. Interactive Windows acceptance remains separate. |
| Installed Linux `b6f788b` | 74 metadata/in-memory checks and 22 exact module hashes, including 112 Cargo reference cases, eight Cargo archive/license reports and eight npm archive policy reports. All 54 semantic workspaces, selection, pending conversation and frozen frontend are preserved. [Receipt](evidence/installed-npm-archive-license-summary.json). | No live scanner, provider task, agent command, account action, model request or hardware operation is performed. |
| Complete Linux `39db1fe` | **Failed:** 313/314 groups, 1,910 passing tests, sixteen declared skips and one failed scheduling-budget assertion. Exact owned cleanup verifies. [Receipt](evidence/linux-39db1fe-scheduling-failed-summary.json). | A nearly passing run is not complete acceptance. |

Complete Linux aafb476 passes **317 groups, 1,923 tests and sixteen declared
skips**, with zero failures/cancellations. The exact original manifest, commands,
deadlines and skip inventory verify, along with every child/tree retirement.
The owned checkout, nine dependency aliases, 782 generated files (11,766,823
bytes), empty temporary parent and marker are removed; all other worktrees
remain. This checkpoint includes wheel RECORD and five-shard scheduling
changes and predates Cargo archive identity and the workflow-ID correction.
[Complete receipt](evidence/linux-aafb476-complete-summary.json).

The installed update verifies a dated backup and launcher readback. It retains
current plus one rollback and removes the exact 531-file, 5,186,925-byte prepared
bundle. Fifty-three sealed workspace files are byte-identical; one changes only
audit metadata. It preserves the repaired native ChatGPT main window, hidden
overlay, saved artwork and workstation guard.

## What is implemented

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

## Latest changes and limits

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

Workflow editing now rejects non-string role/step IDs and repeated dependency
edges before persistence. Two regressions reproduce the previous acceptance of
malformed JSON identities; four focused groups/72 checks now pass, including
unchanged encrypted profile, bindings and history after refusal. Read-only
compatibility checks accept all 57 saved workflows across 54 workspaces and
preserve all 54 sealed files byte-for-byte. Typecheck, original package bounds
and exact cleanup pass. Installed workflow correction acceptance now passes five additional metadata
checks; native Windows acceptance remains separate.
[Installed evidence](evidence/installed-profile-identity-summary.json). [Source and compatibility evidence](evidence/workflow-identity-source-summary.json).

Python wheels now receive bounded ZIP/metadata identity checks and supported
SHA-256/384/512 RECORD member comparisons without extraction or execution.
Thirty independent RECORD reference cases and thirty focused groups yield
147 distinct passes, including six actual Linux scans and six Windows guest
doubles. Package HTTP readback, all sixteen installation/recovery scenarios and
the original package budget pass. Installed Python metadata checks pass; native
Windows RECORD acceptance remains separate.
[Contract](python-wheel-records.md), [source evidence](evidence/pypi-wheel-record-source-summary.json).

Cargo host admission refuses omitted unresolved dependency, license and source
gaps. Six groups/46 checks pass, including four actual Linux artifact journeys
and four Windows guest doubles. Eight Cargo metadata checks pass in the installed
54-check update. [Source evidence](evidence/cargo-inventory-verifier-source-summary.json).

Selected Cargo archives now receive bounded gzip/USTAR manifest identity checks.
A matching declared checksum cannot hide a different embedded name or literal
version. Thirteen focused groups yield **132 distinct passes**, including six
actual Linux scans, six Windows guest doubles and 26 independent Python
TOML/USTAR/gzip cases. Host/BOM binding, source-separated findings, original
Git/files, replay refusal and exact cleanup verify. The original package bound,
typecheck and five verifier guards pass. The first composed run failed one
timeout-inventory assertion; registering the two new files in the original
integration class resolves it, with no existing deadline extended. No extraction,
Cargo invocation, build, dependency resolution or publisher verification occurs.
Installed metadata acceptance passes ten Cargo checks inside the 56-check update;
native Windows and live installed scanner archive acceptance remain unperformed.
[Installed receipt](evidence/installed-cargo-archive-summary.json).
[Archive contract](cargo-archive-identity.md),
[source evidence](evidence/cargo-archive-source-summary.json).

The Windows backend scheduler now uses five jobs for all 207 groups, preserving
the original group objects, child bounds, twenty-minute job limits and 950-second
estimated-workload ceiling. Historical placement estimates about 799 seconds per
job; three groups/35 checks pass. Native acceptance remains pending.
[Scheduling evidence](evidence/windows-five-shards-source-summary.json).

## Unfinished implementation

- Remaining guided role/device wiring, editor command activation and frontend
  exposure. Home/catalog and command activation are frozen for owner review.
- Broader Shield syntax and coverage, dependency/feature/target resolution,
  complete archive and license-text inspection, publisher provenance and
  verified local vulnerability context.
- Broader external observation streams and remaining portability, controller
  and conversation work identified in the [requirement ledger](switchyard-requirements.md).
  One passing adapter does not complete the corresponding suite requirement.

## Failed or unaccepted software checks

These are engineering or verification issues, separate from unavailable hardware
and accounts.

- The older complete Linux `49a5053` retry failed four builds and one permission
  fixture. The pinned-Node launch and explicit fixture mode corrections are
  implemented; the later `39db1fe` run passes those checks but fails scheduling.
  Both original failures and exact cleanup remain recorded.
  [Linux failure](evidence/linux-49a5053-failed-summary.json).
- Windows shortcut startup intermittently reaches its original bound. The
  confirmed cleanup race is repaired and has native acceptance; subsequent
  passing diagnostics do not establish the startup cause or stability.
  [Cleanup](evidence/shortcut-writer-native-summary.json),
  [recurring failures](evidence/windows-shortcut-recurring-timeout-summary.json).
- Windows fixture-registry `2ab67fc` reaches the original five-second Python
  startup bound. Its unchanged `39db1fe` follow-up passes all twenty tests.
  Cause remains unknown; separate cancelled PyPI/OSV jobs contribute no accepted
  checks. [Failure and follow-up](evidence/windows-fixture-registry-followup-summary.json).
- Newer native Windows results require their own exact final receipts. Queued
  runs, cancellations and partial output do not count as acceptance.

## Checks requiring hardware, accounts or interactive access

| Check | Exact boundary |
| --- | --- |
| F77 physical behavior | Cached VIA 9/Vial 4 readout and pinned `wcass:f77` source checks pass. New typing, hotplug and write/readback checks remain unperformed. No new HID, unlock, reset, flash, bootloader, solenoid or electrical operation is authorized here. Preserve firmware Dvorak and US host input. |
| B122 hardware and cap fit | Hardware is unavailable; all 27 physical gates remain open. |
| Microsoft work Copilot | No approved work tenant is available. Synthetic policy/Graph checks cannot establish tenant, license or account acceptance. |
| Windows ordinary-user/UAC/guest behavior | Headless native CI and guest doubles do not accept these interactive journeys. Restricted storage ownership separately passes all eight original checks with QUERY mask 8. |
| Native provider/task/IDE interaction | No live login changes, model requests or new native task create/resume are authorized during this backend work. The Claude/tmux attempt stopped at trust and retired its owned processes. Installed Codex 0.167.0 remains outside the reviewed 0.166.0 gate. |
| Home/catalog and microphone interaction | Frozen frontend bytes and backend transcription tests do not establish visual or live microphone acceptance. |

[Continuation notes](switchyard-continuation.md) preserve operating constraints
and the next work. Detailed historical results remain in the
[verification record](verification.md), [history index](switchyard-status-history-8.md)
and [the preceding status checkpoint](https://github.com/SquirmyWormy275/strathex-switchyard/blob/9a71cf1572d49fc934fc43a5abc8b48c3a8364a9/docs/switchyard-status.md).
