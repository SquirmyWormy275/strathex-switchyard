# Compare selected npm artifact bytes

Supply Chain and Release Shield can compare an explicitly selected file against
the SHA-512 checksum declared for one npm lockfile location. This is a raw-byte
integrity check. It does not install a package, extract an archive, contact a
registry or establish publisher identity.

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
hash. Archive contents/format, package name/version inside the file, license
obligations, publisher provenance and overall repository security remain
unverified. A lockfile and attacker-controlled artifact can agree; agreement alone
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
