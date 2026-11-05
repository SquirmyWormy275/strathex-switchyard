# When signed scanner policy changes

A pipeline result describes one target under one evidence policy. Revoking a
scanner feed or its signing key must retire the result even when the receipt's
clock has not expired. This applies to both host execution paths.

## Reviewed effect

Every version 2 scanner/trust maintenance review displays the six affected
pipeline and Shield actions and its compartment scope. Review alone changes no
receipt. Applying the one-use approval atomically appends invalidation lineage
for every prior matching execution receipt, then records a policy-change marker,
before attempting the registry effect. Historical receipt bodies, results and
hashes are unchanged. Run, other action families and other compartments retain
their original receipts.

The rule is deliberately conservative: adding a trusted source, installing a
feed, revoking either, and removing a retired allocation all retire prior results
for these six actions. It avoids inferring which old observation depended on a
partially available or expired package. Old review approvals cannot authorize
the expanded effect; obtain a current version 2 review. Kernel lease identities
remain compatible with version 1, whose original host exit can still be observed
without replaying its effect.

## The receipt-commit race

Invalidating only already-issued receipts leaves a race with a running scan.
Both hosts bind their review to the protected registry history and policy-change
markers. At admission they compare that binding again. Inside the locked receipt
transaction, the append guard repeats the comparison against current state. A
policy change after report validation therefore refuses a passing receipt, even
when the original native program exited zero. Empty invalidations advance the
binding too. An active or unobserved interrupted maintenance operation blocks new
evidence; recovery may observe the original kernel lease's exit without replay.
After verified exit, fresh validation may inspect the retained current registry;
the original uncertain operation and old invalidations remain unchanged.

The guard applies only to validation receipt issuance. It leaves native stop,
budget settlement, ownership inspection and cleanup available after policy drift.
A lost invalidation acknowledgement is an uncertain effect: retain the
invalidations, do not dispatch the registry action, and do not replay it. The
original review never earns a passing maintenance receipt from that uncertainty.

## Reading a historical result

The execution status response contains a separate `receipt` object with its
historical result, completeness, invalidation identity, expiry and exact expiry
state. It reports `scopeRevalidated: false` and `gateEligible: false`: reading
history does not recheck today's task inputs. Replayed requests keep the original
outcome and receipt ID. `ReceiptLedger.isFresh` reloads the protected record, so a
caller retaining an earlier object cannot bypass a later invalidation.

## Evidence and limits

Core cases cover atomic all-or-none retirement, duplicate changes, first
lineage, unrelated actions, compartments, all five maintenance effects, lost
acknowledgements, legacy review recovery, empty invalidations and exact expiry.
Real Linux namespace and explicit Windows guest-double integrations retain
previously accepted results while exposing later invalidation. A deterministic
fault at each host's post-validation/pre-receipt boundary refuses a pass, retains
verified zero native exit and never replays the program. Windows receives
separate `fixture-invalidation` and `validation-policy` CI jobs; new native
acceptance is pending independently of the software checks.

This covers changes through the protected signed-feed maintenance path.
Full repository/ignored-secret/history inventory, broader scanner coverage,
expiring reviewed exceptions and comprehensive target-drift gate consumption
remain unfinished. A signed feed and a fresh receipt never establish coverage
that a scanner did not perform. [Feed deadlines and trust](signed-fixtures.md)
and [current verification](verification.md) record the accepted source versions.

Normal installed `9f3024e` passes six update/fourteen actual Supply Chain API
checks, including receipt expiry, retired receipt status and unchanged historical
results. Both guardians exit; original state is restored and owned scratch
removed. Receipts `assignment-legends-1793857471815.json` and
`installed-shield-baseline-1793857655461.json` are retained. Zero model prompts.

Both execution hosts also check [current protected task/account/authority state](receipt-authority-commit.md)
inside validation receipt append. This is separate from reading historical
results or revalidating a live external provider/filesystem.
