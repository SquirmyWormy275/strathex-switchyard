# Windows helper startup candidate

## Restricted setup-identity guardian

The current native evidence is specific: `fb265e7b` fails Job creation with error 5.
At `ad4d5e6`, the separate cold restricted child with its existing QUERY allowance
creates and closes new anonymous, Local and Global empty Jobs successfully.
The actual guardian remains failed; the difference in its descendant context is
not yet explained. [Native comparison](evidence/windows-cold-job-native-summary.json).

The failing guardian now performs one read-only self-token access observation
only after `CreateJobObjectW` returns error 5: `OpenProcessToken` requests
`TOKEN_QUERY` (mask 8) against its own pseudo-process handle, then closes any
returned handle. It neither grants access nor reads token/account information.
The optional closed failure field reports only opened/error/close status; older
frames remain accepted. CI projects fixed query-result suffixes while retaining
original refusal, uncertain exit and all eight owner checks.

Six groups / 79 tests, two managed builds / 2,071 portable checks and typecheck
pass. All 124 owned build files (3,240,871 bytes) and test staging are removed.
Native 0a0dd11 now reports self-query error 5 in the actual failed guardian.
[Native evidence](evidence/windows-guardian-query-native-summary.json).
[Evidence](evidence/windows-guardian-query-source-summary.json).

The read-only access check follows Microsoft's
[OpenProcessToken contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocesstoken).
It does not change the token object ACL, default DACL, restricting SIDs, process
rights, privileges, account, runtime or namespace. A token-open observation
cannot accept the guardian or prove which access its failed Job API attempted.

Native `6f2097b` reaches protected initialization and mode update, then fails as
`probe-identity-created-worker-exit`. The guardian child is created but never
reports readiness. [Exact native result](evidence/windows-owner-probe-native-summary.json).

The helper now emits an optional closed `startup-failure` frame before readiness
with the original request ID and a fixed phase. Phases distinguish environment,
image attributes/open/hash, Job creation/configuration, self-birth lookup and
readiness output. Only the two Job APIs can attach their immediately captured
Win32 error code. Paths, credentials, URLs and raw exception text are excluded.

The host retains refusal and `RUNTIME_STOP_UNCONFIRMED`; this frame does not
acknowledge a command or establish exit. Unknown fields/stages refuse, and no
later frame can invoke readiness after failure. The existing native environment
test now verifies an invalid environment fails before acknowledgement with the
exact environment phase. The original eight restricted-owner checks remain.

Six groups / 78 tests, two managed builds with no warnings/errors, 2,006 portable
checks and typecheck pass. All 124 owned build files (3,207,249 bytes) and test
process/staging cleanup verify. No SDK download or local installation occurred.
Native fb265e7b identifies the Job-creation denial. [Source evidence](evidence/runtime-startup-observation-summary.json).

At `4faa8a1`, version 2 native leases pass 24 checks/one declared skip with
cleanup. The restricted owner clears protected state initialization and mode
update, then fails later at its read-only storage probe. The complete owner is
still unaccepted. [Native result](evidence/windows-lease-pipe-native-summary.json).

Windows `da28b5c` identifies the restricted failure as **Access Denied opening the
parent process**. The next source protocol binds worker lifetime to its private
inherited input pipe instead of that lookup. It checks EOF while idle, reading
partial frames, holding a lease and waiting for a lock, with one reader and no
new process/token rights. File identity, sharing, sequencing, Job containment and
the original eight owner assertions remain. Two managed builds / 2,006 portable
checks, five groups / 53 passes / one Windows-only skip and typecheck pass; native
acceptance is pending. [Failure and source](evidence/windows-lease-pipe-owner-source-summary.json).

## Earlier startup checkpoints

The restricted Windows owner currently reaches JavaScript, then fails during
state-lock initialization. An earlier exact-image comparison observed
`CREATE_NO_WINDOW` exit `0xc0000142` before helper entry; detached startup reached
entry under the same restricted token and explicit creation-time Job.
[Retained native failure](evidence/windows-lease-console-native-summary.json).

The earlier WinExe candidate builds the existing pipe-driven helper as `WinExe` instead
of a console executable. Microsoft distinguishes those
[output types](https://learn.microsoft.com/en-us/visualstudio/msbuild/common-msbuild-project-properties?view=visualstudio)
and documents that
[`CREATE_NO_WINDOW` applies to console applications](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags).
Avoiding console initialization is a hypothesis based on the comparison, not an
accepted diagnosis or repair.

The production Node spawn stays unchanged, including its inherited pipes and
parent-loss Job behavior. The state lease protocol, original parent watcher,
private desktop, restricted token, query-only child-token correction and original
eight owner assertions are unchanged. No detached production fallback is added.
The native comparison now reads the digest-pinned image's PE header and requires
the Windows GUI subsystem before launching either probe. Its versioned diagnostic
can report that observation without claiming a lease or successful owner journey.

Both managed targets compile with zero warnings/errors. The managed helper PE
has subsystem 2; this Linux build does not verify a Windows native apphost.
The portable protocol proof passes 1,975 checks; four isolated JS groups pass 42,
with typecheck and exact owned build/test cleanup. A first local build attempt
included pre-existing generated attributes; the corrected build uses an owned
copy of tracked source and leaves those original files untouched.

The first native candidate, 8168d4e, failed the copied-helper metadata check with
exit 2 before any restricted-owner proof. Its imported artifact digest verifies.
This is a regression, not accepted native startup. The receipt does not identify
the exact throwing operation.

Inspection found six pipe-command entry points still setting console encodings.
The [.NET 8 implementation](https://github.com/dotnet/runtime/blob/v8.0.24/src/libraries/System.Console/src/System/ConsolePal.Windows.cs)
calls console code-page APIs and throws on failure; those APIs act on an
[associated console](https://learn.microsoft.com/en-us/windows/console/setconsolecp).
The correction installs strict UTF-8 readers and writers over inherited streams,
without code-page changes or console allocation/attachment. Ten managed checks
cover Unicode, EOF, byte-exact output without BOM, malformed input, malformed
output and ownership of underlying streams. Both targets compile and all 1,985
portable checks pass; four isolated JS groups/42 checks and typecheck pass.

At that source checkpoint, metadata startup and the original owner journey
awaited native validation. The follow-up below verifies metadata startup while
retaining the owner failure. The separate archived-release staging fix also
awaits native acceptance. [Failed native artifact and stream correction](evidence/windows-pipe-text-source-summary.json),
[earlier candidate source evidence](evidence/windows-winexe-source-summary.json).


## Native follow-up and parent watch

At `1fc9d7f` the copied helper now passes metadata, private-runtime and exact exit
checks, and its isolated copy is removed. Both console-comparison modes reach
entry and retire exact resources. The original restricted Node journey still
fails during private-state initialization after the helper reads input. The
ordinary eight checks, thirteen restricted metadata and thirty-one native
exchange checks pass. [Imported native evidence](evidence/windows-pipe-native-summary.json).

The next candidate removes another source dependency: [.NET Process.SafeHandle](https://github.com/dotnet/runtime/blob/v8.0.24/src/libraries/System.Diagnostics.Process/src/System/Diagnostics/Process.cs)
opens a PID-only Process with full access. The lease only needs
[limited query access for birth time](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)
and [synchronization for exit observation](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject).
It now requests exactly those rights on one non-inherited handle, rechecks birth
and exit on that same handle, and joins the timer before closing it. Existing
request/owner progress labels are always emitted; they contain no paths or
caller data and grant no lease.

The native receipt does not prove this was the exact throwing operation. Both
managed targets and 1,985 portable checks pass; five isolated groups pass 49 tests
with one Windows-only skip. The original owner and parent-loss journey still
require native acceptance. [Source evidence](evidence/windows-lease-parent-source-summary.json).


## Canonical lock paths

At `701f915` the original owner still fails with the last fixed label
`lease-input-read`. The newly unconditional `lease-request-read` marker follows
canonical-path equality and precedes parent-handle opening. The parent-watch
change therefore has not repaired this failure.

[.NET path normalization](https://github.com/dotnet/runtime/blob/v8.0.24/src/libraries/System.Private.CoreLib/src/System/IO/PathHelper.Windows.cs)
expands existing 8.3 names. Node path joining preserves that spelling. The next
source correction resolves the already-created Windows lock path before native
dispatch and pool lookup, requiring both spellings to name the same ordinary,
single-linked file on the same drive, compared with bigint file identities.
Changed identity, links, device/UNC paths and alternate drives refuse. The
native canonical-path comparison and file-handle checks stay intact.

Five isolated groups pass 52 checks with one Windows-only skip; typecheck passes.
The native receipt contains no path spelling, so a particular short alias is
not claimed as observed. The original owner journey remains unaccepted.
[Failure and correction](evidence/windows-canonical-lock-source-summary.json).


## Parent observation after canonical-path acceptance

The `fea2ca4` native run reaches `lease-request-read`, so the caller path correction
clears the preceding canonical-path comparison. The next operations open the
parent handle, query its birth and check liveness. None is yet established as the
specific failing operation; the original restricted owner still exits 2 with
zero of eight checks. Fixed labels now separate open/query denial from other
failure and record successful open/birth read. No private path, PID, account or
exception text is exported, and all original restrictions remain.

The separate native lease test reaches an outdated diagnostic-label assertion.
Its new expectation requires the complete successful-start sequence, preserving
file replacement/hard-link/malformed-release and cleanup assertions. The original
failed native receipts remain retained. Two managed builds/1,985 portable checks,
five isolated groups/53 passes/one Windows-only skip and typecheck pass; native
acceptance is pending. [Evidence](evidence/windows-parent-observation-summary.json).


## Preserve progress through the managed report

The `f653827` native owner still fails. The managed report's closed progress list
had not been extended with the new parent labels, so it discarded that detail.
The report does not identify the exact failed parent operation. Its source
projection now accepts those same fixed labels and tests all ten emitted labels
through serialization, preserving the exact failure kind and exit code. No
unknown text or private field is accepted. Two builds and 1,995 portable checks
pass, with all owned staging removed.

The separate ordinary-owner native lease lane now passes 24 checks with one
declared Linux-only skip and all child/tree cleanup verified. File replacement,
hard-link refusal, malformed release and parent-loss checks pass after correcting
the stale diagnostic expectation. This is distinct from restricted-owner or
guest acceptance. [Evidence](evidence/windows-parent-projection-summary.json).

## After guardian readiness

A separate `worker-start-failure` frame now reports fixed creation stages only:
pipe setup/inheritance, attribute initialization/storage, handle/Job attributes,
environment allocation, `CreateProcessW`, stream construction and worker identity.
Only the native API stages can carry a numeric error. Paths, arguments, inherited
environment and child output remain excluded. The frame is accepted only after
the same guardian's ready/start exchange and before a suspended worker or result.
It remains an unconfirmed-stop refusal, never execution or cleanup evidence.

Observation ends before the worker acknowledgement and resume. The native test
adds an absent working-directory case: readiness must occur, the worker callback
must not occur, the marker must remain absent and original Job exit must verify
independently. Actual Windows `d15285b` passes all eight acknowledgement/refusal
tests without skips, including this failure case.
[Native receipt](evidence/worker-start-refusal-native-summary.json). Portable
validation and managed builds also pass. [Source evidence](evidence/worker-start-observation-source-summary.json).
