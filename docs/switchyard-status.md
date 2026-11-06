# Switchyard implementation and acceptance

Switchyard gives a Model F keyboard stable controls for returning to tasks,
reviewing work and handing context between tools. It is a **partial implementation
of the October 29 Rev2 suite**. The F77 is the pilot device, not the scope limit.

Start with the [requirement ledger](switchyard-requirements.md) for complete scope,
[verification](verification.md) for source-specific evidence, and the
[continuation notes](switchyard-continuation.md) for current engineering work.

The latest Windows environment observation confirms both Windows directory variables are present and correct, with no OpenSSL override or Node options. The cold restricted child still aborts in cryptographic initialization; this is an unresolved native software failure, not unavailable hardware. [Observed failure](evidence/windows-environment-native-summary.json).

The complete `83d4139` Linux run passes **244/244 groups, 1,556 tests and eleven declared skips**, with every child/tree and exact owned checkout, dependency, build, temporary parent and marker cleanup verified. Later editor authorization has separate five-group/59-test evidence. [Full run](evidence/linux-83d-complete-summary.json), [authorization](evidence/editor-authorization-summary.json).

The backend now prepares an exact editor target only from an acknowledged load on its original live owner. Fresh socket/alias/process checks refuse a replaced endpoint even when the old metadata bridge survives. Four groups / 75 checks pass with cleanup and typecheck. This grants no terminal authority or IDE attachment; the read-only signed editor metadata consumer now passes six groups / 63 checks. Command wiring, terminal creation and native attachment acknowledgement remain unfinished. [Contract](coding-task-owners.md#prepare-an-exact-editor-target).

The cold native CNG probe at `83d4139` passes both API forms under the exact restricted primary token. Its token recheck, process/tree/pipe retirement, provider closure and buffer clearing verify. Node still aborts at `ncrypto::CSPRNG` before JavaScript, exit 134; the failed fixture is preserved. This narrows the investigation beyond a universal cold BCrypt access failure, without identifying the OpenSSL cause or claiming a repair. [Native evidence](evidence/windows-cold-random-native-summary.json).

The signed editor review/issue/consume client now reaches the protected backend with strict instance and selection binding. Cancellation after durable consumption leaves the authorization spent. Focused cohorts, typecheck and compiled extension checks pass; actual terminal creation and native acknowledgement remain unfinished. [Evidence](evidence/editor-authorization-client-summary.json).

Installed source `2c87c03` passes six update, ten owner/editor/severity and seven journal checks. Three signed authorization routes refuse unknown ownership without effects. All 54 workspace identities remain; 52 sealed files are byte-identical across the update. The two opened verification workspaces are resealed by existing restart recovery; their definitions/package/modes pass comparison, and selected bytes remain unchanged during metadata checks. The historical pending conversation stays byte-identical. Dated launcher backups verify and temporary packaging is removed. [Installed evidence and failed extra assertions](evidence/installed-editor-authorization-summary.json).

The reviewed editor launcher now composes signed authorization with one exact Terminal creation. Five groups/54 tests cover context drift, executable/socket replacement, duplicate calls, partial creation and shutdown joins; extension build and compiled loading pass. Provider/editor effects use doubles. Command wiring and native task/account acknowledgement remain unfinished. [Evidence](evidence/editor-terminal-launch-summary.json).

Windows CI now records four fixed RNG import-presence flags for its exact Node image, using the existing `dumpbin` tool and matching image digests. Two groups/19 tests pass; native observation is pending. Static imports do not establish the executed OpenSSL branch or repair the existing CSPRNG failure. [Source evidence](evidence/windows-node-rng-imports-source-summary.json).

## Latest verified checkpoints

| Checkpoint | Result | What it establishes |
| --- | --- | --- |
| Complete Linux source `83d4139` | **244/244 groups; 1,556 passed tests; eleven declared skips.** | Every child/process-tree exit and exact owned fixture, dependency, build and checkout cleanup verifies. [Receipt](evidence/linux-83d-complete-summary.json). Later source changes have separate focused evidence. |
| Windows state leases `ce5be6a` | Eighteen native tests pass; one declared Linux-only skip. Supply Chain scenario and all 23 policy-output tests also pass. | The shipped native helper exercises real kernel sharing, replacement/hard-link refusal, malformed release, detached owners and parent loss. Three archive digests and child/tree cleanup verify. [Receipts](evidence/native-state-lease-ce5-summary.json). |
| Windows packaging and scanner directories | Client/package cohort: 73 native tests pass at `5fe6e95`; scanner registry: twenty pass at `ec3afe7`. | Package size and filesystem identity corrections pass their complete focused cohorts. [Package](evidence/windows-fixture-alias-followup-summary.json), [registry](evidence/linux-startup-windows-user-object-summary.json). |
| Installed Linux application `e768d18` | Six update checks, nine owner/editor/severity checks and seven existing journal checks. | All 54 workspace identities, selected sealed bytes, private endpoint and frozen Home are preserved. Dated launcher backups verify and temporary bundle is removed. No native task or provider starts. [Receipt](evidence/installed-editor-metadata-summary.json). |
| Codex owned Unix task adapter | Three checks against the installed CLI; two account metadata operations, revocation and exact shutdown. | Actual listener/bridge/socket ownership and retirement. No native thread, prompt or login change. Production remains stdio; complete task/IDE composition is unfinished. [Adapter](evidence/codex-unix-task-adapter-summary.json), [readiness correction](evidence/linux-startup-windows-user-object-summary.json). |

**Full Windows acceptance remains failed.** At `7a16bfe`, 58 of 59 filesystem
workflow jobs pass. The detached restricted primary child exits with code 134
and produces no owner result; the prior mode exited with DLL-initialization
status 3221225794. This change is not an accepted repair. Its private desktop and
namespace access probes complete, while the failed fixture is preserved.
[Exact latest failure](evidence/windows-detached-native-summary.json).

The native child at `8c6f91a` identifies a cryptographic random initialization
assertion: `ncrypto::CSPRNG`, source `node.cc:1221`. It still exits 134 with no
owner result. All three standard pipe handles close, but its underlying Windows
random-source failure remains unconfirmed. [Exact failure](evidence/windows-random-assertion-native-summary.json).

A fixed CNG diagnostic now compares native status codes under the original and
restricted tokens, closing explicit provider handles and clearing buffers. It
compiles in both managed targets; 1,856 portable checks and twenty focused
registry/report tests pass with cleanup and typecheck. Native execution at `a9cefaf` captures success for both CNG API forms under both tokens, yet the cold restricted Node child still fails. This parent-process observation is not a startup repair. [Native receipt](evidence/windows-random-access-native-summary.json).
The registry also refuses retirement of a substituted saved owner.
[Source and evidence](evidence/random-access-owner-retirement-summary.json).

The accepted complete Linux `370c21e` checkpoint includes the corrected CI dependency
guard and shutdown joins for active polls, deadlines and managed input release.
All exact owned checkout/dependency/build cleanup verifies; its marker is removed.
The preceding failed `efbaa52` run remains failed. [Correction](evidence/execution-shutdown-summary.json).

The subsequent complete **`359a825` run passes 242/242 groups**, 1,534 tests
and eleven declared skips. Its private temporary parent uses available storage
without changing mount rules, quota settings, deadlines or assertions. Every
child/tree and exact temporary parent, checkout, alias, build and marker cleanup
verifies. [Complete acceptance](evidence/linux-2eeb-complete-summary.json). Later
Studio owner-route composition has separate 91-test and forty-case evidence.

The complete `a9cefaf` run is **failed: 236/242 groups**, 1,508 passed tests,
thirteen failed tests and eleven declared skips. All six failing groups report
Linux `EDQUOT` during fixture writes/copies; `/tmp` has per-user quotas. Every
child/tree and the exact owned checkout, dependency aliases, builds and marker
were removed after exit verification. No broad cleanup or quota change occurred.
Use a fresh explicitly owned temporary root on available storage for the next
complete run. [Failed receipt](evidence/linux-a9c-quota-failure-summary.json).

Normal Studio now composes the owner/load service through authenticated routes
with exact request fields and active-workspace checks. Selection, keyboard-only
mode, individual stop and application close retire original owners and join loads.
Private owner/load records are omitted from generic snapshots. Six files pass
91 tests; the final HTTP/privacy cohort passes forty, with cleanup and typecheck.
The provider is controlled; real loading, installed acceptance, frontend wiring
and authenticated IDE/terminal handoff remain open. [Routed evidence](evidence/routed-task-load-summary.json).

Reviewed loading on the original owned task connection is now implemented as an
explicit backend operation. One-use policy-bound review, durable no-replay
reservation, idle-state checks, repeated effect boundaries and joined shutdown
pass 62 tests across five files. An actual Unix listener/bridge loads a synthetic
task with a controlled provider; no real task or model turn is requested.
The separate owner/load routes are now connected; installed acceptance and IDE attachment remain unfinished.
[Load contract](coding-task-owners.md), [evidence](evidence/reviewed-owned-task-load-summary.json).

The explicit protected task-owner service now persists original task/account/
repository/listener identities and refuses duplicate or foreign-host adoption.
Five related files pass 76 tests; final eight registry/five package checks pass
with exact cleanup and typecheck. An actual Unix listener/bridge composes with a
controlled provider double. The 242-group `359a825` run passes as recorded above. The owner/load routes have separate composition evidence above; frontend and IDE attachment remain unfinished.
[Owner contract](coding-task-owners.md), [evidence](evidence/coding-task-owner-summary.json).

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

History: [6](switchyard-status-history-6.md), [5](switchyard-status-history-5.md),
[4](switchyard-status-history-4.md), [3](switchyard-status-history-3.md),
[2](switchyard-status-history-2.md), [1](switchyard-status-history-1.md).
