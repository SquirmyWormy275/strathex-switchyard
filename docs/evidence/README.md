# Generated engineering evidence

[Switchyard's development SBOM](switchyard-development.cdx.json) is a real
CycloneDX 1.6 export from this repository's `package-lock.json`. The scanner
inventories three external packages and four declared local workspace packages. Its metadata binds the exact
lockfile hash and deliberately records repository scope as unverified, dependency
relationships as not collected and publisher provenance as not verified. Local
workspace source bytes remain unverified; their root-contained lock metadata is
identified separately. Composition remains `unknown`.

This demonstrates deterministic component identities, nested/aliased npm package
handling and a standard machine-readable output. It does not establish a complete
release inventory, clean vulnerability result, installed package integrity or
publisher attestation. Hashes of lockfile integrity strings are labelled as
metadata; they are not downloaded package hashes.

Start with the BOM's `metadata.properties`, then inspect `components` and
`compositions`. The [scanner contract](../shield-baseline-scanner.md) explains
its reviewed inputs, signed feeds, policy and practical limits. To exercise the
offline scanner checks:

```sh
mise exec node@24.14.0 -- node --test tools/layout-studio/shield-scanner-engine.test.mjs
```

Four generated examples, including this actual development lock and scoped
aliases, conform to the official CycloneDX 1.6 schema. Three invalid mutations
are rejected. The separate private verification receipt pins the official
schemas and validator source; temporary tooling was removed without installing
host packages or copying a runtime. The Suite's authenticated report also binds
its BOM through the complete report hash; this checked-in example is unsigned.


Regenerate or check this exact artifact without network access or package execution:

```sh
mise exec node@24.14.0 -- node scripts/export-development-sbom.mjs
mise exec node@24.14.0 -- node scripts/export-development-sbom.mjs --check
```

The updated seven-component artifact separately passes the unmodified official
schema, with three invalid mutations rejected. Receipt
`cyclonedx-workspace-schema-proof-1793861912692.json` retains exact source hashes;
temporary tooling is removed and no host package is installed.


The [native Windows checkpoint summary](windows6a-validation-summary.json) keeps
exact artifact IDs/digests and child outcomes at source `6a45643`. Eight focused
contract groups pass 23 tests with three declared platform skips; service removal
and two group deadlines still fail. Guest execution is doubled and the full
workflow is not accepted. Only small verified JSON receipts are retained locally;
private download URLs and artifact archives are not retained in the repository.

The ecosystem-aware inventory checkpoint regenerates this same development BOM
with explicit npm ecosystem and manifest properties. Its SHA-256 is
`c9e0de415080a840dd65908691884f85d7bbe464a85fb16472e579b4f0baf746`.
It still has seven components, four workspace links, unknown composition and no
verified source/publisher claim. The official CycloneDX 1.6 schema accepts it
and both [Python requirement examples](../python-supply-chain.md); three invalid
mutations fail validation. Receipt `pypi-cyclonedx-schema-1793885089361.json`
retains exact schema/validator/BOM hashes. Prior BOM hashes above describe their
historical checkpoints.
