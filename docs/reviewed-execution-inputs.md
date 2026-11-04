# Reviewed inputs for disposable execution

A disposable execution workspace must contain only the files the operator
reviewed. Copying a whole project can carry an ignored `.env`, database or
credential file into the run. Switchyard's Linux runtime now refuses that
fallback. The [reviewed task execution API](reviewed-task-execution.md) connects
this prerequisite to separately approved Linux Run effects. Other execution
actions and the frontend connection remain unfinished.

The existing v1 host-pinned process recipe accepts an `inputFiles` extension:

```json
{
  "inputFiles": [
    {
      "path": "tests/synthetic.mjs",
      "sha256": "<64 lowercase hexadecimal characters>",
      "size": 128,
      "classification": "non-production"
    }
  ]
}
```

Replace the example digest and size with the exact reviewed file's SHA-256 and
byte count. This is one field within a complete process recipe, not a standalone
manifest. The manifest still needs its normal independent host pin and user
presence approval. Imported manifests cannot approve their own contents. Review
the data classification deliberately: the software verifies selected bytes and
their boundaries, not the truth of an arbitrary label or absence of secrets
within an explicitly supplied file.

Linux disposable recipes require 1–4,096 literal relative files, at most 4 MiB
each and 64 MiB total, with at most 32 path components and 4,096
distinct directories. File/directory collisions and Windows console/serial
device aliases (including superscript DOS aliases) are refused before staging. There is no directory glob, Git metadata, traversal,
platform alias, case-colliding path or automatic dependency installation. Omitted
inputs fail closed. Existing Linux pins that relied on copying the full project
must be reviewed with exact inputs and pinned again; they are not silently
migrated. Non-disposable recipes retain their existing behavior.

The provider retains source directory descriptors, refuses symbolic links and
non-regular files, bounds reads to the reviewed length, verifies the digest and
file metadata, and checks the repository directory identity. It writes a new
private directory and gives group/other users no file access. Unselected inputs
are never enumerated or copied. Cleanup checks the original staging directory
identity; a replacement directory is preserved for review.

The Linux namespace no longer mounts the host's whole `/etc`. It supplies only
the dynamic loader cache there, alongside the existing read-only system runtime
mounts, isolated process/network namespaces and cleared environment. This does
not turn explicitly selected production data into synthetic data, provide a
disk quota for arbitrary writable build outputs, or accept every execution
action. The connected Run path mounts reviewed inputs read-only and bounds its
temporary filesystem. Windows now has a separate native NTFS staging port with
the same manifest limits. Its guest mapping and execution connection remain
unfinished; copying reviewed inputs alone provides no execution containment.

## Native Windows staging

`createWindowsReviewedInputs` is an internal host port, not a command endpoint.
It reserves one exact operation, source identity, selected-byte manifest and new
staging-directory identity in the encrypted compartment before acknowledging
native startup. The fixed `--stage-reviewed-inputs` C# helper pins directory
handles without delete sharing, refuses reparse points and already writable
source handles, and copies only bounded, digest-verified regular files. It sets
and independently reads back a protected inheritable DACL on its newly owned
directory. No existing project permissions are changed.

The JavaScript host independently checks the complete staged tree and hashes.
Duplicates cannot stage again; unknown native exit blocks replacement. Cleanup
requires the original directory, unchanged selected bytes, independently stopped
stager and a trusted consumer-exit fence. Replacements and unfamiliar files are
preserved. The workspace retains at most 64 MiB of outstanding input copies.
The returned lease explicitly reports `sandboxEnforced: false` and has no runtime
protection grant; it cannot authorize an uncontained host recipe.

Four software boundary cases pass. The changed C# helper compiles with zero
warnings/errors using the existing .NET 8 SDK. Its Linux invocation rejects the
Windows-only mode before filesystem effects. Actual NTFS sharing, DACL,
junction, identity and cleanup acceptance runs separately on Windows CI:

```powershell
node scripts/verify-windows-reviewed-inputs.mjs --synthetic --helper=C:\absolute\path\Switchyard.Hotkeys.exe
```

This explicit synthetic check opens no guest, keyboard or provider account and
copies no runtime. Native acceptance remains pending; it does not establish
Windows Sandbox execution or interactive device/account acceptance.

Run the software boundaries with the pinned Node runtime:

```sh
mise exec node@24.14.0 -- node --experimental-transform-types --test apps/linux-companion/test/linux-repository-runtime.test.ts apps/windows-companion/test/repository-runtime.test.ts
```

For an explicit actual Linux Bubblewrap check using only temporary synthetic
files, run:

```sh
mise exec node@24.14.0 -- node --experimental-transform-types scripts/verify-repository-inputs-host.mjs --synthetic
```

The native check stages one exact file, verifies that host home/`/etc/passwd`,
unselected credentials, ambient credential variables and a live host loopback
listener are inaccessible, then verifies cleanup and unchanged originals. It
does not touch the keyboard, frontend, desktop settings or application accounts.
The small result receipt stays private; no runtime is copied.
