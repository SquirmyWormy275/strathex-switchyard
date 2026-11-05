# Shield baseline scanner

Switchyard can execute a pinned, dependency-free scanner over explicitly reviewed
non-production input files. All four Linux Shield actions connect to the normal
task grant, one-use execution approval, checkpoint, budget, namespace, native
ownership and protected receipt path. This is an implemented baseline scanner;
full Shield acceptance remains unfinished.

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
| Binary input, unsupported lock/workspace link, missing advisory package version or unknown license | Explicit coverage gap. |
| Only a saved native zero exit survives restart | Incomplete higher-level observation; no program replay or passing recovery evidence. |

Every report currently includes `repository_scope_unverified`. History and source
permissions are not inferred from copied files; publisher provenance is not
inferred from a registry URL or integrity string. The request scope is literally
`reviewed-inputs`; it cannot claim an entire repository. Full staged/unstaged/new
and ignored-secret inventory, relevant Git history, broad language/ecosystem
coverage, signed publisher provenance and audited expiring exceptions remain
unfinished implementation. This is separate from unavailable hardware/accounts.

## Configure an exact run

Copy the shipped [engine](../tools/layout-studio/shield-scanner-engine.mjs) into the
reviewed input set. The host requires its exact SHA-256 and its own pinned Node
executable, with precisely two literal arguments: the engine path and request
path. The recipe uses foreground disposable isolation, read-only workspace,
`NODE_ENV=test`, bounded time/output and an exact input allowlist. Node options,
extra arguments, alternate scripts and writable build mode are refused.

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
engine identity and a `packages` array. Each entry specifies `ecosystem: "npm"`,
literal `name`, exact `version` and `advisories` containing only `id`/`severity`.
An empty advisory list establishes only that feed's explicit observation of that
exact package version. An absent package/version is a gap, never "no known issues."
There is no unreviewed online lookup or version-range interpretation.

Supply-chain scanning reads npm lockfile versions 2/3, including nested package
locations, and returns a typed inventory with locked versions, license metadata
and integrity-string hashes. It checks exact advisories and the signed simple
license allowlist. Workspace links, unsupported formats and absent source or
integrity metadata remain gaps. This inventory is not a claimed CycloneDX export
or publisher-provenance verification. [npm lockfile reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/).

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

Seven scanner cases cover real matches, redacted reports, all four incomplete
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
acceptance of this iteration is pending.
