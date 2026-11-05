# Calculate severity from supported source metrics

The [OSV collector](osv-advisory-source.md) can calculate a base severity from
complete CVSS 3.0/3.1 base vectors. It uses FIRST's published
[equations, rounding and rating thresholds](https://www.first.org/cvss/v3.1/specification-document).
It does not infer metrics from advisory prose or database-specific labels.
Supported source data produces a numeric maximum and its low/medium/high/critical
rating; matched advisories still fail Shield and retain incomplete coverage.

The calculator accepts exactly the eight base metrics, in any order, with a
128-character ceiling. Missing, duplicate, unknown or invalid metrics refuse
calculation. Temporal/environmental groups, other CVSS versions and unsupported
methods retain `severity: "unknown"` plus an explicit reason in source provenance.
This is base-vector support, not full CVSS support or contextual risk assessment.

## Bind the right package and version

The collector first independently establishes the requested ecosystem, package
and affected version. It then follows the [OSV severity scope](https://ossf.github.io/osv-schema/#affectedseverity-field):
package-specific ratings apply only to matching affected entries. A rating from
another ecosystem, package or unaffected version cannot substitute. Record-wide
ratings cannot coexist with package-specific ratings; that ambiguity stays
unknown. Missing package-specific ratings also stay unknown.

Each applicable severity array is limited to eight entries and the combined
selection to 32. Every applicable entry must use a supported complete base vector;
the maximum calculated score determines the rating. Mixed supported/unsupported
methods stay unknown. Source labels and optional source strings do not authorize
a request, fetch, executable, publisher claim or metric. The signed finding
contract has no `none` severity: a matched advisory containing only zero-score
vectors remains unknown and failed, with `zero-base-score-not-a-clearance`.

## Retain the calculation evidence

Collector version `switchyard-osv-collector/2` retains the exact public record
hash, package/version proof, calculation algorithm identity, normalized vector
hashes, individual numeric base scores, applicable scope and maximum score.
Unsupported cases retain fixed reasons without copying arbitrary source fields.
The normalized feed still contains only advisory ID and severity; the separate
signed-feed workflow binds the serialized provenance hash and original source
freshness. HTTPS and calculation hashes grant no upstream signature or operator
trust.

Unknown severity continues to add `advisory_severity_unassessed` in the offline
scanner. Supported calculation can resolve that specific gap; repository scope,
artifact/publisher provenance and other missing coverage remain incomplete.
No advisory match becomes passing evidence because its base score is low or zero.

## Independent numeric verification

Every possible base-metric combination was compared against FIRST's separately
downloaded [3.0](https://www.first.org/cvss/calculator/3.0) and
[3.1](https://www.first.org/cvss/calculator/3.1) reference calculators: 2,592 vectors
per version, all 5,184 numeric scores and qualitative ratings match. Receipt
`cvss-v3-reference-1793885857563.json` binds reference source hashes and ordered
result digests. Offline regression tests retain those independent result digests.
The reference calculators receive no external I/O, and their code is not shipped.

Additional cases cover package scope, unaffected versions, conflicting levels,
mixed methods, malformed vectors, zero scores, redaction and the strict host's
failed/incomplete report contract. Unsupported methods, temporal/environmental
assessment, source-metric correctness, full vulnerability coverage and publisher
authentication remain separate unfinished work.

A live fixed public query on November 5 calculated eight of the ten matched
`requests@2.19.1` records (seven medium and one high); two retained unknown
severity. `packaging@25.0` returned no records at that observation. Receipt
`cvss-osv-source-1793885966605.json` retains exact record/query/response and
calculation hashes. These identities are demonstration inputs, not package
recommendations or assurances about a project. Reference tooling was removed
(`cvss-reference-cleanup-1793886044371.json`).

Eight isolated calculator/collector/scanner/host/runner groups pass all 57
checks, with every child cleanup verified; type checking passes. The [reference
summary](evidence/cvss-v3-reference-summary.json) binds exhaustive result digests
and the focused receipt. Normal installed severity acceptance remains separate.
