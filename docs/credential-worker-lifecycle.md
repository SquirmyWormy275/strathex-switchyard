# Credential worker lifecycle

Switchyard uses the operating system credential store for compartment keys. A
timed-out worker must not return a partial secret or leave an untracked process
that a later request can replace. `credential-process.mjs` owns the direct child
used by the existing Secret Service and Windows DPAPI adapters.

Results require a closed output stream and a numeric, nonnegative exit status
without a signal. Nonzero exit statuses remain available to the adapter: an
empty Secret Service lookup with status 1 still means the key was not found.
Timeout, output overflow and spawn/input/process errors return fixed diagnostics
only after joining direct-child retirement. Arbitrary stderr is counted, never
returned. The existing 10-second execution deadline and 32 KiB stdout ceiling
are unchanged.

Unconfirmed retirement retains the exact child. Concurrent and later requests
join its pending stop and refuse to spawn while its exit remains unconfirmed.
An observed close clears that ownership, including a close racing with an
uncertain stop result. There is no PID search or permission change.

Ten worker tests include concurrent retirement, signal-only exits, the exact
output bound, redacted errors and two real controlled Node workers. Six focused
groups pass 69 tests, including encrypted-state, packaging and harness checks;
typecheck and owned temporary cleanup pass. [Evidence](evidence/credential-process-source-summary.json).

These tests do not read or replace user credentials. Secret Service/DPAPI
arguments, targets and storage remain unchanged. Native Windows and installed
acceptance are separate. Direct-child retirement does not establish arbitrary
descendant containment or abrupt-parent-loss cleanup, and an already completed
Secret Service write cannot be claimed to roll back after a later timeout.
