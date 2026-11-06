# Windows helper startup candidate

The restricted Windows owner currently reaches JavaScript, then fails while
starting its state-lock helper. The prior exact-image comparison observed
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

**Native metadata startup, the original eight-check owner journey and complete
release acceptance remain unaccepted.** The separate archived-release staging fix
also awaits native acceptance. [Failed native artifact and stream correction](evidence/windows-pipe-text-source-summary.json),
[earlier candidate source evidence](evidence/windows-winexe-source-summary.json).
