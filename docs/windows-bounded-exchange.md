# Bound Windows guest output storage

The Windows Run adapter requires a filesystem-enforced bound on its writable
exchange. The artifact collector's size checks cannot prevent a running guest
from filling an ordinary mapped host directory. The intended exchange uses a
new, owned fixed-capacity virtual disk. Existing host-volume quotas and disks
are outside this implementation's mutation boundary.

Image creation is implemented. `--create-bounded-exchange-image` accepts only
the schema, operation UUID, precreated `disk-UUID` directory and its exact native
identity. It pins the NTFS directory chain, refuses existing entries, sets and
reads back its private inheritable DACL, then creates only `exchange.vhd` with
exclusive create semantics. It cannot take a disk number, device path, arbitrary
image filename, capacity, shell command or source image.

The image has a 64 MiB fixed virtual capacity and a 64 MiB + 512-byte backing
length. Its only partition is a 63 MiB FAT16 exchange filesystem. The constructor
fully writes the new image and bounds every metadata offset. Its fixed VHD
footer binds the operation UUID, capacity, disk type and checksum. The native
helper additionally asks Windows' read-only VHD reader to verify the same UUID,
capacity, sector size, fixed type and detached state. Image and footer hashes,
file/directory identities and ACL readback form the creation proof.

The format follows Microsoft's [VHD specification](https://www.microsoft.com/en-us/download/details.aspx?id=23850)
and [FAT specification](https://www.microsoft.com/en-us/download/details.aspx?id=53426).
The metadata check uses [OpenVirtualDisk](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/nf-virtdisk-openvirtualdisk)
with no writable backing-store depth and [GetVirtualDiskInformation](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/ns-virtdisk-get_virtual_disk_info).
Creation does not attach a disk, assign a drive letter, mount a volume or format
an existing filesystem.

Fourteen checks invoke the compiled image constructor/validator. They cover
actual output size and identity, corrupt checksums, altered size/type/UUID even
with a recomputed checksum, changed partition geometry, truncation, and rejection
of nonempty streams or an empty UUID before writes. An independent read-only
`fsck.fat` check accepts the actual partition as clean with 32,183 free data
clusters; its hash is unchanged afterward. The helper builds with zero
warnings/errors, and native-only entry guards refuse Linux execution. Build,
probe and specification scratch is removed after retaining source/assembly
hashes in `windows-bounded-image-build-20261104.json`.

Native Windows CI at `899c78e` passes all 16 actual filesystem checks, including
new image creation, Windows header/UUID readback, fresh read-only inspection,
identity/hash refusal and byte preservation. Its small archive was downloaded
and digest-verified; only `windows-filesystem-899c78e-native.json` was retained.
A separate short filesystem workflow runs these checks alongside the unchanged
full release lane.

The initial `332aa8a` job passed 11 input/worker/Node checks before failing image
header validation. Its diagnostic rerun at `f5dd3be` identified an opaque UUID
byte-order comparison error. Windows returned the original bytes; formatting
those as a CLR GUID reversed the first fields. The reader now compares the
exact original bytes. Failed receipt `windows-filesystem-332aa8a-failed.json`
remains separate; no alternate identity or capacity was accepted as a repair.

`--inspect-bounded-exchange-image` provides a separate read-only native
observation of the original file ID, full image hash, private directory DACL
and detached VHD header. It cannot change the ACL or create a replacement. The
native checks include changed identity/hash refusals and byte preservation.
The helper builds with zero warnings/errors and five Linux native-only guards
pass. Scratch was removed after retaining
`windows-image-inspection-build-20261104.json`.

The creation proof explicitly reports `attached: false`,
`exchangeQuotaEnforced: false` and `sandboxEnforced: false`. A separate one-time
writable handoff is described below. An image creation proof alone is not an
execution capability; Studio Windows Run remains unfinished.

## Detached image ownership

`createWindowsExchangeImages` now persists the exact operation, protected review
scope, private root identity and native guardian before acknowledging creation.
It permits only one outstanding 64 MiB image per compartment. Retained operation
records prevent duplicate creation. Independent bounded descriptor reads verify
the complete image and footer hashes, fixed length, original single-link file
identity, unchanged timestamps and the entire directory entry set.

A lease must obtain fresh native detached-state readback before use. Removal
requires independent command exit, trusted consumer exit, fresh native detached
readback and unchanged original bytes. A partially created image without its
original identity/proof is preserved. Missing or foreign entries, replacements,
changed content and unknown owners block another image. Cleanup after scope
revocation retains observed identity facts and never upgrades the original
uncertain result or replays creation. Creation and inspection guardians are
recorded separately through each exact ownership transition; late verified exits
can release the in-process slot without restarting the app.

Eight explicit native/VHD/DACL fault cases and the combined 43-case
ownership/snapshot/runner check pass; four packaged-import checks and type
checking pass. Tests use owned sparse synthetic files, real descriptor hashing,
encrypted state and kernel locks. They do not mount a disk. Native CI now also
exercises this host service through actual creation, fresh readback, duplicate/
quota/consumer fences, exact guardian exits and guarded removal; its new result
passes all 19 checks at `e589c4f`, run 41889645807. Protected image records are
omitted from general workspace snapshots.

The initial lease owns an immutable detached image and reports no filesystem
enforcement or sandbox protections. It becomes unusable after a writable-volume
reservation; the separate volume lease owns subsequent inspection and cleanup.

## Exact native volume transition

The fixed `--bounded-exchange-volume` mode now implements attach, inspect and
detach for an original image and precreated `mount` folder. Requests pin both
native file/directory identities and the image's footer; attach additionally
requires its complete initial hash. The root must contain exactly these two
entries. Paths to physical disks, drive letters, volume selectors, format
commands and source images are not accepted.

Attach enables only an already assigned `SeManageVolumePrivilege` in that
helper's process token. It does not grant the privilege or install a service.
Windows' [AttachVirtualDisk](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/nf-virtdisk-attachvirtualdisk)
creates the attachment without a drive letter. Its persistence is tracked
separately from the short helper's process lifetime. The physical device number
is derived from this exact opened image, then a bounded read-only volume scan
requires one matching partition extent at the original offset and length.
Only that volume can be associated with the original empty private folder.

Readback verifies its mount-point tag and original NTFS directory identity,
volume GUID, exact backing extent, FAT label/serial and bounded capacity. The
private root and mount ACLs are read back independently. Detach removes only
that verified association, calls
[DetachVirtualDisk](https://learn.microsoft.com/en-us/windows/win32/api/virtdisk/nf-virtdisk-detachvirtualdisk),
closes its handle, and reopens the original image to verify detached state,
unchanged footer and cleared mount-point tag. API success alone is insufficient.
Unknown results preserve the original image/mount for exact reconciliation.

The helper compiles with zero warnings/errors; six Linux mode guards and four
packaged-import checks pass. Scratch was removed after retaining
`windows-bounded-volume-build-20261104.json`. Native CI now adds exact attach,
duplicate refusal, fresh mounted inspection, bounded writes through actual
kernel disk-full and exact unmount/detach readback. It uses only its new owned
image, attempts original-identity cleanup after failure, and never starts a VM.
All 23 native checks pass at `f4c0f9a`, run 41892941320, including actual
disk-full behavior and independent detached readback. The digest-verified small
artifact is retained as `windows-volume-f4c0f9a-native.json`.

## Durable writable handoff

`createVolume()` reserves the original image and mount identities in encrypted
state before native attach acknowledgement. It cannot replay, create another
image in the compartment, or return the original immutable lease to service.
Fresh inspection binds the exact volume GUID, capacity, mount association and
ACL readback. Native readiness, independently observed process exit and current
scope are separate checks. Lost writes or acknowledgements retain the original
reservation and permit only original-identity reconciliation.

The resulting lease reports the actual filesystem quota separately from Sandbox
containment. A consumer holds its own cross-process lock and must recheck scope
before returning a result. Cleanup requires trusted consumer exit, independently
stopped native commands, fresh exact-volume inspection and detached readback.
Guest changes to the disposable FAT body are expected; removal still requires
the original backing identity, length, footer and complete entry set. Foreign
entries, replaced files, changed footer bytes or unknown owners are preserved.
Restart cleanup can resume an already verified detach without replaying attach
or upgrading the original admission outcome.

All 53 focused storage/suite/runner checks pass, including 18 storage fault and
lifecycle cases. Packaged import checks and type checking pass. These tests use
explicit native doubles, real encrypted records, locks and descriptor reads;
they do not demonstrate a mounted volume. The native Windows lane now includes
three additional host-service checks for the one-time handoff, consumer fencing
and changed-body cleanup. All 26 actual native checks pass at `a8690328`, run
41896980735; its digest-verified receipt is
`windows-writable-handoff-a869-native.json`.

Windows Sandbox mapping of this trusted volume, Studio Run connection and a
supported personal host's privileged setup remain implementation work. No VM
execution capability is inferred from a volume lease.
