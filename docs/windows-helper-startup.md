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

**Native Windows startup, the eight-check owner journey and complete release
acceptance remain pending.** The separate archived-release helper staging fix is
also awaiting native verification. [Source evidence and limits](evidence/windows-winexe-source-summary.json).
