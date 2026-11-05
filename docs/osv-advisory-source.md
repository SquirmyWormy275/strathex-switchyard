# Collect public vulnerability data for exact package versions

Switchyard can collect a bounded advisory feed from the fixed public
[OSV query endpoint](https://google.github.io/osv.dev/post-v1-query/). It sends only
the explicitly named package identities below. It reads no repository source,
installs no package, signs no data and enrolls no trust.

```sh
mise exec node@24.14.0 -- node scripts/collect-osv-advisories.mjs \
  --package=lodash@4.17.20 --package=typescript@5.9.3 \
  --out=/absolute/path/to/a/new/collection
```

For explicitly selected Python distributions, use `--pypi=requests@2.19.1`
and `--pypi=packaging@25.0` in place of the npm flags. Both flag types may be
combined. These are timestamped demonstration identities, not recommendations.

The new private output directory contains `advisory.json` and `provenance.json`.
Existing output is preserved. The provenance binds normalized feed bytes,
original collection start/finish, query and response hashes, record IDs and
modification times. Descriptions, arbitrary advisory URLs, executable fields and
pagination tokens are not copied into the normalized output.

## Exact matching and bounded failure

OSV documents version-query fuzzy matching. The collector independently requires
the returned ecosystem/name and either an explicit literal affected version or
a supported interval containing that exact query. npm accepts stable
`major.minor.patch` releases and `SEMVER` intervals. PyPI accepts the [bounded
numeric release subset](python-supply-chain.md) and `ECOSYSTEM` intervals, with
trailing zero components compared equivalently. Only ordered `introduced`/`fixed`
boundaries are supported. Prereleases, build metadata, other ecosystems and
unsupported range boundaries fail collection; they are not converted into an
empty advisory list.

All pages must complete. Repeated pagination, duplicate IDs, unsupported records,
withdrawals, malformed JSON/UTF-8, redirects, failed requests and oversized data
refuse a complete feed. The collector permits 32 selected package/version pairs,
32 advisories per pair, eight pages per pair, 64 requests, 512 KiB per response
and 4 MiB total. Request/total deadlines are at most 15/60 seconds. Cancellation
settles the collection without producing a partial success artifact.

The [OSV schema](https://ossf.github.io/osv-schema/) exposes quantitative severity
vectors. GitHub also publishes database-specific annotations, but
[documents those fields as unstable](https://github.com/github/advisory-database#database_specific-values).
Collector version 2 calculates supported complete CVSS 3.0/3.1 base vectors
using independently verified equations and package-specific scope. It does not
rely on unstable labels. [Severity calculation and limits](cvss-severity.md)
describe vector bounds, maximum-score selection and source hashes. Missing,
unsupported or ambiguous metrics retain `severity: "unknown"`; the scanner still
fails every matched vulnerability and adds `advisory_severity_unassessed`. The strict host parser permits unknown
severity only for vulnerability findings. It cannot turn missing severity or
other missing coverage into a complete pass.

## Separate signing and installation

The output is unsigned public data. HTTPS response hashes do not constitute an
upstream signature, publisher provenance or operator approval. Use the existing
[signed feed maintenance](signed-fixtures.md) workflow to review signing authority,
the exact public bytes and the desired freshness bound separately. No model or
task can enroll a key through collection.

When signing this source, preserve `provenance.startedAt` as the manifest's
`generatedAt`; choose an expiry and maximum age measured from that original
collection time. Bind the serialized provenance hash in the signed feed version.
The installed verifier does this automatically for its separately approved
synthetic validation compartment, then clips authenticated evidence to the normal
signed-content/SLA/trust deadlines. It never relabels old collection time as fresh
signing time. The collector does not automate ordinary operator enrollment or
provide an always-on source refresh service.

## Evidence and limits

Five collector/scanner/parser cases cover exact-version boundaries, full
pagination, source and size faults, cancellation, deadlines, clock drift and
unassessed severity. Twenty-nine surrounding collector/host/runner/package
checks and type checking pass. Four independently exited groups pass all 21
checks with child cleanup (`isolated-test-dec40fb3-9986-4f63-95f2-00027d4d5417.json`).
Both real Linux and Windows guest-double scanner paths retain authenticated
failed/incomplete receipts for unknown severity after native exit.

A real CLI collection on November 5 queried the two public versions in the
example: OSV returned four matching records for `lodash@4.17.20` and none for
`typescript@5.9.3`. The collector independently checked the affected-version
evidence. Small receipts `osv-live-1793865854913-advisory.json` and
`osv-live-1793865854913-provenance.json` are retained; owned collection scratch
was removed. This is a timestamped query demonstration, not a current package
recommendation or assurance about a project using either version.

The full installed source proof supports:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_supply_chain --osv-advisory
```

It fetches fresh source data, preserves its original freshness clock, signs and
installs the exact bytes under separate operator approvals, and scans synthetic
lockfiles with those package identities. It submits no model prompt or project
source to OSV. Installed source `adbd10a` passes six update checks and fourteen
actual source/scan checks with two independently verified native scanner exits.
Receipts `assignment-legends-1793866214773.json` and
`installed-shield-baseline-1793866400136.json` retain the public source hashes,
authenticated failed/incomplete outcomes, feed retirement and full original-state
restoration. Owned source, signing material, packages, staging, release bundle and
proof checkout were removed; zero model prompts and no keyboard access.

Automatic whole-repository scope, automatic history selection, additional ecosystems/full Python semantics, full CVSS/contextual assessment,
publisher provenance and ordinary UI source management remain unfinished. A
successful query with no returned records describes that selected identity at
that observation time; it does not verify publication, source bytes or complete
vulnerability coverage. All baseline clean results remain incomplete.
