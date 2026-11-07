# SXSY-B122 native desktop boundary

This Windows helper provides exact native process/window operations for reviewed
desktop executables. The commissioned companion can focus or launch through its
attested catalog. The Suite embeds the same implementation behind a separate
focus-only boundary.

The Suite now connects explicit executable review, protected configuration,
physical-intent dispatch and original-owner recovery for ChatGPT and stable
Microsoft VS Code. The source boundary has 234 focused checks and a successful
managed build; frontend controls and interactive Windows provider/window
acceptance are still pending.
[Current evidence](../../../docs/evidence/windows-vscode-focus-source-summary.json).

## Closed entry points

| Entry point | Contract |
| --- | --- |
| `--stdio-v2` | Commissioned companion discovery, focus and fixed-profile launch. |
| `--native-desktop-focus-v3` | Owner witness first, then discovery/focus only, including the separate VS Code target. Launch is refused. |
| `--native-desktop-owner-v1` | Read-only observation of an original PID/creation-time identity. |
| `--self-test` | Portable grammar/policy checks and native self-process checks when on Windows. |
| `--managed-terminal-v1` | Separate reviewed managed-terminal descriptor; unchanged version 1. |

The Suite's `Switchyard.Hotkeys.exe` exposes the focus-only and owner-query
entries, plus `--native-desktop-self-test`. It refuses the broader desktop
stdio, earlier focus-only v2 and managed-terminal entries. It links this source
through its project file; no second native implementation is copied.

VS Code is accepted only by the focus-only entrypoint. The companion's four
provider enrollments and launch profiles remain unchanged. The typed self-test
checks this distinction as `nativeEditorPolicyVerified`; it does not establish
that an actual installed editor image or foreground window has verified.

Construct the Suite process port with `focusOnly: true` and both
`onHelperOwned` and `onHelperStopped` persistence callbacks. The owner frame
contains only its schema, exact started-child PID and creation FILETIME string.
The port checks that PID against the child it started and requires a successful
owner write before sending any request. Startup is serialized.

Exact child closure and retirement persistence must complete within the existing
two-second retirement bound before replacement. A failed or pending owner write
is joined before retirement is recorded. An uncertain close or retirement write
retains the original session. Terminal stream errors discard queued responses;
failed or leftover protocol output cannot promote an earlier result.

The read-only owner query accepts `switchyard-native-focus-owner-query/v1` with
`processId` and `processStartTime`. It reports whether that original identity
has exited. A documented absent-process result proves absence; a live process
requires limited process access, current-user/session verification and exact
creation-time comparison. Denied or failed queries remain unknown. It cannot
terminate a process, focus a window or choose another identity.
[Process lookup contract](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.getprocessbyid?view=netframework-4.7.2).

## Native effect checks

The helper holds the reviewed executable and process handles. Focus binds the
approved image, PID, creation FILETIME and window handle across preparation,
one-time authorization and the final response. It requires the current-user SID
and session using TOKEN_QUERY **8**. After SetForegroundWindow, the original
process/window must still verify and GetForegroundWindow must report that exact
window. Foreground restrictions remain in force.

No window title, account lookup, injected input or alternate application supplies
identity. The protocol accepts no arbitrary shell, URL, working directory or PATH
lookup. A cancellation-state read failure during an operation remains ambiguous
in the authenticated effect ledger; it cannot become a refusal before effect or
permission to replay.

These checks use documented
[creation-time readback](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes),
[token queries](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)
and [foreground readback](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow).

## Build and verification

The commissioned release build packages a self-contained `win-x64` executable,
binds its SHA-256 into the checksum/SBOM inventory and runs its typed self-test.
The Suite reuses its existing self-contained hotkey helper. Packaging does not
establish installed provider, account or native window acceptance.

The existing SDK builds the combined source with zero warnings/errors and cleared
package feeds. Thirty-five focused groups pass 234 tests, including ownership persistence,
cancellation ordering, malformed/substituted owner frames, exact child closure and
ambiguous focus/launch journal cases. The local managed self-test reports native
owner/current-user checks as unperformed. Temporary source/build files are
removed after verified exit; exact counts are retained with the source evidence.

Windows automation now requires native self-owner checks, focus-only launch
refusal and an independent read-only observation that the original helper exited.
Those Windows results are pending.

Earlier source checkpoints retain
[process-birth evidence](../../../docs/evidence/provider-process-birth-source-summary.json),
[retirement regressions](../../../docs/evidence/provider-helper-retirement-source-summary.json)
and [focus-only packaging evidence](../../../docs/evidence/windows-focus-only-source-summary.json).
Broader companion launches retain their kill-on-close Job Object until an exact
new surface verifies; this launch capability is absent from Suite focus mode.
