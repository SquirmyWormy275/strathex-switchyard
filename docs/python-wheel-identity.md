# Compare the identity inside a selected Python wheel

An explicitly reviewed Python artifact now receives two separate checks: its
[declared byte hash](python-artifact-integrity.md), and the package identity in
its wheel metadata. A matching hash does not excuse a wheel declaring a different
package or version. Supply Chain and Release Shield record that identity mismatch
as a failed provenance finding, bound to the original requirements file, selected
artifact and metadata digest.

The scanner never extracts, imports or installs the archive. It does not evaluate
environment conditions or resolve dependencies. Every result remains incomplete.

## What is compared

The scanner requires one root `.dist-info` directory containing nonempty
`METADATA`, `WHEEL` and `RECORD` files. It reads the mandatory identity headers,
accepts metadata versions 1.1, 1.2 and 2.1–2.6, and requires Wheel-Version 1.0.
Duplicate or folded identity fields refuse. The directory and metadata must agree
under PyPA name normalization and PEP 440 version equivalence. The observed name
and version are then compared with the selected declared pin. The artifact
selection itself still binds the literal pin. These are declarations, not proof
of publisher identity or installation compatibility.
[Wheel specification](https://packaging.python.org/en/latest/specifications/binary-distribution-format/),
[core metadata](https://packaging.python.org/en/latest/specifications/core-metadata/).

`artifact.archive` distinguishes `matched`, `mismatched` and `unsupported`.
Unsupported or mismatched identity requires `python_wheel_identity_not_verified`.
Byte integrity retains its own status and findings. Reports and CycloneDX include
only bounded identity fields, the metadata digest and explicit unverified RECORD
status; private summaries, descriptions, source and other metadata are omitted.
The host validates the closed observation, exact BOM, mandatory gaps and failed
finding, including the original finding ceiling.

## Bounds and unsupported formats

The ZIP reader cross-checks central/local headers, names, offsets, lengths,
compressed-stream consumption and CRC32 values. It accepts stored and deflated
members in a contiguous single-disk archive. It refuses encryption, descriptors,
ZIP64, archive/member comments, extra fields, trailing payloads, links, special
file types, unsafe/nonportable names, case aliases and file/directory collisions.
No member path reaches the filesystem.
[ZIP format](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).

The original two-MiB selected-file and sixteen-MiB aggregate input limits remain.
One archive may contain at most 1,024 entries, four MiB of expanded bytes, 512-byte
ASCII names and 32 path segments. Identity files are limited to 64 KiB and 2,048
lines. Wheel and npm inspection share a 32-MiB expansion budget. The reader reserves
an allowance before decompression; failed attempts retain that charge. Forged
small sizes cannot remove the decompressor's output bound.

RECORD presence and ZIP CRC checks do **not** verify RECORD's cryptographic hashes.
Compatibility tags, signatures, dependency graphs, executable behavior, actual
license texts and publisher provenance remain unfinished implementation. Broader
ZIP variants also remain unsupported. `artifact_contents_not_inspected` and
publisher/environment gaps remain mandatory where already required.

## Evidence and reproduction

Eight focused groups pass 100 checks, followed by eight unit checks with one new
case: **101 distinct passes**. Six actual Linux scanner journeys and six Windows
guest doubles cover both actions, matched/mismatched identity and unsupported
format. Original files, index/HEAD, protected incomplete receipts, replay and exact
process/staging cleanup verify. Typecheck and the original package-size test pass.
Installed metadata acceptance now passes; native Windows wheel acceptance remains separate.
[Source evidence](evidence/pypi-wheel-identity-source-summary.json).

The existing `scripts/verify-python-inventory-host.mjs --read-only-metadata`
verifier now pins the wheel implementation and adds the fifteen ZIP facts,
six in-memory wheel reports and host-forgery refusals. Its ten checks start no
scanner process or account action. Four flag-guard tests and all ten installed checks pass at source 39db1fe,
within its 44-check update. All 54 workspace snapshots and frozen frontend verify;
only current plus one rollback remain and the prepared bundle is removed.
[Installed receipt](evidence/installed-python-wheels-summary.json).
[Verifier source checks](evidence/private-runner-verification-source-summary.json).

The [15-case reference fixture](../scripts/fixtures/pypi-wheel-oracle.json) was
created and reread in memory with existing Python 3.15.2 `zipfile`, email parsing
and PyPA utilities. Seven supported identity cases and intentionally unsupported
wheels retain independent byte/CRC/offset/metadata facts and source hashes. Tests
also cover every truncation of the stored example, unsafe headers, duplicate
metadata, a forged-size decompression bomb, manifest-separated findings and the
original finding limit. The initial two identity regressions and intermediate
host-admission failures remain recorded separately.

Regenerate using already installed tools:

```sh
python3 -I -B scripts/generate-pypi-wheel-oracle.py
```

This writes only synthetic fixture JSON. It downloads, extracts and executes no
package. Portable tests consume the committed facts without needing Python.
