# Switchyard implementation and acceptance

This branch is a partial implementation of the complete Rev2 handover. The F77
is the pilot device, not a scope limit. The [requirement ledger](switchyard-requirements.md)
separates unfinished implementation from checks needing hardware or accounts;
[verification](verification.md) identifies the exact source and practical limits
behind each accepted result.

## Active backend iteration

The Windows host now durably hands one original fixed-capacity image into a
writable-volume lifecycle. Native Windows workflow 41896980735 at `a8690328`
passes actual host-service creation, mounted readback, non-replay/consumer fences
and cleanup of changed disposable guest data, alongside its ownership fault
checks. Local storage/suite/runner checks pass 53/53. Original image identities,
footer, exact detach and independent native/guest exit remain cleanup fences.

Native Sandbox startup now requires that exact bounded volume binding; a
read-only configuration-validation verb uses the same native checks without
starting a VM. Fifty focused storage/transport/session/runner cases, four release
checks, type checking, a zero-warning/error helper build and six Linux guards
pass. Native mapping acceptance is pending CI. The higher backend and isolation wrapper now consume the trusted bounded
volume lease while holding both consumer locks, validate plain output descendants
and preserve exclusive native-owner retirement. Their related group passes
43 checks with one declared platform skip; type checking passes. The Studio
Windows Run adapter and personal-host privileged setup remain unfinished
software. Supported interactive Windows VM acceptance remains a separate check.

Complete Windows `72c5f96` passes 261/261 groups: 1,738 tests, 1,690 passed and
48 declared skips. Its bounded archive was SHA-256 verified and only receipt
`d2b0aa0e-67a1-4f55-bf55-d21daf5fab91` retained. That checkpoint predates the
image/volume ownership work. The frontend remains frozen; no browser was reloaded.

The Linux reviewed Run service now passes actual task-input → policy/checkpoint/
budget → Bubblewrap → owned guardian → terminal-result checks. It preserves the
original admission result, releases terminal budget claims, and removes only
unchanged, independently stopped input copies. Atomic tool replacement during
readiness cannot substitute the reviewed executable descriptor. The API,
shutdown/restart boundaries and evidence exclusions are described in the
[execution contract](reviewed-task-execution.md). The frontend is unchanged.

Normal installed source `f5dd3be` passed ten checks with one actual empty
Codex task and zero prompts. Actual output confirmed denied host files,
credentials and loopback, a read-only workspace and 64 MiB temporary filesystem.
The terminal receipt, separate exact-stop receipt and duplicate admissions
matched. A third, freshly reviewed Run started after the stopped Run; all three
native guardians independently exited and unchanged input copies were removed.
Definitions, selection, keyboard-only validation state and the private link were
restored. Receipt: `installed-repository-execution-1793816998155.json`.

Complete local Linux source at `0151e69` passes 151/151 groups: 967 tests,
957 passed and ten declared platform skips. Receipt:
`9a24b1ab-23b8-44d5-9569-a444d2ff1ca0`. The disposable checkout was removed after
its complete receipt and exited children were verified. Full `26b78c2` also
passes 151/151 groups (968 tests, 958 passed, ten skips), receipt
`8c5bf46c-45aa-402e-b153-7191f1778a3b`. Full `6c92229` passes 152/152 groups:
973 tests, 963 passed and ten declared skips, receipt
`82350ba4-6f30-4839-bddc-7fa318809380`. Both temporary checkouts were removed
after their complete receipts and all exited children were verified. Complete
`0aeae75` also passes 152/152 groups (973 tests, 963 passed, ten skips), receipt
`ca301375-e244-4718-b78a-4b514094d07d`; its temporary checkout was removed after
all child cleanup verified. Ubuntu release CI at `0aeae75` passes, including the actual namespace
preflight with Ubuntu's packaged scoped bwrap AppArmor profile. No workstation
policy, namespace restriction or guardian no-new-privs setting was weakened.

The full `c5059dd` Linux run passes 152/153 groups: 979 tests, 968 passed, one
failed and ten declared skips. Receipt `1f131ceb-d88e-4d87-a191-1402fab793f2` is
preserved as failed; all children exited and its temporary checkout was removed.
The failure was an actual application-stop race: `/proc/<pid>/stat` returned
`ESRCH` after the authenticated process exited between checks. Stop now accepts
that exact exit observation alongside `ENOENT`; generation/birth checks remain.
All five application cases pass, including deterministic ESRCH/ENOENT reads
after a real authenticated fixture shutdown. Complete corrected `e9dd9ae` passes
154/154 groups: 988 tests, 978 passed and ten declared platform skips. Receipt
`0dfaddc5-3caf-4538-8ff4-3d4d563f6ad8` was retained and its disposable checkout
removed after every child exit and cleanup was verified.

Reviewed per-run stop has a separate approval, budget, operation and receipt,
with exact-handle ownership, duplicate rejection and receipt-only recovery.
Windows CI at `0151e69` exposed its deadline being spent on repeated kernel-lock
helper startups before the effect. Admission now uses one authenticated journal
transaction; the same 15-second deadline and final scope check remain. A failed
admission write cannot deliver a stop or leave a partially started claim. Native
Windows backend acceptance of this correction passes at `dbe62bb`. The short Windows client lane
at `26b78c2` passed 42 assertions but exceeded the suite group's 45-second harness
limit before its last case. That group now receives 120 seconds on Windows;
no assertion or production deadline was removed. Its corrected short Windows
client lane passes at `0aeae75`.

Native Windows reviewed-input staging is implemented separately from guest
execution. The fixed C# reader pins NTFS directory/file handles, refuses reparse
points and writable source handles, hashes only explicitly selected bytes, and
sets/readbacks a private inherited DACL on a new owned directory. The host
records readiness before acknowledgement, verifies the complete copied tree,
refuses replay and preserves unknown owners/replacement files. Cleanup requires
independent native and trusted consumer exit. Four software boundary cases and
four release-closure cases pass; the helper compiles with zero warnings/errors
and rejects this mode on Linux before filesystem effects. The small build
scratch directory was removed, with source/assembly hashes retained in
`windows-reviewed-inputs-build-20261104.json`; no runtime was copied. Actual NTFS,
ACL, junction, sharing and cleanup acceptance passes all six checks at `dbe62bb`,
run 41866977914. Its 785-byte artifact was imported, SHA-256 verified and parsed;
only `windows-reviewed-inputs-dbe62bb-native.json` was retained, not a runtime or
archive. This confirms filesystem staging, not VM execution.
[Input contract](reviewed-execution-inputs.md).

The failed installed `0151e69` proof remains preserved, including its encrypted
workspace and synthetic inputs; it exposed the subsequently corrected dispatch
scope reuse. New Run requests bind their own protected review digest, while
same-request duplicates and legacy operation scopes retain no-replay behavior.
The Windows Sandbox backend now consumes exact native input capabilities,
requires the selected catalog, binds source/operation/manifest, holds a kernel
consumer lease and maps the reviewed copy read-only. Readiness persists the exact
new guest ID before recipe acknowledgement; exit evidence must match its VM,
operation and configuration. Unknown guest exit preserves the exchange and
blocks extraction/restart replacement. Thirty-three mapping/staging/installation
cases and four packaged-closure checks pass. The default process-only runner
cannot supply that proof. [Guest mapping contract](windows-reviewed-guest-mapping.md).
The fixed native Sandbox CLI transport now implements closed metadata/list/
start/stop/connect/login-probe/worker verbs with protected readiness, native exit,
exact VM scope and non-replay tombstones. It separates the guest exit code from
the CLI exit code. The new C# helper builds with zero warnings/errors; build
scratch was removed after retaining `windows-sandbox-cli-build-20261104.json`.
Five native-transport faults, 26 final transport/manifest/package cases, type
checking and the delayed-recipe mapping checks pass. Actual no-VM native metadata
acceptance is now in CI, pending. [Native command contract](windows-sandbox-native-commands.md).
The managed guest lifecycle coordinator is now implemented and software-tested:
exact creation, guest acknowledgement, viewer/login readiness, one worker,
deadline/mode cancellation, owned VM stop and receipt-preserving restart recovery.
It never substitutes a viewer PID or adopts a foreign singleton. A pending
unconfirmed start remains unknown even when inventory is empty; only its exact
acknowledged nonce or explicit native no-effect evidence permits reconciliation.
The worker now supports explicit host shutdown ownership while preserving legacy
request defaults, avoiding result loss from racing guest self-shutdown. Seven
lifecycle cases and the combined 57-case boundary/inventory check pass; package
imports and type checking pass. The compiled worker parser passes five actual
checks with zero-warning/error build; scratch was removed and hashes retained in
`windows-guest-worker-lifecycle-build-20261104.json`. [Lifecycle contract](windows-managed-guest-lifecycle.md).
The embedded guest worker now builds into the existing helper and stages as one
exact, private NTFS hard link without copying a runtime. Protected ownership,
native/consumer exit fences, no replay and foreign-data preservation pass 44
focused cases with snapshot/runner checks. Both input and tool staging now
release their in-process slot after independently verified late exit. Six actual
compiled entry/guard checks pass with zero warnings/errors; source/assembly
hashes were retained and scratch removed. Native Windows link/renamed-entry
acceptance is now included in CI, pending. [Tool contract](windows-guest-tools.md).
One host-pinned Node runtime now stages beside that worker as a second exact
hard link. Requests cannot supply tool paths; copied trusted configuration,
independent source hashes/identities, native write-sharing prevention and
interrupted two-link cleanup pass 47 focused cases. The updated helper compiles
without warnings/errors and Linux native-only guards pass; scratch was removed
after `windows-node-tools-build-20261104.json` retained source/assembly hashes.
Actual Windows Node version/identity/sharing acceptance is in CI, pending.
The Studio Windows Run adapter, bounded writable
exchange, broader build outputs and remaining action connections are unfinished
implementation, not hardware blocks. The coordinator explicitly reports no
exchange filesystem quota. Actual VM startup/login/worker/stop/restart acceptance
remains a separate supported-Windows-host check. Complete Windows verification at `dbe62bb`
passed backend, native NTFS, helper, Job Object, fresh-runtime and suite packaging,
then stopped on the runner's hard five-minute validator rejecting the explicitly
declared eight-minute execution group. That exact exception and upfront timeout
preflight are now tested; other groups retain the five-minute cap. The early Windows backend harness
now allows 20 minutes for the expanded encrypted lifecycle cases; individual
effect deadlines and final backend failure gate remain unchanged. Complete
corrected Windows acceptance remains pending. Native Windows CI now continues independent helper checks
after a backend failure, then requires that backend outcome in an unconditional
final gate; a failed backend still makes the release verification fail. Complete
corrected Windows release verification now passes at `c5059dd`, run 41872535770,
including backend, native filesystem/guardian checks, optional-runtime acceptance
and the complete packaged release. Seven real input/metadata checks were imported
after verifying their archive digest; only `windows-reviewed-inputs-c505-native.json`
was retained. Newer worker/Node/image changes have separate pending native checks.
The bounded full-verification archive was also downloaded and digest-verified;
only its JSON receipt was retained. It records 259/259 groups, 1,720 tests,
1,672 passed and 48 declared skips: `c4e345be-cb3f-4188-8542-3ce9fbc63ec3`.

The bounded Windows exchange image constructor is now implemented: a new exact
private file, fixed 64 MiB virtual capacity, 63 MiB FAT16 partition, operation-bound
VHD footer, native read-only header verification and no mount/attach effect.
Fourteen compiled corruption/format checks and an independent read-only fsck
pass; the helper builds without warnings/errors. Build/probe/specification
scratch was removed after retaining source/assembly hashes. A separate short
Windows filesystem workflow now runs the native input, worker, Node and image
journeys without waiting for the full release lane. [Exchange contract](windows-bounded-exchange.md).
Durable image ownership, attach/mount/detach/recovery, actual disk-full validation
and the Studio adapter remain unfinished implementation; image creation grants
neither a writable exchange lease nor execution protections.

The first short Windows filesystem run at `332aa8a` passed all 11 actual native
input, embedded-worker and Node checks, then failed image header validation.
The overall job remains failed; its digest-verified small JSON receipt is
preserved as `windows-filesystem-332aa8a-failed.json`. The reader now emits closed
field/numeric diagnostics for that software discrepancy. Exact read-only image
inspection is implemented separately, binding original file identity, bytes,
private DACL and detached metadata without changing the directory ACL. The
updated C# build has no warnings/errors, all five Linux mode guards pass and
16 staging/package cases pass. Native inspection/header acceptance is pending;
the immutable Node/worker checks are confirmed individually, not an accepted
complete image or VM path.
The diagnostic rerun at `f5dd3be` identifies the VHD UUID byte-order comparison:
the native reader returns the persisted opaque network-order bytes, while CLR
GUID formatting reverses its first fields. The comparator now checks the exact
original bytes instead. No alternative UUID/capacity is accepted; corrected
native acceptance remains pending.

Corrected `899c78e` now passes all 16 actual native Windows filesystem checks,
including image UUID/capacity/type, detached state and fresh immutable readback.
The small archive was downloaded and digest-verified; only
`windows-filesystem-899c78e-native.json` was retained. Detached image ownership
is now implemented separately: protected reservation before ACK, exact full/
footer hashes and identities, one outstanding image per compartment, no replay,
consumer/native exit fences, fresh native inspection before cleanup, scope
revocation and late-exit reconciliation. Eight image fault cases plus the
combined 43-case ownership/snapshot/runner check pass; four package checks and
type checking pass. Its actual native service journey is now in CI, pending.
Writable-volume ownership/attach/mount/detach/recovery and the Studio Run adapter
remain unfinished; the detached lease grants no execution protection.

The detached ownership service now passes all 19 actual native Windows checks
at `e589c4f`, run 41889645807. The same immutable source passes all 156 Linux
groups: 1,004 tests, 994 passed and ten declared platform skips. Receipt
`71ff7517-e62b-4fbc-87c6-be7aa3d3deac` was retained; all children were verified
cleaned/exited and the temporary checkout was removed.

The exact native volume attach/inspect/detach mode is now implemented. It binds
the original image and mount directory, derives its device from the VHD handle,
verifies the single exact partition extent and mounted capacity, and requires
fresh detached image/tag/footer readback before reporting cleanup. It enables
only an existing assigned manage-volume privilege in that helper's token.
Six Linux entry guards, four package checks and a zero-warning/error build pass;
build scratch was removed. Native CI now includes actual fixed-capacity disk-full
and detach checks, pending. Durable writable-volume handoff/restart ownership,
trusted guest mapping, normal Windows privilege setup and Studio Run connection
remain implementation work; no guest or workstation disk was opened locally.

## Current pilot

The normal installed command is `~/.local/bin/switchyard`. Source development uses
`mise exec node@24.14.0 -- npm run layout:studio`. Keep the printed private link
local; it contains access credentials. The frontend is frozen for review and its
exact digest/private link have survived the backend updates.

Published source `f5dd3be` is installed as release
`3b3b7883ab312dd486cf165180ff9e057020c8a933e2d1dbf2584ada2f4b688e`: 484 files,
4,779,454 bytes. Six normal update checks pass (assignment-legends-1793816639962.json).
Current plus one rollback occupy about 12 MiB, bundle staging is empty, and no
extra Node/.NET/Python/model runtime was copied. Definitions, modes, keyboard
configuration, native ChatGPT voice/overlay repair and the private link remain
preserved.

## Accepted evidence

- Complete Linux source: 147/147 groups, 950 tests, 940 passed and ten declared
  platform skips; receipt 99c53747-2954-4709-ba97-b646bf07d43f. The additional
  Windows metadata probe is explicitly skipped on Linux. Type checking passes.
- Normal installed reviewed commit: seven checks with one actual empty Codex
  task, zero prompts, exact binary bytes/author, preserved unowned edit, shared
  index reconciliation and durable duplicate/receipt readback. Receipt
  installed-repository-commit-1793784076954.json.
- Normal installed metadata recovery: eight checks after a deliberate native
  lost-readback fault. One commit, unchanged original outcomes, separate recovery
  approval/receipt, 36 independently stopped Git guardians and 13 retained
  inspection guardians. Receipt installed-repository-recovery-1793787873360.json.
- Distinct client launch: five versioned recipes and eight ownership/lifecycle
  tests. Five actual Python/Gio private-bus cases passed again with exact native
  URL hash witnesses, without opening a browser. The normal installed Linux API
  then passed six checks with one actual fixed GitHub Copilot homepage request,
  no prompt or repository/session selection, independent helper exit and
  duplicate/scope rejection. Current witness proof:
  installed-client-launch-1793790877401.json. Validation records/staging were
  removed and keyboard-only validation mode/selection restored. The external
  browser was not closed; visual page/account/plan acceptance is not claimed.
- Complete corrected Windows release: 250/250 groups at PR head cda0327,
  1,657 tests, 1,615 passed and 42 reviewed skips. Run
  [41807554404](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41807554404),
  receipt 6fa0410b-85ba-4dd5-a7f9-69b7b112767f. Its tested merge commit has exactly
  the same source tree. Bounded artifact 13313323640 was downloaded and SHA-256
  verified; no archive/installer bundle was retained locally. This predates the
  newer retained-ownership/recovery/client-launch source.

## Windows client verification

Current source 7012333 passes all 60 checks in six native Windows boundary
groups, including shared reviewed-input validation, exact role routing and actual
Windows PowerShell WinRT/AsTask metadata without URI activation. Run
[41826311362](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41826311362),
receipt c04c5387-af12-480c-87f3-84015b127275. Tested merge commit 7074fdf has the
exact same source tree. Artifact 13319542094 (1,573 bytes) was downloaded in memory
and SHA-256 verified; only client-platform-windows-7012333.json remains privately.
No archive or runtime copy was retained. Windows guest input staging remains
unfinished; these checks do not accept an interactive URI/account/window.

The published role source 15cd19b passes all 47 checks in five native Windows
client groups, including actual Windows PowerShell WinRT/AsTask metadata without
URI activation. Run [41823579833](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41823579833),
receipt 9097bbd9-ec2b-4dc3-ae9d-8619c6fc4993. Its tested merge commit f4c37b2 has
exactly the same source tree. Bounded artifact 13317249676 (1,424 bytes) was
downloaded and SHA-256 verified; the complete receipt is retained privately as
client-platform-windows-15cd19b.json. No ZIP or installer/runtime was retained.

The earlier WinRT source ea96ffe passed 41 checks after correcting native UTF-8
startup and the fixed Utility module; the original 40/41 timeout remains in the
verification history. The 15-second metadata deadline was preserved. These are
accepted software/native metadata checks, not interactive Windows URI, account,
window or device acceptance. The complete newer Windows release remains pending. Run 41823818569 at source
38eb56d has passed backend, native helper build, owner-loss, optional-runtime and
suite packaging steps; complete bundle verification was still running at the
last check. The newer 7012333 full run is queued behind it. Track fresh runs after
subsequent documentation checkpoints; do not relabel queueing as a hardware block.

## Complete Windows failure corrected in the native boundary test

Complete run 41823818569 at 38eb56d reached all groups but failed the client group:
its Python-only negative test tried `python` in the deliberately restricted
copied-source PATH. Nine other client cases, including native WinRT metadata,
passed. Receipt b7410441-17c0-494d-930b-a8363d0df29f preserves that failure.
The negative test now invokes each platform's actual fixed helper: Windows
PowerShell on Windows and system Python/Gio on Linux. Four malformed requests
must fail before broker activation. No test was skipped, no ambient PATH added
and no script policy changed. Six focused groups pass locally (60 tests, 59
passed plus the declared native Windows metadata skip), receipt
286739b9-26e1-4100-8a8c-ef4d2165655c. Fresh Windows/full acceptance is pending.

## Client roles and physical intent connection

Exact `client-surface` role bindings now connect summon to the fixed HTTPS
transport, with a fresh local binding identity and recipe digest. The Linux CLI
and Windows hotkey sender attach an invocation UUID. The protected launch record
binds that UUID to its exact role, so retries do not launch again and rebinding
cannot reuse an old result. Binding changes before native acknowledgement reject
the request; late changes retain an uncertain outcome. Client bindings accept no
prompt/context or invented session and do not change the active conversation.
Work dispatch follows the persisted active workspace and permits only Microsoft
work Copilot, regardless of a caller's Personal compartment field.

Five focused groups pass: 47 tests, 46 passed and the one declared native Windows
metadata skip on Linux; receipt f0d42bbb-0858-4b23-9ae0-bcc08b1409c0. Six physical
intent cases include authenticated HTTP, actual gateway receipt correlation,
stale/late role changes and synthetic Work-only routing. Native client responses
in these cases are fixtures, not browser/account acceptance. The changed Windows C# sender compiles from isolated tracked sources; its actual
dispatch method sent two authenticated HTTP packets with distinct matching UUIDs
on Linux/.NET 8.0.30 (native-hotkey-dispatch-20261104-034142.json). No build files
were retained. The normal installed role demonstration then passed seven checks
at 15cd19b (installed-client-launch-1793792795748.json): one real fixed homepage
request through a temporary workflow role and the actual CLI physical-intent
gateway, matching invocation/receipt, no duplicate helper, zero prompts and
independently verified exit. It restored validation definitions, keyboard-only
mode and selection and removed only its own successful launch record. A small
private dated definition backup remains. No physical key, browser visual/account
or interactive Windows acceptance is claimed. Fresh native Windows source
acceptance remains pending.

## Reviewed disposable execution inputs

The older Linux execution-root provider copied an entire repository, potentially
including ignored credentials. It now requires exact host-pinned non-production
input paths, SHA-256 values and sizes. Descriptor-bound reads, bounded buffers,
source/staging identities and replacement-preserving cleanup enforce the file
boundary; unselected files are not copied. The namespace no longer mounts the
host's whole `/etc`. Old disposable pins without reviewed inputs fail closed and
need deliberate repinning. See [the input contract](reviewed-execution-inputs.md).

Nineteen focused Linux/runtime checks and type checking pass. The final complete
Linux run passes all 147 groups (950 tests: 940 passed, ten declared platform
skips; receipt 99c53747-2954-4709-ba97-b646bf07d43f). A real Bubblewrap
proof passed three checks (repository-inputs-native-1793793697536.json): exactly
one file staged; host home, host `/etc/passwd`, unselected synthetic credentials,
ambient credential variables and a live host loopback listener inaccessible;
original files unchanged and temporary staging removed. No runtime was copied.
This is an execution prerequisite, not completion of general execution effects,
Windows guest staging, output disk quotas or the frozen frontend connection.

## Work still required

General execution effects, exact native desktop/IDE/terminal attachment, remaining
controller controls and the accumulated frontend/guided role controls remain
implementation work. An API launch request does not establish a provider
account, native conversation, task completion, exact resume, submission or
mediation. Microsoft work Copilot remains distinct from GitHub Copilot; no
personal fallback or employer approval is inferred.

Installed discovery again returned zero configuration interfaces; latest receipt
device-enumeration-1793793796030.json. No HID interface was opened or written. Actual F77/B122 identity, typing/unlock/hot-plug, physical
transactions, printer/cap fit, interactive Windows accounts/windows, microphone
and approved tenant behavior require their actual environments. No flash/reset,
bootloader, solenoid operation, public release, merge or license change occurred.

## Next executable work

1. Connect host-pinned general execution recipes to the task authority, durable
   operation/budget and owned-guardian paths, reusing the reviewed input provider.
   Finish the bounded Windows writable exchange, Studio
   execution adapter and broader output/restart recovery; the
   older direct process-group launcher is not the desktop readiness/exit protocol.
2. Complete exact native desktop/IDE/terminal attachments and the remaining
   source-verified controller controls, without substituting homepage launch for
   session identity or inferring electrical capabilities.
3. Check fresh Windows CI for each new native change and continue integrated
   acceptance. Preserve the frozen frontend until its review resumes; its task,
   role, recovery and controller controls remain unfinished implementation.

## Preserved implementation history

The previous append-only status log is preserved in full, in order, across
[history part 1](switchyard-status-history-1.md) and
[history part 2](switchyard-status-history-2.md). Their byte-for-byte concatenation
matches the original 137,472-byte log; SHA-256: `43ac555a5b970cf4e918af5578b09396309ce858e7872257fc1eb9231cca87f0`.
Relative documentation links retain their original directory. This page is the
current entry point; older pending statements in the history are superseded by
the explicit source/receipt evidence above.
