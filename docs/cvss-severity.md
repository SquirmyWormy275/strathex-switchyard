# Calculate severity from supported source metrics

The [OSV collector](osv-advisory-source.md) can calculate a base severity from
complete CVSS 3.0/3.1 vectors, including their optional temporal and environmental metric groups. It uses FIRST's published
[equations, rounding and rating thresholds](https://www.first.org/cvss/v3.1/specification-document).
It does not infer metrics from advisory prose or database-specific labels.
Supported source data produces a numeric maximum and its low/medium/high/critical
rating; matched advisories still fail Shield and retain incomplete coverage.

The collector requires all eight base metrics and accepts the fourteen optional metrics in any order, within 128 characters. Omitted or explicit `X` metrics use the standard defaults without claiming a supplied environment. Missing, duplicate, unknown or invalid metrics refuse calculation. CVSS 2/4 and other unsupported methods remain unknown. The original base-only helper still accepts only its eight base metrics.

The signed finding severity continues to use the maximum applicable **base** score. Supported supplied context is retained separately as numeric temporal/environmental scores and vector hashes, with `advisory-supplied-metrics` provenance, `localEnvironmentVerified: false` and `baseSeverityReduced: false`. For example, a critical base score of 9.8 can retain supplied scores of 8.5 and 8.2 without lowering the signed critical finding. These calculations do not verify the source metrics against the user's environment or clear a vulnerability.

## Bind the right package and version

The collector first independently establishes the requested ecosystem, package
and affected version. It then follows the [OSV severity scope](https://ossf.github.io/osv-schema/#affectedseverity-field):
package-specific ratings apply only to matching affected entries. A rating from
another ecosystem, package or unaffected version cannot substitute. Record-wide
ratings cannot coexist with package-specific ratings; that ambiguity stays
unknown. Missing package-specific ratings also stay unknown.

Each applicable severity array is limited to eight entries and the combined
selection to 32. Every applicable entry must use a supported complete supported CVSS 3 vector;
the maximum calculated score determines the rating. Mixed supported/unsupported
methods stay unknown. Source labels and optional source strings do not authorize
a request, fetch, executable, publisher claim or metric. The signed finding
contract has no `none` severity: a matched advisory containing only zero-score
vectors remains unknown and failed, with `zero-base-score-not-a-clearance`.

## Retain the calculation evidence

Collector version `switchyard-osv-collector/3` retains the exact public record
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

## Temporal and environmental verification

The broader implementation independently matches FIRST on **899,880 vector
cases**, 449,940 per version: all base/temporal combinations, every effective
modified environmental combination, explicit/omitted inheritance, and all
temporal combinations for each of 93 distinct rounded environmental inner
scores. CVSS 3.0 and 3.1 retain their separately verified rounding behavior.
The private reference calculators are hash pinned, receive no external I/O and
are not shipped. Offline tests retain only input vectors and independent result
digests. The first comparison detected a 3.0 rounding mismatch; its failed receipt
is preserved, and the corrected version matches both independent references.

Eight isolated calculator/collector/Linux execution/Windows guest-double/consent/
runner/package groups pass 56 checks with cleanup; typecheck passes. These are
software checks, with actual Linux scanner processes in their execution fixture;
Windows guest behavior is doubled. Installed acceptance is separate.
[Calculation evidence](evidence/cvss-v3-context-summary.json).

The explicit installed demonstration uses only a synthetic offline advisory:

```sh
node scripts/verify-shield-host.mjs --synthetic \
  --action=shield_supply_chain --cvss-v3-context
```

It loads the normal installed collector, binds the exact calculation provenance
to the signed advisory feed version, and checks that the real isolated scanner
retains the critical base finding despite lower supplied context scores. The
clean comparison remains incomplete. It submits no model prompt or public
advisory query and uses its own proof workspace. Native acceptance must be
recorded after this journey runs.

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
failed/incomplete report contract. Unsupported methods, source-metric correctness, verification of local environmental facts, full vulnerability coverage and publisher authentication remain separate unfinished work.

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

Normal installed source `7e252a1`, release `1b98c54…`, now passes six update
and both 16-check Supply Chain/Release demonstrations. Each preserves eight
calculated records and two unknown records, authenticated failed/incomplete
outcomes, original freshness, feed retirement and four verified scanner exits.
Original state/frozen Home restore and all owned source/signing/packages/staging/
bundle/checkout are removed; zero prompts and no HID. [Installed evidence](evidence/installed-cvss-summary.json).
