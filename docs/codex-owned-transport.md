# Connect to an owned Codex listener

Switchyard's production Codex task and design adapters still use restricted
stdio. The new argument builder preserves those exact tool, hook, MCP and
first-party restrictions and can also describe one explicit local Unix listener.
It refuses network endpoints, path aliases and an unspecified/global transport.
No production task is switched to a listener by this change.

The installed 0.166.0 CLI was exercised with an owned private directory and
process group. Its Unix listener uses a socket named by the SHA-256 of the
requested path. The probe checked the native executable hash, process birth,
private socket ownership and the socket inode held by that exact server before
connecting through the existing WebSocket adapter. Two read-only account
responses matched. The process exited, its socket retired and its owned directory
and marker were removed. No thread, model turn, account change or global daemon
command was requested. [Exact source-bound evidence](evidence/codex-owned-unix-summary.json).

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server#protocol)
describes WebSocket framing over Unix sockets. The CLI's separately advertised
stdio proxy did not complete initialization in either bounded trial; those
failures remain retained and that route is not exposed by the app.

This demonstration establishes read-only access to the owned listener. Effective
configuration readback, continuous account-event fencing, parent-loss acceptance
and complete Studio/task/IDE attachment remain unfinished. Two matching account
snapshots do not establish continuous login identity or permission to resume a
task. Existing saved task/account authority is not inferred from the socket.
