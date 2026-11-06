# What has actually been verified

Complete Linux `7e45654` finishes **305/306 groups**, with 1,783 accepted tests
and sixteen declared skips. The combined artifact file exceeds its original
120-second deadline; no partial plan from that group is accepted. Every child
and process tree exits, and the exact owned checkout, nine dependency aliases,
782 generated files and temporary parent are removed. Three other worktrees
remain unchanged. The published `55515d1` split retains every assertion and
deadline, passes focused checks and is undergoing a separate complete rerun.
[Failed run and cleanup](evidence/linux-7e45654-timeout-summary.json).

Independent native `f7fda6b` reaches pipe creation, reports 15 parser checks,
and fails descriptor readback before fields are observed. The 36-check proof
remains failed and the original restricted owner never starts. Bounded buffer-
length observation retains the existing guards. A separate Windows task-owner
job now selects all 26 original scenarios under their original bounds. Thirty
focused groups pass 67 tests with one Windows-only skip; two managed builds and
2,101 portable checks pass. [Native failure](evidence/private-pipe-readback-failed-summary.json),
[source receipt](evidence/pipe-buffer-and-task-source-summary.json).

The `25f07e9` pipe candidate is **failed**, not accepted: ordinary native setup
preflight stops after the PE check, before pipe-proof or restricted-owner checks.
Its exact worker-start substage was not retained. Readback observation now runs
independently after failed preflight, with all original assertions preserved;
35 focused tests, five Windows-only skips, two managed builds and 2,101 portable
checks pass. [Failure](evidence/private-command-pipes-preflight-failed-summary.json),
[source correction](evidence/private-pipe-readback-source-summary.json).

The private-command-pipe candidate passes 69 focused tests with five Windows-only
skips, two clean managed builds and 2,101 portable checks. It opens only the
primary token with QUERY mask 8, creates three pipes with one exact owner entry,
verifies six handle descriptors and compares unchanged default-DACL bytes.
Thirty-six native checks are added but unaccepted until Windows executes them.
The original owner remains 0/8. [Contract](windows-private-command-pipes.md),
[source receipt](evidence/private-command-pipes-source-summary.json).

Native Windows `d15285b` also passes all eight suspended-worker and creation-
refusal checks without skips, including absent-cwd error 267, no execution,
independent Job exit and unchanged malformed/overdue acknowledgement refusals.
[Native receipt](evidence/worker-start-refusal-native-summary.json).

Complete Linux `dad5400` passes **281 groups / 1,776 tests / fifteen declared
skips / zero failures**. All owned children, checkout, nine aliases, 782 generated
files and the run marker were removed; unrelated worktrees remain preserved.
[Complete receipt](evidence/linux-dad-complete-summary.json).

Native Windows `d15285b` identifies the original owner's next denial precisely:
**CreatePipe / stdin / error 5**, after guardian readiness and its start
acknowledgement. No suspended worker is registered; original owner acceptance
remains **0/8**. This identifies the failed API, not the denied descriptor rule.
[Native receipt](evidence/worker-start-native-summary.json).


Native Windows `dad5400` verifies the guardian self-birth correction: readiness
and the original start acknowledgement complete. One guardian and two status
helpers verify exact QUERY-mask-8 registration; no suspended worker is registered.
The original owner remains **0/8**, failing at
`probe-identity-committed-worker-exit`. Broader failed-fixture cleanup is not
claimed. [Native receipt](evidence/guardian-self-birth-native-summary.json).
A bounded worker-start failure frame now identifies only the fixed pipe,
attribute, process-create or worker-identity stage and its numeric API error.
It grants no permissions and cannot establish execution or cleanup. Seven
focused groups pass **69 tests / five Windows-only skips**, two managed builds
and **2,101 portable checks** pass, and typecheck/owned cleanup verify.
Actual Windows acceptance remains pending.
[Source receipt](evidence/worker-start-observation-source-summary.json).


Native Windows `dbbcce8` finishes all four preliminary backend jobs within
their twenty-minute limits: **170/171 groups accepted**, with 971 passing tests
and 135 declared skips from completed plans. The remaining task-owner file
reaches its original 45-second child deadline after 22 partial pass reports;
no cases from that incomplete plan are accepted. The previously failing native
state-lock group now passes ten tests with one Linux-only skip.
[Native receipts](evidence/windows-backend-dbbc-native-summary.json).
All 26 independent task-owner cases now have exact manifest entries and their
original 45-second child bound; the two Linux-only skips remain explicit.
The test file and production code are unchanged. Thirty focused groups pass
**66 tests / one declared Windows-only skip**, including every task-owner case
once. Native follow-up remains pending.
[Source receipt](evidence/task-owner-scenarios-source-summary.json).


Native Windows `cff471e` verifies the first guardian's exact QUERY-mask-8
allowance and reaches `probe-identity-created-native-self-birth`. That later
phase establishes that named Job creation/configuration cleared, but the
original owner remains **0/8**; worker and status registration were not exercised.
[Retained native evidence](evidence/windows-descendant-query-native-summary.json).
The next correction reads the guardian's creation time through Windows' current-
process pseudo handle, preserving the original birth format and permissions.
The coordinator now checks liveness through `GetExitCodeProcess`, because exit
time is undefined for a live process. Nine focused groups pass **87 tests / four
Windows-only skips**; two managed builds and **2,101 portable checks** pass.
Native acceptance of this correction remains pending.
[Source evidence](evidence/guardian-self-birth-source-summary.json).

Complete Linux `dbbcce8` is **failed**: 280 groups, 1,770 passed tests,
fifteen declared skips and two fixture write failures caused by `/tmp` user
quota exhaustion. An exact owned 18-byte write probe confirmed `EDQUOT` and was
removed. Socket fixtures now honor the isolated temporary directory, keeping the
same socket path limit. The focused recovery tests pass. All owned test children,
checkout, nine aliases and 782 generated files were retired; a corrected complete
run remains pending. [Failed run and cleanup](evidence/linux-dbbc-failed-summary.json).


A CI-only candidate now applies the existing QUERY-only token allowance to
exact descendants of the original restricted owner. Job membership, process
birth, pinned image, original restrictions and exact mask-8 readback are required.
The original two cold/Node observations, eight owner checks and ninety-second
deadline remain. Nine focused groups pass **88 tests / four declared Windows-only
skips**, a final 45-test follow-up passes, and two managed builds verify **2,101
portable checks** (30 new parser cases). Typecheck and owned cleanup pass.
Native acceptance is pending; the original owner remains **0/8**.
[Contract](windows-descendant-query.md), [source receipt](evidence/windows-descendant-query-source-summary.json).

The complete Linux run at `d551ccf` is **failed**: 278 groups, 1,767
passed tests, eleven declared skips and one crash-fixture failure. EOF cleanup
could remove the socket before the fixture substituted it. The corrected fixture
holds the exact carrier before abrupt host loss; 42 recovery/ingress tests pass.
All children, the temporary checkout, nine dependency aliases and 782 generated
files were removed. A corrected complete run remains pending.
[Failed run](evidence/linux-d551-failed-summary.json).

Windows `b600a6d` also remains a **failed complete release**. Its preliminary
backend exceeded twenty minutes and reported one lease-case failure without a
complete plan; later steps continued by design. The release build then refused
the non-scalar `TestPythonPath` argument before starting. Source now assigns all
171 preliminary backend groups exactly once across four isolated jobs, retaining
every declared child bound and a twenty-minute limit per job. Python is selected
directly from the pinned setup action, preserving version/hash/reparse checks.
The scheduling/harness/lease follow-up passes 39 tests with one Windows-only
skip; native scheduling and the reported lease failure remain unaccepted.
[Retained failure](evidence/windows-b600-release-failed-summary.json),
[correction](evidence/release-scheduling-recovery-summary.json).

Independent Windows `b600a6d` runtime installation, 49-package imports and offline
CPU model load/recheck pass, with its temporary runtime removed.
[Runtime receipt](evidence/windows-runtime-b600-native-summary.json).
This does not accept the failed backend batch or complete release.

An optional Windows worker acknowledgement now holds the exact process suspended
while its owner registers PID, birth and executable hash. Callback refusal,
cancellation and malformed or overdue acknowledgement cannot authorize execution.
Seven focused groups pass **82 tests / four declared Windows-only skips**;
27 harness follow-up tests, two managed builds, 2,071 portable proof checks,
typecheck and owned cleanup pass. Actual Windows `7dd2c36` now passes all six
native acknowledgement tests without skips. [Native receipt](evidence/windows-suspended-worker-native-summary.json).
This step grants no permissions and does not repair the original
restricted owner, which remains **0/8**.
[Contract](windows-worker-acknowledgement.md), [source evidence](evidence/windows-suspended-worker-source-summary.json).

Selected Python artifact comparison now supports exact requirements pins and
multiple declared SHA-256 alternatives through Supply Chain and Release. Fourteen
behavior/harness groups pass 98 checks; the initial packaging guard correctly
fails at 1,006 bytes above 5 MiB. Removing three implementations reached only
through erased types from the app bundle restores it to **5,096,071 bytes**;
their repository source remains unchanged. The corrected packaging, application,
sixteen installation cases and Python execution follow-up passes **19 groups /
37 tests**, with typecheck and exact cleanup. Six actual Linux and six Windows
guest-double scans retain original bytes and receipts. Native Windows host `d551ccf` now passes nine tests with two declared
Linux-only skips and verified cleanup under the original 300-second bound;
the guest remains doubled. [Native receipt](evidence/python-artifact-windows-native-summary.json).
[Contract](python-artifact-integrity.md), [evidence](evidence/python-artifact-integrity-summary.json).

Native Windows `b600a6d` now passes all sixteen original installation/recovery
cases exactly once, with unchanged assertions, original 120-second child bounds
and verified child/tree cleanup. The earlier timeout and local zero-plan attempt
remain failed evidence. The complete Windows release subsequently failed as recorded above; restricted
owner acceptance remains separate and failed.
[Native installation receipt](evidence/installation-scenarios-native-summary.json).

Native Windows `c367dff` also passes nine Cargo artifact tests with two declared
Linux-only skips under the original 300-second bound. The guest remains doubled.
[Cargo native receipt](evidence/cargo-artifact-windows-native-summary.json).

Installation scheduling now uses sixteen exact case names, each in its own
bounded child, with the original 120-second child limit and six-minute CI step.
The original test file and production code are unchanged. Nineteen groups /
48 tests pass, including every installation case exactly once and exact cleanup.
An initial regex-selector attempt selected no cases and correctly failed; that
receipt is retained. Native Windows scheduling acceptance now passes all sixteen cases; see the receipt above.
[Scheduling evidence](evidence/installation-scenarios-source-summary.json).

Windows `7e5c495` also retains a separate installation-group timeout: fifteen
case reports succeeded before the original 120-second deadline, but there was no
complete TAP plan, so the group is failed with zero accepted cases. The earlier
`3363e8b` sixteen-case acceptance remains source-specific. Independent-case scheduling now passes native acceptance above. This is a CI failure, not unavailable hardware.
[Timeout evidence](evidence/windows-installation-timeout-summary.json).

Selected Cargo artifact-byte comparison is implemented through reviewed Supply
Chain and Release execution. Exact package/version/source binding, mismatch
findings, receipt replay and cleanup pass fifteen groups / 105 tests and a
21-test manifest-alias follow-up; typecheck passes. Four actual Linux scans and
four Windows guest-double runs preserve original bytes/index/HEAD. Native Windows host acceptance now passes nine tests and two declared Linux skips;
publisher/archive-content verification remains open.
[Contract](cargo-artifact-integrity.md), [evidence](evidence/cargo-artifact-integrity-summary.json).

Native `7e5c495` now compares the same pinned cold image with and without
the existing self-query allowance. Without it, self-query, legacy CryptoAPI and
Local/Global named Job creation receive error 5; anonymous Job creation and CNG
still succeed. The original child with its existing allowance succeeds in all
three Job namespaces. Both cold children verify token restrictions, exit and
handle cleanup. The actual guardian remains denied and the original owner stays
**0/8**. No new rights were granted; broader failed-fixture cleanup is not claimed.
[Paired native receipt](evidence/windows-unmodified-cold-native-summary.json).

Source `0a0dd11` passes the complete Linux manifest: **261 groups, 1,745
passed tests, eleven declared skips, zero failures**. Every owned child/tree,
temporary checkout, nine dependency aliases and 782 generated files (11,766,655
bytes) were retired. This includes the npm artifact-byte comparison and guardian
failure reporting. Installed and hardware/account acceptance remain separate.
[Linux receipt](evidence/linux-0a-complete-summary.json).

Native `0a0dd11` confirms the actual failed guardian also receives error 5 from
its own `OpenProcessToken` call with QUERY mask 8. The original restricted owner
remains 0/8. This does not yet identify the exact process/token DACL or prove which
internal access caused Job creation to fail.
[Exact native evidence](evidence/windows-guardian-query-native-summary.json).

The next CI-only comparison runs the same cold image once without its existing
self-query allowance, then preserves the original cold and Node checks unchanged.
It grants no additional rights and cannot satisfy the original self-query/owner
assertions. Six groups / 79 tests, two managed builds / 2,071 portable checks,
typecheck and owned cleanup pass. Paired native execution is recorded above; the owner remains failed.
[Source evidence](evidence/windows-unmodified-cold-source-summary.json).

The artifact-scanner lane at `f0aacab` now passes **eight tests / two declared
Linux-only skips on actual Windows**, with its original 300-second bound and
verified cleanup. The guest remains explicitly doubled.
[Windows artifact evidence](evidence/npm-artifact-windows-native-summary.json).

The failing guardian now performs one read-only self-token access observation
only after `CreateJobObjectW` returns error 5: `OpenProcessToken` requests
`TOKEN_QUERY` (mask 8) against its own pseudo-process handle, then closes any
returned handle. It neither grants access nor reads token/account information.
The optional closed failure field reports only opened/error/close status; older
frames remain accepted. CI projects fixed query-result suffixes while retaining
original refusal, uncertain exit and all eight owner checks.

Six groups / 79 tests, two managed builds / 2,071 portable checks and typecheck
pass. All 124 owned build files (3,240,871 bytes) and test staging are removed.
Native 0a0dd11 now confirms self-query denial; see the later comparison above.
[Evidence](evidence/windows-guardian-query-source-summary.json).

Selected npm artifact comparison now joins the existing reviewed Supply Chain
and Release paths. It compares raw bytes with one canonical SHA-512 declaration,
retains high failed mismatch findings, and keeps archive contents/publisher
identity and the complete Shield gate unverified. Thirteen groups / 89 tests are
accepted across behavior and corrected inventory checks, including six actual
Linux and six Windows guest-double scans; typecheck and owned cleanup pass.
Native Windows host follow-up passes eight tests / two declared Linux skips; guest execution remains doubled. [Contract](npm-artifact-integrity.md),
[evidence](evidence/npm-artifact-integrity-summary.json).

Windows `ad4d5e6` builds and executes the cold native probe. Its restricted child
with the existing TOKEN_QUERY-only allowance successfully creates/query-closes
empty anonymous, Local and Global Jobs. Original token/RNG and cleanup checks
pass. The actual setup-identity guardian still fails Job creation with error 5;
the difference in descendant context remains unresolved. No broader access or
fallback is enabled. [Native evidence](evidence/windows-cold-job-native-summary.json).

Source `3363e8b` passes the complete Linux manifest: **260 groups, 1,734
passed tests, eleven declared skips, zero failures**. Every owned child/tree,
temporary checkout, nine dependency aliases and 782 generated files (11,766,655
bytes) were retired. Installed and hardware/account acceptance remain separate.
[Linux receipt](evidence/linux-336-complete-summary.json).

The same source passes **five application and sixteen installation/recovery
tests on actual Windows**, with the same-source helper and original deadlines.
The complete Windows release, including isolated Python prerequisite verification,
is still pending. The restricted-owner Job creation failure remains open.
[Native lifecycle receipts](evidence/windows-336-lifecycle-native-summary.json).

A CI-only cold-process probe now observes anonymous, Local and Global empty Job
creation after all original RNG/token checks. It grants no rights, assigns no
process and changes no production fallback. Six groups / 78 tests, two managed
builds / 2,071 portable checks, typecheck and owned cleanup pass. Native C++
execution now confirms all three empty-Job cases while the original owner still fails. [Contract](windows-job-observation.md),
[source evidence](evidence/windows-cold-job-source-summary.json).

Windows `fb265e7b` proves `CreateJobObjectW` fails with Win32 error 5 before
setup-identity readiness. The original restricted owner remains 0/8. Do not
infer whether its object DACL or namespace caused denial and do not add broader
token/process/default-DACL/SID/privilege/account permissions or a runtime fallback.
[Native evidence](evidence/windows-guardian-job-native-summary.json).

The complete older Windows release `1fc9d7f` fails four groups (eight tests).
Two Python-dependent checks lack Python on the isolated PATH; native application
and recovery fixtures still bundle inert helper text. The source now admits one
explicit existing, version/hash-checked Python 3.13.3 test executable and bundles
the exact-source helper for actual Windows lifecycle tests. Eight groups / 113
tests plus 29 lane/package follow-up checks, typecheck and exact test cleanup
pass on Linux. Source 3363e8b now passes both native application and installation
lanes with every original check and deadline; the complete release remains pending.
[Original failure](evidence/windows-release-1fc-failure-summary.json),
[corrections](evidence/windows-release-prerequisite-summary.json).


The Windows guardian now reports only fixed pre-readiness startup phases, with
API-specific numeric codes for Job create/configure failures. The host preserves
refusal and all ownership checks; it does not turn diagnostic output into exit
or execution acceptance. Six groups / 78 tests, two managed builds / 2,006
portable checks, typecheck and exact owned cleanup pass. Native fb265e7b
identifies the Job-creation error described above. [Contract](windows-helper-startup.md),
[evidence](evidence/runtime-startup-observation-summary.json).

## npm prereleases and native Windows probe result

Collector 8 now accepts bounded literal npm SemVer including prerelease/build
identities; scanner and host report validation share that grammar. Twelve groups
/ 101 tests, typecheck, 556 independent grammar cases and 276,676 node-semver
precedence comparisons pass. Linux actual execution and Windows guest doubles
join collected synthetic advisories to signed feeds and protected receipts, with
original bytes/index/HEAD preserved and owned staging/processes retired.
The first local group selector stopped before staging because a Windows file
expands to multiple manifest groups; the selector was corrected.
[Contract](npm-semver.md), [evidence](evidence/npm-semver-summary.json).

Native Windows `6f2097b` now reports `probe-identity-created-worker-exit`,
after protected initialization and mode update. The exact setup-identity command
guardian is created but exits before readiness. Its 4,260-byte archive hash and
source/merge tree verify; no archive is retained locally. Original owner 0/8
remains failed, while ordinary owner 8, restricted metadata 13 and restricted
exchange 31 pass. This identifies the command boundary, not its underlying
managed operation or a new permission requirement.
[Native artifact evidence](evidence/windows-owner-probe-native-summary.json).

## Windows read-only probe observation

The native 4faa8a1 owner clears private state and mode update but fails its
read-only storage probe. The CI proof now delegates unchanged native operations
through fixed phase observation: reconcile/identity/capability, command startup,
child registration, ready callback and completed ownership persistence. Only
known fixed error categories are retained, with an unknown refusal fallback.
Original exceptions, assertions and protected failed fixtures are preserved.
Five isolated groups / 60 tests, typecheck and every child/tree cleanup pass.
The existing managed and JavaScript bounded phase projection accepts these
labels; no managed protocol or production runtime change is made. Native
follow-up is pending. [Evidence](evidence/windows-owner-probe-observation-summary.json).

Windows `4faa8a1` clears restricted private-state initialization and mode update.
Its version 2 native lease tests pass **24 checks / one declared skip**, including
EOF, contention, partial input, non-pipe input refusal and parent-loss cleanup.
The restricted owner now fails later at the read-only storage probe, still zero
of eight complete owner checks. [Native result](evidence/windows-lease-pipe-native-summary.json).

Shield now supports exact declared license-and-exception pairs in signed policy.
Seven groups / 59 tests plus a 26-test engine follow-up, typecheck and exact
cleanup pass. Actual Linux scans and Windows guest doubles keep base-only and
different-exception permissions distinct; no legal or publisher verification is
claimed. [Evidence](evidence/license-exception-declaration-summary.json).

Windows `da28b5c` identifies the restricted failure as **Access Denied opening the
parent process**. The next source protocol binds worker lifetime to its private
inherited input pipe instead of that lookup. It checks EOF while idle, reading
partial frames, holding a lease and waiting for a lock, with one reader and no
new process/token rights. File identity, sharing, sequencing, Job containment and
the original eight owner assertions remain. Two managed builds / 2,006 portable
checks, five groups / 53 passes / one Windows-only skip and typecheck pass; native
acceptance is pending. [Failure and source](evidence/windows-lease-pipe-owner-source-summary.json).

Native Windows `f653827` passes both lease groups: **24 checks, one declared
Linux-only skip**, and every child/tree cleanup verifies. The separate restricted
owner still fails zero of eight checks. Its managed projection omitted the new
progress labels; that reporting gap is now corrected and all ten emitted labels
are tested through the managed projection. Two builds / 1,995 portable checks and
exact staging cleanup pass. The precise restricted-parent failure remains unknown
until the native follow-up. The client and policy workflows at `f653827` pass.
[Retained failure, native lease pass and projection correction](evidence/windows-parent-projection-summary.json).

Windows `fea2ca4` now clears canonical-path acceptance, then fails before the
parent-process check completes; the original restricted owner still passes zero
of eight checks. Ordinary owner (8), restricted metadata (13) and native exchange
(31) continue to pass. New fixed diagnostics distinguish parent open/query failures
without changing rights or containment. Two managed builds / 1,985 portable checks,
five groups / 53 passes / one Windows-only skip and typecheck pass.
A separate native lease test reached a stale diagnostic-label assertion, now
corrected to require the exact full sequence. Both failed receipts are retained;
the native follow-up is pending.
[Current Windows evidence](evidence/windows-parent-observation-summary.json).

Agent, host-action and editor recording now refuse metadata from before initial
consent or the latest resume. The encrypted interval stays monotonic across
duplicate resume and backward clock movement. Nine isolated groups / 105 tests,
typecheck and exact child/tree cleanup pass. Existing event history is retained;
no live account, native task or frontend operation runs.
[Recording-boundary evidence](evidence/observation-window-summary.json).

Windows `701f915` still fails after reading lock input, before the new canonical-path
progress marker; the parent-watch correction is therefore not an accepted fix
for that failure. The next source change resolves an existing Windows lock path
and verifies the same bigint file identity and local drive before native dispatch.
Native path guards remain unchanged. Five groups/52 passes/one Windows-only skip
and typecheck pass; native acceptance is pending.
[Retained failure and source correction](evidence/windows-canonical-lock-source-summary.json).

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

Editor workflow history now passes **seven groups / 84 tests**. Explicit Personal
consent records four lifecycle states in the same encrypted journal transaction,
with private correlation, pause/exclusion fences and no live attachment or
completion claim. Actual Linux carriers and controlled provider/terminal checks
verify cleanup; typecheck passes. Frontend, installed and native acceptance remain
separate. [Contract](editor-workflow-observation.md),
[evidence](evidence/editor-workflow-observation-summary.json).

Latest complete Linux `701f915` passes **260/260 groups, 1,713 tests and eleven
declared skips**, with every child/tree and exact owned checkout/build cleanup
verified. It includes editor lifecycle history, retained Terminal composition,
exact retirement and Cargo prerelease/build matching.
[Receipt](evidence/linux-701-complete-summary.json). The later Windows path
correction has separate focused evidence.

Cargo inventory and advisory matching now support bounded prerelease/build
versions and u64 core numbers. **Nine groups / 94 tests** and **146,326 independent
Rust SemVer comparisons** pass, including actual Linux scans and Windows guest
doubles. The Windows CI matrix has an independent Cargo lane. Typecheck and exact
owned cleanup pass. Broader syntax, resolution, licenses and provenance remain
unfinished; installed and native guest acceptance are separate.
[Contract](cargo-supply-chain.md), [current evidence](evidence/cargo-semver-summary.json),
[earlier TOML checks](evidence/cargo-supply-chain-summary.json).

Earlier complete Linux `7772cb3` **failed**: 249/250 groups, 1,622 passed tests,
one failure and eleven declared skips. An editor socket remained after child
exit during teardown. Exact staging and every child/tree cleanup are verified.
Signal-safe cleanup and parent lifecycle passed 26 focused checks; subsequent
complete runs pass, including the current `701f915` checkpoint above.
[Failure and correction](evidence/linux-777-complete-failure-summary.json).

Native Windows `a061be0` clears the original random-startup abort with query-only
access to the owned child token. Original ACL entries/restrictions and denied
duplicate/impersonation checks verify. The same Node image reaches JavaScript,
then fails private-state initialization (exit 2, zero owner checks). Separate
filesystem/setup jobs pass. The failed fixture is preserved; the whole owner
journey remains unaccepted. [Source-bound artifact](evidence/windows-self-query-native-summary.json).

Installed `5a2c324` passes six update, eleven owner/editor/severity and seven
journal checks. All 54 non-audit semantic snapshots match the fixed-clock
preflight; 52 sealed files are identical, and two have only expected recovery
audit additions. Dated launcher backups and exact bundle cleanup verify.
Offline severity and signed unknown-owner refusals do not establish live task
or editor attachment. [Installed evidence](evidence/installed-cvss4-summary.json).

CVSS 4 source support matches 463,204 independently generated/reference-compared
vectors. Six groups / 58 tests, typecheck and exact source/build cleanup pass;
actual Linux scanner and Windows guest-double evidence remain distinct from
installed acceptance. [Evidence](evidence/cvss-v4-summary.json).

Earlier focused backend checkpoint: the exact consumed-editor return path supports
idle and active original tasks without another launch/resume. Five groups / 60
tests, typecheck, compiled extension load and owned cleanup pass with controlled
provider/editor doubles. [Evidence](evidence/editor-active-return-summary.json).
Windows V3 provider lookup at `47a49c8` is now observed natively: both lookups
succeed, both provider opens return Access Denied, and original Node remains
exit 134. [Native evidence](evidence/windows-provider-lookup-native-summary.json).

Switchyard is a partial implementation of the full Rev2 suite. The F77 is its
pilot device. Software checks, installed Linux demonstrations, native Windows
filesystem tests and physical/account acceptance are separate evidence.

Earlier isolated editor transport source passed eleven Linux lifecycle/wire tests and five
package checks, plus typecheck. Exact peer, deadline, parent loss and substituted
socket cases verify with synthetic processes; a retained shutdown traceback
failure is corrected and rerun. That checkpoint predates the later composed lifecycle and retained Terminal checks.
[Evidence](evidence/editor-ingress-summary.json). Native Windows `71614e0` isolates
the remaining owner failure to its state-lock helper startup (`0xC0000142`), with
no first worker marker. [Native failure](evidence/windows-state-lock-native-summary.json).

Earlier accepted complete Linux evidence at `d900499`: **248/248 groups, 1,600 passed
tests and eleven declared skips**, with every child/tree and exact owned checkout,
dependency, build and temporary-parent cleanup verified. It includes the exact
editor process observer and Windows token-security diagnostic source. Later
protocol-witness and query-only correction source has separate focused evidence.
[Complete run](evidence/linux-d900-complete-summary.json).

The earlier native cold CNG probe succeeded under the original restricted primary
token; Node still aborts at CSPRNG with exit 134. This is a failed software
validation, not an unavailable-hardware check.
[Exact Windows result](evidence/windows-cold-random-native-summary.json).

| Path | Accepted evidence | Practical limit |
| --- | --- | --- |
| Installed owner metadata `4b5e3cc` | Six normal update checks, seven owner-route metadata/refusal checks and seven existing metadata checks pass. Original 54 workspaces, selected sealed bytes/private endpoint/frozen Home and dated launcher hashes verify; temporary bundle removed. [Receipt](evidence/installed-task-owner-summary.json). | Zero native provider starts, task loads, model turns or hardware operations. Actual loading and IDE attachment remain separate acceptance. |
| Complete Linux `74d0d04` | 242/242 groups; 1,529 passed tests and eleven declared skips. Every child/tree and exact owned temporary parent, checkout, dependency alias, build and marker cleanup verifies. [Receipt](evidence/linux-74d-complete-summary.json). | Later Studio owner-route composition has separate focused evidence; Windows, installed, hardware and account acceptance remain distinct. |
| Routed owned task loading | Six files/91 tests, then final two-file/forty-case HTTP/privacy cohort pass. Actual authenticated HTTP, encrypted state and one-use review; provider doubled. Typecheck and child/tree cleanup verify. [Evidence](evidence/routed-task-load-summary.json). | Separate backend routes are connected; real loading, installed acceptance, frontend and exact IDE/terminal handoff remain open. |
| Complete Linux `a9cefaf` — failed | 236/242 groups, 1,508 passed tests, thirteen failed tests and eleven declared skips. All six failed groups report `EDQUOT` during writes/copies. Child/tree and exact checkout cleanup verifies. [Receipt](evidence/linux-a9c-quota-failure-summary.json). | This failed run is retained; the subsequent `74d0d04` run passes using an explicitly owned temporary parent on available storage. No deadline or assertion relaxation. |
| Reviewed owned task loading | Five files/62 tests including fifteen registry cases; actual Unix listener/bridge with a controlled provider; typecheck and all child/tree cleanup pass. [Evidence](evidence/reviewed-owned-task-load-summary.json). | Production routing, live loading, installed acceptance and IDE handoff remain open. No model turn or task completion claim. |
| Native RNG observation `a9cefaf` | Digest-verified receipt: both fixed RNG API forms succeed under restricted and original impersonation. All diagnostic handles/buffers and child standard pipes retire. [Receipt](evidence/windows-random-access-native-summary.json). | Cold restricted Node still aborts at CSPRNG, exit 134/no result; the failed fixture remains preserved. Parent observations do not prove a repair. |
| CNG diagnostics and exact owner retirement | Both managed builds, 1,856 portable checks and twenty registry/report tests pass, with typecheck and exact cleanup. [Evidence](evidence/random-access-owner-retirement-summary.json). | Native status capture has separate evidence above; child startup remains failed. Owner registry has separate reviewed loading evidence, without IDE attachment. |
| Complete Linux `370c21e` | 241/241 groups, 1,509 passed tests and eleven declared skips; all child/tree and owned checkout cleanup verifies. [Receipt](evidence/linux-370-complete-summary.json). | Later 242-group task-owner source has focused evidence only; Windows/hardware/accounts remain separate. |
| Protected task metadata owners | Five files/76 tests, then final eight registry/five package cases pass with cleanup and typecheck. Actual listener/bridge composes with a controlled provider double. [Evidence](evidence/coding-task-owner-summary.json). | Explicit metadata-only service; task loading, authenticated IDE attachment and normal installed routing remain unfinished. |
| Native restricted child assertion `8c6f91a` | Digest-verified artifact identifies `ncrypto::CSPRNG` at `node.cc:1221`; all standard handles close. [Failed receipt](evidence/windows-random-assertion-native-summary.json). | Exit 134/no owner result persists; underlying Windows RNG failure remains unidentified. No weaker entropy or token relaxation. |
| Restricted assertion source diagnostic | Two managed builds, 1,856 portable checks, ten JS report cases and typecheck pass, with owned cleanup. [Source](evidence/windows-assertion-location-source-summary.json). | Native execution pending. Only fixed upstream basenames/line numbers may be retained; prior assertion and child journey remain failed. |
| Execution shutdown and exact CI dependency guard | Seven related files pass 66 checks and typecheck, including held poll/deadline/input-release callbacks. [Evidence](evidence/execution-shutdown-summary.json). | Prior full `efbaa52` remains failed: 240/241 groups, 1,504 passed, one failure and eleven skips, with all owned cleanup verified. Separate GitHub teardown cause is not reconstructed; full followup pending. |
| Native restricted child pipe capture `7a75189` | Exact artifact digest verifies; all three standard handles close, output drains, and 663 stderr bytes classify as an assertion. [Native receipt](evidence/windows-stdio-native-summary.json). | Still exit 134/no owner result; failed fixture preserved. Exact assertion and complete child acceptance remain unfinished. |
| Restricted child standard pipe candidate | Both managed targets compile with zero warnings/errors; 1,847 portable checks and seventeen focused JS tests pass, with one declared Windows-only skip, cleanup and typecheck. [Source evidence](evidence/windows-restricted-stdio-source-summary.json). | Native execution pending. Three exact inherited handles, closed pipes and bounded fixed diagnostics do not upgrade the previous exit-134 failure. Separate GitHub Linux release teardown at `efbaa52` fails with `ENOTEMPTY`; full local followup is still running. |
| Exact creator account/repository boundary | Six related files pass 81 tests, typecheck and exact child/tree cleanup. The creator's account, original repository, reservation and stop generation are checked after asynchronous setup and before thread effects. [Evidence](evidence/coding-creator-boundary-summary.json). | Provider doubles only; no live task or account switch. Persistent task/IDE composition remains unfinished. |
| Detached restricted Windows child `7a16bfe` | The source-specific artifact digest verifies; 58/59 workflow jobs pass. [Failed receipt](evidence/windows-detached-native-summary.json). | Child exit changes to 134, with no owner result. The whole workflow and child remain failed; fixture preserved. No cause or successful repair is inferred. |
| Restricted native namespace observation and detached-startup candidate | `b83b1a0` completes all fixed access probes and closes every handle; original/restricted results match. Both candidate managed targets compile, 1,816 checks and eight JS report tests pass, and typecheck succeeds. [Exact artifact and source](evidence/windows-restricted-console-candidate-summary.json). | The original child still fails DLL initialization and its fixture stays preserved. Detached startup is a candidate for the file/pipe-only proof, not an accepted repair; every token/desktop/Job/exit guard remains. |
| Native lease followup `ce5be6a` | Complete Windows lease files: eighteen passed tests and one declared skip; Supply Chain scenario: one pass; policy-output cohort: 23 passes. All three archive digests and every child/tree cleanup verify. [Exact source and artifacts](evidence/native-state-lease-ce5-summary.json). | Prior startup failures stay failed. Full Windows remains unaccepted; the restricted primary child still fails DLL initialization. The next fixed namespace diagnostic compiles in both targets and passes 1,816 managed plus 28 JS checks; native execution pending. [Diagnostic](evidence/windows-restricted-namespace-source-summary.json). |
| Complete Linux `7897835` | 241/241 groups, 1,501 passed tests and ten declared skips; every child/tree exit and exact owned checkout/dependency/build cleanup verifies. [Exact receipt](evidence/linux-789-complete-summary.json). | Accepts that immutable source; later native worker changes have separate evidence. Windows, hardware and account checks remain separate. |
| Native Windows state lease worker | Two managed targets compile with zero warnings/errors; 1,816 portable checks, including forty new parser cases. Four focused JS files pass 43 tests with one Windows-only skip and exact child cleanup; typecheck passes. [Source and CI wiring](evidence/native-state-lease-source-summary.json). | Native worker acceptance pending. Prior startup failures remain failed. Separate native USER-object access passes at `7897835`, but child DLL initialization still fails and its failure fixture is retained. |
| Complete Linux failure and bounded startup correction | Immutable `5fe6e95`: 239/241 groups, 1,495 passed, four failed tests and ten skips; exact child/tree/checkout cleanup verifies. Corrections pass four files/25 tests, typecheck and three installed Codex metadata/shutdown checks. [Exact evidence](evidence/linux-startup-windows-user-object-summary.json). | Complete followup pending. Windows scanner registry passes twenty native tests at `ec3afe7`; separate Shield worker startup and restricted-child DLL initialization remain software failures. Owned USER-object diagnostic compiles in both targets and passes 1,776 portable checks; native execution pending. |
| Scanner directory alias correction and Windows package followup | Four related local files pass 39 tests; final registry file passes 20 cases and typecheck. Native `5fe6e95` client cohort passes seven files/73 tests, including corrected packaging, with digest-verified receipt and cleanup. [Exact evidence](evidence/windows-fixture-alias-followup-summary.json). | Native registry now passes all twenty cases at `ec3afe7`; actual short spelling depends on host 8.3 support. A separate policy output test fails at lock-worker startup with no progress; original deadline and failure remain. Restricted-child DLL startup remains unfinished. |
| Owned Unix task adapter | Seven related complete task files pass 78 tests; five corrected package/catalog/install files pass 52 checks. Actual installed CLI passes three task-adapter checks with two account operations, revocation and verified exact cleanup. [Source and receipts](evidence/codex-unix-task-adapter-summary.json). | Explicit adapter only; main Studio composition/full task/IDE attachment remains unfinished. Native proof uses a verifier-only permission boundary, with no native threads, prompts or login changes. The original broader package failure stays failed; size now fits the unchanged budget. |
| Native Windows focused followup `2d0cd09` | Complete device/storage files pass 18/11 tests respectively; both artifact digests and all cleanup verify. [Exact source and artifacts](evidence/windows-2d0-focused-native-summary.json). | 57/58 filesystem jobs pass; restricted native startup still fails. Original full-run device failure cause remains unestablished. A separate package-size failure has a local correction pending native followup. |
| Complete Windows run and focused correction | Native `6f7e595`: 343/344 isolated groups pass, 2,169 passed tests, one failed test, 82 declared skips; all child cleanup verifies. Followup passes four local files/56 tests and typecheck. [Exact failed receipt and followup](evidence/windows-full-followup-summary.json). | Full Windows acceptance remains failed. First device failure needs the corrected bounded diagnostic; native path-alias repair and the added whole-file cohorts await Windows. Other nonisolated failures and restricted-child DLL initialization remain unfinished software. |
| Owned Codex provider lifetime | Eight related complete files pass 104 tests and typecheck. The installed CLI passes four checks across two lifetimes and three persistent metadata clients, including normal stop and parent loss/recovery. [Exact source and receipt](evidence/codex-owned-lifetime-summary.json). | No threads/model turns/login changes. Startup is private/neutral, account identity cannot rebind, and unknown files prevent retirement. Production stays stdio; Studio/task/IDE wiring and live login switching remain unaccepted. The 240-group Linux manifest is complete; no new complete-cohort pass is claimed. |
| Pinned Codex Unix stream | Seven complete software files pass 95 tests, final bridge file passes all seven cases, and typecheck/package/inventory pass. The installed CLI passes four native persistent-connection checks with exact peer/config/account/exit/cleanup evidence. [Contract and source](codex-owned-transport.md). | Zero threads/model turns. Account-change fencing is software-tested; live login switching stays unaccepted. Production stays stdio; owned listener/task/IDE lifecycle wiring remains unfinished. |
| Native restricted-child log query `6f7e595` | Twelve parser cases execute on Windows; the bounded native query completes and closes its handles. Both artifact digests verify. [Exact receipt](evidence/windows-restricted-child-events-native-summary.json). | No exact PID/creation-time event is retained; this does not establish absence elsewhere. The child still exits with `STATUS_DLL_INIT_FAILED`; the whole workflow remains unaccepted while all 55 other jobs pass. |
| Native Windows `fdb0559` | Corrected source passes thirty native filesystem checks, both six-check service/setup lifecycles with thirteen restricted metadata checks each, and 1,541 service-header cases. All 55 other workflow jobs succeed. [Verified artifacts](evidence/windows-fdb-native-summary.json). | The restricted primary child still exits with `STATUS_DLL_INIT_FAILED`, keeping the whole workflow unaccepted. The disabled post-delete branch is not separately forced; interactive Windows/UAC/guest/account/physical acceptance stays separate. |
| Restricted-child Application Error diagnostics | Both managed targets compile, 1,776 portable checks and five complete backend files/fifty-one tests pass. Exact PID plus process creation time, XML limits and fixed output privacy are enforced. [Source evidence](evidence/windows-restricted-child-events-source-summary.json). | Test-only read of at most 32 recent existing events, no retry or token/Job/exit relaxation. Native query execution now completes with no retained exact match; the actual child initialization repair remains unfinished. |
| Windows acknowledged deletion state | Exact `842416e` failures identify disabled start type after acknowledged deletion. The correction preserves every normal header case and adds 772 post-delete cases: 1,764 portable checks and five backend files/fifty tests pass. [Source, artifacts and limits](evidence/windows-service-deletion-state-summary.json). | Exact-source native followup now passes thirty filesystem checks and both six-check service/setup lifecycles; the whole workflow retains one restricted-child failure. Disabled is pending deletion, never usable installation or absence. The restricted primary child remains a separate DLL-initialization failure. Five native fixture-invalidation tests now pass; the earlier timeout stays failed. |
| Owned Codex listener guardian | Four actual native checks pass: pinned process/socket, effective restricted configuration, two account snapshots, abrupt parent loss and exact owned retirement. Two complete software files pass eighteen tests. [Exact source/receipt](evidence/codex-owned-guardian-summary.json). | Source verifier; production stays stdio. Continuous Unix account fencing and complete Studio/task/IDE attachment remain unfinished software. The earlier dangling-alias cleanup failure stays failed with a separate exact cleanup receipt. |
| Owned Codex Unix metadata | Native 0.166.0 listener/socket identity, two matching read-only account responses and exact process/socket/directory retirement pass; four source groups pass 62 tests and typecheck. [Contract and exact evidence](codex-owned-transport.md). | No task or model turn. Production stays on restricted stdio. The proxy attempts remain failed; effective Unix configuration, continuous account fencing, parent loss and full IDE attachment are not accepted. |
| Windows lock timeout phases | Three complete Linux files pass 23 checks and typecheck, including missing startup/acquire/release acknowledgements and bounded private-stderr rejection. [Exact source](evidence/windows-lock-phase-diagnostics-summary.json). | Diagnostics preserve the original deadlines and callback semantics. New native Windows diagnostic acceptance remains required; the original fixture timeout stays failed. |
| Native Windows `4911642` | Thirty native filesystem checks, six service-lifecycle checks and six native setup-lifecycle checks pass, with thirteen restricted metadata checks in each lifecycle. [Digest-verified artifacts](evidence/windows-491-native-summary.json). | The workflow remains failed: the restricted primary child still exits with `STATUS_DLL_INIT_FAILED`, and fixture invalidation hits the original lock deadline. No guest, interactive UAC, ordinary-account or physical acceptance is inferred. The later removal pass does not prove the earlier header failure's cause or repair. |
| Installed fresh permission reads | Normal `3319f922` passes six update/seven privacy checks plus 16 actual native Supply Chain checks; [receipt and recovery](evidence/installed-fresh-protected-reads-summary.json). | One empty task, two independently exited scanners, zero prompts/public queries/HID/microphone. Failed finding and incomplete clean cases, duplicate suppression, quota/signing cleanup and app restart pass; only the new proof workspace is reversibly archived. All original 54 identities/private link/Home are preserved and checkout/bundle removed. |
| Corrected native Windows authority/state | Three groups/31 checks in [digest-verified `3319f922` artifact](evidence/windows-authority-3319-summary.json); all six policy workflow jobs succeed. | All original and new cases remain required; 240-second child and 12-minute step bounds unchanged. Guest execution is doubled; interactive Windows/UAC/guest/device/account acceptance remains separate. Earlier `9dc0a944` timeout stays failed. |
| Complete Linux `d4128e6` | 238/238 groups; 1,471 passed tests and ten declared skips; [exact source/receipt](evidence/linux-d412-complete-summary.json). | All child/process-tree cleanup and owned immutable fixture/alias/worktree removal verified. Includes CVSS context and private-desktop proof source; actual Windows API acceptance remains separate. |
| Installed CVSS context `c5d2d28` | Six update/seven metadata and 15 checks each for real Supply Chain/Release; [source-bound evidence](evidence/installed-cvss-context-summary.json). | Four independent scanner exits, signed source-provenance binding, critical base retained despite lower context, zero prompts/public queries. Own two workspaces archived; original 54 restored with app restart/private link/Home verified. |
| Complete Linux `35a64a9` | 237/237 groups, 1,464 passed tests and ten declared skips; [source/receipt](evidence/linux-35a-complete-summary.json). | All child/process-tree cleanup and immutable fixture/alias/worktree removal verified. Includes the corrected history teardown and new Windows worker source; CVSS context additions have separate focused checks. Original failed full runs remain failed. |
| Native Windows keyless leases `0740791` | Both complete files pass: 16 tests and one declared platform skip; [digest-verified evidence](evidence/windows-keyless-leases-074-summary.json). | Actual Windows kernel sharing and parent-loss release through the default pooled store path. Wider native workflow still has separate removal/restricted-child failures. |
| Complete Linux `9dc0a944` | 235/235 groups, 1,445 passed tests and ten declared skips; [exact source/receipt](evidence/linux-9dc-complete-summary.json). | All child/process-tree cleanup and owned immutable checkout/fixture/alias removal verified on Btrfs. Includes original-bound Shield/Pipeline. This is code verification; full Rev2, native Windows, UI, hardware and account acceptance remain separate. Earlier failed full runs remain failed. |
| Native Windows client `9dc0a944` | Seven groups/73 checks; [digest-verified archive and receipt](evidence/windows-client-9dc-summary.json). | Native Windows host contracts and child cleanup pass; interactive windows, guest, physical and account journeys remain separate. |
| Native Windows authority file timeout | Ten passing subtests precede the original 240-second file bound; [failed archive and correction](evidence/windows-authority-9dc-timeout-summary.json). | File plan incomplete, so the cohort remains failed. Two new state regressions move to the existing independently bounded state child, included unfiltered in authority CI; all assertions and original bounds remain. Three Linux groups/31 checks plus five packaging checks pass; corrected native Windows follow-up now also passes three groups/31 checks. |
| Fresh permission-bound repository reads | Nine focused groups / 70 checks, typecheck and child cleanup; original Shield/Pipeline files pass at 35.042/27.523 seconds under unchanged 120-second bounds. [Source hashes and paired evidence](evidence/fresh-protected-reads-summary.json). | Provider permission and grant state stay fresh; keys are never cached. Paired Btrfs fixture removes duplicate reads while retaining ten target captures and 120 ready/exit records. Earlier full failures remain failed and their cause is unproven. The complete `9dc0a944` Linux follow-up now passes; normal installed `3319f922` now also passes 29 update/privacy/native checks. Owned comparison scratch is removed. |
| Installed non-final Python scans | Normal `ccd1bc1d` update passes six update/seven metadata checks; Supply Chain and Release each pass 16 installed checks, with four independent native scanner exits. [Exact receipts and cleanup](evidence/installed-pep440-summary.json). | Two empty native tasks, zero model prompts/public queries/HID/microphone. Finding and clean cases stay non-passing; aliases match without changing literal pins. Signed feeds/source/signing scratch are retired; only two new proof workspaces are reversibly archived with encrypted native identity recovery. Original 54 active workspaces, private link and Home are preserved; app restart verified and checkout/bundle removed. Earlier failed attempt stays failed. |
| First installed non-final Python attempt | Native scanner exits 0 with the correct literal pin, equivalent advisory finding and encoded package URL; [failed receipt and cleanup](evidence/pep440-first-installed-failed-summary.json). | The verifier used a legacy npm fixture name and failed before full acceptance. It remains failed. Corrected verifier passes two groups/28 checks; exact synthetic quota/grant/source/signing cleanup and reversible encrypted archive restore the original 54 active workspaces. |
| Python non-final versions | Six isolated groups / 62 checks; 295 independent PyPA identifiers / 87,025 pairwise ordering and identity comparisons; [source hashes and receipt](evidence/pep440-summary.json). | Actual Linux Supply Chain/Release scans and Windows guest doubles preserve literal pins, match normalized advisory identities and keep incomplete coverage. Full requirements/resolution/artifact/provenance and native Windows acceptance remain unfinished. Installed acceptance is recorded separately. |
| Codex designer reply persistence and runner admission | Seven consolidated groups / 80 checks, child cleanup and typecheck pass; [source hashes and receipt](evidence/codex-design-account-boundary-summary.json). | Late connection/epoch changes retain the draft and native session, with no saved reply or retry. Prior connection-fence source passes six installed update/seven metadata checks, preserves all 54 workspaces and removes owned scratch. Live account switching remains separate. |
| Native Codex account boundaries | Auth notifications close pinned connections even if the fingerprint is restored; metadata cannot silently rebase, partial IDs survive, and reply persistence rechecks the connection epoch. Three focused groups pass 40 checks plus four broader groups/38 checks. Real CLI login/inventory and exact owner-loss exit pass at 31 ms, without a thread or model prompt. | Controlled notification/account transitions, no real user login/logout. Live account-switch acceptance and external credential mutation coverage remain separate. [Contract](codex-account-boundaries.md). |
| Installed reviewed-text observation | Normal installed `095f5dd` passes six update/seven privacy/five actual native checks. One reviewed synthetic Codex turn records three local text phases; its duplicate adds no events. Three captured native processes exit, proof records/staging and checkout are removed, and all 54 workspaces remain. | One native integration prompt; no implementation helper. Local metadata is separate from task completion, continuous external streams and Claude native acceptance. Fresh fences/audit bookkeeping remain; selected definitions/selection/frozen Home are preserved. [Summary](evidence/installed-text-observation-summary.json). |
| Reviewed coding-text observation | Five isolated collector/Codex/Claude/Suite/package groups pass 56 checks with cleanup. Existing encrypted mutations append local reservation/identity/reply/failure/review metadata with a distinct namespace, duplicate prevention and consent/pause/exclusion fences. | Provider execution is doubled here; Claude contributes no invented acknowledgement. Hooks add no provider request or state transaction. Normal installed source 095f5dd has separate native evidence above; Claude native text events and broader streams remain outstanding. [Contract](agent-lifecycle-observation.md). |
| Local thread-to-terminal object binding | The exact local Codex record survives open/reuse/close events; same-title neighbors do not replace it and generic adoption cannot relabel it. Managed focus requires unique object/root/thread identity and bounded API readback. Linux path case is preserved. Three focused groups pass 136 checks with cleanup; typecheck/build pass. | Software evidence for the current extension lifetime. Closing the surface is not native task completion; native TUI, cross-restart and broader Studio/account attachments remain open. [Summary](evidence/vscode-thread-terminal-binding-summary.json). |
| Scoped local Codex terminal launch | Four isolated groups pass 147 checks, including twelve async context/identity/refusal cases, exact persistence/registration acknowledgements and strict daemon permission response checks. Typecheck/build pass; actual Codex 0.166 accepts the explicit socket/UUID/root/read-only/on-request flags in a help-only parser check. | Daemon responses are doubled in software tests. No daemon connection, new task or prompt in the parser check. Native TUI attachment is still an outstanding integration check. [Contract](ide-terminal-selection.md). |
| Windows client platform `7d9310a` | Workflow 42082500125/job 127444401154 passes seven groups/71 tests with child cleanup. Artifact 13443535181 is SHA-256 verified in memory; only its small receipt is retained. | Execution merge `2b8d785` with PR head `7d9310a`; source-specific portable/WinRT metadata checks. Separate from interactive account/window acceptance and newer terminal changes. [Summary](evidence/windows-client-7d-summary.json). |
| Scanner cost profile | One actual synthetic Change Scan completes with isolated program/guardian exit. Fixture/review/apply take 2.78/1.34/15.19 seconds; ten fresh authority captures cause 120 protected Git-probe lifecycles and 1,045 state reads. Owned diagnostic roots and script are removed. | Nested timings overlap. This measurement does not establish the cause of aggregate deadline failures or implement a performance fix; failed diagnostic wrappers remain separate from product results. [Profile](evidence/repository-performance-summary.json). |
| Exact integrated-terminal selection | Three isolated groups pass 147 checks; typecheck and extension build pass. The real compiled helper selects both identical-title terminal objects repeatedly, refuses a closed object, and passes two native/three API checks with nine verified process exits, profile removal and focus restoration. | Disposable source fixture, zero prompts/text/trust bypass or user profile changes. Exact coding-task/account/IDE attachment remains unfinished. [Contract and evidence](ide-terminal-selection.md). |
| Newer Linux observation checkpoint | Immutable `ea5a0f7`: 231/233 groups accepted, 1,392 reported passed tests and ten skips; two scanner/pipeline groups timed out at the existing 120-second limits. Both same-bound reruns also timed out, with child cleanup verified. | Failed run; reported counts are incomplete. The `514bf68` complete pass remains the last accepted full checkpoint. Cause is unconfirmed; no deadline was increased. [Failed evidence](evidence/linux-ea5-timeout-summary.json). |
| Installed configuration-request metadata | Installed `7d9310a` passes six update/seven privacy checks with 54 workspace IDs and three exact source pins. Selected sealed bytes and frozen frontend are preserved; bundle/checkout removed. | Zero model requests or new workspaces. Native configuration-turn event acceptance remains open. [Summary](evidence/installed-design-observation-summary.json). |
| Configuration-request observation software | Four isolated collector/Suite/Claude-design/package groups pass 39 checks with cleanup. Atomic local reservation/reply/failure events omit raw IDs, text and account data; a changed-account refusal records no delivered-model claim. | Provider responses are simulated. These hooks add no model request; broader runtime/external/IDE event streams remain unfinished. [Contract](agent-lifecycle-observation.md). |
| Installed native task observation | Source `ea5a0f7`, release `7096e4c8…`, passes six update/seven metadata/four actual native checks. One empty Codex task records reservation/binding/status; polls collapse and pause blocks collection. One retained native metadata process independently exits, and only owned records/repository/bundle/checkout are removed. | Zero prompts/new workspaces/HID. Definitions/selection/frozen Home are preserved; fresh mode fences and normal audit bookkeeping remain. This is Codex native acceptance, separate from Claude event and external/design/IDE streams. [Summary](evidence/installed-agent-observation-summary.json). |
| Opt-in first-party task lifecycle observation | Seven isolated collector/task/bridge/Suite/runner/package groups pass 85 checks with cleanup. Real encrypted state records local versus provider metadata, changed statuses, privacy, pause/exclusion, duplicate-poll collapse and unchanged non-authority boundaries. | Providers are doubled in these software checks. Covers operations observed by the task adapters; broader external/design/IDE streams remain unfinished. Installed empty-native-task acceptance is separate. [Contract](agent-lifecycle-observation.md). |
| Complete Linux pipe-lock/request checkpoint | Immutable `514bf68`: 232/232 groups, 1,401 tests, 1,391 passed and ten declared skips. Every child cleanup and owned fixture/dependency-alias/worktree/marker removal verifies. | Includes Copilot request/recovery/echo handling, native-width proof source and Linux pipe locks. Later F77 audit/package/inventory changes have separate focused/installed evidence. [Summary](evidence/linux-514-complete-summary.json). |
| Complete workspace metadata inventory | Four isolated Suite/lock/restoration/verifier groups pass 31 checks with cleanup. Fifty-four real sealed workspaces remain discoverable, including the selected identity beyond the old 32-entry cutoff. Credential-free listing, route privacy, explicit 256-entry overflow and external selection drift are covered. | Metadata only; no content/account/task authority. Normal installed `2276ac2` passes six update/seven metadata checks, including all 54 pilot identities, with selected state/frontend preserved and owned cleanup. [Contract](workspace-inventory.md). |
| Installed F77 direct-protocol audit | Normal installed source `0cc9e76c`, release `f49d611e…`, passes six update/four cached-readout API checks with exact original state/frontend preservation and owned bundle/checkout removal. | Source comparison only: no HID, solenoid control, fitted-hardware, electrical or running-firmware authentication claim. [Summary](evidence/installed-haptic-protocol-summary.json). |
| Linux per-transaction kernel-lock holder | Three isolated Suite/commit/lock groups pass 28 checks, including native owner loss, cross-process crash release and exact duplicate commit recovery, with cleanup verified. Commit group completes in 43,621 ms under its original 45,000 ms bound. | Replaces per-lease Node startup with a fixed pipe reader under the same kernel lock. Earlier failures remain failed; latest full-source acceptance remains pending. Local latency observations are not universal performance claims. [Contract](private-state-locking.md). |
| Linux full-run timeout failures | Immutable `0cfe82c`: 209/230 groups accepted; 21 groups exceed their declared deadlines. 1,294 reported assertions pass and ten declared skips remain; every child cleanup verifies. The failed receipt and safe owned-fixture/alias/worktree removal are retained. | This run is failed, not a current full-suite pass. Workstation load was later observed; its causal contribution is unestablished. Original limits remain unchanged. [Summary](evidence/linux-0cfe-timeout-summary.json). |
| Microsoft final-message acceptance | Four isolated account/lifecycle/request/integration groups pass 44 checks with every cleanup verified. Exact/reformatted/fenced/plain request echoes and absent/non-text final messages retain unconfirmed delivery; an earlier text reply cannot replace them. | Simulated Microsoft responses only. Exact echo detection does not prove speaker identity or reject every paraphrased recap. [Contract](copilot-account-binding.md). |
| Independent newer Windows filesystem/setup | Source `a87f048` has digest-verified native artifacts: thirty filesystem checks/39 native calls and six setup lifecycle/thirteen restricted metadata checks. Owned volume detach and native exit verify. | Separate restricted-primary-process lane remains failed; no guest, ordinary-account/UAC or keyboard acceptance. [Summary](evidence/windows-a87-native-summary.json). |
| Installed Microsoft journal metadata | Normal installed source `ea5a0f7`, release `7096e4c8…`, passes six update plus seven actual API/privacy/refusal checks, including all 54 saved workspace identities. Selected sealed bytes, definitions/mode/readouts, private endpoint and frozen Home are preserved; owned bundle/checkout are removed. | Zero Microsoft requests/model prompts; no new workspace, keyboard or microphone access. Metadata acceptance does not establish live tenant delivery. [Summary](evidence/installed-copilot-journal-summary.json). |
| Durable Microsoft request/recovery software | Ten isolated groups pass 90 checks with every cleanup verified. Real encrypted files/kernel leases and authenticated HTTP cover separate-instance duplicate delivery, original remote identity, restart/retention, lost acknowledgements, owner/phase loss, stale approvals and metadata privacy. | Microsoft responses are simulated; no tenant contacted. Local acknowledgement remains reviewed-unconfirmed, never cancellation or completion. Three independent Windows workers remain pending. [Contract](copilot-request-recovery.md). |
| Microsoft account and local request lifecycle | Five isolated groups pass 58 runner/account/lifecycle/Suite/integration checks, then fifteen final account/lifecycle cases pass; all cleanup verifies. Exact credential pins and actual Suite mode/workspace/shutdown fences reject mismatched accounts, follow-up requests and late replies. | Real encrypted state, simulated Microsoft responses, no tenant contact. Local abort and one-second settlement observation cannot verify remote cancellation. Durable restart handling has separate 90-check software evidence above. [Contract](copilot-account-binding.md). |
| Complete Linux lock checkpoint | Immutable `4700d9a`: 225/225 groups, 1,355 tests, 1,345 passed and ten declared skips. Every child cleanup and owned fixture/dependency-alias/worktree removal verify (`isolated-test-4057ed5a-1702-44c7-a9f6-34eee6f0604b.json`). | Includes module-free lock source and installed-verifier/report checks. Later license and Copilot changes have separate focused/installed evidence; this is not a full run of later source. |
| Installed declared license analysis | Normal source `402dd7e` passes six update plus 14 Supply Chain/14 Release checks; four scanner exits, signed-feed retirement, original-state restoration and all owned cleanup verify. | Required disallowed terms fail; permitted alternatives stay unselected; unsupported exceptions remain unknown. No legal, license-text, publisher or SPDX-list claim. [Summary](evidence/installed-license-summary.json), [contract](npm-license-declarations.md). |
| Native module-free Windows locks | `4700d9a` passes eight Sandbox transport, three ignored-tree authority and six lease tests plus one declared skip; all three archive digests and child cleanup verify. | Actual native parser/kernel locks under original bounds; earlier failures remain failed, exact startup cause unproven. No guest/account/whole-workflow acceptance. [Artifacts](evidence/windows-470-state-lock-summary.json), [contract](private-state-locking.md). |
| Complete Linux tmux checkpoint | Immutable `c2fe4d8`: 223/223 groups, 1,350 tests, 1,340 passed and ten declared skips. Every child cleanup and owned fixture/dependency-alias/worktree removal verify (`isolated-test-95777632-4992-4c85-af39-477a02720294.json`). | Covers CVSS, shared state queues and source tmux navigation. Later installed-verifier and token-proof edits have focused evidence; this is not a full run of those later sources. |
| Installed Claude/tmux trust boundary | Normal installed source `c2fe4d8`, release `b6098cc…`, verifies native account availability and reaches the CLI's workspace-trust dialog without submitting a prompt. Latest refusal restores exact workspace/focus and retires all four owned processes, socket and cache. | Real registered session navigation remains blocked by native workspace trust; no trust override or prompt is sent. Earlier failed cleanup and manual recovery's unprovable original selection remain recorded. [Evidence](evidence/installed-tmux-trust-boundary-summary.json). |
| Restricted Windows primary token correction | Native `a87f048` proves the historical query requests one byte; the generic minimum-four-byte reader rejects it before reading a flag or creating a child. The dedicated bounded decoder compiles warning-free; 223 portable and 25 isolated runner/selector/report checks pass with owned cleanup verified. | Corrected native execution remains pending on available CI, not blocked by hardware/accounts. Exact SIDs, deny-only group, assigned privileges, primary token, integrity, Job containment and verified exits remain mandatory. Earlier failures remain failed. [Failure](evidence/windows-a87-restricted-failed-summary.json), [contract](windows-storage-broker.md#actual-restrictions-and-historical-token-metadata). |
| Native tmux pane navigation | Real private tmux/Foot source demonstration selects the exact second pane, verifies compositor focus and repeats three provider-identity checks. Seven fault cases, 64 surrounding/31 runner/29 final Claude-window checks pass with cleanup. All five owned processes, both units and exact socket/directory are retired; no owned windows remain. | Synthetic CLI identity only; registered real Claude and normal installed API acceptance remain separate. No text/model prompt, key transaction or user terminal configuration change. [Summary](evidence/tmux-native-pane-summary.json), [contract](tmux-task-focus.md). |
| Installed quantitative severity | Source `7e252a1` passes six update plus 16 Supply Chain and 16 Release checks, four scanner exits, feed retirement and restoration; all owned source/signing/packages/staging/bundle/checkout removed. | Eight records calculate supported CVSS base ratings, two stay unknown. Both failed/incomplete outcomes remain non-passing; zero prompts/HID. [Summary](evidence/installed-cvss-summary.json), [numeric verification](cvss-severity.md). |
| Complete Linux Python checkpoint | Immutable `8108738`: 221/221 groups, 1,335 tests, 1,325 passed and ten declared skips. Every child cleanup and owned fixture/alias/worktree removal verify (`isolated-test-90208df4-5cd3-4e31-9d97-ec548e21db4f.json`). | Includes both Python scanner paths and client file split; later CVSS/state queue/token-order source `1701456` passes a separate 222-group run: 1,343 tests, 1,333 passed and ten declared skips, with every cleanup and owned checkout removal verified (`isolated-test-85fb6019-18fd-4d86-9c8e-6ef3b827b074.json`). |
| Independent native Windows filesystem/setup | Source `c8b1216`: two archive digests verify thirty filesystem checks/39 native calls and six setup lifecycle/thirteen restricted metadata checks, with exact owned native exit/cleanup/retirement. Strict native C++ build passes. | Same workflow still fails separate restricted-token/state-lock/exception contracts; earlier setup failures remain failed with cause unestablished. No ordinary account, guest or hardware acceptance. [Summary](evidence/windows-c8b-native-summary.json). |
| Installed Python requirement scans | Source `8108738`, normal installed release `346e908…`, passes six update and 16 Supply Chain plus 16 Release checks. Four scanner exits, signed-source freshness, retired feeds, original state and frozen Home restore; all owned source/signing/packages/staging/bundle/checkout removed. | Exact numeric declarations only; no environment, artifact hash, license, publisher or complete-coverage assurance. Zero prompts/HID. [Summary](evidence/installed-pypi-summary.json), [format and reproduction](python-supply-chain.md). |
| Ecosystem-separated dependency inventory | Eight isolated groups pass 52 checks with every cleanup verified; npm and PyPI identities stay distinct. Three standalone BOMs validate against official CycloneDX 1.6 schemas; three invalid mutations fail. Temporary validator tools removed. | Requirements metadata only, no dependency installation or automatic upstream upload. Full Python semantics and additional ecosystems remain unfinished. [Contract](python-supply-chain.md). |
| Complete Linux native editor checkpoint | Immutable `d43721f`: 218/218 groups, 1,324 tests, 1,314 passed and ten declared skips. Every child cleanup and owned fixture/alias/worktree removal verify (`isolated-test-fb7bca13-5389-4542-a022-743d466b7f9d.json`). | Later Python source `8108738` passes a separate 221-group full checkpoint above; no current-head pass is inferred. |
| Windows client rerun | Source `04d9d6c` passes seven complete groups and all 70 assertions, with cleanup under original bounds. | The previous 45-second file timeout remains failed. Contract/window doubles do not establish native Windows desktop interaction. [Digest summary](evidence/windows-04d-client-summary.json). |
| Windows client file timeout and independent gateway file | PR head `4fd8c28`, workflow `42029707203`, retains failed archive `13415811749`; archive digest verifies. All 70 reported assertions pass, but the combined physical/gateway file exceeds its original 45-second child bound before accepted exit. All child cleanup verifies; five of six groups pass. | Native focus cases now occupy a complete separate file, retaining every assertion and the original 45-second per-child bound. The exact client selector includes both files; no skip or deadline waiver. Eight local runner/client groups pass 87 tests (86 passed, one declared Linux platform skip), with every cleanup verified (`isolated-test-dbc2c702-1e9d-42d8-8a4a-9df1205e1778.json`). Native rerun pending; failure remains failed. [Digest summary](evidence/windows-client-4fd-timeout-summary.json). |
| Complete Linux native-focus checkpoint | Immutable `c735516`: all 218 required groups pass, 1,316 tests, 1,306 passed and ten declared skips (`isolated-test-cb4f8300-cb00-40c6-8844-67f7030d6ee8.json`). Every child cleanup verifies and owned fixtures/dependency aliases/checkout are removed. | Includes exact repaired ChatGPT focus and restricted-process proof source correction. Later VS Code navigation has separate 90-check and actual source/installed evidence; no complete latest-source run is inferred. |
| Installed VS Code and repaired ChatGPT focus | Normal installed `dd0cad1`, release `c50a7624c39c2866c59e2c7275c0e7156f5142a73543360751468fcd8309f805`, passes six update/five VS Code/five ChatGPT checks. Both restore exact original selection/definitions/mode/private endpoint and frozen Home; zero prompts. | Owned editor cgroup exits and independent process readback clears; separate profile/extensions, disposable package and proof checkout are removed, user settings unchanged. The target refuses after owned editor exit while another application with the same class remains open. Three earlier prototypes remain failed with cleanup/restoration; actual navigation establishes no account/repository/session authority. [Digest summary](evidence/native-vscode-focus-summary.json). |
| Independent Windows Shield scenarios | All five action/clean scenarios pass at PR head `869aa9e` / artifact merge `d365e15`, each on its own worker with the original 300-second child bound. All five archive digests and child cleanup verify. | Guest/native staging remain doubled in these software scenarios. Earlier combined-file timeouts remain failed; overall workflow still fails the separate restricted-process proof. [Digest summary](evidence/windows-869-shield-scenarios-summary.json). |
| Native VS Code navigation source | Six isolated configuration/gateway/terminal/Suite/package/runner groups pass 90 checks with every child cleanup verified (`isolated-test-66903f0b-865b-492b-b007-3b68326d91b7.json`). Actual source gateway refuses unauthenticated/keyboard-only effects, then focuses the exact native editor with unchanged process birth and repaired ChatGPT identity; zero prompts (`native-vscode-gateway-1793881739644.json`). | Fixed native executable and two verified classes; no class-only selection, alternate editor, launch or content handoff. Initial legacy-class prototype remains failed before effect with owned gateway cleanup. Normal installed VS Code and owned editor/profile retirement pass separately above. Repository/Copilot/account/session and Windows focus remain separate. [Contract](native-client-focus.md). |
| Normal installed exact native focus | Installed `b82f056`, release `a6c095ec81436d03fc136e7f6da73977c842e9cabb57ceb33f15a202daa11416`, passes six update/five actual focus/API/restoration checks. Receipt `installed-native-main-window-1793881005201.json`; one mapped repaired main window, zero floating overlays, original selection/definitions/mode/private endpoint/frozen Home restored. Disposable package and proof checkout removed; zero prompts/no device or microphone access. | First verifier-only mode precondition failure `installed-native-main-window-1793880918796.json` remains failed before workspace mutation; exact checkout cleanup verifies (`failed-native-focus-installed-cleanup-1793881033321.json`). Corrected verifier checks actual active work and independent retained guardian exit, preserving original mode. Focus only; no provider-account/conversation/task acceptance. [Contract](native-client-focus.md). |
| Exact repaired native ChatGPT focus | Real Linux direct focus and authenticated source-gateway journeys pass with unchanged PID birth identity, one mapped repaired main window and zero floating overlays. Unauthenticated request refuses; owned gateway fixture is removed. Receipts `native-main-window-focus-1793880286229.json` and `native-main-window-gateway-1793880470456.json`. | Uses the existing safe launcher and changes no launcher/voice/overlay configuration. Six isolated configuration/terminal/gateway/package/runner groups pass 65 checks; after gateway policy coverage, four groups pass 38 with every cleanup verified (`isolated-test-77b03406-c6b5-4729-8dbf-4ed1014c12c8.json`, `isolated-test-6f48f54d-d653-41ac-bf5e-e721e0571a1e.json`). No account/conversation/task/prompt/hardware acceptance. [Contract](native-client-focus.md). |
| Restricted-process second native failure and explicit restriction correction | PR head `80e8551` / merge `2ab1993` returns Win32 87 at `create-restricted-child-with-token`, before child start. Archive `13413554767` digest verifies; original service/context are preserved. Creator diagnostics show quota assigned/disabled, primary-token privilege absent, impersonation enabled. | Current source retains one direct creation with creation-time Job assignment, independently verifies the exact restricting-SID list and scopes only the creator's already assigned quota privilege with restoration before resume. Both targets compile warning-free; all 223 portable checks pass with owned scratch removed (`windows-history-native-build-1793882469415.json`). Native execution pending; neither earlier failure is upgraded. [Failure digest](evidence/windows-restricted-owner-80-failed-summary.json). |
| Restricted-process native failure and API correction | PR head `869aa9e`, native job `127231697479`, archive `13412623086` fails before child creation with Win32 1314 at `create-restricted-child`. Archive digest verifies; preceding 13 metadata/31 restricted .NET/8 worker-token JS checks pass without upgrading the failure. Original service/context/ownership are preserved. | Harness now uses one explicit `CreateProcessWithTokenW` call with the caller's existing impersonation privilege, exact bounded environment, unchanged creation-time Job and child-token assertions. Both targets compile warning-free; 223 portable checks pass and owned scratch is removed (`windows-history-native-build-1793880640423.json`). Actual corrected native execution pending. [Failure digest](evidence/windows-restricted-owner-869-failed-summary.json). |
| Restricted JavaScript primary-process proof source | Both C# targets compile warning-free and all 223 portable checks pass with the existing SDK and owned scratch removed (`windows-history-native-build-1793879927476.json`). Three isolated runner/selector/owner groups pass 38 checks with every cleanup verified (`isolated-test-b8d1adb6-f004-4b92-934f-4dda9e7180e1.json`). | Test-only explicit restricted primary-token creation, actual child token readback before/after, creation-time owned Job assignment and exact exit. No shipped helper launch command. Actual native Windows execution pending; no ordinary-account/interactive/guest acceptance. [Contract](windows-storage-broker.md). |
| Native Windows policy checkpoint | Workflow `42017703748` succeeds at PR head `bd77ec4` / merge execution `b5295a6`. All six archive digests verify; 131 passing test executions include the repeated harness. Policy, recovery, three independent stop scenarios, output, authority and host-stop complete with every child cleanup verified. | Actual Windows host, guest doubled. Earlier original timeouts remain failed. The storage workflow still packs five independent Shield scenarios into one six-minute step; source now schedules five separate workers with all original child deadlines/assertions and exact full-inventory selection. Native rerun pending; two local runner/selector groups pass 20 checks with cleanup (`isolated-test-b3be3170-8280-4386-bc93-57c17d180431.json`). [Digest summary](evidence/windows-bd77-policy-summary.json). |
| Complete Linux inspector checkpoint | Immutable `bd77ec4`: 218/218 required groups, 1,304 tests, 1,294 passed and ten declared skips. Receipt `isolated-test-386e9c91-d440-4c1c-a8d8-baf1338f6221.json`; every child cleanup verifies and owned fixtures/aliases/checkout are removed. | Includes selected-workspace inspector and prior historical/recovery implementation. Native guest/account/hardware acceptance remains separate. |
| Installed selected-workspace inspector | Normal installed `bd77ec4` passes six update/sixteen actual CLI/API plus separate current-file scanner checks. All four stable-launcher commands use the actual selected synthetic workspace; 24 CLI query guardians, eleven direct history queries and two scanners independently exit. | Receipts `assignment-legends-1793877445888.json` and `installed-shield-baseline-1793877607788.json`; full restoration, frozen frontend and owned scratch removal verify. Zero prompts/no keyboard access. Witness plus separate current-file scan, not historical-byte scanning. [Contract](inspect-cli.md). |
| Native Windows staging and broker checkpoint | PR head `bd77ec4`, artifact merge revision `b5295a6`, native job `127212549882` succeeds. Eight archive digests verify: index/history each six actual NTFS checks and three guardian exits; 223 portable/16 protected-file checks; 30 filesystem checks/39 native calls; service lifecycle and 31 restricted .NET exchanges; eight JS owner checks. | Exact service/files, disks, native processes and owned staging cleanup verify. JS owner worker token is not ordinary-user acceptance; restricted .NET checks use impersonation. Guest/setup/account/device acceptance remains false. Overall filesystem workflow `42017703826` failed elsewhere. [Digest summary](evidence/windows-bd77-native-summary.json). |
| Complete Linux history/Windows/recovery checkpoint | Immutable `13635bb`: 217/217 required groups, 1,293 tests, 1,283 passed and ten declared skips. Receipt `isolated-test-799530a3-c749-4c04-b5f5-7503e7b7c0f6.json`; every child cleanup verified and owned fixtures/aliases/checkout removed. | Includes historical scanner integration, Windows connection and corrected package/recovery boundary. Later inspector source remains separately tested; native Windows/guest/physical/account acceptance is not inferred. |
| Inspector active-workspace correction | First installed `44221bf` retains failed `installed-shield-baseline-1793876624890.json`: omitted compartment used API Personal default and the task-list assertion failed before grants/scans. Eleven query exits/restoration and exact owned fixture/trust/source/signing/packages/staging/checkout cleanup verify (`failed-inspect-scope-proof-cleanup-1793877136442.json`). | Source now resolves/pins the actual selected workspace through a read-only status route and checks it before output. Four isolated inspector/history/index/Suite groups pass 50 checks with child cleanup (`isolated-test-06aa9e22-f57f-4464-98d0-85d44973f003.json`). Corrected installed acceptance passes at `bd77ec4` above; failed edge-test prototype `isolated-test-25d4150d-a893-40c2-95df-7f92c39431b1.json` retains its premature uninitialized-cache expectation; corrected edge primes cache first and still requires drift refusal. [Contract](inspect-cli.md). |
| Historical full-checkpoint failure and corrected package/recovery subset | Immutable `82eb764`: 213/214 groups pass, 1,266 tests pass, one fails and ten declared skips; obsolete interrupted-install descriptor count rejects a valid larger package (`isolated-test-cdb74631-c09b-4890-bb12-a1e95d1540a4.json`). A separate ordinary run retains a failed 5 MiB budget assertion (`isolated-test-bdd94636-1723-4e2b-8565-8ba06e5b6e2f.json`), seven groups/19 tests pass. | Both remain failed. Recovery now shares the existing 640-payload-file release ceiling plus its manifest; a real boundary crash/recovery test passes. Duplicate UI backend copies are omitted while verified frozen assets remain; the 5 MiB budget and 128 MiB production byte ceiling stay unchanged. Three corrected package/installation/runner groups pass 38 checks with child cleanup (`isolated-test-3818ce71-13c8-4ac6-bd79-04f6a2f50f94.json`). Every old child cleanup/readback verifies; owned failed fixtures/aliases/checkout removed (`failed-full-history-install-cleanup-1793875722780.json`). [Contract](suite-release-recovery.md). |
| Complete Linux Windows-connection checkpoint | Immutable `112efdc`: 211/211 required groups, 1,256 tests, 1,246 passed and ten declared skips. Receipt `isolated-test-be48daaa-a8c9-4e7d-9772-9977e8201458.json`; every child cleanup verified and owned fixture/worktree removed. | Includes the Windows reviewed index connection and Linux compatibility. Native Windows/guest/physical/account acceptance remains separate. |
| Installed package/Windows-connection compatibility | Normal installed Linux `13635bb`, release `81367973a693738830be3a97cbc3edc165329ca4fc8a4c33f748586d809e1539`, passes six update/thirteen actual historical-scan/API checks. Both scanner exits, provenance/replay/feed retirement, full restoration and exact frozen frontend verify. | Receipts `assignment-legends-1793875875539.json` and `installed-shield-baseline-1793876047390.json`; owned source/signing/packages/staging/bundle/proof checkout removed, one empty task/zero prompts/no keyboard access. Complete Linux run passes 217 groups with cleanup; native Windows acceptance remains separate. |
| Read-only installed inspector source | Three isolated inspector/package/runner groups pass all 32 checks with child cleanup (`isolated-test-d308577e-bb57-494c-b66d-8f69d890b1ef.json`), including ten CLI/gateway/privacy/boundary tests. Normal CLI hits actual signed local gateway and real Git API fixture, strips task secrets, leaves original Git/grants/journal unchanged and refuses replacement listeners/redirects/changed endpoints/oversized or source-return responses. | Guardian identity is doubled in this software fixture; independent actual reader/installed proofs remain separate. Stable-launcher installed CLI acceptance passes at `bd77ec4` above. No new prompt, grant, scanner or keyboard transaction. [Contract](inspect-cli.md). |
| Installed historical scan | Normal installed `4901cc8`, release `ffd440981ebb02b4ffb887c94a8f7951a47608244a5bd5e9f3553de86cf7c471`, passes six update/thirteen actual historical-scan/API checks. Secret removed from current source is found with authenticated commit/blob provenance and incomplete scope; both scanner exits, replay/feed retirement and restoration verify. | Receipts `assignment-legends-1793874653637.json` and `installed-shield-baseline-1793874824975.json`; owned source/signing/packages/staging/bundle/proof checkout removed, one empty task/zero prompts/no keyboard access. Broader/automatic history remains unfinished; Windows historical connection passes software contracts, with native acceptance separate. |
| Windows reviewed historical scan connection | Six isolated scanner/input/authority/runner groups pass all 57 checks with child cleanup (`isolated-test-5a5fd866-14dc-4ffd-8b7e-c207e8b8de52.json`). Real Git history feeds reviewed Codebase Audit and Release Shield, authenticates historical-only findings and rejects target drift; orchestrator verifies private consumption before tools/storage/guest and cleanup after late refusal. | The guest and NTFS in JS contracts are doubled; source connection is implemented, actual NTFS/guest/installed Windows acceptance remains separate and pending. Broader/automatic/mixed-source history remains unfinished. [Contract](windows-history-staging.md). |
| Windows historical transport | Both C# targets compile with zero warnings/errors; 62 new portable checks plus all 161 earlier checks pass (`windows-history-native-build-1793874765049.json`), owned scratch removed with the existing SDK. Five isolated packet/native-input/runner groups pass all 40 checks with child cleanup (`isolated-test-dd6967ce-bdb3-4233-aebc-28e685dfcdbc.json`). | Source packet/privacy/hash/boundary contracts only; native NTFS/ACL is doubled in JS. Separate actual CI verifier and selectors are wired; normal Windows historical scanner connection now passes 57 software checks; native/guest/installed acceptance pending. [Contract](windows-history-staging.md). |
| First installed history-scan verifier failure | Installed `82eb764` completes both real scans, detects the historical-only secret, authenticates provenance and independently stops both scanners, but the final verifier incorrectly reads a virtual alias from the original repository. Receipt `installed-shield-baseline-1793874504741.json` remains failed; original-state restoration passes. | Verifier now skips both private Git alias namespaces while checking actual current files. Exact synthetic fixture/trust retirement, sixteen retained query exits/two scanner exits and owned source/signing/package/staging/proof-checkout cleanup verify (`failed-history-proof-cleanup-1793874565999.json`). Corrected installed acceptance passes separately at `4901cc8`; this failure remains failed. |
| Linux historical scanner connection | Five focused cases and six isolated scanner/history/index/runner groups pass all 60 checks with every child cleanup verified (`isolated-test-cc61dae8-a7f3-4781-acae-d8c4661e19f1.json`). Actual isolated scan finds a secret removed from the current file and authenticates commit/blob provenance; late HEAD drift removes copies with no scanner start. | Only explicitly owned paths, all selected first-parent versions and bounded depth; incomplete coverage remains. General execution, physical substitution and mixed index/history requests refuse. Subsequent exact-traversal tests pass 21 checks in three groups, including same-boolean shallow drift (`isolated-test-db045785-1e6d-4abc-bd24-870649db6d74.json`); ten surrounding groups pass 22 (`isolated-test-35db7f9e-d4a0-4779-9444-448c060c2414.json`), all child cleanup verified. Installed Linux history scan now passes at `4901cc8`; Windows historical scanner connection passes software contracts; native acceptance remains separate. [Contract](historical-shield-inputs.md). |
| Installed history byte witnessing | Normal installed `40bb3eb`, release `cb74c174ae8fa881d9be19bdb2d735bbf6bb845c910630da18c9facdf8645c3c`, passes six update/fourteen actual API and separate current-file scan checks; eleven query probes/two scanners independently exit, unchanged original repository and full restoration verify. | Receipts `assignment-legends-1793873715840.json` and `installed-shield-baseline-1793873865290.json`; owned repository/signing/packages/staging/bundle/proof checkout removed, one empty task/zero prompts/no keyboard access. Witness itself performs no historical scan. |
| Selected history byte witnesses | Four isolated history/index/runner groups pass all 38 checks with child cleanup (`isolated-test-e5445075-0749-41a5-a947-13458f79eab7.json`). Raw commit links, reconstructed tree hashes, selected blob bytes, real HTTP/native exits and exact deadline/drift refusals pass. | No source/messages returned, authority or scan. First-parent/depth/path bounds and incomplete scope remain explicit; installed witness acceptance passes separately above. Linux historical scanner software checks pass; native Windows remains separate. [Contract](git-history-inputs.md). |
| Complete Linux staged-scanner checkpoint | Immutable `11d8cc7`: 208/208 required groups, 1,241 tests, 1,231 passed and ten declared skips. Receipt `isolated-test-10ea941c-1736-4c0a-8e11-c83a4bd24a3d.json`; every child cleanup verified and owned fixture/worktree removed. | Includes exact index witnesses, isolated staged/worktree scans and the corrected deadline inventory. Later Windows transport work remains separately tested; native Windows/physical/account acceptance is not inferred. |
| Complete Linux OSV/generated-tree checkpoint | Immutable `adbd10a`: 205/205 required groups, 1,222 tests, 1,212 passed and ten declared skips. Receipt `isolated-test-c4c0c525-33d5-4ed8-9ebf-8784cee9e487.json`; every child cleanup verified and owned fixture/worktree removed. | Includes OSV source and explicit generated-tree policy. Later index-input work remains separately tested; native Windows/physical/account acceptance is not inferred. |
| Later index-witness checkpoint failure | Immutable `4a6627a`: 206/207 groups pass, 1,223 tests pass, one fails and ten declared skips. The exact deadline-inventory guard lacks the new index group entry; receipt `isolated-test-72711a93-699d-4602-b263-91b5055f79e7.json` remains failed. | Source now includes the exact new entries without changing their bounds; the corrected guard passes in the 37-check isolated subset. Every old child cleanup verifies, no owned process remains, and owned fixtures/checkout were removed (`failed-full-index-inventory-cleanup-1793868621389.json`). Later immutable `11d8cc7` passes all 208 groups with child cleanup; this older failure remains failed. |
| Complete Linux preview/scenario checkpoint | Immutable `3cb0897`: 200/200 required groups, 1,207 tests, 1,197 passed and ten declared skips. Receipt `isolated-test-1d343e79-2220-4a01-85e4-2ff4a5f5cf78.json`; every child cleanup verified and owned fixture/worktree removed. | Later generated-tree exclusions and OSV changes remain separately tested; native Windows/physical/account acceptance is not inferred. |
| Complete Linux workspace checkpoint | Immutable `18e6185`: 192/192 groups, 1,197 tests, 1,187 passed and ten declared skips. Receipt `isolated-test-2ff9aeb6-bbc7-471c-9a6b-c50aea14fe8a.json`. | Every child cleanup verifies; owned fixtures and detached checkout removed. Later preview/scenario/diagnostic changes remain separately tested. |
| Complete Linux authority/haptic checkpoint | Immutable `6a45643`: 191/191 groups, 1,192 tests, 1,182 passed and ten declared skips. Receipt `isolated-test-b0474209-3e04-4603-8ef6-441f439fb5d6.json`. | Every child cleanup verifies; owned fixtures and detached checkout removed. Later workspace inventory separately passes 14/14 tests in two groups, receipt `isolated-test-54ad40b5-a325-4130-9d63-93d5e307d1d6.json`; child cleanup verifies. |
| GitHub Linux overlay prerequisite | Source `6a45643`, workflow [41982439206](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41982439206), fails the actual bounded-build test because the distribution Bubblewrap lacks `--overlay-src`. | Remains failed. CI now builds SHA-256-pinned upstream 0.13.1 only on the disposable worker. Official archive checksum independently matches (`ci-bubblewrap-source-1793862181470.json`); no workstation change. Later workflow [41984665699](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41984665699) builds the helper and passes the outer namespace probe, but fails nested setup with a namespace permission refusal. The distribution AppArmor child-capability denial needs scoped integration. CI adds one exact fixed-helper inheritance rule to the setup profile only; ordinary child capabilities and final user namespaces remain denied. Native acceptance is pending. Both failures remain retained; no workstation/sysctl/test change. |
| Complete Linux connected-exception checkpoint | Immutable `82bd9b3`: 188/188 required groups, 1,185 tests, 1,175 passed, ten declared skips. Receipt `isolated-test-028adfa5-e6df-40ae-8931-85c79fd9c6ab.json` retained. | Every child cleanup verifies; owned fixture root and checkout removed. Later outcome/deadline, local authority guard and haptic assessment are separate. |
| Solenoid source assessment | Seven source/capability/catalog cases, twenty-five inventory/readout contracts and twenty-three package/Suite cases pass. Exact WCASS/Leyden F77 declarations are distinguished from live state, physical hardware and electrical limits; unknown/protocol-conflicting/forged capabilities leave no operations. | Source comparison only; instrumented API makes zero HID calls and preserves profiles/mode/readouts. Runtime state/control implementation and physical acceptance remain separate. Installed inspection is pending. [Audit](solenoid-capability-audit.md). |
| Public OSV source | Five collector/scanner/parser tests, two real-Linux/Windows-guest-double host journeys, twenty-nine surrounding checks and type checking pass. Four isolated groups pass 21 checks with child cleanup (`isolated-test-dec40fb3-9986-4f63-95f2-00027d4d5417.json`). | Live CLI collects two explicit public stable npm versions, independently checks matches and emits an unsigned hash-bound feed. `osv-live-1793865854913-{advisory,provenance}.json` retained, owned collection scratch removed. Severity remains unassessed, all matched vulnerabilities fail; signing/enrollment separate. Installed `adbd10a` passes six update/fourteen actual source and scan checks with two verified scanner exits, full restoration and owned source/signing/packages/staging/bundle/checkout removed. Receipts `assignment-legends-1793866214773.json` and `installed-shield-baseline-1793866400136.json`; zero prompts, no keyboard access. [Contract](osv-advisory-source.md). |
| Explicit ignored generated-tree authority | Three policy/filesystem cases, three real-Git authority cases and two real-Linux/Windows-guest-double execution cases pass. An 80 MiB ignored tree stays outside hashing/staging while selected secret bytes remain exact; generated churn preserves policy and root replacement refuses new admission. | Ten surrounding input checks, thirty-one authority/runner/package checks and type checking pass. Distinct directory-policy fingerprints, reviewed Shield-only exclusions and incomplete coverage; normal installed 03710e9 passes six update/eighteen actual inventory/tree/secret checks with two scanner exits and full restoration. Receipts `assignment-legends-1793864731589.json` and `installed-shield-baseline-1793864938308.json`; all owned source/signing/sparse build/packages/staging/bundle/proof checkout removed, zero prompts. Native Windows pending. [Contract](ignored-build-tree-policy.md). |
| Installed Windows-connection compatibility | Normal installed Linux `112efdc`, release `408086bab7911cc60170fed4576414ad04356aaca45f735fe49591377dc10462`, passes six update/thirteen actual staged/worktree API checks. Both scanner exits, original Git provenance, replay/feed retirement and full restoration verify. | Receipts `assignment-legends-1793871636105.json` and `installed-shield-baseline-1793871799715.json`; all owned source/signing/packages/staging/bundle/checkout removed, one empty task/zero prompts, no keyboard access. Linux compatibility does not infer native Windows acceptance. |
| Windows reviewed index connection | Five isolated groups pass all 52 focused input/authority/runner/scanner checks (`isolated-test-954840a2-3fa0-466b-ac27-3791b4a121c4.json`); ten ordinary Windows scanner/pipeline/Run/input/package groups pass 29 (`isolated-test-115dfe58-5a6c-4e0d-9bdb-ca97f11e2b88.json`). Type checking and the native-verifier environment guard pass; every child cleanup verifies. | Actual orchestrator validates index bytes before tools/storage/guest and removes owned copies after late refusal. Full reviewed guest-double scan consumes real Git bytes and authenticates provenance. Separate CI verifier uses real NTFS staging and owned guardians with malformed packet injection, before service lifecycle checks; its native acceptance is pending. Native guest/interactive/installed acceptance remains separate. [Contract](windows-index-staging.md). |
| Windows index transport foundation | Helper and portable proof compile with zero warnings/errors using the existing offline SDK. Forty-nine new pure native packet checks and all 112 previous checks pass, including exact Node JSON hashes across Unicode/base64 encoding (`windows-index-native-build-1793869623746.json`). Four JS transport/runner/selector/package groups pass 27 checks with child cleanup (`isolated-test-c2366df9-0439-4560-a8cf-0b107dc7d836.json`); type checking passes. | Owned build scratch removed; no service/volume/account/guest/keyboard opened. Strict aliases, object hashes, packet/witness digests and zeroed buffers; 320 KiB raw subset inside unchanged 512 KiB native stdin. Later reviewed host connection passes 52 focused and 29 ordinary regression checks; actual NTFS/guest and installed acceptance remain unaccepted. [Contract](windows-index-staging.md). |
| Linux explicit staged scanner inputs | Six focused cases pass, including actual staged-only secret detection alongside clean worktree input, exact provenance, duplicate-content finding identity, staging drift with no program start and general Run/pipeline/substitution refusals. Four isolated groups pass 26 scanner/index/exception checks (`isolated-test-21c607e3-b727-4b85-b44d-fe5020caad5e.json`); four task/runner/stager groups pass 37 (`isolated-test-12e025c2-e08b-42de-9f49-fc1d680df92f.json`), and eight ordinary scanner/staging groups pass fourteen (`isolated-test-be2f96fc-727a-40bb-942f-40efb4041e4d.json`). | Every child cleanup verifies. Type checking and deterministic development BOM check pass. Explicit reviewed aliases live only in private disposable staging; all results remain non-passing. Installed 11d8cc7 passes six update/thirteen actual staged/worktree API checks, with both scanner exits, original provenance, replay/feed retirement and full restoration. Receipts `assignment-legends-1793868587004.json` and `installed-shield-baseline-1793868749979.json`; all owned source/signing/packages/staging/bundle/checkout removed, zero prompts. Windows reviewed connection now passes software contracts; native acceptance remains separate. [Contract](staged-shield-inputs.md). |
| Git index byte witnesses | Four parser/hash cases, task-bound authenticated HTTP, five drift scenarios and real Linux guardians pass; 25 surrounding cases, 24 runner/selection/package checks and type checking pass. Four isolated groups pass 25 checks with verified child cleanup (`isolated-test-ae93b9fc-ed7d-42a2-b210-af874c191b08.json`). | Index bytes differ from the worktree and are verified against their original Git object identities without source disclosure, grant or scan claim. A prior fixture teardown failure remains failed in `isolated-test-6ac353a1-4e8d-4b57-8251-b338a3d044a0.json`; sequential fixture owner shutdown corrects the race, both runner cleanups verify. Installed 4a6627a passes six update/fourteen actual witness and separate worktree-scan checks with all six query probes and two scanner exits independently verified, full restoration and owned scratch removed. Receipts `assignment-legends-1793867452227.json` and `installed-shield-baseline-1793867608531.json`; zero prompts. Separate Linux staged scanner source checks now pass; installed Linux staged-scan acceptance passes at 11d8cc7; Windows reviewed staging now passes software contracts; native acceptance remains separate. [Contract](git-index-inputs.md). |
| Scanner input preparation | Four bounded parser/real-Git/authenticated HTTP/drift/cleanup checks and thirty-four surrounding authority/runner/package cases pass, with type checking. An 80 MiB ignored build fixture stays grouped while root/nested ignored secret-file names are identified. | Incomplete metadata preview only; no source byte witness, scan, grant, security receipt or model prompt. Normal installed bfb7f1d passes six update/sixteen actual preview/scan checks; exact prior maintenance journal retained, every inventory probe independently exited, two scanner exits and full restoration. Receipts `assignment-legends-1793863080369.json` and `installed-shield-baseline-1793863236319.json`; all owned scratch removed. Prior failed verifier receipt and cleanup retained separately. Consequential snapshot limits stay unchanged. [Contract](scanner-input-inventory.md). |
| Independent Windows scenarios and removal phases | Nineteen runner/selector cases and eight separately exited Shield/stop scenarios pass locally, with every cleanup verified (`isolated-test-a2e0b8c1-ad73-4e98-b009-72ec411d2904.json`). Helper/proof compile with zero warnings and 112 portable checks pass using the existing SDK. | Earlier native 300-second failures remain failed. Scenarios keep their original child bounds and every assertion; verifier selection requires the entire fixed inventory. Removal changes only bounded phase labels, retaining all comparisons, native-code checks and deadlines. Native acceptance pending; `windows-removal-phase-build-1793863699257.json` binds the compiled working source. |
| New native Windows contract evidence | Source `6a45643`: eight separately digest-verified groups pass 23 tests and three platform skips, with all child cleanup verified. | Exceptions, ignored inputs, receipt-time authority and policy invalidation are native host software with the guest doubled. Full filesystem acceptance still fails service-removal query/configuration; Shield policy and stop groups time out at 300 seconds. All three failed artifacts are retained. [Exact IDs/digests/counts](evidence/windows6a-validation-summary.json). |
| Installed workspace lock inventory | Normal installed `7dc9196`, release `413aaebca22a4f4336af2202481386376802dd390f524d660708823839297014`, passes six update/fourteen actual Supply Chain API checks. Known-vulnerable input fails and clean input remains incomplete, with two verified exits, original-state preservation and exact report-bound BOMs. | Receipts `assignment-legends-1793862128657.json` and `installed-shield-baseline-1793862282934.json`; one empty task/zero prompts, all owned source/signing/packages/staging/bundle/proof checkout removed. |
| Later native Windows client checkpoint | PR head `112efdc`, workflow [42004196356](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/42004196356): six groups, 61/61 tests, no skips and all child cleanup verified. | Artifact `13403888383`, merge-artifact name `switchyard-client-platform-531a63f9b899323c86a5d33b8101cd8a1fae76d7`, archive SHA-256 `ecbf20fb3d9a5484d9bdd7164928be77bdbc126f7d5367bd9b9ca882bac2d1e1` independently verified. Only `windows-client-platform-112efdc.json` retained. This is client software, not NTFS/guest/account/UI acceptance. |
| Native Windows client checkpoint | Source `6a45643`, workflow [41982439144](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41982439144): six groups, 61/61 tests, all child cleanup verified. | Artifact `13394747014` SHA-256 `7be71c7217c8002c5bbcb475fa47e708801e7b08a85e89169872898dcdcfb9c0` independently verified; only `windows-client-platform-6a45643.json` retained. No guest/account/UI acceptance inferred. |
| Installed cached F77 source capability | Normal installed `6a45643` passes six update and three actual cached-readout API checks; zero HID transactions or prompts. | Receipts `assignment-legends-1793861120925.json` and `installed-haptic-source-1793861121084.json`; original readout/profile/workflow/mode/endpoint preserved and owned bundle/proof checkout removed. Source support grants no physical control. |
| Workspace lock inventory | Twelve scanner cases and six real-Linux/Windows-guest-double integration cases pass; actual seven-component BOM conforms to the official CycloneDX 1.6 schema and three invalid mutations are rejected. | Exact root-contained lock metadata only; no source-directory reads, hook execution, source/graph/provenance acceptance or complete pass. Receipt `cyclonedx-workspace-schema-proof-1793861912692.json`; temporary validator removed. Installed workspace acceptance passes at 7dc9196, as recorded above. |
| Installed receipt-time authority | Normal installed `0f04adc`, release `1d8c3ce421672a4516b86cf8fe18d286a3b60e2f0e070f5b1acc49c9dd0ce25c`, passes six update/seventeen actual exception/scan checks, with three independent native exits and restored original state. | Receipts `assignment-legends-1793860291500.json` and `installed-shield-baseline-1793860601561.json`; owned source/packages/signing/staging/bundle/proof checkout removed, zero prompts. |
| Receipt-time authority state | Three focused cases pass: protected scope/receipt mutations, exact expiry/revocation and two post-validation host races. Six existing pipeline/policy races, twenty-nine contract/maintenance cases, six package/state checks, six Shield/exception regressions and type checking pass. | Current protected state is checked inside append; no nested store I/O. Linux account change and Windows grant withdrawal refuse a pass after zero native exit. Guest is doubled; installed acceptance passes at 0f04adc, while native Windows remains separate. [Contract](receipt-authority-commit.md). |
| Installed exception outcome update | Normal installed `0423f23`, release `d6c38d53a33776dfb1ffc3b2f7d6b361d0de4e401612a39dbae8ae447ad4b6a4`, passes six update checks. | `assignment-legends-1793859695968.json` retained; owned bundle/proof checkout removed. Actual exception/scan journey remains accepted separately at 82bd9b3. |
| Installed reviewed exceptions | Normal installed `82bd9b3`, release `4175121a117a6cdbb72eac3e685158e01b9d0b594b53a1493853ea896677ec96`, passes six update/seventeen actual API checks: exact approval, authenticated raw-finding preservation, incomplete repeat, withdrawal, original expiry/replay and three native exits. | Original state restored; owned source/packages/signing/staging/bundle/proof checkout removed. Receipts `assignment-legends-1793859246213.json` and `installed-shield-baseline-1793859581132.json`; zero prompts. Later outcome correction remains separately source-tested. |
| Exception outcome correction | Thirteen controller/ledger cases pass. Verified transaction rollback settles failed/not-started with a sanitized audit; exact committed receipt/effect read-back recovers a lost acknowledgement without replay. A late budget boundary rolls back policy, budgets and prior-receipt retirement. | Later than installed/connected `82bd9b3`; its focused evidence is separate. Unknown read-back is never treated as success. |
| Complete Linux ignored-input/foundation checkpoint | Immutable `ace2d22`: 185/185 groups, 1,176 tests, 1,166 passed, ten declared skips. Receipt `isolated-test-3f42aecd-3967-4c0c-bda3-67b9b7d268ef.json` retained. | Every child cleanup verifies; owned fixture root and checkout removed. Connected exceptions and later outcome correction remain separate. |
| Reviewed finding exceptions | Twenty-nine core/controller/HTTP/inventory cases, eleven final package/controller checks, forty Suite/maintenance/Shield/race regressions and two separate real Linux/Windows guest-double journeys pass; type checking passes. Exact grant/withdrawal, raw finding preservation, decision authentication, incomplete receipts and failure restoration are verified. | Operator policy commits atomically with audit, budget and prior receipt retirement; source receipt remains fresh inside commit. New native Windows remains pending; installed exception acceptance passes at 82bd9b3. Frontend controls and full coverage remain unfinished. [Contract](shield-exceptions.md). |
| Complete Linux retirement checkpoint | Immutable `9f3024e`: 182/182 groups, 1,166 tests, 1,156 passed, ten declared skips. Receipt `isolated-test-23947e9d-cdf5-4c8d-8d4b-e81335569189.json` retained; every child cleanup verifies. | Owned fixture root/checkout removed. Later ignored-input/exception foundation and connected exception source are separate. |
| Exception ledger foundation | Twenty-three ledger/confirmation/inventory cases, twenty existing journal/maintenance cases, type checking and five packaged release checks pass. Exact scope, expiry, redacted reasons, immutable withdrawal and atomic multi-domain rollback are covered. | Foundation checkpoint `ace2d22`; operator API and scan application are accepted in the later connected-source row. This foundation alone had no active override path or complete Shield claim. [Contract](shield-exceptions.md). |
| Explicit ignored scanner inputs | Three authority cases and two real-Linux/Windows guest-double execution cases pass; seventeen authority/Run/Shield regressions, twenty-two inventory/package checks and type checking pass. Exact ignored bytes bind review/issuance/revalidation; a synthetic ignored `.env` is found without disclosing matched bytes or staging/modifying it. | Ignored paths are explicitly owned for pinned Shield only; mixed commit/Run/pipeline grants fail before native queries. Automatic relevant-secret/large-build-tree/whole-repository/history scope remains unfinished. Normal installed `1a5cd43` passes six update/sixteen real Change Scan checks, including exact expiry/retirement/replay and two native exits. Receipts `assignment-legends-1793857942421.json` and `installed-shield-baseline-1793858153322.json`; original state restored, owned scratch removed, zero prompts. Native Windows remains separate. [Contract](ignored-scanner-inputs.md). |
| Installed receipt retirement | Normal installed `9f3024e`, release `31905b5bf9240446ba556d0c1681676eac5fb831b87b14b3a961727af8222115`, passes six update/fourteen real Supply Chain checks, exact expiry/invalidation/replay and two independently verified native exits. | Historical failed/incomplete outcomes preserved; original state restored, owned source/packages/signing/bundle/proof checkout removed. Receipts `assignment-legends-1793857471815.json` and `installed-shield-baseline-1793857655461.json`; zero prompts. |
| Feed-policy receipt retirement | Thirty-five core/maintenance/inventory/package cases pass; final package/recovery group passes ten. Four existing Linux/Windows pipeline cases expose revoked receipts; two deterministic post-validation races refuse a pass despite verified zero native exit. Twenty maintenance/removal/Linux/Windows Shield cases, fifteen existing Run/recovery/output cases and type checking pass. | Reviewed version 2 effects invalidate prior six-action results in one compartment before registry mutation. Both hosts guard receipt commit; Run and other compartments remain outside that retirement. New native CI is pending; installed retirement acceptance passes at 9f3024e. [Contract](validation-receipt-invalidation.md). |
| Complete Linux shared scanner | Immutable `9a73479`: 180/180 required groups, 1,157 tests, 1,147 passed, ten declared skips. `isolated-test-32b40b9e-9781-41fd-9884-5ff70282cbdb.json` retained. | Every child cleanup verifies; owned fixture parent/checkout removed. Later deadline and invalidation source are separate. |
| Signed feed effective expiry | Nineteen registry cases pass with real P-256 packages, each deadline source, exact expiry and a last-millisecond authenticated observation rejected at trust expiry. Thirty-six contract/evidence/package and nineteen controller/removal/pipeline/Windows Shield cases pass; type checking passes. | Evidence expiry is the earliest content expiry, signed maximum-age deadline or trust expiry. Signed bytes/declared expiry remain unchanged. Installed `0cd785f` passes six update/thirteen actual checks; receipts `assignment-legends-1793856754649.json` and `installed-shield-baseline-1793856930607.json`. Two guardians exit; original state restored and owned scratch removed. |
| Installed shared strict parser | Normal installed `9a73479`, release `af1b58752f76e021e2a790a8052a0439407dce9b548fd0a462d32bbf399959c8`, passes six update/eleven actual Supply Chain API checks, exact report-bound BOM/receipt/replay, two independent exits and full restoration. | One empty task, zero prompts. Receipts `assignment-legends-1793855902184.json` and `installed-shield-baseline-1793856071289.json` retained; owned scratch removed. This is Linux acceptance; native Windows remains separate. |
| Windows pinned baseline connection | Both policy/recovery cases pass: all four actions plus clean input, source/recipe/feed refusal and lost acknowledgement without replay. Two attestation cases pass with fifteen negative faults. Three independently exited Windows/shared-Linux groups pass five cases with all cleanup verified; existing Run/authority 35, pipeline/evidence five and final package/inventory/evidence 27 pass. | Guest is explicitly doubled. Exact source/feed/native-result/HMAC/receipt software is exercised; actual Windows Sandbox/UAC/account and new native CI acceptance remain separate. [Contract](windows-shield.md). |
| Installed scoped BOM data | Normal installed `8e83371`, release `bfcbc28da24980f712872357c42416bd4203c1c65394ff2adc52b58e3e076e60`, passes six update and eleven actual Supply Chain API checks. Known-vulnerable and clean incomplete versions return report-bound CycloneDX hashes, exact replay and two independently verified native exits; feed retirement and full restoration pass. | Zero prompts. Receipts `assignment-legends-1793854523011.json` and `installed-shield-baseline-1793854727077.json` retained; owned staging/packages/signing/bundle/proof checkout removed. Full Shield remains incomplete. |
| CycloneDX and npm aliases | Nine scanner cases and real namespace integration pass. Four generated BOMs, including the actual Switchyard development lock and scoped aliases, conform to the official CycloneDX 1.6 schema; three invalid mutations are rejected. `cyclonedx-schema-proof-1793853836585.json` retains exact schema and validator source hashes; all temporary schemas/tooling/cache removed. | The example inventories three external packages and declares unknown composition, unverified repository scope and uncollected dependency graph/provenance. Workspace links remain unsupported. No host package or runtime installed; installed SBOM acceptance is pending. [Evidence](evidence/README.md). |
| Installed scanner entrypoint closure | Normal installed `326a9f3`, release `dd846e8dc7351b8020f4d24006ce870aa83f35e0ffe6ea9ed6df7744ab4ba709`, passes six update and eleven actual API checks: exact engine bytes under a Node-option filename refuse admission before execution; valid failing and clean incomplete scans, receipt/replay, two independent exits, feed retirement and full restoration pass. | Receipts `assignment-legends-1793853690564.json` and `installed-shield-baseline-1793853836585.json` retained; owned packages/signing/staging/bundle/checkout removed. Zero prompts. The direct Alacritty extension is installed but its native check is blocked by absent Alacritty; no terminal or config is installed. Later CycloneDX work is separate. |
| Installed Shield baseline | Normal installed `b6dca0a`, release `239f77a0e92b66e4a6a324e6a590f7f553d215aae93ee277fd27ef65b85bd010`, passes six update and thirteen checks through authenticated normal APIs: four failed scans, clean incomplete case, separate one-action grants, exact report/receipt coverage, replay, five independent native exits, feed revocation/retirement and restored original selection/modes/definitions/private endpoint/frozen Home. | One empty native task, zero prompts; complete Shield remains unaccepted. Receipts `assignment-legends-1793853154242.json` and `installed-shield-baseline-1793853523201.json` retained; owned stages/packages/signing scratch/bundle/proof checkout removed. Earlier refused four-action verifier receipt remains failed, with separate exact cleanup. New option-filename guard and Alacritty extension are later source changes. |
| Pinned Shield baseline implementation | Seven scanner cases and three integration cases pass, including six actual namespace scans, all four actions, clean incomplete scope, exact signed feeds, failed receipts with incomplete coverage, tampering and revocation before/after execution. Eight supervisor cases include all six higher-level actions refusing native-zero-exit upgrades. Existing pipeline/build/Suite cases pass 27; receipt/runtime/package checks pass 75, with 35 final ledger/scanner/package/inventory checks and type checking. | Baseline heuristics and reviewed inputs only. Full repository/ignored-secret/history inventory, broader ecosystems, publisher provenance and audited expiring exceptions remain unfinished implementation. Installed proof is pending. [Contract](shield-baseline-scanner.md). |
| Bounded writable-copy build implementation | Three manifest/capability/native cases and two pipeline cases pass, covering an actual generated build, unchanged live/staged inputs, shared 64 MiB overlay-plus-temporary ENOSPC, hidden setup paths, explicit read-only enforcement, exact permission-bound review/checkpoint, both HMAC pipeline receipts, replay and stop cleanup. Combined new/harness group passes 22; runtime/guardian/inventory 37; build/Run/Suite/package 33; type checking passes. | The host must enable this Linux-specific extension. Source JSON cannot enable an uncontained host fallback. Files are ephemeral; artifact export/live write-back is not added. Installed `50dd23d` passes six update and ten writable-copy Run/stop checks, zero prompts, with original workspace/private endpoint/frozen Home preserved. Receipts `assignment-legends-1793851542323.json` and `installed-repository-execution-1793851723364.json` retained; owned staging/bundle/proof checkout removed. [Contract](bounded-build-workspace.md). |
| Installed namespace quota closure | Normal installed `d2c413d`, release `d59010f455c4202cffde4bd7fec786c817e1a721c81117ec0e76e0d4465f7933`, passes six update and ten actual Run/stop checks. Root/device write denials run through the normal API, along with original inputs, exact stop/replay, native exit and cleanup. Receipts `assignment-legends-1793850275117.json` and `installed-repository-execution-1793850446831.json` retained. | One empty native Codex task, zero prompts. Original selection/modes/definitions/private endpoint/frozen Home preserved; owned inputs, bundle and proof checkout removed. The newer writable-copy mode also passes its installed checkpoint above. |
| Complete corrected Linux checkpoint | Immutable `8e83371` passes 177/177 groups: 1,153 tests, 1,143 passed and ten declared skips. Receipt `e62a9f97-1739-46e2-ace5-c806b79262da` retained with every child cleanup verified; owned fixture parent and checkout removed. | Includes baseline Shield, receipt completeness/recovery, entrypoint closure, direct-terminal checks and CycloneDX. Predates the new Windows Shield source; its 180-group lane remains pending. Native guest/account/physical acceptance remains separate. |
| Deletion-query pending handling | Native `238592b` pinpoints `service-absence-query-configuration`. Queries now preserve Win32 codes; recognized missing/deleted/marked metadata is only a bounded pending observation after the original accepted delete. Both actual C# targets compile warning-free and 112 portable checks pass; owned scratch removed. | No unavailable configuration becomes absence or a matching configuration. Observable mismatches, access denial and unknown-handle errors still fail closed. Only a fresh OpenService error 1060 permits final file removal under the unchanged ten-second bound. Fresh native acceptance is pending. |
| Linux temporary-quota escape closure | A new actual-namespace probe demonstrated regular-file writes outside capped `/tmp`, under generated root and device filesystems. Those mounts are now read-only; further user namespaces are disabled/asserted. Thirty-one namespace/runtime/guardian/inventory cases pass, including aggregate 64 MiB ENOSPC across several files, denied root/device writes, a usable `/dev/null`, denied nested namespace creation and unchanged host namespace limit. Thirty actual pipeline/Suite/package regressions and type checking also pass. | Applies to the Suite's read-only reviewed workspace. Previous quota claims covered `/tmp` and did not establish closure of these other paths. Bounded writable preparation and independent adversarial assessment remain separate; installed acceptance is pending. No host sysctl, desktop config or live repository changed. |
| Current installed compatibility checkpoint | Normal installed `3ec0549`, release `a170fa2163dd28062afd6ec24f65beb85fe1a0a791c09b4559f0607c3b8f8ce8`, passes six update and eight actual Claude metadata checks through nine independently exited guardians. Receipts `assignment-legends-1793849251592.json` and `installed-claude-commands-1793849314893.json` retained. | Exact 2.1.317 metadata, no prompt/background task/external stop. Selection, modes, definitions/private endpoint/frozen Home preserved; owned bundle, source checkout and temporary metadata state removed. Current-version model execution remains unaccepted. |
| Retained complete Linux capability failure | Immutable `5d398d2` attempts 172 groups: 171 passed, one failed; 1,129 tests, 1,118 passed, one failed and ten declared skips. Receipt `43d14c61-5e5b-4f96-96b7-35795fa88afa` retained with every child cleanup verified; failed source/fixture parent removed after the isolated correction passes. | The authority test expected only Run in the capability catalog. It now checks all three connected actions while proving its issued grant remains Run-only and refusing unsupported/Work actions. All nine authority cases pass. The failed complete run remains failed; a fresh complete rerun is required. |
| Native removal configuration phase and correction | At `14aae78`, workflow [41961018330](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41961018330) pinpoints failure in `service-absence-configuration`. Archive SHA-256 `501f29b1b8a26163533b04abecf7c282d35cce6e18a5465a3c19aa739e89f7ab` verifies; `windows-service-removal-14a-configuration-failed.json` remains failed. | Full original configuration now rechecks before accepted deletion; deletion polling tolerates only an absent original environment registry key, with every present value/configuration still pinned. Exact stopped state, independent original process exit, error-1060 absence and the unchanged ten-second bound still precede file removal. Both actual C# targets compile warning-free and 112 portable checks pass; native rerun is pending. |
| Claude 2.1.317 metadata and exact-version approvals | 34 agent/submission checks and 23 Suite/package regressions pass; type checking passes. Actual installed discovery plus source shared metadata pass eight checks through nine distinct stopped guardians, without prompts, background tasks or external session stops. `installed-claude-commands-1793849052080.json` retained; the repeat verifier records the exact version. | Explicit reviewed versions are 2.1.308 and 2.1.317. Tests bind text approval to the exact version and reject changed-version replies. Model replies in the new version's tests are synthetic; real 2.1.317 model execution and Windows CLI/account acceptance remain unaccepted. No implementation was delegated to Claude. |
| Native Windows pipeline checkpoint | At `5d398d2`, workflow [41960677205](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41960677205) passes all sixteen jobs. Pipeline policy/evidence/recovery artifacts verify SHA-256 `874513960972257d07be3644d41f115056257ec4ccda1bf679bc076b42b9880c`, `28864fdaaf6591768d88071ebdfec01fb52b89d3d9b6f3fd2814b2e92fd7e156`, `614533e73abedd29485132adb59a1cd9a173a84db3cb75002b94667d9ffdf77b`; six cases pass and every child cleanup verifies. Small `windows-pipeline-*-5d3.json` receipts retained. | Native OS/crypto/task/ownership boundaries are real; guest execution is explicitly doubled. Native service/filesystem jobs pass at this source, while the earlier `25bd26c` removal failure remains failed. The stopped-PID correction postdates this run. |
| Stopped SCM PID contract and removal diagnostics | Both actual C# targets compile with zero warnings/errors; 112 portable protocol/journal/fact checks pass using the existing offline SDK. Only source-linked build scratch was used and removed. The observer retains independent original-process exit and requires exact SCM absence under the unchanged ten-second bound; invalid stopped PIDs no longer decide it. | Native `25bd26c` remains failed. This corrects a documented API mismatch and adds precise observation phases; fresh native lifecycle acceptance is pending and the prior failure's exact cause is not inferred solely from this correction. [API contract](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-queryservicestatusex). |
| Windows pipeline admission and host evidence | 35 policy/evidence/parser/harness/package cases, 22 existing Run/owner cases and an explicit lost-observation/restart case pass; type checking passes. Both pipeline actions bind actual P-256 registry feeds and HMAC evidence. Twenty-four report/ownership/expiry fault inputs and recovery non-upgrade are covered. | Guest execution is explicitly doubled. Complete native pipeline and interactive account/guest acceptance remain pending. [Contract](windows-pipelines.md). |
| Complete Linux quota/removal checkpoint | Immutable `403e0c9` passes all 168 groups: 1,121 tests, 1,111 passed and ten declared skips. Receipt `13be1a30-2e93-4b87-8a94-9a1953285b9f` retained; every child cleanup verified and owned fixtures/checkout removed. | Predates the test split and Windows profile/pipeline changes; current required Linux inventory has 172 groups. |
| Native profile and split fixture contracts | At `25bd26c`, workflow [41959567836](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41959567836) passes all twelve complete contract jobs. `windows-{fixture-maintenance,fixture-removal,backend-contract}-25b.json` archive digests verify; eleven, four and 34 tests pass, every child cleanup verified. | The separate native lifecycle job fails service-absence verification after eight actual JavaScript-owner and 31 restricted-client checks pass. Digest-verified `windows-exchange-25b-removal-failed.json` remains failed (archive `295d5acfd09e97948208eaacbbc0171105b91f868ffce068a56a237c08b01472`). Prior accepted runs do not erase this failure. |
| Windows Run backend profile contract | The Run caller now selects the backend-supported `full_sandbox` profile for `run_target`; 51 complete backend/runner checks and type checking pass. The actual backend rejects the old mismatch before dispatch and verifies exact reviewed mapping/guest exit with an explicit native guest double for the corrected profile. | No profile check is relaxed, guest is launched or live Windows acceptance inferred. Fixed network/clipboard denial and one-shot, nonpersistent execution verify. A focused complete backend contract matrix job is added under its existing isolated bound. |
| Native fixture registry and retained controller timeout | At `403e0c9`, workflow [41958987641](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41958987641) passes all seventeen registry cases. Artifact SHA-256 `a34c1dbfa71c348c16c5d16db22dda894a529812b8032ed395c2baf95b153673` verified; `windows-fixture-registry-403.json` retained with child cleanup verified. | The combined controller file times out at its original 120 seconds after thirteen passing cases; digest-verified `windows-fixture-maintenance-failed-403.json` remains failed (archive `e3206a5cecaf92571d842a56f06c1d01c1088cc4c1e6a0a18ed5024985a9775a`). Eleven maintenance and four removal cases now run independently with the same original bound. No assertion or production deadline changed. Native rerun is pending. |
| Installed aggregate quota and approved removal | Normal installed `403e0c9`, release `c41ad33e45fd0e1accd5b4b0cad0f6b0abb0b7d6729f2c5c2fd7536fb51101aa`, passes six update and eleven API checks. Receipts `assignment-legends-1793847745744.json` and `installed-signed-fixtures-1793847762267.json` retained. Manifest/content accounting, revoked allocation retention, exact approved deletion, released quota, retained tombstones and duplicate original receipt verify. | New synthetic Personal compartment only, no provider/account/hardware operation. Original selection/definitions/modes/private endpoint/frozen Home restored; signing scratch, bundle and disposable proof checkout removed. Focused Windows checks and the complete Linux lane at this source are running separately. |
| Aggregate fixture storage and reviewed removal | 88 combined registry/controller/service/HTTP/privacy/harness/package checks and two additional linked/legacy registry cases pass; type checking passes. Atomic byte/count reservations, unknown-outcome retention, exact original-file deletion, partial-removal fresh approval and lost-reply preservation are exercised with real files, crypto, AEAD persistence and kernel leases. | Installed/native Windows acceptance is pending. Focused registry and maintenance matrix jobs use their original isolated bounds. Same-user adversarial assessment, complete Shield execution and frontend controls remain separate. |
| Complete Linux signed-fixture checkpoint | Immutable `27e0eb3` passes 168/168 groups: 1,117 tests, 1,107 passed and ten declared skips. Receipt `df4c7c97-bddc-41b3-8cde-a92fdf1e5822` retained; every child cleanup verified and owned fixtures/checkout removed. | Includes actual Linux signed-feed pipeline cases and normal Node package closure. Predates aggregate quota/removal; those current changes have focused checks above. |
| Installed signed fixture maintenance | Normal installed `27e0eb3`, release `6fdc54437d76707a04ff4daa303565df3e145bc1314aff49b61dd89fec0e3193`, passes six update and ten API checks. Receipts `assignment-legends-1793846107230.json` and `installed-signed-fixtures-1793846351612.json` retained. Public key enrollment, exact package readback, original duplicate receipt, privacy and separate fixture/key revocation pass. | Only a new synthetic Personal compartment/feed; no model, account, microphone or hardware operation. Original selection, definitions/modes, private endpoint and exact frozen Home restored. Known synthetic package/signing scratch, bundle and disposable checkout removed. Native Windows controller and complete Shield execution remain separate checks. |
| Native separated storage matrix | At `fc1fc27`, complete workflow [41952535367](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41952535367) passes all nine jobs. All eight contract archive digests verified, with every child cleanup verified. The broker owner passes sixteen cases, Run owner seventeen and harness seventeen. `windows-storage-contract-*-fc1.json` receipts retained. Exchange and filesystem archive digests also verified: eight actual JavaScript-owner, 31 restricted-client and thirty filesystem checks pass again. | All per-file bounds and assertions are preserved. The old combined-batch failure remains failed. No interactive guest/UAC or new fixture-controller native acceptance is inferred. |
| Suite signed fixtures and Linux pipeline connection | 59 controller/registry/HTTP/privacy/harness/package checks pass with real AEAD persistence, kernel leases, files and P-256 signatures. Both pipeline actions bind the exact installed feed metadata; revoked/changed feeds stay incomplete. All seven native pipeline cases pass; type checking passes and the packaged server runs under normal Node flags. | Synthetic feeds/keys, no model prompt or provider account. Normal installed API and native Windows controller acceptance are pending. Fixture provenance is not a completed vulnerability scan. Aggregate fixture quota, reviewed removal/retention, Shield execution and frontend controls remain unfinished. [Contract](signed-fixtures.md). |
| Scanner/advisory approval preservation | Seven real filesystem/P-256/journal registry checks pass, including substitution of another valid signed package during the approval prompt and concurrent enrollment of different keys under the same authority ID. Type checking passes. | Existing companion administration only; normal Suite fixture administration/pipeline connection remains unfinished. No feed, trust authority, account or key was installed in the pilot's actual application. All test fixtures are synthetic and removed. |
| Actual Windows JavaScript owner | At `b0f29ae`, workflow [41950577420](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41950577420), eight actual owner/native-client checks and the separate 31 restricted-client checks pass. Exchange archive SHA-256 `c9715cc42e56a36f113d3bc49ff35d7b148198944a45c95131a4a9648f7a0e1a` verified; `windows-broker-owner-b0f-native.json` retained. Actual mapping/write/readback, consumer exclusion, exit refusal, detach/retire and replay refusal pass; every retained native guardian independently exited and only the synthetic private fixture was removed. | The JavaScript proof uses the existing administrative worker token; the separate C# proof removes volume privilege. No guest, setup request or new account. The workflow later fails its serial contract batch and is not accepted as a whole. Normal app/guest and interactive UAC remain open. |
| Windows contract inventory/batch failure | The same `b0f29ae` workflow failed a Windows-only timeout inventory expectation and hit the six-minute combined-file limit. `windows-storage-contracts-b0f-failed.json` retained; the interrupted file was Sandbox sessions, so complete contract cleanup is not claimed. | The new group is now explicitly expected and each complete contract file runs in its own Windows job under the existing isolated bound, with bounded receipt/descendant cleanup. Assertions and production deadlines are unchanged. Native rerun is required; the earlier whole-workflow failure stays failed. |
| Complete Linux broker connection | Immutable `a1e71b0` passes all 166 groups: 1,101 tests, 1,091 passed, ten declared platform skips and zero failures. Receipt `f2749065-cd67-4d3e-9a10-c78b86b901c6` retained; every child cleanup verified, short fixture parent and disposable checkout removed. | Predates the separate three-case preparation/expired-capability/read-failure correction; that current source passes 73 focused checks and type checking. Native Windows, interactive guest and account acceptance remain separate. |
| Installed broker backend preserves F77 and Home | Normal installed `e1a1f30`, release `ed5b058f76ad93ab75dc3e3ebd787291de27b6b1b4165fa0db30d9b9ede59143`, passes six normal update and five actual F77 API checks again. Receipts `assignment-legends-1793843467065.json` and `installed-f77-readout-1793843529512.json` retained. | Full keymap/macro hashes match the independent guarded capture; definitions, selection, modes, private endpoint and exact frozen Home preserved. HID transports exited, bundle/checkout removed. No configuration/unlock/flash/reset/electrical command, provider prompt or browser reload. |
| Broker preparation race and expired capabilities | All 73 owner/runner/HTTP/privacy/package/inventory checks pass, including a held native identity discovery while a duplicate preparation is refused before I/O, an expired capability with no native discovery, and a failed ownership read releasing only its unused host lease. Type checking passes. | Explicit service/VM doubles with real AEAD/kernel locks. This correction postdates the complete Linux lane currently running at `a1e71b0` and needs native Windows verification. It changes no frontend, account or keyboard configuration. |
| Native protected exchange accepted | At `1f4e8e5`, complete workflow [41948972575](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41948972575) passes. All thirty filesystem checks, 112 compiled portable checks, sixteen protected-file checks, both service/setup lifecycles and 31 actual restricted-client volume/mapping checks pass. Four archive digests verified; `windows-{exchange,filesystem}-1f4-native.json`, `windows-native-setup-1f4-lifecycle.json` and `windows-broker-1f4-protocol.json` retained. | The restricted token has Administrators deny-only and no volume-management privilege. Exact create/attach, client filesystem writes/kernel exhaustion, five mount-point mutation denials, mapping substitution refusal, detach and retirement pass; original native exit verified. No guest, new account or interactive UAC. Earlier failed removal/access receipts remain failed. The newer normal Run adapter requires its own native verification. |
| Normal Windows Run broker connection | Seventy owner/runner/HTTP/privacy/package/inventory checks pass with real encrypted persistence and kernel leases, explicit service/VM doubles, and type checking passes. The ordinary factory uses broker storage for every new Run; exact reviewed inputs and only the derived disk root reach the backend. | No elevation/installation or direct-volume fallback. Tests cover lost create/attach/detach/retire responses, absent/reserved original results, unknown exits, mode revocation, live consumers, setup exclusion and orphaned asset recovery. Native normal-application guest/UAC acceptance remains open. |
| Installed F77 read-only pilot | Normal installed `3e346c1`, release `a68b9876984a82483566d320b98d48c03e496df1a37c1131766bc7fbb160fb4a`, passes six update and five device API checks. Exact keymap/macro hashes match the independent live capture; recent source reconciliation passes. `assignment-legends-1793842045992.json` and `installed-f77-readout-1793842177742.json` retained. | No configuration/unlock/reset/flash/electrical command, provider prompt or browser reload. Definitions, selection, modes, private endpoint and frozen Home preserved. HID transports exited, temporary checkout and bundle removed. Earlier script failures remain retained. Typing/hotplug/physical writes remain unaccepted. |
| Current F77 read-only pilot | Linux kernel hidraw discovery and protected live readout pass: VIA 9, Vial 4, three 8 × 11 layers, exact full definition/UID source match. Ninety query reports, no configuration write/unlock/reset/flash/electrical command. Private `f77-live-readout-1793841566987.json` and `f77-live-catalog-identification.json` retained. Eighteen device regressions pass, including platform backend selection and discovery without opens. | Source `f8591fe` plus the transport correction; installed-app update/readout accepted separately below. Classic/Ultra Compact case identity, typing, hotplug and physical write transactions remain unaccepted. Source matches are not authentication. |
| Complete Linux `f8591fe` | All 165 groups pass: 1,083 tests, 1,073 passed, ten declared skips, zero failures. Receipt `06f341a4-bc1a-4729-8628-5df92ec427be` retained; all child cleanup verified and owned fixture parent/checkouts removed. | Predates the small hidraw selection regression. Native Windows/guest/hardware/account acceptance remains separate. Earlier failed receipts remain failed. |
| Windows removal lifetime still unresolved | Workflow [41946814568](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41946814568) passes the six no-effect setup checks, standalone helper, 112 portable checks and sixteen protected-file checks. Service proof passes four lifecycle and thirteen restricted-client checks, then fails with exact phase `service-absence`. | Original native service exit passed; SCM absence did not. The exchange proof never ran, so the disk-only descriptor correction is not accepted. No retry or broad cleanup was attempted. |
| Windows guardian identity correction | At `21038f6`, workflow [41938283517](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41938283517), all thirty native filesystem checks, six setup preflight checks, both six-check service lifecycles and thirteen restricted-client boundaries pass. Three archives were digest-verified; receipts `windows-filesystem-21038-native.json` and `windows-native-setup-21038-{no-effect,lifecycle}.json` retained. | Uses creation time and original Job emptiness; the new regression substitutes a live unrelated PID and confirms it remains alive. The earlier `d7872fb` failure remains retained. No interactive UAC or VM acceptance inferred. |
| Full Linux `819840a` retry required | The complete lane attempted all 165 groups: 156 passed, nine failed; 1,078 tests, 1,019 passed, 49 failed and ten declared skips. Failed receipt `95a60386-8152-4dc6-a7a1-0cb03a0c48ce` retained with every child cleanup verified. | Multiple native/fixture writes returned Linux quota error 122 on `/tmp` (a user-quota tmpfs, despite free aggregate space). Unrelated existing temporary data was preserved. The nine affected files are rerunning with a separately owned temporary parent on the home filesystem; no assertions or deadlines changed. This run is not accepted. |
| Installed host setup API | Normal installed `819840a`, release `a7a8411c60161ba7e858c21621d04dadaf87b8dc703691a1369edc77d399e930`, passes six update and six authenticated API checks. Receipts `assignment-legends-1793837287037.json` and `installed-windows-storage-api-1793837324149.json`. | Linux reports unsupported Windows setup with no native effect. Unauthenticated access, Work evidence and arbitrary selectors are refused. Definitions, mode, private link and exact frozen Home preserved; bundle and checkout removed. |
| Native exchange access failure isolated | At `f2285b8`, workflow [41944316783](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41944316783), direct and native setup lifecycles both pass six checks plus thirteen restricted-client boundaries with independent exit. All 106 crypto/parser/journal/fact checks pass natively. Four archive digests were verified; `windows-{broker,native-setup}-f228-lifecycle.json`, `windows-broker-f228-protocol.json` and failed `windows-exchange-f228-failed.json` retained. | The exchange reaches creation/attach but denies the restricted client's first filesystem write. Its failed receipt remains failed; disk-full/detach/retirement were not accepted. `AttachVirtualDisk(NULL)` inherited the backing image's read-only client ACL. An explicit client read/write descriptor now applies only to the attached disk; the original backing file and mount point remain read-only. Native rerun is required. |
| Original exchange result recovery and host binding | Both C# targets build without warnings; sixteen metadata, thirty exchange-wire, 43 journal and 23 fact checks pass (112). The native transport, setup, suite and release group passes 51 checks; all 33 Sandbox backend checks also pass. Type checking passes. The host rejects mismatched input manifests before any guest/output effect. | Explicit native/guest doubles in host tests. Read-only result lookup validates the original installation and performs a fresh serial signed challenge; it never reserves or resends an absent effect. Native exchange acceptance is pending the expanded 31-check restricted-client proof, including five mount reparse-point permission denials. Normal Run factory connection remains unfinished. |
| Windows removal regression at `4f995d4` | Workflow [41942299398](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41942299398) passes sixteen metadata, thirty exchange-wire, 37 journal, sixteen protected-file and thirteen actual restricted-client/service checks. The following service removal fails, so only four lifecycle checks completed. Two archive digests were verified; `windows-broker-4f995-{protocol,removal-failed}.json` retained. | The exchange-volume proof was not reached and is not accepted. Removal now records bounded native phase/error category and the CI receipt retains its original structured result plus one post-failure observation. No effect retry, weaker assertion or deadline change was added. |
| Protected broker mapping admission | Both C# targets compile without warnings and all 106 portable crypto/parser/journal/fact checks pass; scratch removed. The new read-only binding path requires fresh signed mounted state, exact protected journal/task/input/image facts and native UUID/footer/extent/capacity/ACL pins. It admits no arbitrary directory and enables no client privilege. | The native exchange proof now includes unprivileged mapping and substituted-root refusal (24 checks), pending Windows execution. The normal Run adapter is still being connected; no guest acceptance is inferred. |
| Complete Linux `4f995d4` | All 165 groups pass: 1,078 tests, 1,068 passed, ten declared skips and zero failures. Receipt `6a95e3e7-0b5d-4ac4-8cca-56a0a95a0c06` retained; every child cleanup verified, short fixture parent and disposable checkout removed. | Uses a short owned home-filesystem fixture parent without changing production code, assertions or deadlines. Earlier quota/socket/runtime failures remain retained. Native Windows service/volume and interactive acceptance remain separate. |
| Exchange fact preservation | All 23 compiled parser/corruption/substitution cases pass in addition to the sixteen metadata, thirty exchange wire and 37 journal checks. Helper and linked proof compile without warnings; source-only scratch removed. Retirement rejects missing, damaged or unfamiliar image/mount facts, changed native IDs/volume/capacity and unconfirmed detach. | Protected storage proves provenance; closed metadata validation separately proves its supported shape. Actual System-service acceptance is running in Windows CI. No unrelated temporary files or workstation settings were changed. |
| Bounded exchange service engine | Actual helper and linked proof compile without warnings; sixteen metadata, thirty exchange protocol and 37 journal checks pass. Engine paths are fixed, one active 64 MiB image is enforced, and removal refuses active/unknown inventories. The new disposable Windows lane exercises 22 restricted-client checks including kernel disk-full and exact retirement. | Native engine acceptance is pending that lane. The normal Run/guest-consumer connection remains unfinished and metadata still reports `brokerImplemented:false`. No guest or workstation volume was opened locally. [Boundary](windows-storage-broker.md). |
| Short socket-root retry | Both remaining source files at `5865730` pass with a short owned temporary parent: fourteen tests, seven passed and seven declared Windows skips; receipt `9798ce87-9eab-47a9-9ead-d11e13253c7c`. Every child cleanup verified and fixtures removed. | The complete run `d2608d80-fb32-4ba4-81f6-006125ca8826` remains failed: 163/165 groups, 1,065 passed, two failed, ten skips. A long Unix socket path returned EINVAL; Node 24.14.0 also aborted in `InternalCallbackScope::Close`. Core stacks confirm that runtime assertion; no OOM evidence was found. Its precise trigger is not established. No system/runtime configuration changed. |
| Bounded exchange effect journal | All 37 compiled fault/state checks and thirty exchange wire checks pass, alongside the sixteen metadata checks, with zero warnings/errors. Reservations precede effect permission; immutable chained records bind operation, task, inputs, image and request. Lost final acknowledgement recovers only an already recorded result; a reservation never establishes success. | The protected-file port derives every path from installation and UUID, exclusively creates bounded records, flushes/readbacks and preserves unknown contents. It compiles but still awaits native System-service acceptance and the actual volume engine. No privileged verb is advertised yet. |
| Linux quota retry | All nine affected source files pass on the home filesystem: 57/57 tests, no skips, every child cleanup verified. Receipt `f0e9b656-d349-4b0a-aeaf-510305f82f24`; its owned fixture parent was removed. | Same source `819840a`, assertions and deadlines. Unrelated `/tmp` data was preserved. This focused retry does not replace a new complete-lane receipt. |
| Bounded broker exchange wire | Thirty compiled crypto/parser checks pass, alongside all sixteen metadata checks, with zero build warnings/errors and removed source-only scratch. Requests bind fixed verbs, installation, operation, task scope, reviewed inputs and fresh nonce; signatures bind the exact result and fixed 64 MiB capacity. | This protocol is not yet connected to privileged effects. Task scope hashes do not independently grant authority; the authenticated host admission and protected native journal remain required. `brokerImplemented` stays false. Native CI now requires all thirty exchange checks. |
| Personal host setup API | Fifty-five transport/controller/suite/package/inventory checks pass locally. Includes authenticated HTTP, exact install/remove review, one-use approval, atomic admission and guarded receipt, replay prevention, uncertain-outcome retention, Work rejection and snapshot privacy. | Native ports are explicit doubles in controller tests. Native service/setup lifecycle evidence is separate; interactive UAC and bounded-volume operations remain unaccepted or unfinished. Frontend unchanged. |
| Native protected setup lifecycle | At `d7872fb`, the native installer passes six lifecycle checks and all thirteen restricted-client/delayed-reader boundaries on the disposable Windows worker, workflow [41935114492](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41935114492). Digest-verified `windows-native-setup-d787-lifecycle.json` retained: protected staging, clean managed startup, signed metadata, exact service/native exit and known-file removal; every guardian independently exited. | Worker is already elevated. Actual UAC dialogue and approved-account behavior remain separate. A later filesystem exit re-observation failed after 26 checks; that failure is retained separately and does not turn the complete workflow green. |
| Windows guardian identity regression | Exit observation now sends the original guardian PID and creation time to the fixed native status helper and also requires the original Job Object to be empty. The helper compiles without warnings; local runtime/controller checks pass and scratch was removed. | `windows-filesystem-d787-failed.json` retains the 26-check failure with original VHD attachment/detachment verified. The old PID-only shortcut could confuse a reused PID with the original guardian. A new actual Windows case tests a live unrelated PID against the old birth/Job scope; native rerun remains required. |
| Native metadata broker lifecycle | The exact service lifecycle and all thirteen restricted-client/delayed-reader/private-cache/malformed-pipe checks pass at `f4ba916`, workflow [41934738389](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41934738389). The signed second metadata response, exact service/native exit and known-file removal now pass. | The workflow's later filesystem groups are still running. This pass used the direct already-elevated managed installer. Full native staging/removal is a separate new CI pass; normal-user UAC, application wiring and privileged volume effects remain unfinished. |
| Native Windows setup boundary | At `39bc24f`, native C++ compilation and all five actual PE/no-effect checks pass in workflow [41933441951](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41933441951): System32-only imports, current-user metadata, unknown-command/changed-helper refusal before elevation, and independent exits. Managed bootstrap also compiles and refuses Linux. | No SDK/setup binary was downloaded locally, and the proof requested no elevation. Full native install/remove, application setup wiring, actual UAC interaction and volume verbs remain unfinished. |
| Broker reply consumption regression | Server and client now acknowledge the digest of the exact signed reply before disconnecting. Helper/proof compile without warnings and sixteen crypto checks pass locally; scratch removed. | Windows discards unread bytes at disconnect. A new actual delayed-reader case will enforce this contract in the thirteen-case native service proof. Native rerun remains required; no retry or time-bound relaxation was added. |
| Complete native helper source packaging | All five package checks pass, including a Windows bundle containing the broker/bootstrap implementation, project and linked guest-worker sources. New Windows bundles can include the native setup image and its source/build entry point; older bundles remain valid. The bounded file inventory is now 640; the 128 MiB byte ceiling is unchanged. | Images in the portable package test are explicit inert doubles. Actual native compiler/preflight evidence is separate above. Native setup application wiring and UAC/volume acceptance remain unfinished. |
| Broker CI proof invocation | At `15a2a3c`, the post-install authenticated metadata call succeeds with the reply acknowledgement. The next proof invocation stopped at its disposable-CI guard: sanitization omitted `GITHUB_ACTIONS`/`RUNNER_OS`. Those markers are now explicitly passed only to that proof after the parent verifies the real worker context. | The thirteen actual service/restricted-client cases still require a passing rerun. Their failures now retain one bounded diagnostic line; no assertion, test selection, authority or deadline was relaxed. |
| Latest installed Linux pipeline demonstration | Normal `25f9fe6`, release `06432460b38ed215c4e2ca33bb836bfbb266a01b5de1d7aeea292ae1a247c4f0`: six update and eight actual pipeline checks pass. Both actions earn authenticated receipts; separately approved pending stop preserves immutable admission; all three exact guardians exited independently. Zero prompts. Receipts `assignment-legends-1793832869599.json` and `installed-repository-pipeline-1793833257955.json`. | Original selection/definitions/modes/private link and frozen Home preserved. Input/bundle staging and disposable checkout removed. Measured pending readiness was 51.4 seconds; no production deadline changed. Windows and physical acceptance remain separate. |
| Scanner fixture installation ownership | Seven registry/offline-signer checks pass, including independent concurrent installation, lost final acknowledgement and unfamiliar empty/populated directories. Type checking passes. Destinations are exclusively created; uncertain installation preserves its original files and journal. | A retained partial or uncertain installation blocks replacement and requires reconciliation. Scanner/advisory application wiring and actual feed/tool acceptance remain unfinished. |
| Windows storage broker wire and protected files | Native Windows passes all sixteen P-256/parser checks and sixteen protected-file/restricted-token checks at `366d409`, workflow [41924140253](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41924140253). Archive SHA-256 verified; `windows-broker-protected-files-366.json` retained with exact merge source `2173e868`. | The new nonce directory was removed; no service, volume, account or guest was opened by this proof. Native service transport acceptance, normal-user setup and bounded volume integration remain unfinished. |
| Windows metadata service bootstrap | Exact installer/service/pipe/private-runtime-inventory/removal code and the linked native proof compile with zero warnings/errors. All sixteen actual crypto/parser checks and four package checks pass locally; two new Windows-only entry guards refuse Linux and scratch was removed. | Native service lifecycle and thirteen restricted-client/delayed-reader/pipe/cache checks are pending Windows CI. Normal-user elevation, bounded volume verbs and application setup wiring remain unfinished; `brokerImplemented` remains false. No Linux workstation service was installed. |
| Standalone helper packaging | Native .NET libraries are embedded with the single executable. Sixteen runtime and four package checks pass locally. A disposable Windows check copies only the executable, denies installed-runtime discovery, verifies actual metadata/exit and removes its owned copy/cache. | First native run [41929214148](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41929214148) failed before acceptance. The proof now removes case aliases before overriding Windows environment coordinates and retains bounded phase/diagnostic evidence. Native rerun is required. |
| Standalone runtime location investigation | At `d8a0999`, the copied executable returned real metadata and independently verified native exit. Digest-verified failed receipt `windows-standalone-d8-failed.json` retained. | The required private extraction cache stayed empty, so acceptance remains failed. Read-only native module diagnostics now report only module names, location categories and path hashes. The helper builds without warnings and its new Linux guard refuses execution. No extraction assertion was waived. |
| Corrected Windows runtime contract | Native diagnostics at `c2a457b` show the configured private base and no external CLR/JIT modules. The pinned Windows .NET 8 single-file host statically links them, per the [upstream implementation](https://github.com/dotnet/runtime/issues/43071). The corrected proof binds its main-image SHA-256 and requires no external runtime modules. | The earlier mandatory-extraction assertion was incorrect for this runtime. Those failed runs remain failed; the corrected native rerun must pass. The service permits an empty private cache only with no runtime DLL outside it, and still seals/verifies its exact inventory. |
| Native Windows standalone and initial bootstrap | At `cba5e2b`, workflow [41931593401](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41931593401), the corrected standalone check passes: exact image, no adjacent/runtime fallback, static runtime, independent native exit and owned copy/cache removal. All sixteen crypto/parser and sixteen protected-file checks also pass. | The service installs and answers its first signed challenge, then the following metadata request fails. Digest-verified failed receipt `windows-bootstrap-cba-failed.json` retained. Native lifecycle remains failed; SCM/pipe phase diagnostics were added without accepting a substitute response or retry. |
| Linux stop readiness regression | Nineteen supervisor/pipeline/stop checks pass, including all five real isolated pipeline cases and a deterministic suspended-ready-write regression. The exact stop controller exists before ownership becomes durable; startup acknowledges only after persistence and the final guard. | The first rerun exposed the test's independent ten-second polling guess. It now awaits the real readiness transition. Production and group time bounds remain unchanged; hosted rerun follows the fix. |
| Connected Linux pipelines and exact stop | Both local gate and clean reproduction execute real programs through the existing task/grant/checkpoint/budget/namespace route. Five pipeline cases and the combined Run/stop group pass 17/17; harness/package/stop group passes 28/28. The stop binds an immutable original admission before the eventual program response exists. Type checking passes. | Reports describe the exact approved recipe; security scanner/advisory fixtures, writable builds and Windows pipelines remain unfinished. [Contract](reviewed-task-execution.md#run-a-local-gate-or-clean-reproduction). |
| Installed Linux pipelines | Normal `5fd0186`, release `883e1fa667b33d001ffeecc2f8ab74882630a378821806e90f37f7964e923ce9`, passes eight checks: both actions, exact authenticated receipts/duplicate refusal, separately approved pending-pipeline stop, three independently exited guardians, denied host inputs/network/credentials, 64 MiB temporary storage and restored selection/definitions/modes/private link. Zero prompts. Receipt `installed-repository-pipeline-1793829793401.json`. Six update checks pass in `assignment-legends-1793829389543.json`; bundle staging removed. | The first pending-stop validator expired its 15-second readiness wait. Failed receipt `installed-repository-pipeline-1793829551182.json` and small synthetic staging retained; exits verified/state restored. Retry measured 38.7 seconds; only validation observation allowance changed, inside the existing HTTP bound. Native task history remains intentionally. |
| Normal Windows task-authority entry | The normal suite factory advertises platform-connected actions and passes its platform to the execution factory. The normal route issues a real separately approved Run grant, rejects another action/approval and rejects Work routing. Authority/suite/physical-intent files pass 33/33 locally. All nine authority cases and seven host-stop cases pass on native Windows at `a50a205`, workflow [41920825404](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41920825404). | Native account and guest ports remain explicit doubles. All six matrix archives were digest-verified; `windows-policy-a50-{policy,recovery,stop,output,authority,host-stop}.json` retained with every child cleanup verified and zero skips. |
| Windows Run prerequisite observation | Thirty transport/session/runner contracts pass locally, including unavailable-before-staging, exact reservation/non-replay and malformed observation refusal. Actual Windows query and all 30 native filesystem checks pass at `e7a8e67`, workflow [41916832172](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41916832172). Digest-verified `windows-storage-preflight-e7a-native.json` retained. Native helper builds with zero warnings/errors; six Linux guards and type checking pass. Build scratch removed. | Query-only token access and unchanged privilege bytes establish readiness only. Normal-user privileged setup/broker is still unfinished; no setup, elevation or VM acceptance is inferred. |
| Verified Windows output status | Thirteen policy/stop/output cases pass using actual grants, encrypted ledgers, descriptor reads and explicit guest doubles. Combined policy/inventory/backend/package group passes 66/66. All four native Windows policy jobs pass at `cdd86cb`, workflow [41914612230](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41914612230). Changed files/substituted roots cannot replace the original outcome; stdout/stderr are redacted and signed exit codes survive replay. | Guest execution is explicitly doubled. The first whole-file lane hit its time bound; verified failed receipt `windows-policy-63cb-failed.json` retained with cleanup. No test or production deadline was waived. |
| Windows workspace startup without Run tools | Eleven host-runner contracts and the complete suite/physical-intent files pass 35/35 locally. Empty recovery does not pin or start an optional helper; retained Run/guest/native-command ownership still requires native reconciliation. | Fixes the missing-helper failure in Windows client workflow `41914612132`; native client reruns pass, including `c7525a0` workflow `41919499739`. |
| Windows failure diagnostics | Backend/helper/installation/lifecycle/release group passes 46/47 with one declared platform skip. Four actual compiled formatter cases preserve success/failure shapes and signed exit codes; warning-free helper build, six Linux mode guards and type checking pass. Scratch removed; receipt `windows-failure-results-build-20261104.json`. | Explicit guest/volume doubles in backend checks. Failed results retain only verified bounded stdout/stderr after exact VM exit, stay failed and cannot become successful artifacts. Native VM/Job acceptance remains separate. |
| Studio Windows Run and exact stop | Eleven policy/admission/stop/recovery cases pass through the normal platform factory, using real task grants, Git inspection, encrypted checkpoints, budgets and distinct receipts. A separate 41-check platform/package group passes, including the existing actual Linux host broker. | The Windows runner in these policy tests is an explicit double. Actual supported-host VM startup/login/worker/stop is not demonstrated. Personal-host privileged setup remains unfinished software. [Contract](windows-reviewed-run.md). |
| Complete Linux runner checkpoint | `cba5e2b`: 163/163 groups, 1,062 tests, 1,052 passed and ten declared skips. Receipt `26d8a535-ec4e-45ea-b47c-2db8d3bdb7e7`; every child cleanup verified and disposable worktree removed. | Includes the durable-readiness regression and helper environment contract. Windows-specific compiler, service and filesystem acceptance remain separate; scanner ownership has its seven focused checks above. Earlier full checkpoint `b145a682-ed06-4a35-9f23-0218999afab9` remains retained. |
| Native Windows filesystem and mapping | All 30 native checks pass at `9cfb922`, workflow [41904474050](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41904474050): exact inputs, embedded worker/pinned Node links, fixed image, host-owned writable handoff, kernel disk-full, exact detach and bounded mapping validation/refusals. Archive digest verified; only `windows-runner-9cfb-native.json` retained. | The workflow opens only new synthetic files/volumes on its disposable Windows worker. No VM, account or keyboard is opened. |
| Windows host runner and cancellation | Combined inventory/runner/manifest/lock/privacy checks pass 57/57 locally. Ten orchestration cases cover cross-process preparation/execution fences, durable cancellation, native exit checks, non-replay and separate storage retirement. Windows short workflow also passes at `6e82937`, including its real kernel probes and runner doubles. | Native services/VM are explicit doubles in orchestration cases; native filesystem acceptance is the row above. |
| Earlier installed Linux Run checkpoint | Normal installed `45e9eb6` passes ten actual Run checks: one empty native Codex task, zero prompts, denied host files/credentials/network, read-only inputs, 64 MiB temporary storage, terminal and exact-stop receipts, duplicate refusal, fresh Run and three independently exited guardians. Six update checks preserve the frozen frontend, definitions, modes and private link. | Bundle staging was removed. Windows-specific source tests do not establish Windows desktop or physical-device acceptance. Receipts `installed-repository-execution-1793824944140.json` and `assignment-legends-1793824727363.json`. |
| Complete Windows worker/runtime checkpoint | `72c5f96`, workflow [41883054390](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41883054390): 261/261 groups, 1,738 tests, 1,690 passed and 48 declared skips. Digest-verified receipt `d2b0aa0e-67a1-4f55-bf55-d21daf5fab91` retained. | Predates image/volume ownership and the Studio Windows adapter. Newer full Windows release checks remain in CI. |

The four passing Windows policy artifacts were digest-verified and imported as
`windows-policy-cdd-{policy,recovery,stop,output}.json`; every child cleanup
verified. They contain thirteen distinct policy cases and the repeated inventory
contract, with no platform skips.

The Windows platform factory now connects separately reviewed Run and exact-stop
requests to the shared policy, checkpoint, budget and receipt ledgers. General
workspace snapshots omit execution records. A recorded stop receipt can recover
a lost final write; independent exit alone cannot turn an unrecorded stop into a
passing result. Program exit never marks a provider's coding task complete.

The frontend remains frozen for review. No browser reload, firmware operation,
workstation mount change or account/tenant session is part of these backend
checks. F77/B122 physical typing, configuration unlock, hotplug and print-fit
acceptance remain open. The B122 acceptance gates remain **NOT ACCEPTED**.
Supported interactive Windows Sandbox, approved Microsoft tenant/account and
microphone checks remain separate. Privileged Windows bounded-volume operations, broader action connections and
remaining device/attachment controls are unfinished software. Host setup
review/apply is implemented; actual interactive UAC acceptance remains separate.

Follow the [requirement ledger](switchyard-requirements.md) for suite coverage,
the [continuation record](switchyard-status.md) for current work, and the
[checkpoint archive](verification-checkpoints.md) for earlier accepted and failed
runs. Small private JSON receipts are retained; disposable checkouts, archives
and build scratch are removed after independent child cleanup verifies.

For the defined Linux source lane, use `runVerification({ groups: linuxGroups })`
from [the isolated runner](../scripts/run-isolated-tests.mjs). The complete
`requiredGroups` inventory includes Windows-specific cases and is not the Linux
acceptance lane. The explicit inventory refuses missing, stale or silently
skipped tests.


## Native pipe length and task-owner completion (2026-11-06)

Source `9fde0a3`, execution `304fb915`, identical tree `20f85744`: the independent
pipe proof retains 15 completed parser checks and a successful read call returning
zero descriptor bytes; setup independently fails at pipe-security-verify. Both
remain failed, and the restricted owner remains 0/8.
[Native pipe receipt](evidence/private-pipe-buffer-native-summary.json).

The same source independently completes all 26 original task-owner cases on
Windows: 24 passes and two declared Linux-only skips, every child within its
original 45-second bound, all child/tree cleanup verified. Provider effects are
controlled doubles. This closes that file timeout but does not accept the complete
Windows release. [Native task receipt](evidence/task-owner-native-summary.json).

The readback correction uses GetSecurityInfo on the exact file handle, validates
structure/self-relative revision/bounded length, then applies the unchanged exact
owner, protected DACL and single-ACE checks. It releases the OS allocation in
finally. Two managed builds pass with zero warnings/errors, 2,101 portable checks
and exact cleanup of 149 files / 3,384,695 bytes. All 36 native pipe checks and the
eight original owner assertions remain required. Installed state is unchanged.
[Source receipt](evidence/private-pipe-security-info-source-summary.json).


## Offline SPDX identifier catalog (2026-11-06)

The pinned dependency-free scanner now checks membership and deprecation against
740 license IDs and 86 exception IDs from SPDX 3.29.0, with immutable upstream
commit, original Git blob and SHA-256 identity checked. Unknown identifiers retain
metadata gaps even in permitted OR alternatives; policy decisions and catalog
membership remain separate. Fixed CycloneDX properties bind version/listing/
deprecation, and host admission recomputes them. No text, publisher or legal
verification is inferred.

Seven isolated groups pass 47 tests without skips, including every catalog entry,
real Linux Supply Chain/Release scans, Windows guest doubles, signed feed/receipt
composition, original index/HEAD/lockfile preservation and exact child/tree
cleanup. Typecheck and deterministic development SBOM checks pass. Application
and release checks preserve the original 5 MiB budget. No installed update,
provider/model request, account change or hardware action occurred.
[Evidence](evidence/spdx-catalog-source-summary.json), [contract](npm-license-declarations.md).


## Native pipe acceptance and restricted worker return (2026-11-06)

Source `2202720`, execution `cd8d04fd`, equal tree `c9e2fa0b`: all 36 native
pipe checks pass, alongside the sixteen original protected-file checks; ordinary
setup preflight passes all six checks with independent exit. This accepts that
readback correction. The restricted owner now creates its worker and verifies
QUERY mask 8 for guardian, worker and status. It next fails at
`probe-identity-return-structured-result`, still **0/8** original owner checks.
The retained artifact does not establish the worker exit code or output contents.
[Native evidence](evidence/private-pipe-native-summary.json).

The CI-only follow-up preserves every original call/result/exception and records
only bounded numeric worker exit and output-byte count when structured parsing
fails. Oversized, unknown and stale metadata are excluded. Two isolated groups
pass 35 tests, no skips, all child/tree cleanup verified. Permissions, installed
state, accounts and hardware are unchanged.
[Source evidence](evidence/worker-result-observation-source-summary.json).


## Restricted setup DLL initialization candidate (2026-11-06)

Native source `20dc066`, merge `3a8a68f1`, equal tree `a687be9f`, retains
worker exit 3221225794 (0xC0000142) and zero stdout bytes. Guardian/worker/status
QUERY mask 8 is verified, but the original owner remains 0/8. The specific failing
DLL is not known. [Native receipt](evidence/setup-worker-native-summary.json).

The candidate defers the setup executable's shell32/ole32 imports until their
installation/elevation APIs are called. Metadata does not use those APIs.
System32-only loading and all original permissions/assertions remain. Native
preflight now parses the exact PE image and requires the two deferred imports,
bounded import tables and absence of eager UI imports. Four isolated groups pass
50 tests with all child/tree cleanup; Windows compilation/runtime acceptance is
pending. No SDK, runtime, model, account or installed application changed locally.
[Contract](windows-setup-metadata-startup.md), [source evidence](evidence/setup-deferred-imports-source-summary.json).


## Complete Linux SPDX checkpoint and Windows host acceptance (2026-11-06)

Clean isolated source `a5520be` passes **306 groups, 1,782 tests, sixteen declared
skips, zero failures** (1,798 tests total). Every child and process tree exits.
The owned worktree, nine dependency aliases, five generated output directories,
782 generated files / 11,766,655 bytes, empty temporary parent and run marker are
removed after source/identity/inventory verification. All three other worktrees
are preserved. This is the accepted complete Linux checkpoint, not acceptance
of later Windows-only source changes.
[Full source and cleanup evidence](evidence/linux-a552-complete-summary.json).

The same source, native Windows execution `3aeddc45`, equal tree `f007ed68`,
passes the two license scanner journeys without skips. Actual Windows protected
host execution uses guest doubles; exact feeds, declared catalog evidence, receipt
replay, repository preservation and child/tree cleanup verify. No actual guest,
publisher/license text, provider account or installed app acceptance is inferred.
[Native SPDX evidence](evidence/spdx-catalog-native-summary.json).

### Deferred setup imports: native preflight passes, restricted startup still fails

Source `56d115efebbec5d70f6232a83a1c64fa76cf49d6` runs as equal-tree merge
`a79b0c1757bbc156b337c2dd3ee049aac757d639` in workflow 42268548295.
The actual setup image passes six original preflight checks and verifies both
delayed UI imports and System32 dependency flags. Its restricted worker still
exits 3221225794 with zero output; the original owner is 0/8. Both bounded ZIP
digests and source/merge tree binding were checked in memory; only small private
receipts and public summaries remain. No installed changes were made.
[Native summary](evidence/setup-deferred-imports-native-summary.json).

The follow-up setup candidate uses the GUI subsystem with explicit
`wmainCRTStartup`, preserving the normal CRT and original wide-argument entrypoint.
It is based on the earlier native console-mode comparison, without asserting a
specific failing DLL. The native PE parser rejects console and unknown subsystem
images; the six preflight and eight restricted-owner assertions remain required.
[Candidate rationale](windows-setup-metadata-startup.md).

### Restricted owner advances to final retirement; bounded CI registration correction

Native `c9a858a` passes six native GUI setup checks and reaches 7/8 original
restricted-owner checks. All 64 registered descendants verify exact QUERY mask 8;
the final independent guardian status loop exceeds that old registration bound.
The original fixture is preserved. Both source/merge tree and bounded artifact
digests verify. [Native receipt](evidence/setup-gui-native-summary.json).

The correction admits only status helpers in slots 65–68, sufficient for 17
commands with three registrations each plus 17 independent final status checks.
Registration 69 and extra workers/guardians remain refused. Both managed targets
compile without warnings/errors; 2,114 portable checks and four groups/50 tests
pass. Exact managed staging cleanup removes 149 files / 3,387,035 bytes.
[Source receipt](evidence/descendant-retirement-source-summary.json).

### OSV inclusive endpoints and whole-range limits

Six groups pass 77 tests, including 1,944 independent membership comparisons
across npm/PyPI/crates.io, plus actual Linux Supply Chain/Release and Windows
guest-double execution. Fixed-range assertions remain; new inclusive last-affected
and union-limit cases preserve failed/incomplete signed findings, receipt replay
refusal, original lock/index/HEAD and exact cleanup. Typecheck and the unchanged
application/release packaging limits pass. No public query, installed update,
model task or account change occurred.
[Source receipt](evidence/osv-range-boundaries-source-summary.json).

### Complete restricted Windows owner accepted at 6e967a3

Source `6e967a3d45e46aafd36da85a86bf73b7693e241d` executes as equal-tree merge
`da80bf1660af8b220ddac54232f775972db8b208` in workflow 42271740559.
All **eight original restricted-owner assertions** and nine outer exchange
checks pass. The separate 13 restricted-client, 31 native exchange and eight
ordinary owner checks also pass. Exactly 68 descendant registrations verify
QUERY mask 8 (17 guardians, 17 workers, 34 status helpers). Original token/tree,
creator quota and desktop readback, both fixtures, service and captured files
retire. The strict original report parser accepts the imported receipt.
No account was created, no guest launched and no workstation app changed.
[Native owner receipt](evidence/windows-restricted-owner-accepted-summary.json).

The same source passes six actual GUI setup preflight checks and 23 native
Windows advisory-source tests with exact child/tree cleanup. Artifact ZIP hashes
and source/merge binding verify in memory; archives are not retained.
[Setup](evidence/setup-final-native-summary.json),
[advisory source](evidence/osv-boundaries-native-source-summary.json).

### Older complete Windows release remains failed evidence

The `dbbcce8` complete release finishes **385 of 386 groups**, accepting 2,336
tests and 195 declared skips from complete plans. Its sole failed group is the
original 45-second task-owner file timeout; partial output is excluded. All child
and process-tree cleanup verifies. Later independently scheduled task-owner
acceptance does not relabel this complete release as passed.
[Complete failed receipt](evidence/windows-complete-dbbc-failed-summary.json).

The installed metadata verifier now includes five pure SPDX observations and
three-ecosystem inclusive-endpoint/union-limit checks. Syntax checking passes;
installed execution awaits the next normal versioned update. It creates no
account, provider, task, keyboard, microphone or public-network effect.

## Complete Linux range checkpoint and installed metadata (2026-11-06)

Source `6e967a3d45e46aafd36da85a86bf73b7693e241d` passes **306/306 groups,
1,793 passing tests, sixteen declared skips, zero failures** (1,809 total).
Every child and process tree exits. Exact source/tree/root identities and all
ignored files were checked before removing the owned checkout, nine dependency
aliases, five output directories, 782 generated files / 11,766,655 bytes, empty
temporary parent and marker. The other three worktrees are preserved.
[Complete source and cleanup receipt](evidence/linux-6e967a3-complete-summary.json).

The same source's actual Windows OSV composed scanner job passes seven tests
with eight declared Linux-only skips. Guest execution remains doubled; all
child/tree cleanup verifies. The bounded artifact ZIP SHA-256 and equal source/
merge tree were checked in memory; no ZIP is retained.
[Native scanner receipt](evidence/osv-boundaries-native-scanner-summary.json).

Normal versioned installation of source `d8a0a96` produces release `ea1e1770…`,
532 files / 5,104,714 bytes with development mode disabled. Dated launcher and
installation backups, reason journal, current symlinks and the previous release
verify. Thirteen owner/editor/offline severity/SPDX/OSV checks and seven Copilot
journal metadata checks pass. All 54 workspace content/settings snapshots and
the pending keyboard-only conversation are preserved: 52 sealed files are
byte-identical, while two contain only audit changes. Frozen Home/frontend hashes
match. No scanner, native task, model prompt, public query, Microsoft request or
keyboard operation occurs. Only current plus one rollback are retained; the
prepared bundle's 533 files / 5,219,707 bytes are removed after manifest checks.
[Installed receipt](evidence/installed-spdx-osv-summary.json).

## Selected npm archive identity (2026-11-06)

The source extension compares bounded gzip/USTAR `package/package.json` name/
version with the exact reviewed npm lock entry, independently of byte integrity.
Matching metadata stays incomplete; detected identity mismatch fails, while
unsupported/ambiguous/malformed input retains a fixed gap. No path is extracted
and no package code or lifecycle script is executed. Expansion reserves 4 MiB
per artifact within a 32 MiB scan budget; other original bounds remain.

Six isolated groups pass **78 tests**, with one additional exact alias/version
case. Twelve actual Linux npm scans and twelve Windows guest-double scans verify
both actions, signed report/BOM/receipt binding, replay refusal, original files/
index/HEAD and exact child/tree cleanup. Python/Cargo regressions, engine,
typecheck and original application/release packaging limits pass. The first
six-group attempt failed: host validation was placed in the Python branch and
concurrent source edits triggered the correct pinned-engine refusal. Its 11
failed assertions remain failed evidence. The abbreviated follow-up selector
also failed the zero-plan guard; only the corrected exact selector is accepted.

An actual offline npm pack with every lifecycle disabled initially exposed
omitted portable uid/gid fields. The corrected parser accepts those unused owner
fields without applying ownership and accepts the exact original 368-byte archive.
All ten owned source/cache/output files (2,930 bytes) were removed. The tiny
synthetic archive remains a portable regression fixture. There were no package,
SDK, runtime, model, account, installed app, frontend or HID changes.
Native Windows and installed acceptance remain separate; this does not establish
publisher provenance, source-member scanning or license compliance.
[Source, failed attempts and cleanup evidence](evidence/npm-archive-identity-summary.json).

## Native index, history and lease reconciliation (2026-11-06)

Source `6b4089cab2a741e64e964829aab3a6f19df1438e` and execution
`440148795e3da4a2d1176ea4b0f0d99ec199f5c9` share tree
`567287bea743473de4b669199e236f8b19b2a30c`. All 66 jobs in Windows boundary
workflow 42274732782 completed successfully. Five specific small artifacts were
then imported and independently digest/schema/cleanup verified; this does not
assert that every other workflow artifact was downloaded.

Native index and history staging each pass six original checks with three exact
guardian exits, protected ACL/hash readback, native rejection of changed packets
and exact fixture removal. These native packets use synthetic Git witnesses;
actual repository observation and guest execution are not inferred. The separate
actual-Windows index and history scanner files each pass two cases using guest
doubles. The two lease groups pass 24 tests and one declared Linux-only skip.
All child/tree cleanup verifies. ZIPs were checked in memory and not retained.
Actual guest, installed Windows and ordinary-user acceptance remain separate.
[Selected source-bound native evidence](evidence/native-history-index-leases-summary.json).

## Archive report bounds and native scheduling correction (2026-11-06)

The host refuses a declared member count that cannot fit the claimed expanded
USTAR size: each entry needs a header, the manifest needs at least one payload
block, and two termination blocks remain mandatory. Four exact selected cases
pass with child/tree cleanup; the actual npm fixture and existing valid reports
remain accepted. This tightens report admission without changing parser bounds.

Windows source `7e45654`, equal-tree execution `e9dbade1`, completes 65 of 66
boundary jobs. The combined artifact file hits its original 300-second deadline;
partial output is excluded, with zero accepted tests from that unfinished plan.
Exact native process-tree termination and owned-root cleanup verify. Its small
ZIP SHA-256 and source/merge tree were checked before private receipt retention.
Byte-integrity and archive-identity scenarios are now split into independent
required files and CI jobs. Their shared assertions preserve original evidence,
repository bytes/index/HEAD, receipts/replay, native exit and cleanup. Original
Windows/Linux child deadlines and the six-minute CI step bound are unchanged.
[Original native failure](evidence/npm-archive-native-timeout-summary.json).

The corrected split now accepts **five distinct groups / 53 tests** across the
initial four passing groups and corrected 20-test harness run. Both byte and
archive composed files pass; their shared helper preserves all twelve actual
Linux and twelve Windows guest-double scenarios. The initial harness failure
was its explicit timeout inventory missing the new file; the original receipt
remains failed. No timeout was extended. Four earlier report-bound checks also
pass with exact cleanup. [Correction evidence](evidence/npm-archive-scheduling-summary.json).
