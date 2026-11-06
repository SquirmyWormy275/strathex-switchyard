# Bounded Windows storage service

Switchyard keeps privileged volume operations in its fixed LocalSystem service.
The desktop application stays unelevated. The native installer and Personal
review/apply route are described in [reviewed Windows Run](windows-reviewed-run.md).

The normal Windows Run factory now uses the fixed broker client for new
exchanges, including ordinary users without volume-management privilege. The
engine, pipe, protected staging and client ownership path are implemented.
Native restricted-client storage and normal Run orchestration are separate
checks: a working interactive Windows Sandbox run and normal-user UAC still
require an authorized Windows host. Metadata retains `brokerImplemented:false`
until that complete native journey is accepted.

## Current verification limits

Source `3319f92`, native workflow `42118172704`, is **not accepted** as a complete
filesystem/restricted-owner journey. Its restricted .NET client passes 13 metadata
and 31 exchange checks, and the original JavaScript owner passes eight checks.
The actual restricted primary-token child then fails during its bounded owner
journey. Token creation and pre-start verification reached that phase, but the
original failure did not capture the child's exit code or result phase. The last
successful token read is not evidence that this later failure was a token decoder
failure. Source `1f06765` repeats the same failure phase.

The Windows historical scanner file also reaches its original 300-second bound
after one passing case; the Shield recovery file fails its private state-lock
wait. These remain unfinished verification/implementation work, with no hardware
or account blocker and no increased deadlines or waived assertions.
[Original digest-verified failures](evidence/windows-filesystem-3319-failures-summary.json).

The test-only parent now captures the original child's wait/exit and bounded
phase/category/check-count metadata before enforcing its existing successful-exit
assertion. It excludes private result paths and text. The owner also retains
initialization failures within its protected failure record. Actual child token,
privilege, job, exit and owner assertions remain mandatory. Both managed targets
compile with the existing SDK, 223 portable checks pass, and three isolated
contract/package groups pass 26 checks. Native execution of this diagnostic is
still pending; it is not a repair acceptance.

The new child diagnostic initially failed to survive the coordinator's privacy
projection. That projection now shares a tested bounded schema: child wait/exit,
booleans, a maximum eight completed checks and fixed phase/category labels are
retained; private paths, arbitrary keys and malformed values are omitted. Nine
focused groups pass 85 checks including this projection, protocol ownership,
package/application contracts and the corrected history fixture. The default
Windows store now uses [short-lived keyless lock helpers](private-state-locking.md)
to avoid repeated PowerShell startup without caching keys or extending existing
budgets. Native verification of the new worker and diagnostic remains pending.

Native source `0740791` now passes both default-store lease files: 16 tests and
one declared platform skip, with digest-verified artifacts and cleanup. The
restricted owner still fails, but the new diagnostic now preserves its actual
child exit: `0xC0000142` (`STATUS_DLL_INIT_FAILED`), with no owner result file.
That is an initialization failure, not evidence that a token decoder failed.
The earlier metadata/exchange/original-owner checks remain partial. A separate
filesystem-lane bootstrap reaches an unconfirmed removal outcome at
`service-absence-configuration-header`; it preserves its original installation.
Neither failure is blocked by absent hardware or accounts.
[Restricted-child evidence](evidence/windows-restricted-owner-074-failure-summary.json),
[native lease evidence](evidence/windows-keyless-leases-074-summary.json).

The next restricted-owner proof creates a temporary private window station and
desktop, explicitly granting only the original user and SYSTEM access and
requesting a medium integrity label. It supplies that exact desktop at child
creation, restores the proof process's original namespace immediately after
creation, and checks both private handle closes after owned-tree exit. Existing
names refuse; no interactive desktop ACL or persistent machine configuration is
changed. Token, privilege, same-user, Job, owner and independent-exit assertions
remain required. Successful report validation additionally requires this startup
kind and confirmed private-object retirement.

This follows Microsoft's documented [child startup desktop access requirement](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw).
It is a source-level candidate for the observed initialization failure, not a
confirmed root cause or accepted repair. Both managed targets compile with the
existing SDK; 223 portable checks and three focused groups/28 checks pass, with
cleanup. Native execution and the separate service-removal failure remain open.
[Source evidence](evidence/windows-private-desktop-source-summary.json).

The removal diagnostic now distinguishes the original service type, start mode
and error-control checks using fixed labels. All three guards remain exactly
`16 / 2 / 1`; no disabled, changed or otherwise non-original header is accepted.
The shared guard passes 769 pure numeric cases, including every one-byte
alternative and maximum DWORD. Both targets compile; all 992 portable checks and
five focused groups/52 checks pass. Native proof and coordinator entry points
require that guard inventory. This identifies the failing invariant on the next
native run; it does not accept service removal or establish its root cause.
[Diagnostic evidence](evidence/windows-service-header-diagnostic-summary.json).

## Prior component evidence

PR head `bd77ec4`, merge execution `b5295a6`, passes the actual Windows native
component job. Digest-verified evidence covers thirteen restricted metadata
checks, 31 restricted .NET exchange checks and eight JavaScript host-owner checks,
with exact service/files retirement and independent native exits. The .NET
checks use thread impersonation; the JavaScript owner used the CI worker token.
This does not establish a restricted JavaScript primary process or an ordinary
user account setup. [Digest summary](evidence/windows-bd77-native-summary.json).

A new test-only `NativeRestrictedHostProof` addresses that first gap. It creates
one same-user Node child with a restricted primary token through
[CreateProcessAsUserW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw),
rather than inferring child identity from thread impersonation. The actual child
token is inspected before resume and after exit: same user, primary type,
Administrators deny-only, medium integrity and no assigned volume-management
privilege. [CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)
disables privileges and a separate call removes the volume privilege; the
[mandatory integrity label](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)
is independently read back. The child repeats the eight real host-owner checks.

The child is assigned to an exact kill-on-close Job Object during process creation,
starts suspended, inherits no handles, and has a ninety-second bound inside the
existing 120-second native guardian deadline. Original process handles and zero
active job members verify exit before only the owned result/context fixture is
removed. Failure preserves the original service, native ownership and fixture;
there is no fallback to an elevated child, account creation or replay. This is
trusted CI proof code, not a general untrusted-code sandbox or a shipped helper
command. No production executable gains a new launch surface.

Both C# targets compile with zero warnings/errors and all 223 portable checks
still pass using the existing SDK (`windows-history-native-build-1793879927476.json`);
owned build scratch is removed. Three isolated runner/selector/owner groups pass
38 checks, including closed context/changed executable and non-disposable child
refusal, with every cleanup verified (`isolated-test-b8d1adb6-f004-4b92-934f-4dda9e7180e1.json`).
The first actual `869aa9e` run fails before child creation: `CreateProcessAsUserW`
returns Win32 error 1314 at `create-restricted-child`. The preceding thirteen
metadata, 31 restricted .NET exchanges and eight CI-worker JS owner checks pass;
they do not upgrade the failed restricted-process proof. The original service,
ownership and owned context remain preserved, without retry. Archive digest and
small failed receipt verify in the [failure summary](evidence/windows-restricted-owner-869-failed-summary.json).

The next native `80e8551` attempt uses `CreateProcessWithTokenW` and fails with
Win32 87 at `create-restricted-child-with-token`, still before child start.
The original service/context remain preserved, with the failure digest verified.
Its diagnostics establish an assigned but disabled creator quota privilege,
no assigned primary-token privilege and enabled impersonation privilege.
That failure remains failed. [Failure summary](evidence/windows-restricted-owner-80-failed-summary.json).

Current source uses one direct `CreateProcessAsUserW` call with the creation-time
Job attribute. The token now contains an explicit restricting-SID list: the same
user plus Everyone, Authenticated Users and Users. Those SIDs undergo an additional
access check; they grant no access absent the normal check. The native proof
requires `IsTokenRestricted`, the exact four SIDs, primary type, same user,
Administrators deny-only, medium integrity and absent volume privilege before
creation and on the actual child before/after execution. Microsoft's
[IsTokenRestricted contract](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-istokenrestricted)
checks restricting SIDs, separately from disabled groups/deleted privileges.

The test creator temporarily enables only its already assigned quota privilege
around that one creation call and independently reads back its original state
before resuming the child. An absent privilege refuses; no privilege is assigned,
account created, profile loaded or fallback attempted. The restricted child was
constructed before that creator-only adjustment. Existing command/input/Job,
suspended start, timeout and independent exit assertions stay intact. These
changes follow the documented creation contract; the earlier failures' precise
kernel cause is not inferred solely from this source correction.

Both targets compile warning-free and all 223 portable checks pass with the
existing SDK; owned scratch is removed (`windows-history-native-build-1793882469415.json`).
The earlier local compiler declaration failure remains failed in
`restricted-host-build-failed-1793880635213.json`; no native code ran and its exact
scratch was removed before the corrected build. Actual Windows execution of the
explicit restricting-SID and scoped creator-privilege proof is pending.
Even a passing result will not establish interactive/UAC, a separate ordinary-user
account/profile, Windows Sandbox guest isolation or physical acceptance.

## Fixed resource boundary

Requests contain one of `create`, `inspect`, `attach`, `detach` or `retire`, an
installation binding, request/operation UUIDs, task-scope/input-manifest hashes
and a fresh nonce. They cannot supply a filesystem path, program, device,
capacity, disk number, mount target or approval assertion. Task/input hashes bind
the effect; they do not independently confer host task authority.

Every path derives from the protected installation and operation UUID. Code,
image files, journal records and mount folders are System/Administrators owned;
the designated ordinary client receives read/traverse access. Only the content
of the mounted FAT16 image is writable through the mount. One active image is
allowed per installation, fixed at 64 MiB plus its 512-byte VHD footer. Up to 64
retained operation inventories bound the journal; exhaustion refuses new work.
Unknown or reserved state consumes the active slot. No existing image is reused.

The engine uses the same native image UUID, NTFS file IDs, VHD footer, disk
extent, mount reparse tag, FAT label/serial and capacity checks as the existing
filesystem boundary. It creates no bootable disk and exposes no general shell,
format, external drive or arbitrary mount operation. Retirement independently
verifies detach and deletes only the original image and empty mount/disk folders.
Unknown or unfamiliar contents are preserved.

## Durable effects and fresh observations

An immutable, flushed/readback reservation precedes permission to change native
state. Completed records are chained to the original operation, task, inputs,
service image and request. A new challenge for the same request returns its
original recorded result; it does not repeat the effect. That historical result
is distinct from `inspect`, which rechecks current native state. A reservation
without a recorded result remains unconfirmed, even if a disk can be observed.

Replies use the installation's protected P-256 key and bind the fresh nonce,
request/effect digest and exact result. The ordinary client verifies that
signature, then acknowledges its digest before the pipe disconnects. Metadata
keeps its five-second bound; the new volume request has a separate fixed
45-second bound. Service removal checks that all exchanges are retired both
before stopping and after independently observing the original process exit.
Only then can known journal files be removed; there is no recursive cleanup.

## Evidence and remaining connection

Sixteen metadata crypto checks, thirty exchange protocol checks and 37 journal
fault checks, plus 23 image/mount fact checks, execute against compiled source on
Linux. Both actual helper and
linked proof compile with zero warnings/errors; the existing SDK is reused and
source-only build scratch is removed. The native CI proof uses a restricted
existing token with Administrators deny-only and `SeManageVolumePrivilege`
explicitly removed, following [Microsoft's token contract](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken).
It creates no account and checks exact image creation, duplicate refusal,
foreign-scope/capacity denial, read-only host files, attach, actual kernel
filesystem exhaustion, detach and retirement through the System pipe.

That new proof must pass before native exchange acceptance is claimed. The normal host admission, exact guest consumer and independent exit-before-cleanup
connection are implemented and fault-tested; native application/guest and
interactive Sandbox/UAC acceptance remain separate checks. No device, account, guest, workstation mount or
physical keyboard was changed on the Linux pilot by these builds.

The helper also exposes fixed `probe-exchange` and `exchange-binding` observations.
The probe sends only a fresh nonce-bound inspect for an unknown operation and
creates no disk or journal. Mapping observation accepts only operation/task/input
scope and derives the protected path itself. It requires a fresh signed mounted
result, exact immutable facts and journal state, then pins the original native
image, mount and extent through admission. The ordinary client receives no
volume-management privilege. The 24-case native proof now includes this mapping
and a substituted-root rejection. Both C# builds and all 106 portable checks
pass; its actual Windows execution and normal Run native acceptance remain pending.

The first engine Windows run failed during the preceding metadata-service
removal, before reaching its volume test. That failure remains retained; bounded
removal phase diagnostics and one post-failure observation were added to isolate
it. See [verification](verification.md) for the exact source and receipt.

The native `f2285b8` exchange run reached the client's first filesystem write and
failed with access denied. Passing a null security descriptor to
[AttachVirtualDisk](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/nf-virtdisk-attachvirtualdisk)
inherits the image file's ACL. The corrected broker supplies a separate disk
DACL granting only System/Administrators and its designated client data access.
The backing image and mount reparse point retain their protected read-only client
ACLs. Five actual kernel-open denials now accompany the filesystem-write/disk-full
proof; its complete 31-check native rerun remains required.

`exchange-result` looks up an original request in the protected journal after a
fresh signed serial pipe observation. It reports absent, reserved or recorded
without invoking `Begin` or performing any effect. The helper checks expected
installation/owner/image identity before effect requests. The native transport
pins that tuple, exact task/input/request IDs and independently stopped guardian.
All 43 journal and 23 fact checks pass locally; the combined host setup/transport/
Sandbox/release checks pass 84 cases with explicit native/guest doubles. The normal Run connection now consumes them through its exact protected ownership adapter.


## Normal Run ownership

`windows-broker-exchanges.mjs` holds the same kernel host lease as Personal setup
from preparation through verified retirement. It never installs or elevates. A
read-only capability check precedes input/tool staging; an unavailable broker
settles the consumed Run as unavailable even for a privileged desktop user.
Only a protected native observation supplies the exact disk directory admitted
to the guest backend. The parent Program Files directory is never allowed.

The encrypted owner binds the original installation/client, operation, task
scope and reviewed input-manifest hash. Create, attach, detach and retire each
receive a stable request UUID persisted before native dispatch. Missing replies
are reconciled through read-only lookup after independent original guardian
exit; neither an absent result nor a reservation is resent. A final protected
result can recover storage facts while the original uncertain Run outcome stays
uncertain. Fresh mapping checks precede guest use. The consumer kernel lease
fences retirement even during the interval before a guest session exists.

Retirement requires original guest exit, native guardian exit, current signed
state and fixed original cleanup requests. Mode or workspace revocation blocks
new capabilities but permits exact cleanup. Private broker owners are omitted
from ordinary snapshots. Retained images from the earlier direct privileged
implementation keep their original cleanup port; they are never a fallback for
new Run effects. Portable tests use explicit service/VM doubles; native storage
and full guest acceptance are recorded separately in [verification](verification.md).

Native `1f4e8e5` is now accepted for the complete 31-check restricted-client
storage proof, both service/setup lifecycles and all thirty native filesystem
checks. Four archive digests were verified and receipts retained. This accepts
the protected storage engine and exact removal lifetime; the newer JavaScript
owner adapter still needs its own native demonstration and the complete guest
journey remains unaccepted.

The native CI coordinator now also schedules eight checks of the actual
JavaScript owner and native client against that same disposable service. It
uses a separate synthetic AEAD store, fixed installed helper/setup paths, an
exact task/input mapping, a real mounted write/readback, consumer lease and
exit refusal, original detach/retire and duplicate refusal. All retained Job
guardians must independently exit before its private fixture is removed. Its
worker token remains administrative; the separate 31-case proof establishes
the ordinary restricted-client boundary. Failure preserves the original
installation and AEAD ownership facts. The eight-check owner proof now passes at `b0f29ae`; its archive digest
verified and bounded receipt retained. It launches no guest, account, setup
dialogue or physical-device operation. The later combined contract batch failed
its Windows-only inventory check and six-minute limit; complete workflow
acceptance remains pending the corrected, independently bounded contract jobs.

### Stopped-service observations

Removal independently captures and waits for the original running service process.
The later stopped-service poll does not use `dwProcessId`: [Microsoft documents
that field as invalid when stopped](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-queryservicestatusex).
Initial pending states are preserved instead of opening a potentially stale PID.
A valid stopped original entry remains pending until SCM reports error 1060;
error 1072 also remains pending. The existing ten-second absence bound is unchanged.
The finer `service-absence-{open,configuration,status,wait}` phases distinguish
future failures without exposing private files or relaxing identity checks.

The `25bd26c` native removal failure remains failed. The PID-contract correction
compiles the actual helper and linked proof without warnings and passes 112
portable checks; this Linux compilation does not establish native removal
acceptance. Its fresh Windows lifecycle result remains pending.

The `14aae78` failure is retained at the more specific
`service-absence-configuration` phase. Full original configuration is now checked
again immediately before `DeleteService`. During accepted-deletion polling, an
absent original registry environment is allowed only as a pending observation;
any present environment and the SCM configuration must still match. It never
establishes absence or permits file cleanup: SCM error 1060 is still required.
Query-configuration/environment phases distinguish any remaining failure. Both
actual targets compile without warnings and 112 portable checks pass; this
correction still needs its fresh native lifecycle result.

The next native failure at `238592b` is in the configuration query, before the
environment check. Queries now retain their native Win32 error. After the
original accepted delete only, missing-path, key-deleted and service-deleting
errors remain pending until the next independently opened observation. This
follows the [configuration API's documented registry-error behavior](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-queryserviceconfigw).
It does not accept a missing query as absence or accept mismatched metadata.
Access denial, invalid handles and other unexpected errors preserve the original
installation. The sole absence condition remains OpenService error 1060, after
closing each observation handle and within the original bound.


### Current removal diagnostics

At `6a45643`, the native worker again passes all 31 restricted exchange checks
and eight JavaScript-owner checks, then fails removal at configuration readback.
The failed artifact remains failed; its verified digest is retained in the
[checkpoint summary](evidence/windows6a-validation-summary.json). Removal now
reports fixed phase labels for required/returned buffer size, header, bounded
string range/termination/value checks, tag and environment. No paths, account
strings, environment values or native buffer bytes are added to diagnostics.
All exact comparisons, recognized pending native codes and original absence/
stop/exit deadlines stay unchanged. The helper compiles with zero warnings;
112 portable protocol/journal/fact checks pass using the existing SDK. Native
service-removal acceptance still requires a fresh worker result.

The next native restricted-owner attempt, source `4fd8c28`, failed during
`restricted-primary-token` verification before creating a child. Its [digest-verified
failure summary](evidence/windows-4fd-restricted-token-failed-summary.json) retains
the original failure and protected installation. The old diagnostic value 5385
was the low bits of a managed exception HRESULT, not a Win32 API error. The proof
now distinguishes those codes and names each finite token check; it retains every
restriction and the original child deadline. The ordinary-account and restricted
primary-process acceptances remain unproven.

Native CI now assigns filesystem, native setup lifecycle and restricted exchange
proofs to three independent workers. Each keeps its original per-command and
20-minute worker bounds; all lanes remain required. The previous repeated native
setup-removal failures remain failures, with original service/staging ownership
preserved. They can no longer suppress the restricted-primary-token check.
Windows Python scanner contracts also receive their own worker. The runner and
workflow inventory regression passes 21 checks in two independently exited groups
(`isolated-test-59c30a1e-da6b-48b4-b820-d5393fcd4dc4.json`).

Native setup keeps its closed stdout schema and emits only a fixed failure phase
and managed child exit code on stderr. Private managed removal failures use
101–129/199 to identify the existing control stages; every nonzero code remains
an unconfirmed outcome, with no replay or broad cleanup. Both managed targets
build warning-free and the portable proof passes all 223 checks with scratch
removed (`windows-history-native-build-1793885463455.json`). The C++ compile and
actual native retirement/restricted-process reruns remain unaccepted. This is
unfinished validation on available CI infrastructure, not a missing account or
physical device.

The independent restricted-exchange worker at `c8b1216` now reaches the precise
restriction-flags assertion before child creation. Its [digest-verified failure](evidence/windows-c8b-restricted-failed-summary.json)
remains failed. Microsoft [documents](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)
that filtering an already restricted token intersects restricting SID lists. The
next test-only source sets all four intended SIDs in the first filter and retains
them through the privilege-deletion filter. Each flag has a separate diagnostic
phase; no restriction or deadline is removed. This addresses an API-ordering
problem; the original native failure cause is not established until retesting.
Both managed targets build with zero warnings/errors and all 223 portable checks
pass, with scratch removed (`windows-history-native-build-1793886535629.json`).

Source `c8b1216` has [digest-verified native success](evidence/windows-c8b-native-summary.json)
for the independent filesystem and setup lanes: thirty filesystem checks/39
native calls, owned disk attach/detach and guardian cleanup, plus exact native
setup install/retire, thirteen restricted metadata checks and all six lifecycle
checks. The strict native C++ build succeeds. Earlier setup failures remain
failed and their cause remains unestablished. The same overall workflow still
fails the separate restricted-token and software contracts; it is not accepted
as a whole. No ordinary-account/UAC or guest acceptance is inferred.


### Actual restrictions and historical token metadata

The next native run at `59a73de` passes public `IsTokenRestricted` but fails the
separate historical `TokenHasRestrictions` phase before creating a child. Its
phase alone does not distinguish a failed query from a false-value assertion.
Its [digest-verified failed receipt](evidence/windows-59a-restricted-failed-summary.json)
remains failed, with the original protected service/context preserved. Earlier
31-case exchange and eight-case owner checks do not establish restricted primary
process acceptance.

The test-only correction now uses one [`CreateRestrictedToken`](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)
call: four explicit restricting SIDs, Administrators disabled to deny-only, and
explicit deletion of every assigned privilege except optional
`SeChangeNotifyPrivilege`. It verifies the resulting primary token, same user,
medium integrity, exact SID identities, Administrators deny-only and assigned
privileges before resuming the child and again after exit. Public
[`IsTokenRestricted`](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-istokenrestricted)
and the actual restricting SID list remain required.

The [`TokenHasRestrictions`](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class)
historical flag is retained as three boolean observations, separate from those
concrete restrictions. The reserved `TokenIsRestricted` information class is not
used. Creation-time Job containment, scoped creator privilege restoration, exact
owner/handle identity, verified tree exit, cleanup and original deadlines remain
required. A closed report validator rejects missing restriction witnesses,
unknown process-proof fields and account/guest/fallback claims.

Both managed targets compile with zero warnings/errors and all 223 portable
checks pass using the existing SDK; owned scratch is removed
(`windows-history-native-build-1793890000422.json`). Four isolated report,
workflow, runner and verifier groups pass 25 checks with every cleanup verified
(`isolated-test-ace3199b-6401-426e-b3fe-fc9b90fc7731.json`). This correction still
requires native Windows execution. It changes no shipped helper/setup commands,
workstation privileges, accounts or logon settings.


The next native `03a6065` attempt reaches the historical observation but returns
no boolean observations before failing. The previous record inferred a false
flag too early; that inference is withdrawn. Its digest-verified failed receipt
(`windows-03a-restricted-owner-failed.json`, archive
`3c7ba721f35b0d709ce6770442be4206c93d9a3b7dbb87b9696d9aa3bead3e26`,
artifact `13426377387`, run `42049684276`, execution `b6c892a4e294b638fe93a8d09e9c8427fff96c01`)
proves failure during the query before child creation. All concrete restrictions
remain required. The test now records only fixed query stage/class, native error
and required/returned byte count, separating a native API failure from a managed
size check without returning token contents or changing the query/deadlines.
Both managed targets again compile without warnings/errors and all 223 portable
checks pass, with owned scratch removed
(`windows-history-native-build-1793891291067.json`). Native validation remains
unfinished. [Source-bound failed summary](evidence/windows-03a-restricted-failed-summary.json).


Native source `a87f048` now identifies the query failure precisely: information
class 21 requests a one-byte buffer, but the general reader requires at least
four bytes. It fails that managed size guard before any boolean observation or
child creation. The [failed source-bound summary](evidence/windows-a87-restricted-failed-summary.json)
retains the original failure and protected installation.

The test-only historical reader now accepts an exact one-byte or four-byte
result and decodes that width without an over-read. Other widths, unexpected
probe success and changed returned lengths refuse. Every other token reader
retains its original bounds. Successful reports must include three exact width
observations in addition to the boolean observations and all concrete security
checks. Both managed targets compile without warnings/errors and 223 portable
checks pass; three isolated runner/selector/report groups pass 25 checks with
every cleanup verified. Receipts are `windows-history-native-build-1793898737394.json`
and `isolated-test-ef01f9d9-9abd-4eab-bb63-7b1637cc8a73.json`. The corrected reader later reaches restricted child execution at `3319f92`,
which fails during the child owner journey as recorded above; this partial
progress does not accept the complete native journey.

### Queue native proofs independently

Each Windows native matrix lane now has its own per-ref concurrency group; each
software contract suite has a separate per-ref/suite group. Fresh restricted
process evidence no longer waits for an unrelated complete contract workflow to
finish. The three native lanes, every software suite, job identities, artifact
inventories and original deadlines remain required. Running jobs are not
cancelled by the new groups. As with GitHub's existing single-pending behavior,
a newer pending job can replace an older pending job for that same lane; a
cancelled result is never accepted as a pass.

This uses [GitHub's documented job-level matrix concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
The workflow/runner inventory checks pass 22 cases in two isolated groups, with
both child cleanups verified
(`isolated-test-5765093e-c5c7-4cae-b147-a300397d844c.json`). Native execution later supplied the child-journey failure above; queue changes
do not supply acceptance of that remaining boundary.
