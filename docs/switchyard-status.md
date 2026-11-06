# Switchyard implementation and acceptance

Switchyard gives a Model F keyboard stable controls for returning to tasks,
reviewing work and handing context between tools. It is a **partial implementation
of the October 29 Rev2 suite**. The F77 is the pilot device, not the scope limit.

Start with the [requirement ledger](switchyard-requirements.md) for complete scope,
[verification](verification.md) for source-specific evidence, and the
[continuation notes](switchyard-continuation.md) for current engineering work.

## Latest verified checkpoints

| Checkpoint | Result | What it establishes |
| --- | --- | --- |
| Complete Linux source `7897835` | **241/241 groups; 1,501 passed tests; ten declared skips.** | Every child/process-tree exit and exact owned fixture, dependency, build and checkout cleanup verifies. [Receipt](evidence/linux-789-complete-summary.json). Later source changes have separate focused evidence. |
| Windows state leases `ce5be6a` | Eighteen native tests pass; one declared Linux-only skip. Supply Chain scenario and all 23 policy-output tests also pass. | The shipped native helper exercises real kernel sharing, replacement/hard-link refusal, malformed release, detached owners and parent loss. Three archive digests and child/tree cleanup verify. [Receipts](evidence/native-state-lease-ce5-summary.json). |
| Windows packaging and scanner directories | Client/package cohort: 73 native tests pass at `5fe6e95`; scanner registry: twenty pass at `ec3afe7`. | Package size and filesystem identity corrections pass their complete focused cohorts. [Package](evidence/windows-fixture-alias-followup-summary.json), [registry](evidence/linux-startup-windows-user-object-summary.json). |
| Installed Linux application `c5d2d28` | Six update/seven metadata checks and fifteen checks each for Supply Chain and Release. | Four actual offline scanner exits, original 54 workspace identities, selection, private endpoint and frozen frontend are restored; owned staging is removed. [Installed receipt](evidence/installed-cvss-context-summary.json). |
| Codex owned Unix task adapter | Three checks against the installed CLI; two account metadata operations, revocation and exact shutdown. | Actual listener/bridge/socket ownership and retirement. No native thread, prompt or login change. Production remains stdio; complete task/IDE composition is unfinished. [Adapter](evidence/codex-unix-task-adapter-summary.json), [readiness correction](evidence/linux-startup-windows-user-object-summary.json). |

**Full Windows acceptance remains failed.** At `7a16bfe`, 58 of 59 filesystem
workflow jobs pass. The detached restricted primary child exits with code 134
and produces no owner result; the prior mode exited with DLL-initialization
status 3221225794. This change is not an accepted repair. Its private desktop and
namespace access probes complete, while the failed fixture is preserved.
[Exact latest failure](evidence/windows-detached-native-summary.json).

The task creator now verifies its own native account, original repository and
exact durable reservation before thread effects, including after asynchronous
setup. Late refusal preserves acknowledged identity and prevents replay. Six
related files pass 81 tests with provider doubles and exact child cleanup; no
native task, prompt or account change was requested.
[Creator boundary evidence](evidence/coding-creator-boundary-summary.json).

The earlier failed complete Linux and Windows runs remain failed. A focused pass
does not replace complete acceptance. [Earlier checkpoints](switchyard-status-history-6.md)
retain the detailed sequence, including original errors and cleanup limits.

## Implemented backend capabilities

| Area | Working behavior | Remaining boundary |
| --- | --- | --- |
| Protected state and policy | Compartment-scoped encrypted state, fresh permission reads, bounded OS locks, exact approvals and durable no-replay recovery. [State locks](private-state-locking.md), [receipt authority](receipt-authority-commit.md). | Account and task identity are checked separately from provider availability. |
| Reviewed execution | Linux Run and pipelines use pinned task inputs, native guardians and explicitly reviewed disposable build workspaces. [Execution](reviewed-task-execution.md), [bounded builds](bounded-build-workspace.md). | Complete Windows guest/UAC/ordinary-user journeys remain unaccepted. |
| Repository inspection | Installed read-only CLI; explicit worktree/index/history witnesses and reviewed scanner inputs. [Inspector](inspect-cli.md), [staged scans](staged-shield-inputs.md), [history](historical-shield-inputs.md). | Automatic whole-repository scope and broader history remain unfinished. Observing bytes does not establish a scan. |
| Shield and supply chain | Offline pinned scans, signed rule/advisory feeds, scoped exceptions, CycloneDX inventories, npm and exact Python dependency metadata, CVSS 3.0/3.1 context. [Scanner](shield-baseline-scanner.md), [Python](python-supply-chain.md), [severity](cvss-severity.md). | Broader ecosystems, publisher provenance, complete coverage and other CVSS versions remain unfinished. |
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

History: [6](switchyard-status-history-6.md), [5](switchyard-status-history-5.md),
[4](switchyard-status-history-4.md), [3](switchyard-status-history-3.md),
[2](switchyard-status-history-2.md), [1](switchyard-status-history-1.md).
