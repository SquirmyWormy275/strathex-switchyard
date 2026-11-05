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

The older `startBoundCodexThread` command now uses the same exact-object reveal
helper. Its App Server thread creation always requests and verifies the exact
directory plus `read-only` / `on-request`; a returned ID survives a failed
permission readback. The CLI resumes only that returned UUID at the explicitly
configured Unix socket and root with the same permission flags. Names, recent
session selectors, remote URLs and ambiguous/overlong socket paths refuse.
The installed CLI and [official CLI reference](https://learn.chatgpt.com/docs/cli/reference)
confirm explicit `unix://PATH` endpoints; [App Server documentation](https://learn.chatgpt.com/docs/app-server)
describes creation and exact-ID resume as separate operations from a model turn.

The launcher rechecks open workspace, window focus, controller lifetime, directory
inode and executable identity across its asynchronous boundaries. Persisted and
registered acknowledgements must retain the exact thread/task/root binding.
Failed creation or later context drift preserves the returned native ID in the
local warning and prevents a terminal launch. The existing local task-binding
metadata message remains; no user request or model turn is submitted by creation.
Thread registration alone does not establish account, native process attachment,
target authority or verified completion.

Four isolated groups pass 147 checks, including twelve asynchronous refusal cases,
strict daemon permission/directory responses and partial identity retention.
Typecheck and extension build pass. A help-only run of the real installed Codex
0.166 CLI accepts the generated flags and exits; it opens no daemon connection,
native task or model request. Native TUI attachment remains an outstanding
integration check, separate from unavailable hardware/account checks and the
broader unfinished Studio-to-IDE task integration.
[Exact parser/software evidence](evidence/native-codex-cli-parser-summary.json).
