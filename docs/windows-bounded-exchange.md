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

Native Windows CI now verifies image creation, independent Windows VHD metadata,
exact hashes/identities, duplicate/foreign-entry/directory-change refusal and
independent guardian exits. A separate short filesystem workflow runs these
checks alongside the unchanged full release lane. Its first run at `332aa8a`
passed all 11 input/worker/Node checks, then failed the image's native header
validation. That failed receipt was downloaded and digest-verified as
`windows-filesystem-332aa8a-failed.json`; the overall job is not accepted. The
reader now reports only a closed field code and bounded numeric diagnostics so
the native layout/identity discrepancy can be corrected from actual evidence.
The local format test is not Windows acceptance.

`--inspect-bounded-exchange-image` now provides a separate read-only native
observation of the exact original file ID, full image hash, private directory
DACL and detached VHD header. It cannot change the directory's ACL or create a
replacement. CI includes changed identity/hash refusals and byte preservation;
native acceptance remains pending. The updated helper builds with zero
warnings/errors and five Linux native-only guards pass. Build scratch was
removed after retaining `windows-image-inspection-build-20261104.json`.

The creation proof explicitly reports `attached: false`,
`exchangeQuotaEnforced: false` and `sandboxEnforced: false`. Durable host image
ownership, exact attach/mount/detach and recovery, actual disk-full validation,
the trusted bounded-exchange lease, and Studio Windows Run connection are still
unfinished implementation. A disk image alone is not an execution capability.
