# An authenticated Windows terminal connection

The new internal carrier exchanges bounded JSON objects with one exact local
terminal process. It now composes with the exact-task protocol through a retained
provider client. Suite routing, durable task ownership and VS Code activation
remain unfinished.

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

The full carrier is natively accepted at `233cd76`: eleven client groups,
119 tests, no skips. This includes the owned Windows Node round trip, original
process/TCP identity and independently retired helpers. Source/merge trees,
artifact digest, original commands, bounds and cleanup verify.
[Native carrier evidence](evidence/windows-editor-ingress-native-summary.json).

Transport observations always keep protocol acknowledgement, task/account
binding, IDE attachment and completion separate. No live provider, model,
account, keyboard or frontend operation was used for this implementation.

## Connect the exact task protocol

`openWindowsCodexEditorConnection()` accepts an already retained, dedicated
provider client and composes the carrier with the restricted editor relay. The
caller supplies current-owner checks, durable ownership/acknowledgement callbacks
and independent retirement of that original provider client. This composition
does not start or adopt a provider, issue task-loading permission, or substitute
a new process after failure.

Windows targets require an explicit local drive path. UNC/device paths, alternate
streams, reserved DOS names, traversal, trailing dots/spaces and malformed Unicode
refuse. Native request and response paths must match the original spelling; no
case folding or path redirection substitutes for repository identity.

The same relay keeps the reviewed native version, restricted configuration and
matching account reads around the exact resume. The terminal receives the task
reply only after the caller retains the acknowledgement. Model turns, login,
foreign tasks, extra configuration and expanded permissions remain refused.
Peer loss or an account boundary withdraws acknowledgement and closes the original
connection. Stop joins startup and pending acknowledgement before retiring both
carrier and provider. Any unconfirmed exit or retention failure prevents an
accepted retirement record.

Fourteen focused groups pass **127 tests with three platform skips**; typecheck
passes. Tests use real sockets with explicit provider/native-peer doubles,
including cancellation during startup/acknowledgement and failed retirement.
The composed connection now passes Windows client CI at `f1167c9`: twelve groups,
127 tests and no skips. Its provider/peer doubles remain explicit; the separate
carrier case uses actual native Windows queries.
[Native composition evidence](evidence/windows-editor-connection-native-summary.json).
This evidence does not establish durable Windows task ownership, journal recovery, Suite routes,
VS Code launching or a live installed-account task.
[Composition evidence](evidence/windows-editor-connection-source-summary.json).

The next [persistent process layer](windows-owned-stdio.md) is implemented with
separate source tests. Its actual Windows Job cases await CI acceptance.
