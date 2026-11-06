# Compare selected Python artifact bytes

Supply Chain and Release Shield can compare a reviewed file with the SHA-256
hash alternatives declared for one exact requirements pin. This extends the
[Python dependency inventory](python-supply-chain.md), alongside the existing
[npm](npm-artifact-integrity.md) and [Cargo](cargo-artifact-integrity.md) comparisons.

The [pip documentation](https://pip.pypa.io/en/stable/topics/secure-installs/#multiple-hashes-per-package)
allows multiple hashes for different distribution files. Switchyard checks one
explicitly selected file against those declarations. It does not run pip, resolve
an environment, download packages or claim pip's complete hash-checking mode.

## Select the pin and file

Include the requirements and artifact files in the ordinary reviewed `files`
inventory with their exact sizes and SHA-256 hashes. The optional reference is:

```json
{
  "packageArtifacts": [{
    "ecosystem": "PyPI",
    "requirementsPath": "requirements.txt",
    "name": "mixed-name",
    "version": "1!02.0rc1.post2.dev3+LOCAL.4",
    "path": "reviewed-package.whl"
  }]
}
```

Use the normalized package name and literal version from the inventory. Artifact
selection requires that exact pin; advisory version equivalence cannot substitute
a differently spelled declaration. Identical pins in separate requirements files
remain separate references. No registry URL or filename-derived package identity
is inferred.

The existing requirements parser supports up to 64 distinct lowercase SHA-256
hashes per package. The request shares the original total limits across all three
ecosystems: 128 artifact references, 512 files, 2 MiB per file and 16 MiB of input.
Unreviewed or empty artifacts, duplicate references, manifest/artifact aliases
and unsupported actions refuse. Missing pins and unsupported requirements syntax
refuse the artifact result without returning a partial inventory.

## Interpret the comparison

| Declaration and selected bytes | Result |
| --- | --- |
| The file matches any declared SHA-256 | `matched`; overall coverage remains incomplete. |
| Hashes exist but none matches | `artifact.integrity-mismatch`, a high provenance finding and failed command receipt. |
| The pin has no declared hash | `unsupported-integrity` and `package_artifact_not_verified`. |
| No artifact was selected for the pin | `package_artifact_not_verified`. |

The scanner rechecks reviewed size and SHA-256 before comparison and again while
reading ordinary inputs. The host verifies the exact reference, bytes, sorted hash
alternatives, comparison status, required gaps and mismatch finding. Substituted
observations, missing findings and changed alternatives refuse. The original
512-finding ceiling remains explicit when reached.

The report's `acceptedSha256` array records the declared alternatives; its name
does not imply accepted security coverage. CycloneDX includes namespaced artifact
metadata and unknown composition. Wheel/archive format, embedded package identity,
installation, license obligations and publisher provenance remain unverified.
Matching an attacker-controlled requirements file is not proof of trustworthy code.

## Demonstration

The source tests exercise both allowed hash alternatives, mismatch, missing hashes,
literal versus equivalent versions, separate requirements files and mixed requests
containing npm, Cargo and Python artifacts. Tampered inputs/reports and the finding
ceiling have explicit refusal cases.

Supply Chain and Release each exercise three outcomes through actual Linux
isolation and Windows guest doubles, signed feeds, authenticated incomplete
evidence, replay refusal, independently verified exit and staging cleanup. Original
requirements/artifact/index bytes and HEAD are preserved. The fixture contains
synthetic binary bytes, not valid wheels. Native Windows host execution at
`d551ccf` passes nine tests with two declared Linux-only skips under the original
300-second bound and verified cleanup. The guest remains doubled.
[Native receipt](evidence/python-artifact-windows-native-summary.json).
Installed and real guest/account/hardware acceptance remain separate.

Fourteen behavior/harness groups pass 98 checks. The initial size guard correctly
refused the oversized package; after removing three unused implementations from
the runtime bundle, nineteen package/lifecycle/Python groups pass all 37 checks.
The bundle is 5,096,071 bytes, below its unchanged 5 MiB budget, and type checking
and owned cleanup pass. All three implementations remain unchanged in source.

[Source and verification receipts](evidence/python-artifact-integrity-summary.json).
