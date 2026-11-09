# Return to an open native app

Open **Your tools → Return to an open app**, choose ChatGPT, VS Code or (on Windows)
Claude Desktop, and select
**Review return to app**. The second action focuses the currently verified single
main window. It does not launch an app, type text, select an account or resume a
coding task. Use [Coding tasks](coding-task-controls.md) for a saved task identity.

On Linux, the existing adapter checks its fixed executable, current user,
process birth and unambiguous main window before and after focus. ChatGPT keeps
the repaired native main window, voice behavior and hidden overlay. No desktop
configuration changes. [Native boundary](native-client-focus.md).

On Windows, first expand **Set up a Windows application** and enter the installed
executable path. Review its canonical path, SHA-256, signer, certificate and expiry,
then save that exact identity. Saving opens no app. Changed executable bytes or
signer require a fresh review. The existing native helper retains QUERY-only
permissions and independently verifies its own exit.
[Windows boundary](windows-native-focus.md).

Claude Desktop keeps its own saved executable identity and never selects Claude
Code or a web substitute. After saving, **Customize → Connect to this computer**
can review its navigation shortcut. The shared saved setup refreshes even after a
lost save acknowledgement. Linux Claude focus and native app launch remain
unfinished; they are not inferred from the Windows implementation.
[Claude Desktop evidence](evidence/claude-desktop-focus-source-summary.json).

The frontend discards reviews when the app, executable field or workspace changes.
The focus endpoint also requires the reviewed workspace to remain selected, even
when another Personal workspace has the same policy. Physical keyboard dispatch
keeps its separate active-workspace contract.

Lost replies do not trigger retries. Saved Windows receipts distinguish completed,
refused and uncertain operations. **Review helper retirement** observes retained
Switchyard helpers, including in keyboard-only mode; it does not retry focus,
close the external app or certify an earlier uncertain effect. A lost setup reply
refreshes the saved identity without replaying its consumed confirmation.

Nine UI cases use real authenticated HTTP, encrypted state, executable-file
identity and the existing review/configuration service. Native signatures,
processes, windows and helper transport are explicit test doubles. Original
native service/gateway tests run separately. Browser rendering and interactive
Windows acceptance remain unaccepted. Claude desktop launch and exact interactive
coding-task attachment remain unfinished implementation.
[Source evidence](evidence/native-app-ui-source-summary.json).
