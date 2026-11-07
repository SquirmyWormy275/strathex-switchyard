# An authenticated Windows terminal connection

The new internal carrier exchanges bounded JSON objects with one exact local
terminal process. It provides the transport needed for Windows editor integration;
Suite routing, durable task ownership and VS Code activation remain unfinished.

`openWindowsEditorIngress()` creates an ephemeral listener on `127.0.0.1` and a
random 256-bit capability. The private endpoint getter supplies the URL and bearer
token to the launching client. Ownership records contain only its hash. The
caller separately pins an already observed process birth and executable identity.

The listener admits one socket and closes admission immediately. It accepts an
exact HTTP/1.1 WebSocket upgrade with the correct host and capability, then checks
the held socket against the pinned [native process and TCP owner](windows-terminal-process.md).
No message passes before both checks. Native identity is rechecked before each
incoming JSON object and each outgoing response. A wrong capability, changed
process, browser Origin, extension negotiation or replacement connection refuses.

The frame codec follows the text, masking, fragmentation and control-frame rules
of [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455). It refuses binary frames,
reserved bits, invalid UTF-8, duplicate JSON keys, nonfinite values and excessive
nesting. Messages are limited to 1 MiB, fragments to 1,024 and JSON depth to 32.
Startup allows eight seconds; headers allow 16 KiB. Pending operations and queued
output have separate bounds. Compression and subprotocol negotiation are absent.

Closing aborts the socket and peer queries. Retirement joins pending consumer
callbacks, verifies listener/socket closure and requires independent native helper
exit. An unconfirmed helper cannot produce a stopped result. The observed terminal
process remains caller-owned; this carrier never terminates it.

Thirteen focused groups pass **118 tests with three platform skips**, including
real local bidirectional JSON exchange, replay refusal, bad authentication,
changed peer evidence, malformed frames and joined shutdown. Native process
inspection is explicitly doubled in those Linux transport cases. Typecheck and
the existing Linux editor/protocol/package regressions pass. No new compiler,
bundle or dependency staging was created.
[Source evidence](evidence/windows-editor-ingress-source-summary.json).

The underlying Windows peer check is natively accepted at `89db483`: nine client
groups, 107 tests, no skips. The new carrier has its own owned Node round-trip
case registered in Windows CI; its acceptance remains pending.
[Native peer evidence](evidence/windows-terminal-peer-native-summary.json).

Transport observations always keep protocol acknowledgement, task/account
binding, IDE attachment and completion separate. No live provider, model,
account, keyboard or frontend operation was used for this implementation.
