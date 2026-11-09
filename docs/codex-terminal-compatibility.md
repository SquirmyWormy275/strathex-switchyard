# Native Codex terminal compatibility

The real Codex 0.167 terminal can now open and display a synthetic saved task
through Switchyard's production handshake and relay. The demonstration includes
a stored assistant reply, one reviewed read-only resume and a stable connection.
The paginated path also renders two saved pages, loading the older turn through
its original continuation cursor. **Live-provider and actual VS Code GUI
acceptance remain separate.**

The installed Switchyard application uses source `3222727`; the pilot VS Code
extension remains at `42655aa`. The app passes 69 served/API and 121 installed metadata checks; the
extension passes exact payload hashes and eight installed module checks.
[Application evidence](evidence/installed-legacy-account-summary.json),
[editor evidence](evidence/installed-editor-terminal-summary.json).

## Connection and permission contract

The Unix carrier accepts the exact `/` and `/rpc` paths under the same kernel
peer verification and bounded frame parser. Query strings, encoded variants and
other paths refuse. Only the captured `codex-tui` 0.167.0 initialization shape is
translated into the restricted upstream handshake; experimental provider methods,
notification opt-outs and attestation are not enabled.

Native remote resume rejects CLI sandbox and approval overrides. Terminal launch
therefore supplies only the exact endpoint, directory and session UUID. The relay
translates the native null-settings envelope into the already reviewed
`read-only/on-request` request. It verifies the returned permissions and brackets
resume with original-account reads. Client overrides, foreign tasks and replay
still refuse.

Project configuration is read only for the selected directory and must retain
the effective tool restrictions. The initial model catalog and policy requirements
also use original-account checks. Eleven optional catalog/feature requests receive
explicit unsupported errors locally. They never enumerate other tasks, install
tools or reach the provider. Unknown operations and task/config/account effects
still close the attachment.

## Paginated saved history

The reviewed 0.167 terminal reads turn summaries and message items separately.
Both requests require the acknowledged selected task and paginated history mode.
Every page checks the original account before and after reading. Page sizes are
bounded at 100 entries; only descending reads and cursors returned by that task
and the same page family are accepted. Responses are bounded to one MiB.
Retained Windows channels use the same validation without another handshake.

The actual terminal renders both the newest saved message and an older message
through two item pages and two turn pages. Thirteen integration groups pass
136 tests with one original skip; final history and packaging groups pass 39
with no skips. Counts overlap. Four diagnostic roots, twenty files and 93,752
bytes are removed after original guardian exit and exact file verification.
[Paginated source and native demonstration](evidence/codex-native-paginated-history-summary.json).

Per-turn edits, anchor cursors, ascending reads and experimental history methods
remain refused. History reads grant no prompt or tool authority.

Legacy `thread/read` now also verifies the original account before querying and
after receiving a reply, including reads after acknowledgement. A mismatched
account prevents delivery and closes the connection; successful repeated reads
retain the one original acknowledgement. Three failing regressions reproduce the
earlier omission. Thirteen integration groups pass 139 tests with one existing
skip, package checks pass five, and typechecking passes. Account changes use
explicit doubles. This later correction is now installed at `3222727`; fourteen
installed in-memory terminal checks pass. The completed full Linux run at `72e7c22`
predates the correction.
[Legacy read correction](evidence/codex-legacy-read-account-summary.json).

## Earlier legacy demonstration and checks

The native CLI, production WebSocket handshake and production relay ran in an
empty owned home with a separate network namespace and a synthetic provider.
The terminal rendered the saved task title and the stored marker
`SWITCHYARD_SYNTHETIC_TRANSCRIPT_OK`, remained connected, and submitted no model
prompt. The provider received exactly one narrowed resume. All processes exited,
and twelve diagnostic directories, 42 files and 254,286 bytes were removed.

Thirteen integration groups pass **128 tests with one existing platform skip**.
The final focused run passes **27 tests**, including changed-account, malformed
metadata, non-null override and retained Windows-channel cases. Typechecking
passes. Original deadlines, commands, cleanup and declared skips are unchanged.
[Audited source and demonstration](evidence/codex-native-bootstrap-summary.json).

The native terminal displays two skills-unavailable messages because those
optional queries are refused; Switchyard does not fabricate an empty-success
response. The earlier demonstration covers legacy history; the paginated
demonstration is recorded separately above. Other TUI versions and live
account/IDE acceptance need their own evidence.

[Earlier startup-prefix evidence](evidence/codex-native-startup-summary.json)
retains the original failures. The contract review uses the
[official App Server documentation](https://learn.chatgpt.com/docs/app-server)
and [version-pinned native connection source](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-client/src/remote.rs).

The paging contract also follows the [version-pinned native history loader](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/tui/src/app_server_session/history.rs).
