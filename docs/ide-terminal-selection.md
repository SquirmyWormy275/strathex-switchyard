# Select the exact integrated terminal

Shift Terminal targets a terminal registered to the action's exact open workspace.
It reuses the active terminal only when that object has the matching registration.
Multiple eligible objects require a picker; identical titles confer no identity.
If none existed when selection began, the authorized action can create one blank
terminal for that root. Closing an offered target never creates a replacement.

Authorization, controller lifetime, open workspace, original window focus and the
offered object's current registration are checked again after the asynchronous
picker. The shared helper reveals that exact object with `show(false)` and waits
at most five seconds for its activation, then independently reads `activeTerminal`.
An event alone cannot establish success. Closure, lost authorization or changed
readback refuse. Final acknowledgement rechecks the target after registration;
a terminal already shown keeps an ambiguous effect if that final check fails.

Three isolated groups pass 147 checks with cleanup, including picker drift,
same-title objects, post-show registration races and listener cleanup. Typecheck
and the actual extension build pass. This is a workspace-terminal selection
improvement. Exact coding-task/account/native-session attachment to an IDE tab
remains unfinished software work.

To demonstrate the compiled helper against the real installed VS Code API:

```sh
npm run build:vscode
node scripts/verify-vscode-terminal-host.mjs --synthetic-terminal-selection
```

The explicit opt-in opens one disposable empty editor profile with a development
fixture. It creates two `/usr/bin/cat` terminals with identical titles and sends no
terminal text or model request. The protected fixture nonce and API process IDs
are independently checked against current-user executable, unique private
directory and native process-birth identities. The newly mapped editor's native
PID/birth is pinned, and the fixture independently requires its own window focus.
Terminal app scopes are separate from the launcher; the proof does not claim or
stop them as a group. Only its own launch unit is stopped, and every pinned native
process must independently verify exit before profile removal. Original focus is
restored. User settings and workspace trust are preserved.

The real demonstration passes two native and three API checks: repeated selection
of both objects, followed by refusal of the closed first object without selecting
its same-title neighbor. Nine pinned processes exit and the profile is removed.
The harness's earlier launcher/scope/readiness failures remain failed receipts.
This validates the compiled helper through a disposable source fixture; it does
not claim production extension installation or a coding-task attachment journey.
[Exact evidence and source hashes](evidence/native-vscode-terminal-summary.json).
