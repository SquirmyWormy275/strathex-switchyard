# Authority at validation receipt commit

Both execution hosts now check the exact protected task/account/workspace and
authority state inside the locked validation-receipt transaction. A valid scan
observation does not establish a current passing receipt if its local scope
changes before that commit.

The check compares the reviewed task and workspace digests, target, authority
ID, action, native task/session/repository binding and protected grant ledger.
Mode, account, authority epoch, uncertain task turns, revocation and exact expiry
are checked against current protected state. The existing signed-feed/exception
policy binding is checked in the same append guard.

The predicate uses the already locked compartment state. It performs no nested
store access, new Git query or provider call. This avoids holding a state lock
while trying to reacquire it. Native stop, budget settlement, audit and cleanup
remain available; the guard applies to validation receipt issuance. Run keeps
its existing execution/ownership contract.

Three focused cases pass. One covers real task-authority capture plus thirteen
scope/receipt mutations, exact expiry and revocation; an invalid append leaves no
receipt. Two deterministic host cases change local scope after report validation:
a Linux account change and a Windows grant withdrawal. Both refuse a passing
receipt despite verified zero native exit, retain the original result and do not
replay the program. The Windows guest is explicitly doubled. Six existing
feed-bound pipeline and receipt-race cases pass with the new guard. Twenty-nine
contract/maintenance checks, six package/state checks, six Shield/exception
regressions and type checking also pass.

This closes the protected-state commit boundary. It does not reread external
provider login or every live repository byte inside the receipt transaction.
History/status continues to report `scopeRevalidated: false` and no gate
eligibility. Consequential consumers still require their fresh complete target
and current authority; historical success alone grants nothing. Complete scope
inventory, remaining native/client/physical acceptance and broader gate
consumption remain separate work. [Evidence](verification.md) and
[policy retirement](validation-receipt-invalidation.md) record their accepted
sources and limits.

Normal installed `0f04adc` passes six update/seventeen actual exception/scan API
checks with this guard, exact expiry/withdrawal/replay and three independently
verified native exits. Original state is restored and owned scratch removed.
Receipts `assignment-legends-1793860291500.json` and
`installed-shield-baseline-1793860601561.json` are retained; zero prompts.
