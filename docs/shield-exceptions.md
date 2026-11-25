# Audited, expiring Shield exceptions

Switchyard connects Personal operator reviews to exact protected findings. Both
execution hosts retain the original scanner report and authenticate a separate
exception decision. Findings covered by current exceptions yield an incomplete
command result; they never establish missing coverage or a complete Shield gate.

## Review one finding

Use `POST /api/suite/host/shield-exceptions/review` with a request UUID,
`action: "grant"`, protected `sourceReceiptId`, exact finding `fingerprint`,
reason and canonical ISO `expiresAt`. The source must be a still-current failed
receipt from the pinned scanner. The host checks its protected report/evidence
binding and revalidates the original task target. Agent-authored findings,
expired/retired receipts, broad scopes and changed targets cannot grant exceptions.

The review shows the action, target, scanner source, rule, path, reason, expiry
and prior-receipt retirement. Apply its exact UUID and one-use token through
`POST /api/suite/host/shield-exceptions/apply`. Both calls require the active
Personal companion workspace. Work and task content cannot authorize exceptions.
Ordinary snapshots omit the private reviews and journal; the explicit authenticated
`.../list` route exposes their bounded operator metadata.

Expiry is one minute through twenty-four hours from review. Approval time never
extends that deadline. The source receipt must still be unexpired immediately
inside policy commit. Exceptions match only the original action, complete target,
pinned scanner source, fingerprint, rule and path. Their usefulness therefore
ends when any of those bindings changes, even before their clock expires.

## Apply without hiding evidence

The policy mutation, budget, audit, maintenance receipt and prior validation
receipt retirement commit in one locked compartment transaction. A fault rolls
back every domain; a consumed approval cannot replay the mutation. Verified
rollback settles the review as failed/not-started and records a sanitized audit.
If only the commit acknowledgement is lost, authenticated receipt/effect
read-back recovers the original result with explicit metadata, without another
policy mutation. The original budget deadline is checked before receipt issuance and final
settlement; a late local effect rolls back both policy and prior-receipt
retirement. Unknown read-back remains an error. No external repository or
filesystem effect occurs.

The next separately reviewed scan preserves raw findings, their counts and report
hash. It adds `shieldExceptionEvaluation`, including exact binding, applied IDs,
redacted reasons and remaining finding fingerprints. The authenticated evidence
binds that decision's SHA-256 and clips its receipt deadline to applicable
exception expiry as well as feed deadlines. Partial exceptions leave failure;
all findings excepted still leaves incomplete mandatory coverage. Empty findings
do not count as an overridden pass. Receipt commit refuses concurrent policy drift.

Withdraw an exact retained exception with a new review (`action: "revoke"`,
`exceptionId`, reason). Withdrawal appends attribution and time, preserves the
original grant and retires prior validation receipts atomically. Retained IDs and
active duplicates cannot be replaced in place. The ledger caps active/history
counts and uses the existing authenticated journal byte bounds.

## Verification and limits

Twenty-nine core/controller/HTTP/inventory cases pass, including exact mismatches,
expiry, one-use review, reason redaction, cross-domain rollback, lost replies,
Work rejection and snapshot privacy. Separate real Linux namespace and Windows
host/guest-double journeys pass: failed scan, exact approval, incomplete repeat
with authenticated unchanged findings, withdrawal, then failure again. New
Windows native CI remains separate. Normal installed `82bd9b3` passes six normal
update/seventeen actual API checks, including exact approval, unchanged raw
findings, authenticated incomplete repeat, withdrawal, original expiry/replay and
three native exits. Original state is restored and owned scratch removed. Receipts
`assignment-legends-1793859246213.json` and
`installed-shield-baseline-1793859581132.json` are retained; zero prompts.
Eleven final package/controller checks, forty Suite/maintenance/Shield/race
regressions and type checking also pass.

The installed verifier supports a synthetic three-scan journey:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_change_scan --ignored-secret-input \
  --reviewed-exception
```

That mode uses ordinary feed freshness and a separately clipped exception
lifetime. The bounded-feed verifier remains a separate acceptance path. No key
material is submitted to a model; no device, microphone, tenant or account UI is
opened. Complete repository/history/ecosystem/provenance coverage and frontend
exception controls remain unfinished. [Current verification](verification.md)
records accepted versions separately from those limitations.

The later failure-state correction passes thirteen controller/ledger cases and
twelve package/controller cases. It settles verified rollback honestly and
recovers only a proven original commit; its acceptance is separate from the
installed 82bd9b3 exception journey.
