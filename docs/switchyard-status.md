# Switchyard implementation and acceptance

Windows `701f915` still fails after reading lock input, before the new canonical-path
progress marker; the parent-watch correction is therefore not an accepted fix
for that failure. The next source change resolves an existing Windows lock path
and verifies the same bigint file identity and local drive before native dispatch.
Native path guards remain unchanged. Five groups/52 passes/one Windows-only skip
and typecheck pass; native acceptance is pending.
[Retained failure and source correction](evidence/windows-canonical-lock-source-summary.json).

Editor workflow history now passes **seven groups / 84 tests**. Explicit Personal
consent records four lifecycle states in the same encrypted journal transaction,
with private correlation, pause/exclusion fences and no live attachment or
completion claim. Actual Linux carriers and controlled provider/terminal checks
verify cleanup; typecheck passes. Frontend, installed and native acceptance remain
separate. [Contract](editor-workflow-observation.md),
[evidence](evidence/editor-workflow-observation-summary.json).

Windows `1fc9d7f` clears copied-helper metadata and console initialization:
both EOF probes now reach entry and retire exact owned trees. Ordinary owner
checks (8), restricted metadata (13) and native exchange (31) pass. The original
restricted owner still fails during lock initialization after reading input,
with zero of eight checks. Both imported artifact digests verify.
[Native result](evidence/windows-pipe-native-summary.json).

The `701f915` source correction removes an unnecessary full-process-access request
from the parent watcher. It pins one handle with only birth-query and exit-wait
rights, retaining parent-loss cleanup and all original token restrictions.
Two managed builds/1,985 portable checks and five groups/49 passes/one declared
Windows-only skip pass. The original restricted owner still fails before the parent watcher; the previous receipt
does not establish the exact post-input failure cause.
[Source evidence](evidence/windows-lease-parent-source-summary.json).

Windows release 97a7727 also failed because its archived test source omitted
the native state-lock helper; the lease test reports ENOENT.
The builder now compiles that helper from the pinned snapshot before tests,
copies verified bytes into an absent destination and includes its build directory
in exact cleanup. Four portable groups / 42 checks pass; native follow-up is
pending. This staging omission is separate from restricted-token startup.
[Failure and source correction](evidence/windows-archived-helper-summary.json).

Cargo inventory and advisory matching now support bounded prerelease/build
versions and u64 core numbers. **Nine groups / 94 tests** and **146,326 independent
Rust SemVer comparisons** pass, including actual Linux scans and Windows guest
doubles. The Windows CI matrix has an independent Cargo lane. Typecheck and exact
owned cleanup pass. Broader syntax, resolution, licenses and provenance remain
unfinished; installed and native guest acceptance are separate.
[Contract](cargo-supply-chain.md), [current evidence](evidence/cargo-semver-summary.json),
[earlier TOML checks](evidence/cargo-supply-chain-summary.json).

The retained Terminal launcher now reaches the restricted connection through the
signed client and Suite. **Six groups / 46 tests** pass, including one owned
synthetic terminal process through actual protected state and Linux carriers:
exact PID/image, one task acknowledgement, duplicate refusal, retained focus and
verified retirement. Typecheck, compiled extension and twelve CommonJS methods
pass; exact test/build cleanup verifies. Production command activation and native
TUI/0.167.0 acceptance remain open. [Demonstration](evidence/editor-terminal-connection-summary.json).

Latest complete Linux `701f915` passes **260/260 groups, 1,713 tests,
eleven declared skips and zero failures**. Every owned child/tree, checkout,
dependency alias, build and temporary parent is verified retired. It includes
editor lifecycle history, retained Terminal composition, exact retirement and
Cargo prerelease/build matching. Later Windows path correction has separate
focused evidence. [Complete result](evidence/linux-701-complete-summary.json).

A later exact stop now accepts the protected retirement record when terminal
disconnect has already completed backend cleanup. Five groups / 39 tests verify
immutable duplicate stop, refusal of substituted identities and launcher shutdown
after actual synthetic terminal exit. [Evidence](evidence/editor-retired-stop-summary.json).

The signed editor connection and typed client now pass **seven groups / 96 tests**.
The routed demonstration uses real protected state and Linux carriers with a
synthetic provider/terminal. Workspace, keyboard-only and shutdown cleanup joins
before original-owner retirement; uncertain exit preserves the relevant refusal.
Typecheck, compiled extension and CommonJS client checks pass, and generated build
output is removed. Retained Terminal composition has later focused evidence;
command activation remains unfinished. [Routing evidence](evidence/editor-routing-summary.json).

Earlier complete Linux `072e066` passes **252/252 groups, 1,649 tests,
eleven declared skips and zero failures**. Every child/tree and the exact owned
checkout, dependencies, builds and temporary parent are retired.
[Complete result](evidence/linux-072-complete-summary.json).
It includes the restricted editor relay and synthetic carrier demonstration.
The later protected journal, composition and recovery have separate focused evidence; the earlier
`7772cb3` socket-cleanup failure remains retained.

Windows `700e7f2` reaches the console comparison: the hidden-console helper
fails before entry; detached startup reaches its fixed entry marker with the same
token restrictions and explicit Job containment. Both owned trees retire.
The unchanged restricted Node journey still fails at private-state initialization;
the ordinary eight-check journey and separate filesystem/setup jobs pass.
[Native result](evidence/windows-lease-console-native-summary.json).
The earlier stale verifier inventory failure remains retained.

The composed editor lifecycle and crash recovery pass **six groups / 64 tests**,
including abrupt loss of an owned synthetic host, exact stale-socket retirement,
preservation of foreign files and acknowledgement withdrawal on terminal disconnect.
Real encrypted state and Linux carriers are exercised with provider/editor doubles.
Signed routes and retained Terminal composition have later evidence. Production
command activation and native TUI compatibility remain unfinished or unaccepted. [Recovery evidence](evidence/editor-recovery-summary.json).

The installed Codex CLI is now **0.167.0**. Offline schema generation succeeds and
its scratch files are removed; the reviewed adapter still refuses versions other
than **0.166.0**. Runtime compatibility has not been accepted.
[Static-only check](evidence/codex-0167-static-summary.json).

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
rechecked. **Production command wiring remains unfinished; native TUI/account/task
acceptance remains open.** Passing editor/provider doubles does not establish IDE attachment.
[Contract and evidence](coding-task-owners.md#one-reviewed-editor-terminal-creation).

**Windows restricted Node now starts, but the owner journey still fails.**
At `a061be0`, query-only access to each owned child token makes both cold legacy
random providers succeed. Duplicate/impersonation access remains denied; the
original ACEs and token restrictions verify. The unchanged pinned Node reaches
JavaScript and reports exit 2 at `private-state-initialize`, before any of its
eight owner checks. This is failed software validation, not a hardware/account
blocker. The original failed fixture is preserved. [Native evidence](evidence/windows-self-query-native-summary.json). The
later `71614e0` diagnostic identifies the exact state-lock helper exiting with
`0xC0000142` during startup before its first worker marker; the DLL/resource
remains unknown. [Latest failure](evidence/windows-state-lock-native-summary.json).

The earlier `78b640d` CSPRNG exit 134 remains recorded as failed historical
evidence. Static imports did not prove the executed OpenSSL branch.
[Historical result](evidence/windows-node-rng-imports-native-summary.json).

At `a37751c`, the legacy-first native probe reports **Access Denied (Win32 error
5)** from `CryptAcquireContextW` before generation. Later CNG calls succeed.
Source/merge identity, artifact digest and token/process/pipe/buffer cleanup
verify; Node still exits 134 and its failed fixture is preserved. The exact
denied resource remains unidentified; the later lookup comparison is below.
[Native evidence](evidence/windows-cold-legacy-random-native-summary.json).

The editor launcher returns to its exact retained terminal while the original
task is idle or active. A separate signed read requires that editor's consumed
authorization and current owner/load/account/repository/socket/policy. It grants
no new launch and leaves the protected journal unchanged. Five groups / 60 tests,
typecheck and compiled extension checks pass with provider/editor doubles.
[Evidence](evidence/editor-active-return-summary.json).

At `47a49c8`, both user and machine default-provider lookups succeed and identify
the Strong provider. Default and explicitly named Enhanced-provider opens still
return Access Denied; subsequent CNG succeeds. The exact denied resource is
unknown, and original Node startup remains failed. Source/digest and native
cleanup evidence verify. [Native result](evidence/windows-provider-lookup-native-summary.json).

CVSS 4 scoring and collector support now match 463,204 independent reference
cases. Six groups / 58 tests include actual Linux scanner execution, Windows
guest doubles and package/notice verification. Supplied context cannot clear a
base finding. Normal installed metadata/offline acceptance also passes. [Evidence](evidence/cvss-v4-summary.json).

Native V4 at `32eba3c` observes Access Denied from all three self-token handle
requests, including query-only access, under the original restricted primary.
Source/merge/archive identity and native cleanup verify. The original Node
failure remains; a provider's exact failing operation is still unproved.
[Native evidence](evidence/windows-self-token-native-summary.json). Native
`d900499` descriptor readback shows only Administrators, SYSTEM and logon ACEs,
with no allow entry for the four restricting identities. The direct query denial
is explained; the later query-only correction passes native ACL and random-startup checks, with private-state initialization now the failing phase. [Correction source](evidence/windows-self-query-source-summary.json). [Readback](evidence/windows-token-security-native-summary.json).

The editor launcher can now observe the exact retained terminal's kernel PID,
process birth and original executable identity while rechecking its consumed
selection. Three groups / 38 tests and compiled extension checks pass with owned
synthetic processes and provider/editor doubles. Actual connection/account/task
acknowledgement remains unfinished. [Evidence](evidence/editor-process-summary.json).

The earlier standalone protocol witness verifies account samples around the
exact resume reply and invalidates on drift or replay. Its initial three groups /
33 tests remain separate evidence. It is now composed with the restricted relay
and peer-verified carriers described above; the witness alone grants no forwarding
or attachment authority. [Earlier evidence](evidence/editor-protocol-summary.json).

## Latest verified checkpoints

| Checkpoint | Result | Practical limit |
| --- | --- | --- |
| Complete Linux `0ad510e` | **255/255 groups; 1,682 passed tests; eleven declared skips.** Every child/tree and exact staging cleanup verifies. [Receipt](evidence/linux-0ad-complete-summary.json). | Journal, recovery, signed routes and Suite transitions. Later Terminal, retired-stop and Cargo changes have separate focused evidence. |
| Earlier complete Linux `072e066` | **252/252 groups; 1,649 passed tests; eleven declared skips.** Every child/tree and exact staging cleanup verifies. [Receipt](evidence/linux-072-complete-summary.json). | Includes the restricted relay and synthetic real-carrier demonstration. Later journal implementation and native IDE/account/hardware acceptance remain separate. |
| Earlier complete Linux `d243d81` | **251/251 groups; 1,633 passed tests; eleven declared skips.** Every child/tree and exact staging cleanup verifies. [Receipt](evidence/linux-d243-complete-summary.json). | Includes signal-safe ingress and its parent lifecycle. Does not cover later Windows console diagnostics or live IDE/account/task attachment. |
| Earlier complete Linux `d900499` | **248/248 groups; 1,600 passed tests; eleven declared skips.** Every child/tree and exact owned checkout, dependency, build and temporary-parent cleanup verifies. [Receipt](evidence/linux-d900-complete-summary.json). | Includes exact terminal process observation and token-security diagnostic source. Later protocol witness and query-only correction have separate focused evidence. |
| Reviewed editor launcher `1508ea9` | Five groups / 54 tests, typecheck, extension build and compiled CommonJS load pass. Generated output is removed. [Evidence](evidence/editor-terminal-launch-summary.json). | Real signed HTTP, encrypted state and Linux leases compose with controlled provider/editor doubles. No actual terminal was launched. |
| Installed Linux `5a2c324` | Six normal update, eleven owner/editor/severity and seven journal checks pass. All 54 semantic snapshots excluding audit match; 52 sealed files remain byte-identical. Launcher backups and exact bundle cleanup verify. [Evidence](evidence/installed-cvss4-summary.json). | Two verification workspaces receive only the expected recovery/journal audit entries. Offline CVSS 4 keeps critical base severity despite zero supplied environment scores. No live task/provider effects or activated editor. |
| Earlier installed Linux `2c87c03` | Six update, ten owner/editor/severity and seven journal checks pass. All 54 workspace identities remain; 52 sealed files are byte-identical across update. Launcher backups and exact bundle cleanup verify. [Evidence](evidence/installed-editor-authorization-summary.json). | The two opened verification workspaces are resealed by existing restart recovery. Definitions/package/modes, historical pending bytes and metadata-check state verify separately. No full semantic before-snapshot was retained. Three signed authorization checks are unknown-owner refusals, with no new permit/task/provider effects. |
| Native Windows `78b640d` | Exact Node import flags and cold CNG success are observed; token, process/tree, pipe, provider and buffer checks verify. Separate filesystem/setup jobs pass. [Receipt](evidence/windows-node-rng-imports-native-summary.json). | Original Node still exits 134 with no owner result; the failed fixture is preserved. The later legacy-first probe identifies Access Denied; the exact denied operation and Node repair remain open. |
| Windows state leases `ce5be6a` | Eighteen native tests, one declared skip, the Supply Chain scenario and 23 policy-output checks pass. [Evidence](evidence/native-state-lease-ce5-summary.json). | This verifies exact lease boundaries, not complete Windows guest or ordinary-user setup acceptance. |

The internal Linux editor ingress now checks one exact terminal peer before
WebSocket upgrade and carries bounded JSON frames. Eleven lifecycle/wire tests,
five package checks and typecheck pass, including a synthetic account/task
witness. The parent lifecycle also passes eight behavior cases and five package checks,
with cancellation/cleanup joined and uncertainty retained. Later protected ownership, signed routes and retained Terminal composition now
pass focused checks. Production command activation and real IDE attachment remain
unfinished or unaccepted. [Carrier](evidence/editor-ingress-summary.json),
[parent lifecycle](evidence/editor-ingress-owner-summary.json).

## Implemented backend capabilities

| Area | Working behavior | Remaining boundary |
| --- | --- | --- |
| Protected state and policy | Compartment-scoped encrypted state, fresh permission reads, bounded OS locks, exact approvals and durable no-replay recovery. [State locks](private-state-locking.md), [receipt authority](receipt-authority-commit.md). | Account and task identity are checked separately from provider availability. |
| Reviewed execution | Linux Run and pipelines use pinned task inputs, native guardians and explicitly reviewed disposable build workspaces. [Execution](reviewed-task-execution.md), [bounded builds](bounded-build-workspace.md). | Complete Windows guest/UAC/ordinary-user journeys remain unaccepted. |
| Repository inspection | Installed read-only CLI; explicit worktree/index/history witnesses and reviewed scanner inputs. [Inspector](inspect-cli.md), [staged scans](staged-shield-inputs.md), [history](historical-shield-inputs.md). | Automatic whole-repository scope and broader history remain unfinished. Observing bytes does not establish a scan. |
| Shield and supply chain | Offline pinned scans, signed rule/advisory feeds, scoped exceptions, CycloneDX inventories, npm and exact Python dependency metadata, CVSS 2.0/3.0/3.1/4.0 context. [Scanner](shield-baseline-scanner.md), [Python](python-supply-chain.md), [severity](cvss-severity.md). | Broader ecosystems, publisher provenance, complete coverage and verified local-context assessment remain unfinished. |
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
