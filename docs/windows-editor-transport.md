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
The journal passes Windows CI at `75fd0b1`: sixteen groups, 165 tests and no
skips, with native/recovery doubles explicit in journal cases.
[Native journal evidence](evidence/windows-editor-journal-native-summary.json).
Production lifecycle composition, native host/helper recovery and the Suite/VS Code
editor paths remain unfinished.


## Retain each carrier query helper

The read-only process probe now calls `onOwner` before acknowledging worker
startup and `onRetired` only after independent guardian/Job retirement verifies.
A closed ownership record contains the query UUID, role, original guardian scope
and helper path/digest. Callback values are copies. A held or failed checkpoint
remains joined during cancellation; uncertain retirement prevents replacement.

The Windows carrier forwards these records through the composed connection.
`handle.recordQuery()` retains one current query at a time, with a bounded
sequence counter. A new query cannot overwrite an unretired one. Retirement must
name the exact saved helper and can still be recorded after permission withdrawal.
Normal editor retirement cannot claim helper exit while that record is active.
Recovery receives the original unretired helper rather than inferring cleanup
from the parent host. These are the editor carrier's queries; task metadata
probes remain part of their separate task-owner lifecycle.

Fourteen focused groups pass **150 tests with four platform skips**, plus
typecheck. Checks cover original callback identity/order, held registration,
checkpoint refusal, helper replacement, record substitution and successful-
cleanup refusal. Real socket composition uses explicit native-query doubles.
The actual Windows carrier test now verifies original helper checkpoint pairs;
its new CI acceptance is pending. No C# change, compilation, new dependency or
installed-state update was needed.
[Source evidence](evidence/windows-query-ownership-source-summary.json).

The next step is production lifecycle composition and native recovery of the
saved host and carrier query helper, followed by Suite/VS Code integration.


## Startup interruption and read-only recovery

The Windows journal saves a query intent before invoking a native command. It
then records the original guardian and helper identity before acknowledging the
worker. A no-start checkpoint is allowed only when no child was observed; a
spawn without captured guardian coordinates remains uncertain. A pending
intent prevents a successful retirement claim.

`windows-editor-recovery.mjs` observes the saved host PID and birth through the
existing bounded native owner-status command. It never signals that host, its
provider or the terminal. Host exit retires the same-process logical connection
and listener. Any original unretired query additionally requires the saved
helper digest and original Job status. Recovery joins its own observer children.
Old records lacking startup intents remain conservative once ingress began.

Source checks pass 87 tests across nine groups, with four Windows-only skips.
Actual Windows recovery awaits CI. Production lifecycle, Suite routing and
VS Code activation remain separate unfinished work. The prior query ownership
checkpoint passes 170 native client tests at `47c80be`; its separate restricted
storage lane failed and does not establish a clean release.

## Protected lifecycle and Suite routes

`windows-coding-editor-connections.mjs` joins the existing review, task owner,
journal and carrier. It captures this host's native identity before reserving
an editor record, retains the original logical task client, and records each
carrier query intent and retirement. The private endpoint is returned once;
duplicate opens return only the original journal record. Logical client shutdown
leaves the provider alive.

The Suite now lazily chooses the Linux or Windows lifecycle. Its signed instance
gateway accepts a closed Windows process/birth/image peer shape and validates it
before forwarding. Neither these routes nor native recovery register a VS Code
command, launch a terminal or alter the frontend.

The synthetic demonstration crosses signed HTTP, protected state, an authenticated
WebSocket and the retained provider channel, then verifies acknowledgement and
shutdown. Workspace and keyboard-only transitions retire the editor before the
task owner. Thirteen groups pass 145 tests with five platform skips; typecheck
passes. The native-host lifecycle case awaits CI. The prior recovery checkpoint
passes 181 native Windows tests at `6881d92`. VS Code's Windows endpoint reader,
terminal process observation and launcher adaptation remain unfinished.

## Windows extension wire client

`studio-windows-task-client.ts` validates the original Windows Job binding,
64-bit birth/file coordinates, one-use review and permission replies, closed
peer shape, and private loopback capability. The Linux and Windows clients
share `studio-instance-transport.ts`: signed requests and responses, fixed
routes, original instance/endpoint readback, bounded HTTP and cancellation.
Windows requires a native endpoint reader supplied by its composition; there
is no plaintext file-reader fallback.

The actual Windows TypeScript client now crosses the signed Suite routes and
real carrier in the synthetic lifecycle demonstration. Native endpoint reads,
provider replies and terminal peer queries are explicit doubles. Nine groups
pass 86 tests with one Windows-only skip; both TypeScript configurations pass.
The earlier lifecycle passes native Windows CI at `3795217` with 189 tests.
Native endpoint-reader packaging, terminal process observation and launcher
composition remain unfinished. Commands and frontend are not activated.

`codex-windows-terminal.ts` supplies fixed read-only/on-request resume arguments
and keeps the bearer in a terminal-local environment value. The reviewed
[Codex 0.166.0 CLI source](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/cli/src/main.rs)
defines `--remote-auth-token-env` and remote resume parsing. Its source digest is
retained in the client evidence; the installed CLI was not executed or upgraded.

## Read the Windows Suite endpoint through held native handles

The native helper now provides a fixed `--editor-endpoint-v1` read operation.
It holds each directory without delete sharing, rejects reparse points and hard
links, and reads at most 4 KiB of strict UTF-8 from the held file. The current
user must own the endpoint and its immediate parent; effective allow entries
are limited to that user, SYSTEM and local administrators. The helper does not
change ACLs, ownership or privileges. Its token access remains QUERY (`8`).

The owner and DACL come from [GetSecurityInfo on the held handle](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo).
[CreateFile sharing and reparse flags](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
keep directory redirection and concurrent file replacement outside the accepted
read. The helper rechecks native identities and the original security descriptor
before emitting metadata. There is no general file-read or shell operation.

`windows-editor-endpoint.mjs` validates the response and returns its bytes only
after the original Job and status observers have retired. Cancellation during
retirement still refuses those bytes. An observed spawn without its original
guardian acknowledgement remains uncertain and blocks another read.

[Source evidence](evidence/windows-editor-endpoint-source-summary.json): six
groups, 68 passes and three Windows-only skips; typecheck passes. All 36 C#
sources compile with the existing SDK, zero warnings/errors; the five temporary
compiler files (621,355 bytes) were removed. The first run's inventory failures
are retained. Actual Windows ACL/path fixtures await CI. The earlier client
passes native CI at `485b7c6`: twenty groups, 205 tests and no skips.

VS Code packaging, terminal observation and launcher composition remain
unfinished. This boundary does not activate commands or change the installed app.

## Package the native boundary for VS Code

The extension now packages six shared query modules and a closed digest/size
manifest. Windows builds include the exact-source native helper; Linux builds
include no Windows binary. The loader checks the complete inventory and bytes
before native ES-module import, then binds its verified helper into the reader
and process-probe factories. Windows release builds create the required helper
even when an explicit build skips verification.

`StudioWindowsNative` retains those factories and reads the exact VS Code
`Terminal.processId`. Its peer result binds the reviewed image and native birth;
it does not search process trees or infer task/account attachment. Shutdown joins
a pending runtime load or native query before closing the original readers.
The launcher and command activation remain unfinished.

[Source evidence](evidence/windows-editor-runtime-source-summary.json): ten
groups, 90 passing tests and three Windows-only skips; typecheck passes. An
isolated CommonJS emit loaded the copied bridge, returned synthetic endpoint
metadata, and closed both original readers. All 49 emitted/staging files
(1,067,969 bytes) were removed.

The [first native endpoint run](evidence/windows-editor-endpoint-native-failure-summary.json)
at `e3fd587` passed 212 tests and failed one. Its original PowerShell fixture setup
hit its 10-second limit before the endpoint query. Group/child cleanup verified;
this is an unresolved test setup failure, not native ACL acceptance. Fixed stage
markers now distinguish startup, owner, files, ACLs and links without changing
the original timeout, token rights, permission rules or skip expectations.

## Review and launch one Windows terminal

`StudioWindowsEditorLauncher` now consumes the signed review once, opens the
original carrier, and retains the exact Terminal returned by VS Code. Fixed
read-only/on-request resume arguments keep the bearer in the terminal-local
environment. Native observation supplies the original PID, birth and reviewed
image; the launcher then waits for the separate carrier/task acknowledgement.
Partial creation, changed context and cancellation cannot reuse a review.
Closing the launcher joins pending work and retires the original connection
and native readers without disposing user terminals or claiming task completion.
`createStudioWindowsEditorLauncher` composes the packaged native reader, signed
client and launcher. It does not register or activate a command.

The working demonstration crosses this launcher, the actual signed Windows
client, Suite routes, protected journal and a real authenticated socket to an
exact synthetic task acknowledgement. Host/file/Terminal/provider boundaries
are explicit doubles. [Source evidence](evidence/windows-editor-launch-source-summary.json):
ten groups, 81 passes and four Windows-only skips; both TypeScript configurations
pass. All 36 C# sources compile with zero warnings/errors using the existing SDK;
five temporary compiler files (626,475 bytes) are removed.

The second [native setup failure](evidence/windows-editor-runtime-native-failure-summary.json)
at `7441289` again returned no fixed PowerShell stage marker before its original
10-second timeout. The setup now uses the existing native helper to create only
fixed synthetic contents under a fresh UUID directory inside the caller's held,
identity-checked temporary parent. ACLs are specified when those new objects are
created; there is no existing-file/ACL mutation, arbitrary contents/SDDL input,
or token-right expansion. Node creates the owned hard link and junction. The
reader's permission rules and all original timeouts/assertions remain unchanged.
Actual Windows acceptance of this replacement and the launcher file checks is
pending; the PowerShell failures are retained, not reclassified as passing.

[Windows file security creation rules](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
underpin the fixture's explicit descriptors. This fixture role is separate from
the read-only endpoint operation and is not exposed by the extension or Suite API.


## Concurrent journal publication

A status read can overlap the interval between durable checkpoint commit and
publication of that row in the retained owner. The journal now takes the same
original transaction lease for those reads. It waits for an in-flight writer,
then rechecks policy, target and complete row identity; retirement or a foreign
replacement still refuses access.

A held-publication regression fails before the correction and passes afterward.
Sixteen focused groups pass 133 tests with five declared platform skips.
Windows checkpoint `961ecb3` passes native endpoint and file checks but fails
the new concurrent launcher demonstration; corrected whole-lane acceptance is
pending. The failed group reached its original timeout, and its original tree
was terminated and cleaned by the test harness. Fixture teardown now attempts
every original cleanup without suppressing failures.
[Source evidence](evidence/editor-journal-publication-summary.json),
[retained Windows failure](evidence/windows-editor-launch-native-failure-summary.json).

The first publication correction (`ecbb8cb`) adds a kernel lease to every read;
its Windows run reaches four acknowledgement failures, though original cleanup
now finishes naturally. Reads and writes now serialize through the original
handle's local publication queue. Every mutation still acquires its original
cross-process kernel lease, and observations still compare fresh protected bytes
and the current target. External replacement and a write that commits but fails
before publication remain refusals; an uncommitted failed write does not poison
later observations. This removes the extra read-side lease without extending
deadlines or weakening permissions. Eight focused groups pass 69 tests with two
platform skips; corrected native acceptance remains pending.
[Source evidence](evidence/editor-journal-read-queue-summary.json),
[native failure](evidence/editor-journal-native-failure-summary.json).

Native `0594c8d` passes eight of nine composed lifecycle cases and still fails
the reviewed launcher acknowledgement deadline. Overlapping journal observations
now share one unfinished original-handle check, including both target captures.
Each queued mutation advances a fence, so a later reader cannot reuse a check
that precedes retirement or publication. Completed results and failures are
discarded immediately; every later observation checks fresh state. The final
protected snapshot also rechecks the original policy. Eight focused groups pass
71 tests with two skips. Native acceptance remains pending, with all original
deadlines and kernel mutation/authorization locks retained.
[Source evidence](evidence/editor-journal-shared-observation-summary.json),
[native failure](evidence/editor-journal-read-queue-native-failure-summary.json).
