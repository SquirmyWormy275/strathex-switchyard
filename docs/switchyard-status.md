# Switchyard implementation and acceptance

Switchyard gives Model F keyboards guided setup and stable controls for returning
to tasks, reviewing changes and handing work between tools. **The full Rev2 suite
is not finished.** The F77 is the pilot device; it does not limit the assignment.

Start with the [README](../README.md) for the product and first run, the
[requirement ledger](switchyard-requirements.md) for scope, and the
[verification record](verification.md) for detailed evidence. Work is published
on [draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20).
No merge or public release has been accepted.

## Current evidence

Each result belongs to its exact source revision. Test totals from different
checkpoints are not cumulative acceptance of the latest suite.

| Checkpoint | Verified result | Limit |
| --- | --- | --- |
| Installed Linux `b320506` | **76 metadata/in-memory checks; 34 exact module hashes.** All 54 semantic workspaces and frozen frontend preserved. [Receipt](evidence/installed-scanner-recipe-save-summary.json). | No live scanner, provider task, account/model request, native focus or hardware operation. |
| Native Windows client `4f56477` | **Seven groups; 94 passing tests; no skips.** Source/merge tree, artifact digest, commands, bounds and child/tree cleanup verified. [Receipt](evidence/windows-client-4f56477-passed-summary.json). | Client contracts only; interactive focus and complete Windows release acceptance are separate. |
| Complete Linux `d09645a` | **326 groups; 2,013 passing tests; sixteen declared skips.** Original inventory, commands, bounds and owned cleanup verified. [Receipt](evidence/linux-d09645a-complete-summary.json). | Includes wheel-license and staged/historical preparation; predates scanner-draft assembly. |
| Complete Windows `dc755901` | **417 groups; 2,478 passing tests; 207 declared skips.** All six jobs and overall workflow passed with verified packet/source/cleanup. [Receipt](evidence/windows-complete-dc755901-summary.json). | Predates newer archive, scheduling, profile/workflow and observation corrections. |

Complete Linux `d09645a` has zero failures or cancellations. Every original
command, deadline, declared skip and child/tree retirement verifies. The owned
checkout, nine dependency aliases, 788 generated files (11,803,414 bytes), empty
test parent and marker are removed; other worktrees remain. This includes the
read-only index correction. Scanner draft/save functionality has later focused and installed evidence.

The latest installation includes 17 wheel license-header cases, 112 Cargo
manifest reference cases, and eight in-memory policy reports for each of wheels,
Cargo archives and npm archives. All four saved profiles and 57 workflows remain
compatible. Selection and the pending keyboard-only conversation are preserved;
53 sealed workspace files are byte-identical and one changes only audit metadata.
Dated backup and launcher readback verify. Only current plus one rollback remain;
the exact 536-file, 4,677,752-byte prepared bundle was removed. Lossless template
storage reduces the package payload to 4,581,074 bytes without changing exports.

## Recent backend changes

- **Reviewed scanner setup saving:** the authenticated Linux backend now reviews,
  saves and recovers exact generated controls. A real demonstration saves through
  this API before fresh authority and execution review. Thirty-five focused groups
  pass 221 tests, including interrupted-save recovery and all installation cases.
  The package stays below its original 5 MiB limit with lossless template storage
  and identical exports. Windows saving and frozen frontend controls remain
  unfinished. [Contract](scanner-recipe-saving.md),
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
- Broader Shield syntax, reviewed draft installation/mixed-source history coverage, general
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
| Windows ordinary-user/UAC/guest behavior | Headless CI and guest doubles do not accept interactive journeys. Restricted storage ownership separately passes its original checks with TOKEN_QUERY mask 8. |
| Native provider/task/IDE interaction | No live login changes, model requests or new native task create/resume are authorized during backend checks. The Claude/tmux attempt stopped at trust and retired its processes. Installed Codex 0.167.0 remains outside the reviewed 0.166.0 gate. |
| Home/catalog and microphone interaction | Frozen frontend and backend transcription evidence do not establish visual or live microphone acceptance. |

## Retained failures and unresolved causes

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
