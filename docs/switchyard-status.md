# Switchyard implementation and acceptance

Switchyard gives a Model F keyboard stable controls for returning to tasks,
reviewing work and handing context between tools. It is a **partial implementation
of the October 29 Rev2 suite**. The F77 is the pilot device, not the scope limit.

Start with the [requirement ledger](switchyard-requirements.md) for complete scope,
[verification](verification.md) for source-specific evidence, and the
[continuation notes](switchyard-continuation.md) for current engineering work.

The latest editor implementation connects a reviewed original task to one exact
VS Code Terminal creation. Signed transport binds the workspace, account, task,
owner, endpoint and editor instance. A short-lived, durably consumed permit and
local attempt record prevent automatic retry after lost replies or partial
creation. Executable hash, repository/socket identity and focused context are
rechecked. **Command wiring and native task/account acknowledgement remain
unfinished.** Passing editor/provider doubles does not establish IDE attachment.
[Contract and evidence](coding-task-owners.md#one-reviewed-editor-terminal-creation).

**Windows startup remains a failed software validation.** The cold CNG probe
succeeds under the exact restricted primary token, while Node aborts at
`ncrypto::CSPRNG`, exit 134, before producing an owner result. The import
observation at `164a622` failed earlier in its build wrapper; its original Node
journey did not run. A followup pins the running Node image and retains bounded
build-phase errors. Static imports alone cannot establish the executed OpenSSL
branch. No token, desktop or entropy requirement
has been relaxed. [Native failure](evidence/windows-cold-random-native-summary.json),
[import observation](evidence/windows-node-rng-imports-source-summary.json),
[build failure and followup](evidence/windows-node-import-build-failure-summary.json).

## Latest verified checkpoints

| Checkpoint | Result | Practical limit |
| --- | --- | --- |
| Complete Linux `83d4139` | **244/244 groups; 1,556 passed tests; eleven declared skips.** Every child/tree and exact owned checkout, dependency, build and temporary-parent cleanup verifies. [Receipt](evidence/linux-83d-complete-summary.json). | A new complete run at `1508ea9` is in progress. Later source has focused evidence until that receipt and cleanup verify. |
| Reviewed editor launcher `1508ea9` | Five groups / 54 tests, typecheck, extension build and compiled CommonJS load pass. Generated output is removed. [Evidence](evidence/editor-terminal-launch-summary.json). | Real signed HTTP, encrypted state and Linux leases compose with controlled provider/editor doubles. No actual terminal was launched. |
| Installed Linux `2c87c03` | Six update, ten owner/editor/severity and seven journal checks pass. All 54 workspace identities remain; 52 sealed files are byte-identical across update. Launcher backups and exact bundle cleanup verify. [Evidence](evidence/installed-editor-authorization-summary.json). | The two opened verification workspaces are resealed by existing restart recovery. Definitions/package/modes, historical pending bytes and metadata-check state verify separately. No full semantic before-snapshot was retained. Three signed authorization checks are unknown-owner refusals, with no new permit/task/provider effects. |
| Native Windows `83d4139` | Both cold CNG API forms succeed; token, process/tree, pipe, provider and buffer checks verify. Separate filesystem/setup jobs pass. [Receipt](evidence/windows-cold-random-native-summary.json). | The original restricted Node journey still fails and its fixture is preserved. Cold CNG success does not identify the OpenSSL cause. |
| Windows state leases `ce5be6a` | Eighteen native tests, one declared skip, the Supply Chain scenario and 23 policy-output checks pass. [Evidence](evidence/native-state-lease-ce5-summary.json). | This verifies exact lease boundaries, not complete Windows guest or ordinary-user setup acceptance. |

## Implemented backend capabilities

| Area | Working behavior | Remaining boundary |
| --- | --- | --- |
| Protected state and policy | Compartment-scoped encrypted state, fresh permission reads, bounded OS locks, exact approvals and durable no-replay recovery. [State locks](private-state-locking.md), [receipt authority](receipt-authority-commit.md). | Account and task identity are checked separately from provider availability. |
| Reviewed execution | Linux Run and pipelines use pinned task inputs, native guardians and explicitly reviewed disposable build workspaces. [Execution](reviewed-task-execution.md), [bounded builds](bounded-build-workspace.md). | Complete Windows guest/UAC/ordinary-user journeys remain unaccepted. |
| Repository inspection | Installed read-only CLI; explicit worktree/index/history witnesses and reviewed scanner inputs. [Inspector](inspect-cli.md), [staged scans](staged-shield-inputs.md), [history](historical-shield-inputs.md). | Automatic whole-repository scope and broader history remain unfinished. Observing bytes does not establish a scan. |
| Shield and supply chain | Offline pinned scans, signed rule/advisory feeds, scoped exceptions, CycloneDX inventories, npm and exact Python dependency metadata, CVSS 2.0/3.0/3.1 context. [Scanner](shield-baseline-scanner.md), [Python](python-supply-chain.md), [severity](cvss-severity.md). | Broader ecosystems, publisher provenance, complete coverage and CVSS 4 remain unfinished. |
| Coding tools | Distinct Codex/Claude task APIs, reviewed text and uncertainty handling; separate Microsoft 365 Copilot account/request boundary. [Native coding](native-coding-tasks.md), [Copilot](copilot-request-recovery.md). | Complete task/IDE attachment and live account-switching acceptance remain open. |
| Desktop navigation and observation | Verified native VS Code/ChatGPT focus and separately opted-in workflow metadata. [Focus](native-client-focus.md), [observation](workflow-capture.md). | Native focus does not establish an exact agent task or terminal attachment; broader observation/UI wiring remains unfinished. |
| Packaging and recovery | Versioned application bundles, integrity checks, installation/update/rollback and interrupted-install recovery. [Install](suite-installation.md), [recovery](suite-release-recovery.md). | No public release or merge acceptance is implied. |

## F77 and checks needing another environment or authorization

The F77 previously passed guarded read-only discovery and complete definition,
keymap, macro and settings readout: VIA 9, Vial 4, three 8 × 11 layers and the
pinned `wcass:f77` source definition. Current backend work uses cached evidence.
The source audit verifies 26 files across two builds; it grants **no haptic
operations** and establishes no electrical limits. [Audit](solenoid-capability-audit.md).

| Check | Why it is still unaccepted |
| --- | --- |
| F77 typing, hotplug and physical transactions | The pilot is available; this backend work does not authorize new HID, unlock, writes, flash, reset or solenoid operations. Preserve firmware Dvorak and US host layout. |
| B122 physical gates and cap/print fit | Exact hardware and physical assessment are unavailable. All 27 physical gates remain unaccepted. |
| Microsoft work tenant/account behavior | No approved work tenant is available; local or simulated Graph checks do not establish tenant/license/consent acceptance. |
| Windows guest, interactive UAC and ordinary-user setup | Headless CI software checks do not reproduce the complete user/guest environment. The separate restricted-child software failure is being worked on now. |
| Claude/tmux navigation | The actual CLI stopped at workspace trust. The latest attempt restored focus/workspace and retired owned processes; no override or prompt bypass is authorized. [Evidence](evidence/installed-tmux-trust-boundary-summary.json). |
| Final Home/catalog, role/device controls and voice UI | Frontend bytes are frozen for owner review. Visual acceptance and remaining UI implementation are separate from backend test passes. |

Keep source and small receipts; remove owned successful staging and publish
regular GitHub checkpoints. Preserve the native ChatGPT repair, hidden overlay,
saved artwork and desktop guard. There is no Seagate work in this assignment.

History: [7](switchyard-status-history-7.md), [6](switchyard-status-history-6.md), [5](switchyard-status-history-5.md),
[4](switchyard-status-history-4.md), [3](switchyard-status-history-3.md),
[2](switchyard-status-history-2.md), [1](switchyard-status-history-1.md).
