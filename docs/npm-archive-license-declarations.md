# Check an npm archive's declared license

Supply Chain and Release Shield now compare the license declared inside a
selected npm archive against the reviewed policy. Both the outer SHA-512 and
embedded package name/version must match before that policy is applied. A
permissive lockfile cannot hide a disallowed archive declaration; an archive
cannot clear a disallowed lockfile declaration.

For example, an MIT lockfile with `MIT AND GPL-3.0-only` inside the archive fails
an MIT-only policy. `MIT OR Apache-2.0` retains `license_choice_not_selected`
even when the policy permits an alternative. These use the existing bounded
[SPDX parser and pinned catalog](npm-license-declarations.md).

The [npm package.json reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#license)
distinguishes SPDX declarations, license-file references and private packages.
Switchyard retains missing, file-only and unsupported statuses without exporting
raw rejected text or file paths. Deprecated objects/arrays, `licenses`,
`UNLICENSED` (including surrounding whitespace), private identifiers and unknown
syntax remain unsupported. Duplicate JSON keys, including escaped aliases,
refuse manifest admission; nested license fields cannot replace the package's.

The typed artifact observation and CycloneDX properties preserve independent
lockfile and archive declarations. Host admission rejects malformed fields,
removed required findings/gaps and changed BOM projections. Finding fingerprints
bind the lockfile location, archive and manifest; the original 512-finding limit
remains. Missing declarations and incomplete content/provenance coverage retain
their gaps. This does not inspect license text, select an OR alternative,
resolve dependencies or establish legal approval.

Sixteen focused groups pass 146 tests without skips, including eight actual Linux
npm archive journeys and eight Windows guest doubles. Type checking, original
package bounds, command/deadline/skip inventory and every child/tree cleanup
verify. The empty owned test parent is removed. No npm invocation, extraction,
package execution, new dependency download or live account/provider operation
occurs. [Source evidence](evidence/npm-archive-license-source-summary.json).

Installed `b6f788b` passes 74 metadata/in-memory checks and 22 exact module hashes,
including eight in-memory npm archive reports. All 54 semantic workspaces and the
frozen frontend are preserved; dated backup and launcher readback verify. The
exact 531-file, 5,186,925-byte prepared bundle is removed. A stale shared-fixture
pin in the Python verifier initially refused its check; the verifier now pins the
newly tested fixture while retaining the independent Python oracle pins. Its
original failure and corrected 12-check pass are retained.
[Installed evidence](evidence/installed-npm-archive-license-summary.json).
Actual Windows execution remains a separate checkpoint.
Frontend activation remains frozen for owner review.
