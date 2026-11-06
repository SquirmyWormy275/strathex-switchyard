# Serialize private state across store instances

## Current native Windows worker

The default Windows path now invokes the existing shipped helper with only
`--state-lease-worker`. The helper accepts the bounded pipe protocol described
below, with no PowerShell startup, shell parsing or executable-path override.
It pins the original parent process handle and the lock file's volume, index and
creation time. Each transaction reopens that exact ordinary single-link file with
exclusive sharing and reparse-point refusal; replacement cannot redirect a lease.
The idle worker retains no file handle, compartment data or key. Parent loss/EOF
retires the worker; watcher disposal joins any pending observation before closing
the original process handle. Acquisition/release and pool bounds are unchanged.

Windows source runs now require the same helper at
`runtime/hotkeys/Switchyard.Hotkeys.exe`, built from
`apps/desktop-hotkeys/Switchyard.Hotkeys.csproj` with the repository's reviewed
.NET toolchain. Packaged releases already include it. CI builds that exact source
once per workflow run and verifies its source revision, size and digest before
staging; a missing helper fails closed, without falling back to PowerShell.

Both targets compile and 1,816 portable managed checks pass, including forty
protocol cases. Four focused JS files pass 43 tests and one declared Windows-only
skip. Native sharing, replacement/hard-link refusal, malformed release and
parent-loss acceptance are pending Windows CI. The earlier timeout failures
remain failed. [Source and limits](evidence/native-state-lease-source-summary.json).

## Earlier PowerShell worker reuse

Every protected mutation still holds an exclusive kernel file lock. Each state
read still retrieves its compartment key and authenticates fresh encrypted bytes.
Switchyard does not cache decrypted state or credentials.

Timeout reports now distinguish worker startup, kernel acquisition and release
acknowledgement. They retain only fixed worker progress labels; raw stderr,
paths and account content are discarded. This changes diagnostics, not lease
authority, retry behavior or the original deadlines. Three complete Linux files
pass 23 checks, including missing replies at every phase and oversized/private
stderr rejection (`isolated-test-4a42b26a-fd36-4943-99d8-b3a85a38755e.json`).
The later native Windows fixture-invalidation timeout remains failed and needs
these diagnostics on a new native run; its original receipt cannot identify the
phase. [Exact Windows checkpoint](evidence/windows-491-native-summary.json).

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
the default store path. Native Windows source `0740791` now passes both complete lease files: 16 tests and one declared Linux-only skip, with every child and process-tree cleanup verified. This executes actual kernel sharing, parent-loss and detached-owner release through the default pooled store path. It does not accept the wider Windows workflow, which retains separate storage-removal and restricted-owner failures. [Native lease evidence](evidence/windows-keyless-leases-074-summary.json).

Nine focused groups pass 85 checks with every process-tree termination and child cleanup verified; typecheck passes. [Software evidence](evidence/keyless-windows-leases-summary.json).

## Earlier implementation and evidence

The following checkpoints describe earlier source cohorts. Current Windows worker reuse and its still-pending native acceptance are described above; earlier passes do not accept the newer implementation.

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


Native Windows `4700d9a` now passes all three corresponding groups, with archive
digests and every child cleanup verified: eight Sandbox transport tests, three
ignored-tree authority tests, and six lease tests plus one declared platform
skip. This executes the actual new parser and kernel-lock helper under the
original bounds. [Exact source/artifact summary](evidence/windows-470-state-lock-summary.json).
Earlier failures remain failed and their precise startup cause is not proven by
a later pass. The whole workflow, actual guest and ordinary-account acceptance
remain separate.

Linux now runs the fixed `/usr/bin/cat` pipe reader under `/usr/bin/flock`
instead of starting Node for each lease. The readiness line can be echoed only
after the kernel grants the lock. An open input pipe holds it; pipe EOF retires
the reader after normal completion or abrupt parent loss. There is no shell,
lease reuse or deadline change. Held nonblocking probes, independent store
serialization, failed mutations, detached-owner crash release and a forcibly
lost lock owner all remain covered. A lost owner invalidates the original lease
before a new writer can be accepted through it.

Three isolated Suite/commit/lock groups pass 28 checks with cleanup verified
(`isolated-test-0bab35ff-6d9c-4a70-8ac8-13788fdeb4eb.json`). The commit group
finishes in 43,621 ms under its unchanged 45,000 ms bound; its prior timeout
remains failed. Thirty local lease acquisitions observed median 51.99 ms before
and 7.05 ms after, with both owned fixtures removed
(`linux-lock-latency-before-1793899173770.json` and
`linux-lock-latency-after-1793899235545.json`). This is a local measurement under
changing workstation load, not a universal benchmark or proof of the earlier
full-run failure's cause. The later `9dc0a94` checkpoint passes all 235 Linux groups; `7c44f05` subsequently fails one history-fixture cleanup in 236 groups. That fixture is corrected, with nine focused groups/85 checks passing, and a new complete 237-group run is in progress. [Original failed full run](evidence/linux-host-recording-full-failure-summary.json).
