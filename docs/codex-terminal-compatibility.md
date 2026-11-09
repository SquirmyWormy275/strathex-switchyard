# Native Codex terminal compatibility

The installed Codex 0.167 terminal now passes Switchyard's initial connection
and selected-thread metadata checks in an isolated demonstration. **Full native
terminal attachment is still unfinished.** The current installed Switchyard
application remains `ec28d09`; this source change has not been installed.

The demonstration uses the real CLI, production WebSocket handshake and
production relay, with an explicitly synthetic provider. An empty owned home,
hidden host configuration and separate network namespace keep real accounts,
tasks and model requests outside the check.

## What changed

The native Unix-socket client requests `/rpc`; the carrier previously accepted
only `/`. Both exact paths now use the same kernel peer verification and bounded
frame parser. Alternate paths, query strings and encoded variants still refuse.

Codex also sends a nullable title and a capability advertisement that differed
from the synthetic clients. The relay recognizes only the captured `codex-tui`
0.167.0 shape and translates it into the existing restricted provider handshake.
It does **not** forward experimental capability admission, notification opt-outs
or attestation requests.

Before resuming, the native terminal reads its account and selected thread.
Empty account-read parameters become `refreshToken: false`. Startup thread reads
are metadata-only, restricted to the reviewed UUID and directory, and bracketed
by original-account checks. These reads do not acknowledge or resume a task.

## Evidence and remaining work

Seven integration groups pass **64 tests, zero skips**. Original commands,
deadlines, serial scheduling and child cleanup are verified. The original four
regression failures are retained. The existing thirteen non-Linux carrier skips
are unchanged; the new path cases extend existing tests.

The real terminal passes initialization, account read and two exact thread reads.
It then reaches a project-specific `config/read` request that the relay still
refuses. Later capture probes also observed `hooks/list` and a Bedrock requirement
check. Supporting the remaining startup exchange and native resume parameters
is **implementation work**, not an account or hardware blocker. Every new request
needs an explicit scope; there is no general forwarding branch.

Visible loading of a real saved task, live provider acceptance and VS Code GUI
verification remain separate checks. No native attachment or completion claim
is inferred from a JSON-RPC reply. The diagnostic processes exited, and their
twelve owned directories, forty files and 230,303 bytes were removed.

[Audited source and native evidence](evidence/codex-native-startup-summary.json).
The contract review used the [official App Server documentation](https://learn.chatgpt.com/docs/app-server)
and [version-pinned native connection source](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/app-server-client/src/remote.rs).
