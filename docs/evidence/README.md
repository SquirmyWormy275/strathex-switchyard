# Generated engineering evidence

[Switchyard's development SBOM](switchyard-development.cdx.json) is a real
CycloneDX 1.6 export from this repository's `package-lock.json`. The scanner
currently inventories three external packages. Its metadata binds the exact
lockfile hash and deliberately records repository scope as unverified, dependency
relationships as not collected and publisher provenance as not verified. Local
workspace links are unsupported. Composition remains `unknown`.

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
