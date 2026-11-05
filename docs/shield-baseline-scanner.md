# Shield baseline scanner

Switchyard can execute a pinned, dependency-free scanner over explicitly reviewed
non-production input files. All four Linux Shield actions connect to the normal
task grant, one-use execution approval, checkpoint, budget, namespace, native
ownership and protected receipt path. This is an implemented baseline scanner;
full Shield acceptance remains unfinished. The [Windows path](windows-shield.md)
now implements the same scanner/input/feed and non-passing receipt contract
through reviewed guest execution; its current tests explicitly double the guest.

The scanner finds private-key markers, GitHub/AWS token shapes, email addresses,
JavaScript dynamic-code calls and selected insecure path/TLS/container patterns.
These are fixed heuristics, with possible false positives and false negatives.
It never executes source code, dependency hooks or feed-supplied patterns. Findings
contain rule, severity, relative path, line and fingerprint, without a source
excerpt or matched value. It never edits files or rotates a credential.

## What each result establishes

| Observation | Result |
| --- | --- |
| A selected baseline rule finds a match, or an exact advisory/license policy fails | Failed findings report and failed protected command receipt; coverage remains incomplete. |
| No baseline finding in the selected inputs | Incomplete report and receipt. A clean input set does not establish repository security. |
| Missing, changed, revoked, expired or incompatible signed feed | Admission refused or result incomplete; no passing receipt. |
| Binary input, unsupported lock or ambiguous/external workspace link, missing advisory package version or unknown license | Explicit coverage gap. |
| Only a saved native zero exit survives restart | Incomplete higher-level observation; no program replay or passing recovery evidence. |

Every report currently includes `repository_scope_unverified`. History and source
permissions are not inferred from copied files; publisher provenance is not
inferred from a registry URL or integrity string. The request scope is literally
`reviewed-inputs`; it cannot claim an entire repository. Full staged/unstaged/new
and automatic ignored-secret inventory, relevant Git history, broad language/ecosystem
coverage and signed publisher provenance remain
unfinished implementation. This is separate from unavailable hardware/accounts.

## Configure an exact run

Copy the shipped [engine](../tools/layout-studio/shield-scanner-engine.mjs) into the
reviewed input set. The host requires its exact SHA-256 and its own pinned Node
executable, with precisely two literal arguments: the engine path and request
path. The recipe uses foreground disposable isolation, read-only workspace,
`NODE_ENV=test`, bounded time/output and an exact input allowlist. Node options,
extra arguments, alternate scripts and writable build mode are refused. Even exact engine bytes
under an option-like filename such as `-e` are refused: the entrypoint must be
a literal relative `.mjs` path.

The closed `switchyard-shield-scan/v1` request identifies one exact Shield action,
the `reviewed-inputs` scope, file paths/sizes/hashes, one scanner feed and an
optional advisory feed. Every engine/request/feed/source file must belong to
that same approved task snapshot. Review displays the scanner hash, feed pins,
literal scope and `completeShieldGateAvailable: false`.

Use [signed fixture maintenance](signed-fixtures.md) to enroll public trust and
install the public feed data separately. A scanner feed has this format:

```json
{
  "schema": "switchyard-shield-rules/v1",
  "version": 1,
  "engine": "switchyard-baseline-scanner/1",
  "rules": ["secret.private-key", "secret.github-token", "pii.email", "javascript.dynamic-code"],
  "allowedLicenses": ["MIT", "Apache-2.0"]
}
```

Other fixed rule identifiers are `secret.aws-access-key`,
`config.tls-verification-disabled`, `docker.privileged` and
`path.request-traversal`. Unknown, duplicate or executable/pattern fields fail.
Signed manifest tool identity must be `switchyard-baseline-scanner` version `1`.
Public rule/advisory bytes are deliberately included as reviewed inputs; signing
keys and unrelated installed feed files remain outside the namespace.

The advisory schema is `switchyard-shield-advisories/v1`, version `1`, the same
engine identity and a `packages` array. Each entry specifies `ecosystem: "npm"` or `"PyPI"`,
literal `name`, exact `version` and `advisories` containing only `id`/`severity`.
An empty advisory list establishes only that feed's explicit observation of that
exact package version. An absent package/version is a gap, never "no known issues."
The offline scanner performs no online lookup or version-range interpretation. A
separate [bounded public OSV collector](osv-advisory-source.md) can prepare exact
stable-version data, with independent supported-range validation and full
pagination, for separate signing/review. Unknown severity remains a failed
vulnerability plus an explicit unassessed-severity gap.

[Python exact numeric requirements](python-supply-chain.md) are also supported
as declared metadata, with explicit unresolved environment/license/artifact gaps.
The typed dependency inventory uses `switchyard-lock-inventory/v2`, with separate
ecosystem identities and manifest provenance.

Supply-chain scanning reads npm lockfile versions 2/3, including nested package
locations, and returns a typed inventory with locked versions, license metadata
and integrity-string hashes. It checks exact advisories and the signed simple
license allowlist. Root-contained npm workspace links use the target entry's
explicit name/version/license, retain the installed alias and hash its declared
lock metadata. The scanner never opens that target directory or executes lifecycle
scripts. External, missing, cyclic or ambiguous links remain unsupported; local
source bytes always retain `workspace_source_unverified` and source/integrity gaps.
Unsupported formats and absent source or integrity metadata remain gaps. Supply-chain and Release Shield reports additionally contain a standalone
CycloneDX 1.6 `cycloneDx` object. Components have distinct location-bound
references, lockfile hashes, license names and explicit metadata. Aliases match
advisories by the real locked package name while retaining the installed name.
The BOM declares aggregate composition `unknown`, repository scope unverified,
dependency graph not collected and publisher provenance not verified. Integrity
string hashes are metadata, never claims about downloaded package bytes.
Change Scan and Codebase Audit return no BOM. [npm lockfile reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).

## Evidence and limits

The host revalidates P-256 signatures, exact installed content/tool versions,
freshness, revocation and current task/workspace authority before and after the
real namespace execution. The authenticated observation binds the manifest,
engine, Node executable, request, feed versions/hashes and complete output hash.
A failed-finding command keeps an authenticated incomplete observation and a
separate failed receipt with incomplete coverage. HMAC, target, action, operation,
policy, expiry and report-hash checks precede receipt metadata. No arbitrary
report or failed native process gains completion authority.

The engine bounds inputs to 512 files, 2 MiB per file and 16 MiB total, with 512
findings and a retained output bound. Linked/traversing paths, changed bytes and
oversized reads fail. Original source/index/HEAD remain unchanged; exact replay
returns the original result. Native exit precedes owned staging cleanup.

Twelve scanner cases cover real matches, redacted reports, all four incomplete
matrices, exact npm advisories/licenses, unsupported data, malicious feeds,
overflow and actual filesystem link/read bounds. Real namespace integration
exercises all four actions and the clean case, pinned-engine/argument refusal,
unsigned feeds, revocation before admission and after execution, protected
failure receipts and exact cleanup. Receipt tampering and six-action recovery
are separately checked. These are synthetic feeds, not acceptance of a production
advisory source or an independent security assessment.

The repeatable installed demonstration uses one empty native Codex task and
submits no model prompt:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs --synthetic
```

It creates a fresh validation compartment/repository, separately installs synthetic
public feeds, issues separate one-action grants, exercises all four failed gates and one clean incomplete result,
checks duplicates/exit/cleanup, retires synthetic packages and restores the original
selection, modes, definitions, private endpoint and frozen Home. Installed
`b6dca0a` passes six update and thirteen installed checks, including all five
scans, exact failed/incomplete receipt coverage, replay, native exits, revocation,
package retirement and restoration. Receipts `assignment-legends-1793853154242.json`
and `installed-shield-baseline-1793853523201.json` retained. Owned source/package/
signing scratch and proof checkout are removed; one empty task, zero prompts.
Normal installed `326a9f3` additionally passes six update and eleven narrower
actual API checks, including the option-filename refusal before execution and
two valid scans; zero prompts, two independently stopped guardians and full
restoration. Receipts `assignment-legends-1793853690564.json` and
`installed-shield-baseline-1793853836585.json` retained; owned scratch removed.
Use `--one-action` for a narrower changed-code recheck plus the clean case.

The [development-lock example](evidence/switchyard-development.cdx.json) is
generated from this repository's actual lockfile: three external components and
four declared local workspace packages. Their source bytes remain unverified. It is a schema-conformant example,
not a complete release inventory or a vulnerability/provenance acceptance.
Four generated cases, including that real lockfile and scoped aliases, validate
against the official [CycloneDX 1.6 schema](https://github.com/CycloneDX/specification/blob/1.6/schema/bom-1.6.schema.json);
three invalid mutations are rejected. Exact schema/tool source hashes are
retained in `cyclonedx-schema-proof-1793853836585.json`. Temporary validator,
schemas and download cache are removed; no host package or runtime is installed.
Normal installed `8e83371` passes six update and eleven actual Supply Chain
checks with known-vulnerable and clean incomplete versions, report-bound BOM
hashes, two independent native exits, feed retirement and full restoration.
Receipts `assignment-legends-1793854523011.json` and
`installed-shield-baseline-1793854727077.json` retained; owned signing/source/
package/staging/bundle/proof scratch removed. Zero prompts. A focused run accepts
`--synthetic --action=shield_supply_chain` and exercises known-failing and clean
incomplete versions, both with report-bound BOM hashes.

Signed fixture facts now clip receipt expiry to content expiry, signed maximum
age and trust expiry. Registry/HMAC boundary checks and normal installed
acceptance at `0cd785f` pass (six update/thirteen actual checks; zero prompts). Use
`--bounded-feed-deadline` with one selected action to exercise an actual signed
five-minute freshness limit; it never waits for or extends that limit.

Protected feed maintenance also retires prior validation receipts and both hosts
check policy at receipt commit. [Invalidation contract](validation-receipt-invalidation.md).

Explicit ignored paths such as `.env` can now be owned only for pinned Shield
scans, with closed classifications and exact read-only witnesses on both hosts.
They remain outside commit/Run/pipeline authority and the Git index. Five focused
authority/real-Linux/Windows-guest-double cases pass.
[Setup and remaining scope](ignored-scanner-inputs.md).

Personal [reviewed exceptions](shield-exceptions.md) now connect exact protected
findings to expiring, audited decisions. Reports keep raw findings; both hosts
authenticate the decision separately and never upgrade missing coverage to a
complete Shield pass. Normal installed exception acceptance passes at `82bd9b3`: six update and
seventeen actual API checks, three verified exits, full restoration and zero prompts.


To regenerate the unsigned development example deterministically, run:

```sh
mise exec node@24.14.0 -- node scripts/export-development-sbom.mjs
mise exec node@24.14.0 -- node scripts/export-development-sbom.mjs --check
```

The seven-component workspace example passes the unmodified official CycloneDX
1.6 schema, with three invalid mutations rejected. Receipt
`cyclonedx-workspace-schema-proof-1793861912692.json` pins the schema and temporary
validator sources; tooling was removed without host package/runtime installation.
Real Linux namespace and Windows guest-double Supply Chain cases preserve aliases,
raw findings, report-bound metadata, incomplete coverage, replay and cleanup even
when the workspace source directory does not exist. The installed demonstration
supports `--synthetic --action=shield_supply_chain --workspace-lock`; normal installed
`7dc9196` passes six update/fourteen actual API checks, two verified exits and
full restoration. Receipts `assignment-legends-1793862128657.json` and
`installed-shield-baseline-1793862282934.json` retained; owned scratch removed,
one empty task and zero prompts.


[Explicit ignored generated-tree policy](ignored-build-tree-policy.md) now allows
Shield-only grants to omit whole named ignored build/dependency trees from byte
hashing. Their verified directory identities and declared exclusions bind the
reviewed target; selected ignored secret files remain exact byte inputs. Both
execution hosts keep excluded roots outside staging and preserve incomplete
security coverage. This is separate from the non-authoritative input preview.


Declared npm licenses now support bounded AND/OR obligations and alternatives.
Required disallowed terms fail; a permitted alternative stays unselected, and
unsupported exceptions/references stay unknown. This is declaration/policy
analysis, not license-text, SPDX-list or legal verification.
[Contract and reproduction](npm-license-declarations.md).
