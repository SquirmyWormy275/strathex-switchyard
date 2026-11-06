# Compare selected Cargo artifact bytes

Supply Chain and Release Shield now compare a reviewed file with the SHA-256
checksum declared for one exact Cargo registry package. This extends the
[Cargo inventory](cargo-supply-chain.md) and uses the same reviewed-input,
approval and protected-receipt path as [npm artifact checks](npm-artifact-integrity.md).

Cargo's [registry format](https://doc.rust-lang.org/cargo/reference/registry-index.html)
defines the checksum as SHA-256 of the `.crate` file. Switchyard compares bytes
already selected by the user. It does not download, install or extract packages.

## Select an exact package

Include both files in the ordinary scanner request's `files` inventory with their
reviewed sizes and SHA-256 hashes, then add:

```json
{
  "packageArtifacts": [{
    "ecosystem": "Cargo",
    "lockPath": "Cargo.lock",
    "name": "example",
    "version": "1.2.3-rc.1+build.7",
    "sourceSha256": "c19b7c6f923b580ac259164a89f2577984ad5ab09ee9d583b888f934adbbe8d0",
    "path": "reviewed-package.crate"
  }]
}
```

`sourceSha256` is the hash of the exact lockfile source string; the example is
`registry+https://github.com/rust-lang/crates.io-index`. Use the source hash from
the package inventory. Private registry URLs stay out of reports. Source hashes
separate equal package names and versions across registries. Prerelease and build
identifiers retain their exact spelling.

The original limits remain: 128 total artifact references shared with npm and Python, 512
reviewed files, 2 MiB per file and 16 MiB total. Empty or unreviewed files,
duplicate identities, manifest/artifact aliases and unsupported actions refuse.
Missing packages, unsupported locks, local packages and Git sources cannot
produce a partial artifact result. Cargo registry declarations must contain the
supported canonical SHA-256 checksum.

## Read the result

| Comparison | Retained result |
| --- | --- |
| Selected bytes match the declaration | `matched`; the overall scan remains incomplete. |
| Selected bytes differ | `artifact.integrity-mismatch`, a high provenance finding and failed command receipt. |
| Package has no reviewed artifact | `package_artifact_not_verified` coverage gap. |

The scanner rechecks original size and SHA-256 before comparison and during its
ordinary input pass. Host admission binds the observation to the exact reviewed
reference and bytes, the declared checksum, its status and the mismatch finding.
Missing, substituted or inconsistent observations refuse. The 512-finding ceiling
still applies and remains explicit when reached.

CycloneDX retains namespaced artifact metadata, with unknown composition and no
claim of a verified installed-component hash. Archive format/contents, embedded
package identity, resolution, licenses and publisher provenance remain unverified.
A checksum match alone does not establish that a package is trustworthy.

## Demonstration and evidence

Fifteen groups / 105 tests pass, followed by 21 artifact tests after tightening
manifest-alias refusal. Type checking and child/tree cleanup pass. Supply Chain
and Release each exercise matched and mismatched files through actual Linux
isolation and through Windows guest doubles, including signed feeds, replay
refusal, authenticated incomplete evidence, independent exit and staging removal.
Original lock/artifact/index bytes and HEAD are preserved.

The test files contain synthetic binary bytes, deliberately not valid archives.
Source-separated and differently spelled build identities, mixed npm/Cargo
requests, missing references, altered bytes, report tampering and finding-limit
behavior are checked. The dedicated Windows CI lane retains a 300-second bound;
native Windows host execution at c367dff passes nine tests with two declared
Linux-only skips and verified cleanup. [Native receipt](evidence/cargo-artifact-windows-native-summary.json).
Installed acceptance and real guest,
hardware or account journeys are separate. No runtime/dependency downloads or
installed application changes were made.

[Exact source and verification receipts](evidence/cargo-artifact-integrity-summary.json).
