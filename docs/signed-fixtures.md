# Signed scanner and advisory fixtures

The Suite can review, install, revoke and separately remove signed evidence feeds within one
Personal compartment. A coding task or imported profile cannot enroll an
operator trust key. Fixture bytes never become a command, model prompt or
execution grant. This connects signed feed provenance to the existing Linux
pipeline evidence; it does not establish that a vulnerability scanner ran or
that a repository is secure.

## Operator path

Select a Personal companion workspace. The frontend remains frozen, so these
are currently authenticated backend routes, with the same origin and private
bearer boundary as the other Suite APIs.

| Route | Purpose |
| --- | --- |
| `POST /api/suite/host/scanner-fixtures/list` | Public-key fingerprints, installed metadata, storage usage and maintenance reviews; no signing key, package bytes or private package path. |
| `POST /api/suite/host/scanner-fixtures/review` | Exact action, fresh request UUID and action fields below. Returns the reviewed summary and one-use confirmation. |
| `POST /api/suite/host/scanner-fixtures/apply` | Only the original request UUID and returned confirmation token. |
| `POST /api/suite/host/scanner-fixtures/recover` | Observe only known-stopped original maintenance ownership; never reinstall or upgrade an uncertain result. |

Every body may select its `compartment`. Work policy refuses administration and
registry evidence access. Reviews expire after five minutes and bind the current
workspace, mode, enrolled accounts, registry state and exact requested effect.

| Review action | Additional fields |
| --- | --- |
| `install-trust` | `policy`: the exact public `sxsy-b122.scanner-fixture-trust` object. |
| `install-fixture` | `manifestPath`: an absolute path to the signed manifest; its signature, content hash and freshness must already verify under installed trust. |
| `revoke-trust` | `authorityId`, exact `keyId`, single-line `reason`. |
| `revoke-fixture` | Exact `fixtureId`, single-line `reason`. |
| `remove-fixture` | Exact revoked fixture or unconfirmed allocation `fixtureId`, single-line `reason`; the host captures the original remaining file identities/hashes for approval. |

The existing offline [signer](../scripts/b122-scanner-fixture.mjs) can create
synthetic packages or an operator-controlled feed authority. Its signing secret
stays outside installed trust. Only a public P-256 PEM block is accepted and
stored in canonical public form. Review exposes the key fingerprint, allowed
kinds and expiry; package review exposes its exact manifest/content hashes,
byte count, feed/tool versions and expiry. A substituted signed package still
needs a new review. Revocation does not silently remove retained files.

## Effect and evidence boundaries

A per-compartment kernel lease serializes maintenance. Its independent AEAD
journal stores trust/fixture events, operation admission, one-attempt budgets
and receipts. The current bound is one operation at a time, 120 seconds and 24
claims per hour. Each compartment has a 64 MiB aggregate copied-byte limit,
including manifest bytes, and 32 retained allocations. Reservation and quota
checks share one protected transaction before directory creation or copying.
Unconfirmed reservations and revoked packages still consume quota. A failed
exclusive directory creation releases only its uncreated allocation, preserving
unfamiliar files and the immutable identity tombstone. Historical installs without
byte accounting conservatively consume a full 64 MiB until reviewed removal.

Removal requires its own approval after revocation. It pins the fixed original
directory identity, manifest/content hashes and individual file identities;
links, changed bytes, replaced directories and extra files are preserved.
Deletion uses only the two known file names and an empty-directory removal,
never recursive cleanup. The protected removal-start record precedes unlinking.
A partial deletion keeps its allocation; only a fresh review can reconcile the
original remaining files or observed absence. Committed removal frees quota but
retains trust/revocation, fixture identity and operation history. An original
uncertain request is never upgraded or resent. These host checks do not establish
same-user adversarial or independent security acceptance.

The actual registry write is guarded by the original workspace and cancellation
generation. Mode or selection changes stop pending authorization. A committed
append or copied package can outlive a lost acknowledgement; the original
request returns incomplete and cannot be resent. Recovery first acquires the
original kernel lease and settles only that stopped host operation's budget.
Its original uncertain result and unfamiliar files remain preserved.

Linux local-gate and clean-reproduction reports can name scanner/advisory IDs.
The host rehashes their installed files, verifies P-256 signatures, type,
freshness, expiry and revocation, and checks registry/workspace stability before
issuing evidence. Authenticated tool-version facts bind each ID to its exact
manifest/content hashes, feed version and tool version. Signing keys and feed
files are not added to the task's isolated input set. Changed or revoked feeds
keep the pipeline incomplete even when its program exits zero.

## Effective evidence deadlines

Resolved fixture facts expose the earliest of the signed content expiry,
`generatedAt + maximumAgeSeconds` and the approving trust key's expiry. This
can be earlier than the manifest's declared expiry. Host pipeline/Shield evidence
uses that effective deadline when clipping receipt lifetime. A fresh observation
cannot remain usable after its feed's signed freshness SLA or trust expiry; the
exact boundary is expired. Package bytes and their signed manifest stay unchanged.

Nineteen registry cases pass, including actual P-256 installs for each of the
three deadline sources, observations one millisecond before/exactly at expiry,
and an authenticated observation that becomes unusable at real trust expiry.
Thirty-six registry/evidence/package cases, nineteen controller/removal/pipeline/
Windows Shield integration cases and type checking pass. Normal installed deadline
acceptance passes at `0cd785f`: six update and thirteen actual Supply Chain checks,
including both receipt expiry comparisons, native exit and full restoration. The repeatable pilot verifier supports a five-minute
signed freshness window without waiting for expiry:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_supply_chain --bounded-feed-deadline
```

That synthetic check requires a single selected action and independently compares
each authenticated expiry with the original signed package/trust deadlines.
Core checks separately exercise the exact expiry boundary.

## Prior result retirement

Version 2 maintenance approvals explicitly include invalidating prior pipeline
and Shield receipts in this compartment before changing the registry. Reviews
bind the affected actions and scope. Both hosts check policy drift inside the
protected receipt transaction; an old in-flight scan cannot issue a pass after
revocation. Historical outcomes remain intact and status exposes invalidation
separately. [Race, recovery and limits](validation-receipt-invalidation.md).

## Verification and remaining work

Nineteen registry tests cover actual files, P-256 signatures, aggregate quota,
concurrent allocation, linked/replaced paths, partial removal and lost replies.
Eleven maintenance and four independently grouped removal tests cover real encrypted persistence/kernel leases, HTTP
authorization, Work rejection, private snapshot omission, expiry, substitution,
revocation, cancellation, lost acknowledgements and exact budget ownership.
Both pipeline actions and revoked/changed-feed cases pass through actual Linux
Bubblewrap execution. Existing five pipeline tests also pass after sharing their
fixture helper. The packaged server is exercised with normal Node 24.14.0 flags.

These checks use synthetic feeds and keys, not a paid model or provider account.
Normal installed `27e0eb3` passes six update and ten API checks, including
exact readback, duplicate refusal, privacy, separate revocation, restored modes/
selection/private link/Home and removal of only the synthetic package/key/source
scratch. The repeatable [pilot verifier](../scripts/verify-fixtures-host.mjs)
creates a fresh validation compartment and requests no model/account or hardware.
Native Windows registry/controller checks now have separate focused CI jobs
under their existing isolated bounds; the registry passes all seventeen cases on native Windows at `403e0c9`
(digest-verified `windows-fixture-registry-403.json`, child cleanup verified).
The combined controller file exceeded its original 120-second bound after
thirteen passing cases. Its digest-verified failed receipt remains
`windows-fixture-maintenance-failed-403.json`. Maintenance and removal now run
independently under the same original bound, with all fifteen cases retained;
native `25bd26c` passes both complete files with archive digests/child cleanup
verified (`windows-fixture-{maintenance,removal}-25b.json`). The new
quota/removal implementation passes 88 combined controller, registry, service,
HTTP/privacy, harness and package checks plus two additional linked/legacy
registry cases, with type checking. Normal installed `403e0c9` passes six update and eleven API checks: quota
includes the manifest, revocation retains its allocation, separately approved
removal frees it, retired IDs/history survive and repeat approval returns the
original receipt. Selection/modes/private link/frozen Home are restored; owned
signing scratch, bundle and proof checkout are removed. Receipts
`assignment-legends-1793847745744.json` and
`installed-signed-fixtures-1793847762267.json` retained.
The separate [baseline scanner](shield-baseline-scanner.md) now runs fixed code
against reviewed source and explicitly copied public rule/advisory data for all
four Linux Shield actions. Full repository/history/ecosystem/provenance coverage
and frontend controls remain unfinished.
