# Scan exact Python requirements

Supply Chain and Release Shield can inventory explicitly reviewed Python
requirements alongside npm lockfiles. Start with a `requirements.txt` containing
exact version pins, then use the normal task grant and signed scanner/feed
review described in the [baseline scanner guide](shield-baseline-scanner.md).
The scanner reads metadata only; it never invokes pip or installs dependencies.

```text
Requests==2.19.1 --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
packaging==25.0
```

This is a deliberately vulnerable test example, not a version recommendation.
Declared hashes remain declarations unless an artifact is explicitly selected
for [byte comparison](python-artifact-integrity.md). Such comparison does not
verify an installed distribution, archive contents or publisher signature.
Selected wheels also receive a [bounded metadata identity comparison](python-wheel-identity.md).
Different declared package identity produces a separate failed finding, while
RECORD hashes and publisher provenance remain unverified.

## Supported input

The recognized paths are `requirements.txt`, `requirements.lock` and simple
named variants such as `requirements-dev.txt`. Distribution names follow
[PyPA name normalization](https://packaging.python.org/en/latest/specifications/name-normalization/):
lowercase, with runs of dots, underscores and hyphens collapsed to one hyphen.
Versions support bounded PEP 440 epochs, release segments, alpha/beta/candidate,
post/development suffixes and local labels, including standard aliases and numeric
normalization. The declaration stays literal in the inventory; comparisons use
normalized numeric/suffix identity, including zero-padded release equivalence.
Versions are limited to 128 ASCII characters and 32 release/local segments;
whitespace, controls and unsupported syntax refuse. Integer comparisons do not
round large components through JavaScript numbers. Optional SHA-256 declarations must use
literal lowercase hex. Comments, CRLF and backslash continuations are supported.
Physical lines are joined before comments are removed, matching pip's documented
order. A declaration absorbed into a continued comment cannot become a package
in the inventory. Comment-only lines end continuations; ambiguous or unfinished
syntax remains unsupported. The original logical-row bound includes the joined
physical bytes.

Exact pins may also include extras, for example `Requests[security,socks]==2.19.1`.
Up to 64 declared names, each at most 128 ASCII characters, are normalized with
the same rules as distribution names. Their union is sorted and deduplicated;
empty brackets are equivalent to no extras. The inventory and CycloneDX preserve
these as declarations. The base distribution still receives its exact-version
advisory and selected-artifact comparisons. `python_extras_not_resolved` and
`python_environment_not_resolved` remain mandatory: no optional dependency is
resolved, downloaded, installed or silently treated as covered.
[Extra semantics](https://packaging.python.org/en/latest/specifications/dependency-specifiers/#extras),
[name normalization](https://packaging.python.org/en/latest/specifications/name-normalization/).

Each requirements file is limited to 256 KiB, 8,192 physical lines, 8,192
characters per logical row, 64 distinct hashes per package and no duplicate
normalized names. The aggregate dependency inventory retains its 4,096-component
ceiling across all reviewed manifests.

This is a strict subset of the [pip requirements format](https://pip.pypa.io/en/stable/reference/requirements-file-format/).
Includes, indexes, URLs, editable/local sources, ranges, wildcards
and other unsupported requirements syntax refuse inventory for that whole file.
The report adds `unsupported_python_requirements`; it never returns a partial
package list or follows an include/index. No environment or dependency graph is
resolved, and a pin does not prove the distribution exists.

## Conditional pins

Exact pins may include bounded environment conditions:

```text
example[tls]==1.2.3; python_version < "3.12" and sys_platform == "win32"
```

This is synthetic syntax, not a package recommendation. Switchyard inventories
the declared pin without evaluating the condition on either host or guest. A
matching advisory still produces a finding; whether this dependency is applicable
to the intended environment remains unknown. The mandatory
`python_markers_not_evaluated` and `python_environment_not_resolved` gaps prevent
that observation from claiming resolved dependencies or complete coverage.
Selected artifact comparisons keep their existing byte-only meaning.

The supported [PyPA marker grammar](https://packaging.python.org/en/latest/specifications/dependency-specifiers/)
includes the eleven ordinary environment variables, quoted ASCII constants,
comparisons, `in`/`not in`, `and`/`or` and parentheses. Conditions are limited to
2,048 characters, 256 tokens and sixteen nested parentheses. Unknown variables,
context-dependent `extra`, `extras` and `dependency_groups`, backslash escapes,
non-ASCII values and malformed expressions refuse the entire requirements file.
Option-like ` -` inside a condition also refuses: pip splits options before
parsing requirements. Hash options must follow the complete condition. Existing
line, file, hash and component limits remain unchanged. Two conditional pins for
the same normalized name still refuse; alternatives are not resolved.

The report stores only `marker: { sha256, variables }`: a digest of the trimmed
condition after continuation/comment preprocessing, plus sorted variable names.
Literal values and expression text stay out of inventory and CycloneDX output.
The digest binds declaration bytes; it does not establish semantic equivalence
or hide guessable values. CycloneDX records the digest, variables and explicit
`not-evaluated` state as namespaced properties, with unknown composition and no
invented dependency graph. The host checks the closed metadata shape, mandatory
gap and exact reconstructed component.

The [87-case marker fixture](../scripts/fixtures/pypi-marker-oracle.json) records
independent pip 26.2.2 / PyPA packaging 26.2 parsing facts, including every ordinary
variable, both operand directions, compound conditions, hashes and continued
comments. Its generator uses already installed tools without evaluation, network
or installation: `python3 -I -B scripts/generate-pypi-marker-oracle.py`.
The existing 39-case extras/preprocessing fixture remains unchanged.

Eight focused groups pass **115 checks**, including two new actual Linux scanner
journeys, two Windows guest doubles and six marker/artifact combinations. Original
repository/index/HEAD bytes, protected incomplete receipts, replay and owned
process/staging cleanup verify. Two regressions fail before implementation;
typecheck and the original package budget pass. An initial selector matched no
tests and was rejected; it accepts no checks. Installed metadata acceptance now passes seven separate checks; native Windows
marker acceptance remains separate.
[Source evidence](evidence/pypi-markers-source-summary.json).

For an installed build containing this change, the repeatable local check is:

```sh
mise exec node@24.14.0 -- node --experimental-transform-types \
  scripts/verify-python-inventory-host.mjs --read-only-metadata
```

It verifies full release integrity and the two tested installed module hashes,
then runs the 87 marker and 39 original reference cases plus fixed synthetic
report/artifact examples in memory. It writes a private receipt, starts no scanner
process and changes no task, account or package. Its current ten checks also
include the bounded wheel metadata comparisons and are separate from actual
scanner execution. Evaluation, installation, network and execution
flags refuse before installed-state access; all four verifier guard tests pass.
[Verifier evidence](evidence/python-inventory-verifier-source-summary.json).

Normal installed aa98c91 passes all seven checks as part of its 41-check update.
All fourteen tested module hashes, 54 workspace snapshots and frozen frontend
verify. The 533-file prepared bundle is removed; only current plus one rollback
remain. These are metadata/in-memory checks, separate from the real source
scanner journeys above. [Installed receipt](evidence/installed-python-markers-summary.json).

## Extras and continuation evidence

Ten focused groups plus one exact regression pass **106 checks**. The new Supply
Chain/Release cases exercise actual Linux scanner exit and Windows guest doubles,
original repository/index/HEAD preservation, signed incomplete receipts, replay
refusal and exact cleanup. Six additional combinations verify that extras preserve
matched, mismatched and absent-hash artifact outcomes. Typecheck, packaging and
the original 5 MiB package test budget pass.

The committed [39-case reference fixture](../scripts/fixtures/pypi-requirements-oracle.json)
comes from existing pip 26.2.2 preprocessing and its vendored PyPA packaging 26.2.
It records module hashes and independently parsed names, versions, extras and
continued comments. No package, runtime or dependency is downloaded. Use
`python3 -I -B scripts/generate-pypi-requirements-oracle.py` only with an already
installed pip to regenerate it. Additional refusal checks retain the original
row/hash limits and reject malformed extras, substituted BOM metadata and omitted
unresolved-coverage gaps. Normal installed 5a8d159 now passes five pure extras
metadata checks, including all 39 reference cases, inside its 31-check update.
All 54 original workspaces and frozen frontend bytes remain preserved. No scanner,
task, model request or public query runs. Native Windows extras acceptance remains
separate. [Installed evidence](evidence/installed-pypi-extras-summary.json),
[source evidence](evidence/pypi-extras-source-summary.json).

## Advisories and portable inventory

The typed dependency document is now `switchyard-lock-inventory/v2`.
Each component identifies its ecosystem and exact witnessed manifest. PyPI
components retain normalized name, literal version and sorted declared hashes.
The host checks the closed component shape and reconstructs the CycloneDX 1.6
component before accepting a report. PyPI package URLs use `pkg:pypi/…`; hash
declarations appear only as metadata properties. Composition stays `unknown`.

Signed advisory entries use `ecosystem: "PyPI"`. Matching includes ecosystem,
normalized name and PEP 440 version equivalence, so npm data cannot cover a Python
package. Equivalent duplicate feed identities refuse the entire feed; an empty
alias cannot conceal another entry with findings.
The [OSV collector](osv-advisory-source.md) accepts explicit public PyPI queries
and independently proves explicit affected versions (including equivalent PEP 440
spellings) or supported `ECOSYSTEM` introduced/fixed intervals. It never reads a requirements file or
automatically sends project package identities upstream.

An affected package produces failed findings; unassessed severity stays unknown.
An empty advisory list establishes only that selected source observation. Every
result retains incomplete coverage, unresolved Python environment, unknown
license metadata and unverified artifact/publisher provenance. Broader Python
requirements/specifier formats, dependency resolution, installed-package
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

The normal installed source `8108738` now passes six update checks and both
16-check Supply Chain/Release demonstrations. Each affected scan reports ten
matching advisory identities as failed; each comparison remains incomplete. All
four native scanner exits, feed retirement and original-state restoration verify.
Owned source, signing material, packages, staging, bundle and proof checkout were
removed. See the [retained summary](evidence/installed-pypi-summary.json) for exact
release, receipt identities and limits. Temporary schema tooling was also removed
(`pypi-schema-tool-cleanup-1793885199709.json`); the initial schema/installer
failures remain recorded separately.

## Validate non-final versions without network or account changes

The version comparator is checked against 295 reference identifiers from the
already installed PyPA `packaging` 26.3 implementation: 87,025 ordered comparisons
also verify semantic identity keys. The committed fixture lets portable tests use
these independent facts without installing Python packages. Regeneration uses
`scripts/generate-pypi-version-oracle.py`; its recorded reference source hash
makes changes reviewable. [Version scheme](https://packaging.python.org/en/latest/specifications/version-specifiers/).

A separate installed demonstration uses fixed synthetic signed feed bytes and
an epoch/pre/post/dev/local requirements pin. It creates an empty native task,
submits no model prompt and makes no public advisory query:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_supply_chain --pep440-requirements
```

Repeat with `--action=release_shield` for Release. The fixture matches a differently
spelled equivalent advisory, keeps the literal pin in the BOM, and checks failed
findings plus a clean comparison that remains incomplete. Package URLs fold case
and percent-encode reserved version characters while the inventory retains the
original declaration. [Package URL type](https://github.com/package-url/purl-spec/blob/main/types/pypi-definition.json),
[encoding rules](https://github.com/package-url/purl-spec/blob/main/faq.md#plus-character).

This command is an acceptance procedure; an installed pass is recorded separately
from software tests and native source-fixture execution.

[Software receipt, reference hashes and native source-fixture limits](evidence/pep440-summary.json).

The corrected installed `ccd1bc1d` source passes this procedure for both actions:
six normal update/seven metadata checks and 16 installed checks per action. Four
real scanner processes exit independently; the finding case fails and the clean
case remains incomplete. Two empty tasks submit zero model prompts. Public
queries, account changes, keyboard and microphone access stay at zero. Exact
synthetic packages and signing scratch are removed; new proof workspaces are
reversibly archived with encrypted native identities/credentials preserved. The
original 54 workspaces and private link/Home are retained, the app restart is
verified, and the owned checkout/bundle are removed.
[Installed receipts](evidence/installed-pep440-summary.json).
The [earlier verifier failure](evidence/pep440-first-installed-failed-summary.json)
remains a failed attempt; its legacy npm-name assertion was corrected separately.

Native Windows source `9193471` now passes all four composed Python scanner cases
and ten artifact checks, with two original Linux-only skips. Exact archive
digests, source/merge tree equality, original deadlines and child/tree cleanup
verify. Guest execution is doubled; actual guest and installed Windows acceptance
remain separate. [Native evidence](evidence/pypi-extras-native-summary.json).
