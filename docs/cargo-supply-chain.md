# Inspect Rust dependency declarations

Supply Chain and Release Shield can now read an explicitly reviewed `Cargo.lock`
alongside npm lockfiles and pinned Python requirements. Use the existing
[task and signed-feed review](shield-baseline-scanner.md). The offline scanner
does not invoke Cargo, resolve dependencies, run build scripts or download crates.

Cargo records exact dependency versions and sources in its generated lockfile.
Switchyard preserves the distinction between public crates.io, another registry,
Git and packages without a source field. A private Git package cannot borrow a
public advisory result merely because its name and version match.
[Cargo's lockfile guide](https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html)
and [source encoding](https://doc.rust-lang.org/nightly/nightly-rustc/src/cargo/resolver/encode.rs.html)
describe these declarations.

## Supported input and explicit gaps

The parser accepts a bounded subset of Cargo-generated version 3 and 4 lockfiles:
`[[package]]` entries with `name`, stable `major.minor.patch` version, optional
`source`, registry `checksum` and optional string-array `dependencies`.
Comments, LF/CRLF and supported basic quoted strings are accepted. Version
components are bounded unsigned 64-bit integers; names are at most 64 ASCII
characters. Public identities use lowercase names. Registry checksums require
64 lowercase hexadecimal characters.

Each file is limited to 1 MiB, 32,768 lines and 8,192 characters per line.
Dependency strings are limited to 2,048 characters, with at most 4,096 distinct
entries and 256 KiB per array. The aggregate inventory across manifests remains
limited to 4,096 components. Duplicate package identities, malformed strings,
unknown fields/tables, older/newer formats, prereleases and build metadata refuse
inventory for that entire file with `unsupported_cargo_lock`. No partial package
list is returned for a malformed file.

This is declaration inventory, not a replacement for Cargo's resolver or a
general TOML parser. Git source syntax, revisions, dependency strings and registry
availability are not resolved or verified. All Cargo results retain
`cargo_resolution_not_performed`, incomplete repository scope and unverified
publisher provenance. Nonempty inventories also retain missing license and
artifact-integrity coverage. Broader Cargo syntax, selected features/targets,
dependency graphs, licenses and artifact/publisher verification remain unfinished.

## Advisory and BOM boundaries

Only the canonical public source
`registry+https://github.com/rust-lang/crates.io-index` matches signed
`crates.io` advisory entries by exact name and version. Other registries, Git and
local packages retain advisory coverage gaps. The
[OSV schema](https://ossf.github.io/osv-schema/) identifies this ecosystem as
`crates.io` and supports `SEMVER` intervals.

The separate [OSV collector](osv-advisory-source.md) accepts an explicit
`--crate=NAME@EXACT_STABLE_VERSION` query. It never reads a project's lockfile or
automatically sends package identities upstream. Its stable-version range
comparator retains the existing tighter limit: 32 characters and numeric
components no greater than 2,147,483,647. Collection, signing and trust enrollment
remain separate operations.

`switchyard-lock-inventory/v2` Cargo components include their witnessed lockfile,
source kind, source-string hash, declared checksum and dependency-array hash.
Private source URLs and dependency strings are not emitted. Only public crates
receive a `pkg:cargo/…` package URL. Declared checksums appear as metadata
properties, never verified CycloneDX artifact hashes. The host validates each
closed component and reconstructs its CycloneDX 1.6 representation. Dependency
relationships remain absent and composition remains `unknown`.

A matching advisory fails the scan, including when severity is unknown. An empty
selected feed remains incomplete and cannot satisfy a security gate.

## Exercise the implementation without accounts or hardware

```sh
mise exec node@24.14.0 -- node --experimental-transform-types --test \
  tools/layout-studio/cargo-lock-inventory.test.mjs \
  tools/layout-studio/repository-shield-cargo.test.mjs \
  tools/layout-studio/repository-windows-shield-cargo.test.mjs
```

The integration cases use synthetic signed data, real protected state and actual
Linux namespace execution. The Windows cases explicitly double the guest.
Supply Chain and Release each check the authenticated failed/incomplete report,
receipt replay, native-process settlement, scratch retirement and unchanged
original lockfile, Git index and HEAD. They create no native provider task and
send no model request. Installed acceptance and native Windows guest acceptance
remain separate, unperformed checks.

[Source hashes, isolated results and independent TOML comparison](evidence/cargo-supply-chain-summary.json).
