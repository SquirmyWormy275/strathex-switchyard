# Verify a worker before it executes

The Windows command guardian can optionally hold its command suspended until the
owner acknowledges that exact worker. This provides a registration point for the
restricted-owner investigation. It grants no token or process access and does not
repair or accept the existing restricted-owner failure.

## Protocol

An explicit Windows `onWorkerSuspended` callback requests the
`suspended-worker-ack` capability. The existing guardian readiness and durable
start acknowledgement still happen first. The helper then creates the worker
suspended, already assigned to its owned kill-on-close Job, with only the three
original standard-stream handles inherited. It obtains PID and creation time
through the exact process handle returned by creation.

The closed `worker-suspended` frame contains the original request ID, guardian
PID/birth, worker PID/birth and locked executable SHA-256. The host checks every
field and invokes the callback once with an immutable copy. A successful callback
authorizes only that frame's worker. The helper checks the closed acknowledgement
and resumes the thread only when its suspend count is exactly one.

Changed, duplicate, missing or extra fields, callback failure, cancellation, EOF
and a response later than ten seconds cannot authorize execution. A pending read
runs independently of the timeout. No second stdin reader races with it. After
acknowledgement, the original parent-loss watcher and bounded execution continue.
The executable remains hash checked and locked throughout this operation.

The optional `runtimeGuardianStopped` child-registration hook runs synchronously
before its status request is written. Registration failure returns false after
stopping that owned status child. Neither hook is enabled by default. Unsupported
hosts and invalid callbacks refuse before launching a guardian.

## Evidence and limits

Seven focused groups pass 82 tests with four declared Windows-only skips. A
two-group harness/inventory follow-up passes 27 tests. Both managed projects build
without warnings or errors; 2,071 existing portable proof checks pass. Owned test
trees and 124 temporary managed build files are removed, and typecheck passes.
[Source receipt](evidence/windows-suspended-worker-source-summary.json).

The native CI cases cover delayed acknowledgement, callback refusal,
cancellation, changed identities, duplicate/missing fields, EOF and timeout.
They independently check Job exit and verify the command marker never appears on
refusal. Actual Windows source `7dd2c36` now passes all six tests without skips.
[Native receipt](evidence/windows-suspended-worker-native-summary.json).
Existing Linux/default behavior tests remain separate from that acceptance.

The original restricted owner remains zero of eight checks at named Job creation.
Applying the already bounded QUERY-only allowance to additional exact descendants
is now implemented as a [CI-only candidate](windows-descendant-query.md), with
native acceptance pending. No broader ACL, privilege, account, default-DACL,
process-access or runtime fallback is introduced here.

Microsoft documents the underlying [creation-time observation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)
and [thread resume count](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-resumethread).
