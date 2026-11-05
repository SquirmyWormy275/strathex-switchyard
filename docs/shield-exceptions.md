# Audited, expiring Shield exceptions

The protected exception ledger is implemented. Operator review/API and scanner
application are unfinished; this ledger alone is not an active override path.
Baseline Shield still returns failed or incomplete results.

Each ledger grant binds one action, complete target snapshot, pinned scanner
source hash, protected source receipt, finding fingerprint, rule and path. A
reason and exact expiry are required. Review accepts one minute through
twenty-four hours; applying a review never extends its original deadline.
Matching ends exactly at expiry. Changed scope, scanner, rule, path or fingerprint
cannot inherit the exception. Empty findings never count as an overridden pass.

Reasons are bounded and redacted. Withdrawal appends attribution, reason and
time while preserving the original grant. Retained IDs and active duplicates
cannot be replaced in place. The ledger caps active/history counts and uses the
existing authenticated compartment, chained journal and byte bounds. Its
match result always reports incomplete coverage and no gate eligibility.

The shared locked-state journal port allows a policy grant/withdrawal, prior
validation-receipt retirement and audit records to commit in one compartment
transaction. A fault between domains rolls back both. It introduces no external
filesystem mutation or second state store. Existing scanner fixture maintenance
continues using its original kernel lease and pre-effect retirement path.

Six core/confirmation cases cover exact matching and mismatches, partial
findings, expiry boundaries, immutable withdrawal, malformed/broad proposals,
reason redaction and cross-domain rollback. Twenty existing signed-fixture
maintenance/removal/invalidation cases pass after extracting the shared journal
port. The fixture tests still exercise real encrypted persistence and kernel
leases; no account, hardware or model is required for these ledger checks.

The next implementation connects one-use Personal operator reviews to a
protected, still-current finding and applies those decisions alongside the raw
scanner report. Work/task input cannot grant exceptions. Even a valid exception
must leave mandatory missing coverage incomplete. [Current status](switchyard-status.md)
records this foundation separately from installed scanner acceptance.
