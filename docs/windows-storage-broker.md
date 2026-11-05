# Bounded Windows storage service

Switchyard keeps privileged volume operations in its fixed LocalSystem service.
The desktop application stays unelevated. The native installer and Personal
review/apply route are described in [reviewed Windows Run](windows-reviewed-run.md).

The exchange engine is implemented and compiles without warnings. Its service
transport and restricted-client native proof are new and await Windows CI.
**The normal task Run/guest-consumer connection is unfinished.** Metadata still
reports `brokerImplemented:false`; neither compilation nor a service lifecycle
establishes a working interactive Windows Sandbox run.

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

That new proof must pass before native exchange acceptance is claimed. Connecting
the normal host admission to this service, binding the exact guest consumer,
maintaining independent VM exit before cleanup, and interactive Sandbox/UAC
acceptance remain separate work. No device, account, guest, workstation mount or
physical keyboard was changed on the Linux pilot by these builds.
