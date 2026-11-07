# Check the identity inside a selected Rust package

Supply Chain and Release Shield inspect the manifest inside a reviewed Cargo
archive alongside its declared SHA-256 checksum. If the file matches the checksum
but declares a different package name or version, the scan fails with an
`artifact.identity-mismatch` finding. This closes a separate gap from byte
integrity: matching a declaration does not prove the declaration describes the
expected package.

Quoted target tables and single-line literal/basic strings now pass 58 independent
Python TOML/USTAR/gzip cases. Ten focused groups pass 96 tests, including six actual
Linux Cargo scanner journeys and six Windows guest doubles. Original package
bounds, typecheck, unchanged input/Git state and exact child/tree cleanup pass;
the owned test root is removed. The previous rejection remains recorded.
Installed acceptance of this grammar expansion and native Windows guest checks
remain separate. [Current source evidence](evidence/cargo-quoted-manifest-source-summary.json).

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

- Ordinary tables with bare or single-line quoted keys, including nested tables
  and quoted platform conditions such as `target.'cfg(unix)'.dependencies`.
- Single-line basic/literal strings, string arrays, booleans and signed 64-bit
  decimal integers, with comments and LF or CRLF line endings.
- One explicit `[package]` with string `name` and `version`, validated by the
  existing bounded Cargo identity rules. Prerelease and build spelling remain
  literal; `+build.7` cannot stand in for `+build.8`.

The parser rejects duplicate definitions and scalar/table conflicts anywhere in
the document. It does not ignore unsupported fields after reading the identity.
Quoted field keys, empty strings and repeated string-array values are accepted.
Quoted and bare spellings of the same key are aliases; a dot inside a quoted key
is literal. A Map tree preserves those distinctions and rejects duplicate or
scalar/table collisions without treating keys as JavaScript object properties.
Multiline strings, inline tables, array tables, dotted field keys, inherited
identity, eight-digit Unicode escapes and other TOML forms retain an explicit
coverage gap. This is not a general TOML implementation or a promise to inspect
every crate produced by Cargo. Cargo's [manifest reference](https://doc.rust-lang.org/cargo/reference/manifest.html)
describes the broader format.

The quoted-key behavior follows [TOML 1.0 key and table rules](https://toml.io/en/v1.0.0#keys).
Parsing a platform condition preserves its syntax as a key; it does not evaluate
that condition or establish which dependencies apply to the host. Cargo.lock
retains its separate, narrower grammar.

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
Normal installed 12b3c87 passes ten Cargo metadata/in-memory checks inside its
56-check update, including all 26 reference cases and six new archive reports.
All 54 semantic workspaces and frozen frontend are preserved; the prepared
bundle is removed. [Installed receipt](evidence/installed-cargo-archive-summary.json).
This starts no installed scanner process. Live installed scanner and native
Windows archive acceptance remain unperformed.
