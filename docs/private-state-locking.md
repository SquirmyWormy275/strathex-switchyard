# Short-lived Windows lock helpers

Every protected mutation still holds an exclusive kernel file lock. Each state
read still retrieves its compartment key and authenticates fresh encrypted bytes.
Switchyard does not cache decrypted state or credentials.

Windows can now reuse a keyless PowerShell worker for successive leases on one
validated lock path. Repeated repository inspections previously started a fresh
PowerShell process for every small journal update. Reuse removes that repeated
startup while preserving a separate kernel-handle acquisition and release for
each transaction. Native performance and boundary acceptance remain separate
from the portable protocol tests.

The worker receives the existing bounded path/PID request through a private pipe.
It checks the original parent's process identity, then accepts only sequenced
`ACQUIRE` and `RELEASE` commands. A callback begins only after the matching lock
acknowledgement. A release acknowledgement is sent only after disposing the
kernel handle. Unknown, stale, oversized or missing replies fail closed.

The helper sees no compartment contents, key, account, provider request or
command output. Its idle period holds no file lock. One second after its last
transaction it exits; at most 64 helpers and 64 pending uses per path are allowed.
Different paths keep distinct helpers. Nonblocking probes refuse a locally busy
path immediately, or retain the native sharing-error result from another owner.
They never invoke the protected callback on an unconfirmed lease.

The original 15-second acquisition budget includes startup and lock acquisition;
the native sharing wait remains bounded at ten seconds. Release acknowledgement
has a two-second bound. Helpers receive EOF on parent loss, and an explicitly
closed or failed worker is independently awaited before replacement. No PID-file
deletion, inherited old lease or automatic callback replay is used. If a helper
dies, the transaction's lease assertion fails. An uncertain release remains a
failure even if the callback has already returned a result.

Linux retains its existing `flock`/pipe lease. The Windows storage-contract
`leases` cohort requires both complete state-lock and keyless-pool test files;
their existing child and workflow limits remain unchanged.

Portable tests execute real independently exited child-process protocol doubles.
They cover serialized mutations, separate paths, nested nonblocking refusal,
privacy, callback/progress failures, helper loss, malformed acquisition/release,
idle retirement, shutdown and capacity. These doubles establish protocol behavior;
actual Windows file-sharing and parent-loss behavior must pass native CI through
the default store path. No native Windows acceptance is claimed by this document.

Nine focused groups pass 85 checks with every process-tree termination and child cleanup verified; typecheck passes. [Software evidence](evidence/keyless-windows-leases-summary.json).
