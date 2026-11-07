# Check a Rust package's declared license policy

Supply Chain and Release Shield now read the explicit `[package].license`
declaration inside a selected Cargo archive. A matching checksum and embedded
name/version are required before the signed license policy is applied. A
disallowed declaration produces a high `license.disallowed` finding and a failed
scan. Every result still has incomplete security and license coverage.

For example, a policy allowing MIT alone refuses `MIT AND GPL-3.0-only`. It permits
an alternative in `MIT OR GPL-3.0-only`, while retaining
`license_choice_not_selected`; Switchyard does not choose the license. An exact
`WITH` pair requires that same pair in policy, and an empty allowlist retains
`license_policy`. These use the existing bounded [SPDX declaration parser and
pinned identifier catalog](npm-license-declarations.md).

Cargo distinguishes its license expression from a path to license text.
[Cargo manifest reference](https://doc.rust-lang.org/cargo/reference/manifest.html#the-license-and-license-file-fields).
This implementation reads declarations only. It does not read a `license-file`,
inspect license text, resolve dependencies, invoke Cargo, extract an archive or
verify a publisher's assertion.

| Observation | Retained result |
| --- | --- |
| Supported explicit package license | Canonical declaration and pinned catalog properties. |
| No package license or license-file | `missing`. |
| Only a string license-file | `file-only`, without its path. |
| Unsupported license expression or field type | `unsupported`, without raw text. |
| Different archive identity or checksum | Declaration metadata may remain, but policy is `unassessed`. |
| Matching bytes/identity and supported declaration | `permitted`, `disallowed` or `unconfigured` under the reviewed policy. |

Nested dependency/metadata license fields cannot replace the package declaration.
The whole manifest retains the [closed Cargo grammar](cargo-archive-identity.md),
including duplicate-key refusal. A declaration does not eliminate `license_metadata`,
`artifact_contents_not_inspected` or `publisher_provenance_not_verified`.

Typed artifact observations and CycloneDX properties retain identical declaration
and policy results. Host admission rejects malformed or extra fields, changed BOM
projections, removed required gaps and missing disallowed-license findings. Finding
fingerprints bind the exact lockfile, source identity, archive and manifest;
private registry URLs remain hashed. The original 512-finding ceiling remains.

Fifteen focused groups pass 124 tests with no skips, including eight actual Linux
scanner journeys and eight Windows guest doubles. Signed feeds, replay refusal,
original Git/files, independent scanner exit and owned cleanup are checked.
The 112 independent Python TOML/USTAR/gzip cases remain passing grammar evidence;
they are separate from the added license-policy tests. Type checking and original
package limits pass. [Source evidence](evidence/cargo-license-source-summary.json).

Installed `6fdc6bd` passes all eight in-memory archive/license policy reports
within its 71-check metadata update. It verifies 22 module hashes, preserves all
54 semantic workspaces and the frozen frontend, and removes the exact 531-file,
5,183,244-byte prepared bundle after dated backup and launcher readback. No live
scanner or provider is started. [Installed evidence](evidence/installed-cargo-license-summary.json).
Actual Windows execution remains a separate checkpoint.
Frontend controls are frozen. Broader license-text inspection, dependency
resolution, provenance and legal approval remain outside this implemented scope.
