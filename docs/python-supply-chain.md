# Scan exact Python requirements

Supply Chain and Release Shield can inventory explicitly reviewed Python
requirements alongside npm lockfiles. Start with a `requirements.txt` containing
exact numeric release pins, then use the normal task grant and signed scanner/feed
review described in the [baseline scanner guide](shield-baseline-scanner.md).
The scanner reads metadata only; it never invokes pip or installs dependencies.

```text
Requests==2.19.1 --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
packaging==25.0
```

This is a deliberately vulnerable test example, not a version recommendation.
Declared hashes are retained as declarations. They do not verify a downloaded
wheel, installed distribution or publisher signature.

## Supported input

The recognized paths are `requirements.txt`, `requirements.lock` and simple
named variants such as `requirements-dev.txt`. Distribution names follow
[PyPA name normalization](https://packaging.python.org/en/latest/specifications/name-normalization/):
lowercase, with runs of dots, underscores and hyphens collapsed to one hyphen.
Numeric releases have one to four components, no leading zeroes, at most 32
characters and bounded integer components. Optional SHA-256 declarations must use
literal lowercase hex. Comments, CRLF and backslash continuations are supported.

Each requirements file is limited to 256 KiB, 8,192 physical lines, 8,192
characters per logical row, 64 distinct hashes per package and no duplicate
normalized names. The aggregate dependency inventory retains its 4,096-component
ceiling across all reviewed manifests.

This is a strict subset of the [pip requirements format](https://pip.pypa.io/en/stable/reference/requirements-file-format/).
Includes, indexes, URLs, editable/local sources, extras, markers, ranges, epochs,
pre/post/dev/local releases and other syntax refuse inventory for that whole file.
The report adds `unsupported_python_requirements`; it never returns a partial
package list or follows an include/index. No environment or dependency graph is
resolved, and a pin does not prove the distribution exists.

## Advisories and portable inventory

The typed dependency document is now `switchyard-lock-inventory/v2`.
Each component identifies its ecosystem and exact witnessed manifest. PyPI
components retain normalized name, literal version and sorted declared hashes.
The host checks the closed component shape and reconstructs the CycloneDX 1.6
component before accepting a report. PyPI package URLs use `pkg:pypi/…`; hash
declarations appear only as metadata properties. Composition stays `unknown`.

Signed advisory entries use `ecosystem: "PyPI"`. Matching includes ecosystem,
normalized name and literal version, so npm data cannot cover a Python package.
The [OSV collector](osv-advisory-source.md) accepts explicit public PyPI queries
and independently proves literal affected versions or supported numeric
`ECOSYSTEM` introduced/fixed intervals. It never reads a requirements file or
automatically sends project package identities upstream.

An affected package produces failed findings; unassessed severity stays unknown.
An empty advisory list establishes only that selected source observation. Every
result retains incomplete coverage, unresolved Python environment, unknown
license metadata and unverified artifact/publisher provenance. Broader Python
formats, full PEP 440 semantics, dependency resolution, installed-package
verification and wider ecosystems remain unfinished implementation.

## Reproduce the installed demonstration

After updating the installed suite from this source:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_supply_chain --osv-advisory --pypi-requirements
```

Use `--action=release_shield` for the separate Release demonstration. Each mode
queries two fixed public examples, separately approves synthetic trust and exact
signed feed bytes, and scans an owned synthetic repository. Source freshness uses
the original collection clock. The verifier checks authenticated failed/incomplete
outcomes, native exit, cleanup and restoration. It submits no model prompt or
project source and performs no keyboard transaction.

Eight isolated scanner/collector/host/runner groups pass all 52 checks, with every
child cleanup verified (`isolated-test-c63db529-bd49-47a9-80f2-93156fa74f6d.json`).
The four new integration cases cover Supply Chain and Release through actual
Linux namespace execution and the Windows guest double; original files/index/HEAD
remain unchanged. The regenerated seven-component development BOM and both
synthetic Python BOMs validate against the official CycloneDX 1.6 schema; three
invalid mutations are rejected. Receipt `pypi-cyclonedx-schema-1793885089361.json`
binds the three schema hashes, validator versions and exact BOM bytes. This is
format validation, not publisher or security acceptance.
