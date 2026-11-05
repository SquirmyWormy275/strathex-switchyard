# Serialize private state across store instances

Independent store objects can address the same sealed compartment files in one
host process. Initialization and mutations now share a process-local queue keyed
by normalized private root and compartment. Each transaction still obtains its
own platform kernel lock, re-reads state, checks the lease before writing and
waits for helper exit. The queue is removed when its last transaction settles.

This prevents same-process store instances from competing to start lock helpers
for the same state. It does not replace cross-process locking, reuse a lease
between transactions or change the existing 15-second acquisition deadline.
Resource locks and nonblocking probes retain their existing kernel behavior.
Callback failure cannot publish uncommitted fields or poison the next instance's
transaction.

The motivating [Windows failure](evidence/windows-c8b-state-lock-failed-summary.json)
hit that acquisition deadline during the existing initialization/concurrent-write
journey. The child exited within its original test deadline and cleanup verified;
the result remains failed. A competing cold helper startup is a plausible
contributor, not an established root cause. The shared queue removes that
competition without weakening the kernel boundary.

Four isolated store/lock/Suite/scanner groups pass all 41 checks, with cleanup
verified (`isolated-test-924a833e-560c-41f5-aabd-32408b16b6f7.json`). These include
independent stores retaining one compartment key and all twelve writes,
cross-process crash release, held-resource probes, failed transaction recovery
and detached pipe ownership. Native Windows confirmation of this correction
remains pending; broader scanner contract timeouts remain separate unfinished
validation.
