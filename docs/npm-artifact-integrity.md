# Compare selected npm artifact bytes

Supply Chain and Release Shield can compare an explicitly selected file against
the SHA-512 checksum declared for one npm lockfile location. The scanner also compares the package name and version inside a supported
archive with that exact lockfile entry. It does not install a package, extract
an archive, contact a registry or establish publisher identity.

## Review the exact inputs

Add the artifact file to the normal reviewed input list with its size and
SHA-256, then include an optional `packageArtifacts` field in the scanner request:

```json
{
  "packageArtifacts": [{
    "lockPath": "package-lock.json",
    "location": "node_modules/example",
    "path": "reviewed-example.tgz"
  }]
}
```

The existing request still includes its schema/version, action, scope, full
`files` list and exact signed feed references. Every referenced lock and artifact
must be an exact reviewed input. The host binds that request, engine, feeds and
bytes to the same task snapshot and one-use execution approval. At most 128
distinct references, shared with [Cargo](cargo-artifact-integrity.md) and
[Python selections](python-artifact-integrity.md),
are accepted within the original 512-file,
2 MiB per file and 16 MiB total bounds. Empty artifacts, duplicate locations,
unreviewed paths, manifest-as-artifact aliases and unsupported actions are refused.
Workspace links and unresolved package references cannot claim artifact results.

The comparison supports one canonical `sha512-<base64>` integrity declaration.
Other algorithms, multiple hashes, options, noncanonical padding and malformed
values remain unsupported. This is a deliberately bounded subset of npm's
[integrity declaration](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/#packages),
not a general SRI implementation.

## Interpret the result

| Observation | Result |
| --- | --- |
| Selected bytes match the declared SHA-512 | `matched` observation; overall Shield result remains incomplete. |
| Selected bytes differ | `artifact.integrity-mismatch` high-severity provenance finding and failed protected command receipt. |
| Declaration is unsupported | `unsupported-integrity` observation and explicit unverified-artifact coverage gap. |
| Package has no selected artifact | Explicit `package_artifact_not_verified` gap. |

The scanner verifies the artifact's reviewed size and SHA-256 before computing
SHA-512, then repeats the ordinary input witness check while scanning inputs.
The host checks the selected path/size/SHA-256, digest grammar, outcome consistency,
declared-integrity hash, mandatory gaps and mismatch finding. Missing or substituted
observations are refused. All report and finding limits remain in force.

CycloneDX carries namespaced properties for the selected artifact path, SHA-256,
observed SHA-512 and comparison status. It does not assert an installed-component
hash. The bounded metadata observation described below is separate from the raw-byte
comparison. Member source code, license obligations, publisher provenance and
overall repository security remain unverified. A lockfile and attacker-controlled artifact can agree; agreement alone
does not make the package trustworthy.

## Evidence

Thirteen groups / 89 tests are accepted across the initial behavior checks and
the two corrected test-inventory follow-ups; the original two inventory failures
are retained. Six actual Linux scans and six Windows guest-double runs cover
matched, mismatched and unsupported declarations through Supply Chain and Release,
signed feeds, original receipts, replay refusal, process exit and owned cleanup.
Original lock/artifact/index bytes and HEAD remain unchanged. Tests also cover
256 canonical final-byte encodings and 256 equivalent noncanonical aliases.

Typecheck passes. Native Windows host execution at f0aacab passes eight tests and two declared
Linux-only skips in its original 300-second bound, with cleanup; the guest remains
a double. [Windows receipt](evidence/npm-artifact-windows-native-summary.json). No installed update or dependency/runtime
download was performed. [Exact evidence](evidence/npm-artifact-integrity-summary.json),
[baseline scanner](shield-baseline-scanner.md).

## Compare the identity inside an npm archive

Every selected npm artifact now gets a separate `artifact.archive` observation.
The worker inspects the reviewed bytes once, in memory, before the ordinary
second input-witness check. It compares the literal `name` and `version` in
`package/package.json` with the package identity from the lockfile, including
alias targets and prerelease/build suffixes. Matching archive metadata cannot
repair a checksum mismatch or establish publisher identity.

| Archive observation | Protected result |
| --- | --- |
| Supported metadata matches | `matched`; the overall scan remains incomplete. |
| Supported metadata differs | `mismatched`; `artifact.identity-mismatch` is a high-severity provenance finding and the protected command fails. |
| Unsupported, ambiguous, damaged or excessive input | `unsupported` with a fixed reason and `npm_archive_identity_not_verified` gap; no partial identity is accepted. |

The supported subset is gzip with regular files and directories in POSIX USTAR.
Checks cover complete headers/checksums, octal sizes, prefixes, padding, two end
records, unique case-insensitive paths, parent/file conflicts and an exact root
manifest. npm's omitted portable uid/gid fields are accepted without applying
ownership. Links, devices, PAX/GNU extensions, non-ASCII paths and unsupported
numeric formats retain a gap. A valid early manifest cannot hide an unsupported
later entry. This is a metadata reader, not an archive extractor or general
archive-safety certificate. [USTAR format](https://man.archlinux.org/man/tar.5.en).

The existing 2 MiB per reviewed file, 16 MiB total and 128 artifact references
remain. Expansion is capped at 4 MiB per distinct npm artifact and charged against
a 32 MiB scan budget. Failed decompression consumes its reserved allowance;
success charges actual expanded bytes, including malformed tar. Node's bounded
[decompression API](https://github.com/nodejs/node/blob/v24.14.0/doc/api/zlib.md#class-options)
checks the complete gzip stream. At most 1,024 entries, 32 path/JSON nesting
levels and 64 KiB of manifest bytes are accepted. Duplicate JSON keys, including
escaped aliases, invalid UTF-8 and nonliteral package identities are unsupported.
No member is written, loaded, imported or executed.

Reports retain only the fixed outcome/reason or declared name/version, exact
manifest SHA-256, entry count and expanded byte count. Host admission checks the
closed fields, status consistency, required gap/mismatch finding and exact
CycloneDX properties. It retains `artifact_contents_not_inspected` because this
metadata check does not scan source members or verify licenses. Raw scripts,
ownership, member names and arbitrary manifest values do not enter the report.
Publisher provenance and complete repository coverage remain separate gaps.

A synthetic package produced with the installed npm CLI in offline mode, with
all lifecycle scripts disabled, verifies the real portable-header format. The
original parser refusal exposed omitted uid/gid fields and remains recorded.
The corrected check preserves the same archive hash, and its exact owned source,
cache and output are removed. Only the 368-byte synthetic fixture is retained
in tests; no dependency or runtime was downloaded. Native Windows and installed
acceptance of this extension remain separate.

Six isolated groups pass 78 tests, plus one separate alias/version test. Twelve
actual Linux npm scans and twelve Windows guest-double scans retain all original
checksum scenarios and add matched/mismatched/unsupported archive identities for
Supply Chain and Release. Original bytes/index/HEAD, protected receipts, replay
refusal and independent native exit/cleanup verify. Python/Cargo regression,
engine, typecheck and application/release packaging checks pass. The initial
source run failed on misplaced host validation and concurrent source drift;
its original receipt remains failed. An incorrectly abbreviated test selector
was rejected for a zero plan and is also retained, separate from the corrected
exact-selector pass. [Source evidence](evidence/npm-archive-identity-summary.json).

## Native timeout and independent scheduling

The first native Windows archive extension at `7e45654` hit the existing
300-second file deadline: the first six-scenario action finished, while the
second action did not produce a final plan. Partial output is not accepted.
The runner verified tree termination and removed its owned test root; the
original failed artifact and source/merge digests are retained.
[Native failure](evidence/npm-archive-native-timeout-summary.json).

Byte-integrity scenarios and archive-identity scenarios now occupy separate
required files and independent Windows jobs. Each keeps the original 300-second
Windows/120-second Linux child bound and six-minute CI step limit. Shared
assertions preserve every original checksum and archive scenario, original
repository state, exact receipt/replay and child/fixture retirement. The host
also rejects member counts that cannot fit the claimed expanded archive size.
Native acceptance of the corrected schedule remains pending.

The corrected schedule passes five distinct groups / 53 tests across the
initial scanner/scheduling results and the corrected harness inventory check.
Every child and process tree exits. [Scheduling evidence](evidence/npm-archive-scheduling-summary.json).

Native Windows 55515d1 now accepts the archive file with ten passing tests and
two declared Linux-only skips in its original 300-second bound; the guest is a
double. Normal installed 0cb823b passes six pure archive checks alongside the
twenty existing metadata checks, preserving all 54 workspaces. This installed
proof executes neither a scanner nor archive contents.
[Windows evidence](evidence/npm-archive-native-summary.json),
[installed evidence](evidence/installed-npm-archive-summary.json).
