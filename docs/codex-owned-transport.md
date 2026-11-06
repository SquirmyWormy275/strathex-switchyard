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

The subsequent guardian demonstration also reads back the effective restricted
configuration and kills only its own wrapper. Independent readback confirms that
the existing guardian contains parent loss, with no live member left in its
owned session. Exact socket, native alias, directory and marker retirement pass.
Four native checks and eighteen software checks pass; the initial alias-cleanup
failure stays failed. [Exact guardian evidence](evidence/codex-owned-guardian-summary.json).

Run the explicit read-only proof from the repository with its supported Node:

```sh
node scripts/verify-codex-owned-listener.mjs --read-only-parent-loss
```

The proof pins the reviewed native CLI digest and refuses a pre-existing socket
or active marker. It creates no thread or turn and never starts/stops a global
daemon. It reads existing account metadata and deliberately kills only its new
wrapper; interrupted cleanup preserves exact owned scope metadata for recovery.

Continuous account-event fencing and complete Studio/task/IDE attachment remain
unfinished software. Two matching account snapshots do not establish continuous
login identity or permission to resume a task. Existing saved task/account
authority is not inferred from the socket. Production connections remain stdio.
