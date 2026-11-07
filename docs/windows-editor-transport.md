# An authenticated Windows terminal connection

The new internal carrier exchanges bounded JSON objects with one exact local
terminal process. It now composes with the exact-task protocol through a retained
provider client. Persistent Windows task ownership is implemented; durable editor
journal/recovery, Suite editor routing and VS Code activation remain unfinished.

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

`openWindowsCodexEditorConnection()` accepts an already retained provider client
or a logical channel on the original authenticated stdio owner and composes the carrier with the restricted editor relay. The
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
connection. Stop joins startup and pending acknowledgement before retiring the
carrier and original editor client. A dedicated client requires native exit; a
logical channel requires joined channel retirement and leaves native exit false.
Any unconfirmed retirement or retention failure prevents an accepted record.

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

The [persistent process layer](windows-owned-stdio.md) passes native client CI at
`45fe70e`: thirteen groups, 139 tests and no skips. The Windows task adapter then
passes at `0078893`: fourteen groups, 147 tests and no skips. These use synthetic
workers/app-server RPC, never a live account or task.
[Native task evidence](evidence/windows-codex-owners-native-summary.json).


## Share the original Windows task connection

`createRetainedCodexEditorClient()` creates a logical channel on the already
authenticated stdio client. The Windows owner retains it before calling the
registration callback and permits one live editor at a time. It starts no
process or native handshake. The terminal receives the exact original native
initialization response, including its original client name; the relay verifies
that retained provenance against the unchanged 0.166.0 gate.

Metadata and editor requests share the native client's request-ID allocator.
The logical channel allows only restricted configuration/account reads and the
exact task's read or one read-only/on-request resume. The relay still checks
account before and after the resume and waits for durable acknowledgement.
Foreign-task notifications are not delivered. Account boundary events revoke
admission synchronously, and a conflicting account reply closes the original
provider. Requests remain bounded to 1 MiB each, 2 MiB aggregate and 64 pending.

Closing detaches the channel and suppresses late replies; retirement joins all
admitted requests. It does not terminate the task owner. The composed Windows
connection records `clientConnectionRetired: true` and
`upstreamExitVerified: false` for this case. Whole-owner shutdown independently
joins editor registration/requests and verifies the original Job.

Thirty-eight focused groups pass **163 tests with one platform skip**, including
actual CodexClient parsing/request multiplexing with synthetic streams, a real
authenticated WebSocket exchange using peer/provider doubles, late reply
suppression, account drift, forbidden effects and joined owner registration.
Typecheck passes. The actual Windows Job fixture now also exercises the channel
and subsequent task metadata; this passes at `fcfe38a` in fifteen native client
groups, 155 tests and no skips. Exact source/merge tree, artifact, commands, bounds
and cleanup verify. [Native channel evidence](evidence/retained-editor-client-native-summary.json). No new compiler,
bundle or dependency staging was created.
[Source evidence](evidence/retained-editor-client-source-summary.json).

This channel is a backend component. [Windows target preparation](coding-task-owners.md)
is implemented with separate source checks. Durable editor journals and recovery,
Suite editor connections and VS Code launching still need integration;
no terminal command or frontend control was enabled.


## Retain Windows ownership after interruption

The shared protected journal accepts an explicit Windows contract. Each record
uses `switchyard-windows-editor-connection/v1` with an exact read-only native host
proof. The logical upstream binds the original Job scope and provider PID/birth/
digest; the listener retains only the capability hash. Ordered transitions pin
the exact terminal peer and endpoint before protocol acknowledgement. No POSIX
directory/socket identity or provider-process exit is substituted for Windows
coordinates.

The existing consumed-permit, kernel-lease, immutable-record and no-replay rules
still apply. A duplicate or restarted host cannot obtain a new handle from a
saved record. Replacement protected bytes cannot be overwritten by an older
handle, including during cleanup. Query-helper uncertainty keeps retirement
uncertain; recovery requires original-host exit plus independent logical-client,
carrier and query-helper facts. This contract accepts a verifier supplied by its
owning service; it is not itself a native recovery implementation.

Personal observation recording remains separately opt-in. Historical events use
a private subject digest and status only, preserve exclusions/recording boundaries
and claim neither live IDE attachment nor task completion. The journal and its
native coordinates remain encrypted.

Thirty-eight focused groups pass **164 tests with one platform skip**, plus
typecheck. Tests use actual protected storage/leases with explicit native and
recovery-verifier doubles. A malformed observation fixture was corrected after
the original bounded failure was retained; production validation stayed intact.
Existing Linux journal, recovery, observation, routing and packaging checks pass.
[Source evidence](evidence/windows-editor-journal-source-summary.json).

The earlier target implementation passes Windows CI at `2d1cc65`: fifteen
groups, 159 tests, no skips, including real process reinspection and protected
target/client registration against a synthetic app server.
[Native target evidence](evidence/windows-editor-target-native-summary.json).
The newer journal's Windows run is pending. Its production lifecycle still must
retain every active query helper, verify native host/helper retirement after
interruption, and connect the Suite and VS Code editor paths.
