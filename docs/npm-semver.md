# Review exact npm prerelease versions

Shield accepts a reviewed npm lockfile containing a literal prerelease such as
`1.2.3-rc.2+reviewed.01`. Its signed advisory feed, scanner inventory and report
validator now share the same bounded version parser. The separate OSV collector
can explicitly query that exact version; it does not discover or submit a
project's dependencies automatically. Start with [advisory collection](osv-advisory-source.md)
and [reviewed scanner inputs](shield-baseline-scanner.md).

## Identity and ordering

The implementation follows [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html)
precedence: numeric core components compare numerically, prereleases precede
the corresponding final release, numeric prerelease identifiers precede
nonnumeric ones, and build metadata does not affect ordering.

Exact identity retains the build. A declared affected version
`1.2.3-rc.2+reviewed.01` cannot substitute for `1.2.3-rc.2+other`. An OSV
`SEMVER` interval can cover both according to precedence; the collector records
the actual queried string and its response hash. The signed scanner feed still
matches each complete version separately. [OSV range semantics](https://ossf.github.io/osv-schema/#affectedrangesevents-fields)
are distinct from npm dependency range selection: the scanner performs neither
dependency resolution nor an install.

## Bounds and honest gaps

Versions are at most 256 ASCII characters. Numeric major, minor, patch and
prerelease identifiers are at most `9007199254740991`. This keeps comparison
within the precise integer range used by npm's implementation. Numeric
prerelease identifiers have no leading zero; build identifiers may have them.
Prefixes, whitespace, coercion, empty identifiers, ranges and oversized
versions refuse. This is a deliberately bounded literal subset of
[node-semver](https://github.com/npm/node-semver), which also offers normalization
and range operations.

Malformed inventory versions produce `unsupported_npm_package` coverage gaps;
malformed signed-feed or returned report versions refuse. No partial version
match can erase an advisory. Matching vulnerabilities still fail with incomplete
coverage; missing severity, provenance, artifact verification and broader scope
remain explicit. The change does not verify installed package bytes.

## Evidence

Twelve isolated groups pass **101 tests**, including actual Linux Supply Chain
and Release scans, both Windows guest-double actions, signed feed review,
protected receipts, replay refusal and exact owned cleanup. Original lockfile
bytes, Git index and HEAD are preserved. Typecheck passes.

The existing npm-bundled node-semver 7.7.3 agrees on **556 grammar cases** and
**276,676 precedence comparisons**, with the intentional literal/numeric bounds
applied explicitly. Its 52-file reference inventory is hashed; no reference
download, install or scratch directory is needed. Native Windows guest and
installed acceptance remain separate. [Source-bound evidence](evidence/npm-semver-summary.json).
