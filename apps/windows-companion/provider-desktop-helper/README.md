# SXSY-B122 provider desktop helper

This Windows-only helper is the native effect boundary used by the companion's
`WindowsProviderDesktopProcessPort`. It is intended to be published as a
self-contained `win-x64` executable and pinned by absolute path and SHA-256 in
the host bootstrap configuration.

Desktop operations accept `--stdio-v2` (one bounded request) and `--self-test`.
The separate managed-terminal descriptor remains version 1. The desktop stdio
protocol never accepts a command, working directory, URL, PATH lookup, or
arbitrary process-control request. Focus and launch pause after native identity
handles are held; the companion must complete its final policy barrier and
return the helper's one-time token before the effect occurs.

Discovery now returns the exact process creation FILETIME as a decimal string.
Focus binds that value together with the approved executable, process ID and
window handle through preparation, authorization and the final response. A reused
PID or an older helper response cannot substitute for the observed process.
The held process must have the helper's current-user SID and session, using only
TOKEN_QUERY (8). A denied query refuses the operation. After SetForegroundWindow,
the retained process/window must still verify and GetForegroundWindow must report
that exact window. Windows foreground restrictions remain in force.

The process port also joins the exact helper's close event before accepting an
owned-session result. It retains an unconfirmed session after the two-second
retirement bound and refuses replacement until that original session exits.
Concurrent admission refuses; it cannot displace an active helper. Terminal
stream errors discard queued responses, and leftover/failed protocol output
cannot promote an earlier result. A cancellation-state read failure during an
operation remains ambiguous in the authenticated journal, requiring reconciliation.

Six focused groups pass 64 source checks, with six reproduced regressions, two
actual owned Node child cases and focus/launch journal scenarios. The native
helper source is unchanged; no live provider/window/account effect occurred.
[Retirement evidence](../../../docs/evidence/provider-helper-retirement-source-summary.json).

This uses documented [creation-time readback](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes),
[token queries](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)
and [foreground readback](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow).
No window title, account name, injected input or alternative application identifies
the target. This commissioned companion boundary is separate from the Suite's
unfinished native Windows focus connection.

Example release build:

```powershell
dotnet publish .\Sxsy.B122.ProviderDesktopHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
```

`deployment/windows/Build-B122Release.ps1` builds this helper by default, runs
its typed self-test, places it under the companion's `provider-desktop`
directory, and binds its SHA-256 into the release checksum/SBOM inventory and
`release.json`. A prebuilt helper is accepted only with an explicit reviewed
SHA-256. Packaging is not evidence that Claude Desktop or ChatGPT Desktop is
installed, signed in, reachable, or independently accepted on a target host.

The earlier process-birth checkpoint passes six isolated groups/56 checks, including three reproduced regressions and
older-protocol refusal. Type checking and the managed build pass with the existing
SDK and cleared package sources. The Linux self-test reports native current-user
readback as unperformed; the Windows portable smoke now requires that native
readback and exact QUERY mask. Real provider-window acceptance remains pending.
The exact owned 25-file, 417,149-byte build/test staging is removed.
[Source evidence and retained failures](../../../docs/evidence/provider-process-birth-source-summary.json).

The helper uses a kill-on-close Job Object until a newly launched process has
produced a new, exact-identity top-level window. If the helper is cancelled or
terminated before that proof, Windows kills only that task-owned launch tree.
