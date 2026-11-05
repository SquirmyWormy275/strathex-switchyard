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
and detached pipe ownership. The digest-verified native Windows `59a73de` lease group now passes five tests
and one declared platform skip, with cleanup verified. The earlier failure
remains failed; the full native workflow is not accepted.


The same source still has two [separate lock acquisition failures](evidence/windows-59a-state-lock-summary.json)
in the first Sandbox transport and ignored-tree authority cases. Each hits the
unchanged 15-second acquisition limit; the file itself exits within its bound
and cleanup verifies. This is available-CI software validation, separate from
actual guest/device/account acceptance. Module startup is a plausible contributor,
not a confirmed diagnosis.

Windows lock acquisition now uses a closed five-field ASCII line rather than
importing PowerShell Utility and parsing JSON. A canonical base64 UTF-8 path
preserves literal Unicode, tabs and shell punctuation; neither side evaluates
text. Requests are bounded to 22,000 characters and 16 KiB path bytes, with
strict PID/boolean/version/encoding validation. The helper uses only language
and .NET operations, with module autoload disabled. It still owns the exclusive
kernel file handle until pipe closure, checks the original parent's birth and
exit, retains sharing-error-only retries/nonblocking behavior, and keeps both
the ten-second contention and 15-second acquisition bounds. No warm-up,
background lease reuse or retry of a failed transaction is introduced.

Four isolated Suite/lock/Sandbox/ignored-authority groups pass 36 checks with
every cleanup verified (`isolated-test-9c07dacc-b24e-49be-91d9-a7a1e54c6e91.json`).
Linux exercises real kernel locks and the closed request's Unicode/injection/
size boundaries. Windows must still execute its native parser and lock journey;
these Linux checks do not establish the startup failure's cause or repair.
