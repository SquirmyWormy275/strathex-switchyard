# Signed scanner and advisory fixtures

The Suite can review, install and revoke signed evidence feeds within one
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
| `POST /api/suite/host/scanner-fixtures/list` | Public-key fingerprints, installed metadata and maintenance reviews; no signing key, package bytes or private package path. |
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
claims per hour. Payloads are bounded to 64 MiB each; aggregate fixture quota
and reviewed package removal remain unfinished implementation.

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

## Verification and remaining work

Eight existing registry tests cover actual files and P-256 signatures. Eleven
Suite-controller tests cover real encrypted persistence/kernel leases, HTTP
authorization, Work rejection, private snapshot omission, expiry, substitution,
revocation, cancellation, lost acknowledgements and exact budget ownership.
Both pipeline actions and revoked/changed-feed cases pass through actual Linux
Bubblewrap execution. Existing five pipeline tests also pass after sharing their
fixture helper. The packaged server is exercised with normal Node 24.14.0 flags.

These checks use synthetic feeds and keys, not a paid model or provider account.
Normal installed API acceptance and native Windows checks of the new controller
are pending. The complete Shield/scanner execution connection, aggregate feed
quota, reviewed removal/retention and frontend controls remain unfinished.
