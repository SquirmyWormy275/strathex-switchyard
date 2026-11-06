# Windows helper startup candidate

The restricted Windows owner currently reaches JavaScript, then fails during
state-lock initialization. An earlier exact-image comparison observed
`CREATE_NO_WINDOW` exit `0xc0000142` before helper entry; detached startup reached
entry under the same restricted token and explicit creation-time Job.
[Retained native failure](evidence/windows-lease-console-native-summary.json).

The current candidate builds the existing pipe-driven helper as `WinExe` instead
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
