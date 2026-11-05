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
