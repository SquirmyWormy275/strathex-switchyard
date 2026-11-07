# Check the identity inside a selected Rust package

Supply Chain and Release Shield inspect the manifest inside a reviewed Cargo
archive alongside its declared SHA-256 checksum. If the file matches the checksum
but declares a different package name or version, the scan fails with an
`artifact.identity-mismatch` finding. This closes a separate gap from byte
integrity: matching a declaration does not prove the declaration describes the
expected package.

Use the existing [Cargo artifact selection](cargo-artifact-integrity.md). No new
authority or selection format is required. Both the lockfile and archive must be
explicitly reviewed inputs. The scanner never invokes Cargo, resolves dependencies,
extracts files, runs build scripts or contacts a registry.

## Supported archive and manifest

Cargo produces compressed `.crate` archives and normalizes the packaged
`Cargo.toml`. Embedded VCS metadata does not establish verified provenance.
[Cargo packaging reference](https://doc.rust-lang.org/cargo/commands/cargo-package.html).

The inspector accepts gzip-compressed USTAR with one exact `NAME-VERSION` root
matching the manifest. It requires exactly one correctly cased `Cargo.toml` at
that root. Ordinary files and empty directory entries are supported. Links,
extension records, duplicate or case-colliding paths, traversal, file/directory
conflicts, damaged headers and ambiguous manifests remain unsupported.

The entire manifest must fit a closed TOML subset:

- Ordinary tables with bare keys, including nested tables.
- Basic quoted strings, distinct string arrays, booleans and signed 64-bit
  decimal integers, with comments and LF or CRLF line endings.
- One explicit `[package]` with string `name` and `version`, validated by the
  existing bounded Cargo identity rules. Prerelease and build spelling remain
  literal; `+build.7` cannot stand in for `+build.8`.

The parser rejects duplicate definitions and scalar/table conflicts anywhere in
the document. It does not ignore unsupported fields after reading the identity.
Literal or multiline strings, empty strings, inline tables, array tables, quoted
or dotted field keys, inherited identity and other TOML forms retain an explicit
coverage gap. This is not a general TOML implementation or a promise to inspect
every crate produced by Cargo. Cargo's [manifest reference](https://doc.rust-lang.org/cargo/reference/manifest.html)
describes the broader format.

The existing limits remain: 2 MiB per selected file, 4 MiB expanded per archive,
32 MiB shared expanded budget across selected package formats, 1,024 entries and
32 path segments. A manifest is at most 64 KiB, 2,048 lines and 8,192 characters
per line; individual strings retain the existing 2,048-character bound. Failed
decompression consumes its reserved allowance.

## What the result establishes

| Observation | Result |
| --- | --- |
| Supported manifest agrees with the lock identity | Archive identity `matched`; scan remains incomplete. |
| Supported manifest differs in name or literal version | Archive identity `mismatched`, high provenance finding and failed scan. |
| Unsupported, malformed, ambiguous or excessive input | Archive identity `unsupported` and a bounded reason. |

Unmatched observations retain `cargo_archive_identity_not_verified`. The strict
host validator binds identity, manifest hash, reviewed bytes, finding fingerprint
and CycloneDX properties. The fingerprint includes the registry-source digest so
private and public identities cannot borrow each other's failure evidence.
Deleting or changing those claims refuses admission.

Name, version, manifest SHA-256, entry count and expanded size are retained for
supported archives. Raw metadata, source text, private registry URLs and build
scripts are not returned. License inspection, dependency/feature/target
resolution, publisher verification and code safety remain unfinished. Existing
coverage gaps and the 512-finding ceiling continue to apply.

## Verification

The reference generator uses the existing Python standard library's `tomllib`,
`tarfile` and `gzip` to produce 26 synthetic cases. It runs no Cargo command,
build, package install or network request. Thirteen focused groups pass 132 distinct tests, including six actual Linux
scans and six Windows guest doubles. Original package bounds, typecheck,
replay, unchanged Git/files and exact cleanup verify. The first composed run
failed one test-harness inventory assertion; the corrected inventory and
follow-up pass without extending existing deadlines.
[Source receipts](evidence/cargo-archive-source-summary.json).
Installed and native Windows archive acceptance remain pending.
