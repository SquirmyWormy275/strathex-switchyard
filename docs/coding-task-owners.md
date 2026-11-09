# Preserve the original coding-task owner

The Linux and Windows `createCodingTaskOwners` service holds an owned native
connection for one registered Codex task. Its protected record binds the original
thread, account fingerprint, repository directory and native listener. It does
not create a thread, submit a prompt, attach an IDE, or grant task authority.
Opening and reading observe metadata only. Loading an existing idle task requires
a separate exact review and one-use confirmation.
Studio now exposes separate owned-connection routes. Existing task creation and
reviewed-text APIs retain their stdio behavior. [Editor task commands](editor-task-controls.md)
now connect the saved-project/task picker to reviewed launch and owned-terminal
return. Actual graphical activation and live task/account acceptance remain separate.

A request first reserves its UUID under a per-task kernel lease. The listener
then records its private directory before startup, guardian before provider start,
socket/alias after readiness, and account after authentication. A duplicate request
returns its original record. Another host cannot adopt its live connection, and
another request cannot replace it until retirement is independently verified.

Reads recheck permission, exact saved task, native account, original repository
identity and protected owner before and after asynchronous metadata access. A
changed binding refuses delivery. Public views contain local IDs and capability
limits; native process/socket/account details remain in encrypted state.

Shutdown stops only owned resources and retains uncertainty when exit cannot be
verified. Restart recovery consumes the exact saved identities and verifies
retirement; it never guesses a PID, adopts a global daemon, or starts a replacement.
Incomplete ownership records are preserved for review. Request history is bounded
and retained for duplicate prevention rather than silently recycled.

Run the focused software proof with the pinned runtime:

```sh
mise exec node@24.14.0 -- node --experimental-transform-types --test tools/layout-studio/coding-task-owners.test.mjs
```

Nine registry cases cover real encrypted state and kernel leases, concurrent
instances, changed account/repository/task/owner, failed persistence, late shutdown,
no replay and exact recovery. One case composes the actual Unix listener and bridge
with a controlled provider double. The complete related cohort passes 76 tests;
final registry and package checks pass thirteen with exact cleanup. These checks
create no real provider task and do not establish live account or IDE acceptance.
[Exact evidence](evidence/coding-task-owner-summary.json).

Retirement also compares the protected native identity with the original live
owner. A substituted saved owner stays uncertain even if the in-memory process
has exited. [Final guard evidence](evidence/random-access-owner-retirement-summary.json).

## Windows task ownership

The Windows adapter uses one original Job-backed stdio connection and the shared
encrypted registry, task leases and reviewed-load rules. A separate configuration
probe is retained before startup, rechecks permission and must retire before the
task owner starts. It uses the existing restricted Codex arguments and reviewed
exact reviewed [version gate](codex-version-contract.md); a project instruction directory cannot become startup cwd.

Guardian identity is saved before worker creation. Later records add the exact
worker and authenticated account; absent earlier fields are not treated as a
different owner. Account drift closes that original connection. Recovery checks
the saved helper digest and original Job scope without adopting or terminating a
guessed process. Uncertain probe or task exit blocks replacement.

Fifty focused groups pass **279 tests with twelve declared platform skips**, plus
typecheck. Tests cover protected registry routing, exact one-use load, replay
refusal, permission withdrawal during a held probe, account drift and failed
post-start persistence. Local provider/transport doubles are explicit. An actual
Windows Job plus synthetic app-server RPC and saved-identity recovery case is
now passes at `0078893`: fourteen native client groups, 147 tests and no skips.
Source/merge tree, artifact digest, original commands, bounds and cleanup verify.
[Native task evidence](evidence/windows-codex-owners-native-summary.json).

The owner can now retain one [logical editor channel](windows-editor-transport.md)
on its original stdio stream. It joins pending registration on shutdown and does
not confuse channel retirement with native process exit. Windows target
preparation is now implemented as described below. Durable editor journals/recovery
and Suite/VS Code editor connection integration remain unfinished implementation,
separate from live-account acceptance.
[Source evidence](evidence/windows-codex-owners-source-summary.json),
[native Job evidence](evidence/windows-owned-stdio-native-summary.json).

## Review and load an existing task

`reviewLoad(compartment, ownerRequestId)` describes the original saved task,
account, repository and connection. `load(compartment, { ownerRequestId,
requestId, token })` consumes that exact review under the per-task lease and
reserves a protected request before the native effect. Only Switchyard-created
read-only/on-request tasks on the original owned connection qualify.

Every effect boundary checks current policy, original task and repository identity,
fresh account metadata and the protected native owner. Active, approval-waiting
or unknown tasks refuse loading. The adapter repeats checks after asynchronous
project setup and retains an exact returned thread identity if later checks fail.
An uncertain outcome preserves its request and stops the owned connection; it
never automatically repeats the resume. Duplicate calls return the retained
outcome without claiming the connection is still loaded. Shutdown joins loading.

The fifteen registry cases and related adapter/session/confirmation cohort pass
62 tests with exact child/tree cleanup and typecheck. The actual Unix transport
loads one synthetic task through a provider double, with zero thread creation,
injection or model turns. Real provider loading, production Studio routing and
IDE attachment remain unaccepted or unfinished. [Exact evidence](evidence/reviewed-owned-task-load-summary.json).

## Authenticated Studio routes

The `/api/suite/coding/codex/owners/` routes are `list`, `open`, `read`,
`review-load`, `load`, `loads`, `editor-target`, `stop` and `recover`. They accept only each
operation's exact fields and require the original selected workspace. Generic
snapshots omit protected owner and load records; `list` and `loads` expose safe
local IDs, statuses and capability limits.

Workspace switching waits for original owned connections to retire and preserves
selection if exit is uncertain. Keyboard-only mode first saves the permission
fence, then joins shutdown. The effect boundary also checks the actual saved
selection, so an external selection change cannot redirect pending loading. App
close and individual stop join in-flight loads; failed retirement remains explicit.

The authenticated HTTP demonstration uses real encrypted state, kernel leases
and confirmations with a controlled provider. It loads exactly one synthetic
task and refuses replay, unauthenticated requests and unexpected prompt fields.
Six files pass 91 tests; the final privacy/route cohort passes forty with cleanup
and typecheck. This establishes backend composition, not live account or IDE
acceptance. [Evidence](evidence/routed-task-load-summary.json).

After a normal versioned update, the pilot can verify only installed metadata and
refusals with `node scripts/verify-task-owner-host.mjs --read-only-metadata`.
The verifier authenticates the saved app instance before disclosing its bearer,
checks exact installed source, safe owner/load projections and rejected effect
fields, then verifies selected sealed bytes, workspace inventory and frozen Home.
It starts no provider, resumes no task and requests no model turn. Extra native,
account or approval flags are rejected before installed-state access; the shared
metadata verifier cohort passes two tests with child/tree cleanup (receipt
`isolated-test-2ce51fcb-268e-40fb-82e1-1924cc8ea2ec.json`). Installed execution of
this later verifier still requires its separate receipt.

The installed `4b5e3cc` application now passes six normal update checks plus
seven owner metadata/refusal and seven existing journal metadata checks. All
54 workspace identities, selected sealed bytes, private endpoint and frozen Home
are preserved. Dated launcher copies and installed bytes match their journal;
the temporary bundle is removed. No native provider, task resume, model, keyboard
or microphone operation occurred. [Installed evidence](evidence/installed-task-owner-summary.json).

Bridge close and original native-owner retirement are attempted independently.
A throwing bridge close cannot skip stopping its owned listener; a successful
listener exit cannot upgrade an uncertain bridge exit. The owner stays retained
and replacement remains blocked. Twenty registry cases and typecheck pass with
exact cleanup. [Correction evidence](evidence/independent-task-owner-stop-summary.json).

## Find eligible saved projects

`editorProjects()` on the Linux and Windows typed clients sends an empty signed
selection to `/instance/v1/editor-projects`, backed by
`/api/suite/coding/codex/editor-projects`. The Suite chooses its selected workspace;
a supplied compartment, project, command or prompt is refused. A same-name
workspace reselection invalidates an in-flight result.

The bounded response lists exact saved repository roots and distinct eligible
task counts. It uses the same protected owner/load/task checks as task choices.
Multiple load records for one task count once; duplicate protected identities
refuse the inventory. Stale owners and changed bindings are omitted. This reads
encrypted state only: no filesystem crawl, provider inspection, native task
operation or state write occurs. Work policy and keyboard-only mode refuse it.

The signed clients validate local paths, total counts, response bounds and endpoint
identity, then freeze the result. Credentials, native sessions, task content,
review tokens and launch authority are absent. Choose a project, call
`editorChoices(repositoryRoot)`, then follow the existing exact review flow.
An empty list means no eligible owned task is currently saved; it is not proof
that the machine has no projects. Picker/command activation is now connected in the source extension.\n[Editor controls](editor-task-controls.md).
[Source evidence](evidence/editor-project-choices-source-summary.json).
Three native Windows groups pass 17 tests with original bounds and cleanup;
providers and endpoint-reader doubles remain explicit.
[Native evidence](evidence/editor-project-choices-native-summary.json).

## Find saved tasks for a project

The editor can request candidates with `editorChoices(repositoryRoot)` on either
typed client. The signed `/instance/v1/editor-choices` operation reaches
`/api/suite/coding/codex/editor-choices` with only an exact normalized local
`repositoryRoot`. The Suite chooses its currently selected workspace; callers
cannot substitute a compartment. A persisted workspace change, including a
same-name reselection, invalidates an in-flight result.

The response contains the workspace, project and up to 64 saved choices. Each
choice has a local task label, task ID, original owner/load IDs and load timestamp.
Only an existing in-memory owner with matching protected task, load, policy and
ownership records is eligible. Closed owners and stale bindings are omitted;
ambiguous identities or an oversized inventory refuse the entire response.
Account fingerprints, native session IDs, socket addresses, prompts, credentials
and review tokens are absent.

These are saved candidates, not current native observations.
`nativeObserved:false`, `authorityGranted:false` and
`freshReviewRequired:true` are mandatory. Listing does not inspect a provider,
resume a task or write state. A chosen row still goes through `editorTarget`,
review, issue and consume with the original identity. The clients validate and
freeze the complete bounded response and recheck the signed endpoint.

The encrypted-store-to-client demonstration uses an explicit synthetic provider.
The original inventory evidence predates the connected
[editor commands](editor-task-controls.md). Live account/task and graphical IDE
acceptance remain separate. [Inventory source evidence](evidence/editor-task-choices-source-summary.json).

## Prepare an exact editor target

The authenticated `editor-target` operation accepts only the original
`ownerRequestId` and `loadRequestId`. It requires a successful, acknowledged load
on this still-live owner, the original account and repository, unchanged policy
and an idle task. It returns a closed target identity and digest, including the
actual private socket and native process identity. The digest is metadata, not a
credential or permission grant.

An existing connected bridge can survive a replaced socket alias. Before exposing
a target for a new editor connection, the listener therefore rechecks the original
private directory, socket parent, socket, alias, native PID/birth, process group,
session and executable path. The registry repeats load/account/policy checks
around this asynchronous inspection and the metadata read. It refuses stopped,
foreign-host, uncertain, replaced, active and malformed targets.

Preparation starts no terminal, performs no second resume and changes no saved
state. `authorityGranted`, `nativeTaskLoaded`, `terminalLaunched` and `ideAttached`
remain false. The authenticated editor consumer, effect authorization and exact
terminal/native attachment acknowledgement are still unfinished. A caller must
revalidate the original target at its eventual effect boundary.

Four isolated groups pass 75 checks, including an actual Unix listener whose
original bridge keeps answering after its alias is replaced, while new-editor
target inspection refuses the replacement. Tests restore only their original
alias before verified owned retirement. Provider behavior is controlled; no live
account or actual editor attachment is exercised. [Evidence](evidence/editor-target-preparation-summary.json).

## Authenticated editor metadata consumer

The Linux extension's `StudioTaskClient` reads the private, same-user endpoint file with
no-follow and file/directory identity checks. Its fixed
`/instance/v1/editor-target` request binds the selected workspace, owner and load
to the exact application instance/build, a fresh nonce and timestamp. The server
signs the response containing those same identities and the target observation.
The API bearer is never transmitted, including to a replacement listener.

The instance gateway dispatches only to the existing read-only target route.
Browser-origin requests, effect fields, wrong identities and stale requests are
refused before target inspection. Application stop fences pending and later
metadata replies. The client preserves a copy of the original selection across
asynchronous work, checks the saved endpoint again, strictly validates and
freezes the target, and cancels pending requests on close.

Six isolated groups pass 63 checks, including the actual instance gateway,
authenticated Studio route, protected registry and app lifecycle, with controlled
provider behavior. Typecheck passes. This consumer has no automatic command
registration or terminal effect: editor command wiring, separately authorized
terminal creation and native attachment acknowledgement remain unfinished.
[Consumer evidence](evidence/editor-metadata-client-summary.json).

The read-only installed verifier now checks the exact signed route and V2
calculator source, rejects an unknown target through the editor client, and
calculates synthetic V2/mixed-version metrics using installed modules. It creates
no workspace or provider task and executes no scanner. Its updated argument
refusals pass two isolated tests (13 invalid invocations), receipt
`isolated-test-be1a40ec-36bc-4880-b9a2-ab5c77f98138.json`; installed execution
requires its separate receipt.

Normal installed source `e768d18` now passes six update checks, nine owner/editor/
severity checks and seven existing journal checks. The signed editor check uses
the exact-source repository consumer against the installed server and requires
unknown-owner refusal; it does not attach a task or editor. All 54 workspace
identities, selected state and frozen Home are preserved. Dated launcher backups
verify and temporary packaging is removed. [Installed evidence](evidence/installed-editor-metadata-summary.json).

## Review a terminal launch for one editor instance

Authenticated `/api/suite/coding/codex/editor/review`, `issue` and `consume`
operations bind the original owner/load to an exact request UUID and editor
instance UUID. Review describes the acknowledged task, account and repository.
Issuing consumes that exact confirmation and stores only a hash of a new
30-second permit in encrypted state. The clear permit is delivered once.

Consumption repeats the original account, idle task, socket, repository and
policy checks under the per-task kernel lease, then permanently spends the
permit before returning `terminalLaunchAuthorized: true`. Concurrent or later
retries return metadata with that flag false. Lost replies and drift after
consumption remain spent; expiry and clock reversal refuse. Sixty-four retained
requests bound the history without recycling replay protection. The protected
records are omitted from generic Studio snapshots, and shutdown joins pending
operations.

This is permission for a specific local editor launch, not proof that one
occurred. `terminalLaunched`, `ideAttached`, `modelPromptSubmitted` and
`completionVerified` remain false. The signed extension transport now obtains this grant through the fixed instance
routes. Focused-window and exact-executable checks, one terminal creation and
native task/account acknowledgement still need their end-to-end connection.

Five isolated groups pass 59 tests, including an actual authenticated HTTP
review/issue/consume journey through the protected owner service with a
controlled provider. Typecheck and all child/tree cleanup pass. No live provider
task, model request, terminal or hardware operation is performed.
[Evidence](evidence/editor-authorization-summary.json).

## Signed editor review and authorization consumer

The extension client now exposes `reviewEditor`, `issueEditor` and
`consumeEditor` through three fixed signed instance routes. Each request and
reply binds the original private endpoint, listener/build, nonce and exact
workspace/owner/load/request/editor IDs. The client accepts only the matching
confirmation domain, current permit and closed response schema. It transmits
scoped review tokens and permits inside signed requests; the application bearer
stays local. Stopping the client or changing its endpoint refuses delivery.

The composed software demonstration reaches the real protected backend through
the HTTP gateway, using controlled provider metadata. It covers review, issue,
consume and replay refusal. Closing the client after durable consumption loses
the reply; a fresh client still sees the request spent. No automatic retry can
turn that lost reply into another launch authorization.

Three focused groups pass 39 tests, four regression groups pass 38, and the final
owner cohort passes 25 after adding cancellation coverage. These counts overlap.
Two verifier argument-guard tests, typecheck, extension compilation and compiled
CommonJS method checks also pass. Child/tree cleanup and removal of the exact
generated extension output verify. Actual terminal creation, command wiring and
native attachment acknowledgement remain unfinished.
[Source-specific evidence](evidence/editor-authorization-client-summary.json).

Normal installed source `2c87c03` passes six update, ten owner/editor/severity and
seven journal checks. The new signed routes reject unknown owners without
creating a review, permit or terminal. All 54 identities remain, and 52 sealed
files stay byte-identical across restart. Existing recovery rewrites the two
opened verification workspaces; definitions/package/modes and the historical
pending conversation remain verified separately. Selected bytes stay unchanged
during the metadata checks. Dated launcher backups and exact bundle cleanup
verify. [Installed evidence](evidence/installed-editor-authorization-summary.json).

## One reviewed editor terminal creation

`StudioEditorLauncher` now connects the signed client to one exact VS Code
`createTerminal` call per returned review. It binds the original focused workspace
and admission callback, repository and socket identities, plus an executable
whose SHA-256 matches the original native owner. Every asynchronous authorization
boundary rechecks those local identities. The command uses the original task
UUID and explicit Unix socket with `read-only` / `on-request`; it sends no text.

The local attempt is reserved before awaiting authorization. Concurrent calls,
lost replies, failed creation and later focus failures cannot reuse that review.
If VS Code returns a Terminal object, the launcher retains that exact object even
when activation fails. Shutdown joins pending operations without closing user
terminals. Successful activation reports only object/focus evidence; native
task loading, account acknowledgement, IDE attachment and completion remain
unverified. Command wiring and the native acknowledgement path are unfinished.

Five isolated groups pass 54 tests, composing the real signed HTTP gateway,
encrypted authorization store and kernel leases with controlled provider/editor
doubles. Typecheck, extension build, compiled CommonJS load and exact generated
output cleanup pass. No actual editor terminal or provider task was opened.
[Source-specific evidence](evidence/editor-terminal-launch-summary.json).

The launcher's explicit `focus(review)` method now returns to that retained
Terminal object after reobserving the original idle owner/account/task through
signed transport. It repeats the focused workspace, executable and filesystem
checks. It creates no new confirmation, permit or terminal. Closed objects,
account drift, changed workspace and shutdown refuse; a same-title neighbor
never substitutes. Three groups / 24 tests and compiled extension checks pass
with controlled provider/editor doubles and exact cleanup. This is limited to
the existing idle-owner contract; active-task return, command wiring and native
acknowledgement remain unfinished. [Evidence](evidence/editor-return-summary.json).

## Returning while the original task is active

The later `returnEditorTarget` client operation uses the fixed signed
`/instance/v1/editor-return-target` route. The Suite's `editor/return-target`
route requires all four original owner/load/request/editor UUIDs and a retained
consumed authorization. Under the task lease it rechecks that record, original
target and policy digest, current account, repository and native endpoint. The
owner may report idle or active; unavailable/unknown states still refuse.
Initial review and launch paths remain idle-only.

Returning does not issue or refresh a permit, resume the task or mutate protected
state. The short creation expiry applies to the original launch, so it does not
prevent later return to an existing object. The launcher must still hold the exact
Terminal object and recheck its original focused context and filesystem identity.
A consumed record alone cannot create or recover a terminal object.

Five groups / 60 tests pass, including the real Suite, signed client, encrypted
store and Linux leases with provider/editor doubles. They cover active return,
unchanged state, no additional resume, missing or foreign grants, altered records,
account drift, cancellation, shutdown and same-title terminal refusal. Typecheck,
compiled extension checks and exact generated-output cleanup pass. Command wiring
and native terminal/account/task acknowledgement remain unfinished; these checks
make no IDE attachment claim.
[Source-specific evidence](evidence/editor-active-return-summary.json).

## Observe the retained terminal process

`StudioEditorLauncher.processIdentity(review)` reads only the exact retained
Terminal object's `processId`. It rechecks the consumed editor selection and
current account/task/repository/socket/policy, then compares current-user kernel
process birth and the original opened executable identity twice. Shell wrappers,
PID replacement, exit, missing objects, changed contexts and shutdown refuse.
Missing PID promises have a five-second bound; cancellation joins context reads.
A successful observation retains one process identity for later comparison.

This is historical process evidence only. It does not prove the process opened a
particular connection, received an account or resumed a thread. The result keeps
`nativeTaskLoaded` and `ideAttached` false. A relay with peer credentials and
account/thread acknowledgements from that same terminal connection is unfinished.
The three-group, 38-test cohort uses real owned Node children with provider/editor
doubles, and the compiled extension performs a read-only observation of its own
check process. No actual IDE or native provider task is started.
[Exact evidence](evidence/editor-process-summary.json).

## Match one connection's protocol

The internal `createCodexEditorProtocol` witness requires the original account
fingerprint, thread and repository. It correlates typed request IDs on one stream,
a verified account response before the resume request, the exact first-party
read-only/on-request resume reply, and a new account request/response after that
reply. Requests sent earlier cannot substitute for the final account sample.
Pending account reads withdraw acknowledgement; account changes, native errors,
replay and malformed/bounded-input failures invalidate permanently. Closing a
connection removes live protocol acknowledgement while preserving failure reasons.

The witness retains only request identity/method/ordering metadata. Its safe view
contains fixed flags/reasons, with no raw account, task, repository or message
content. Frame-result booleans describe observations and must not be treated as
permission to forward requests. Unknown unrelated messages are not a grant of
execution authority. Only the declared minimal resume parameter contract is
supported; native TUI compatibility is not established.

Three groups / 33 tests, packaged import and typecheck pass with synthetic frames.
The witness itself opens no transport or provider. Peer-bound relay composition
and final editor acknowledgement remain unfinished; `ideAttached`, kernel peer,
terminal process, authority and completion flags remain false in its result.
[Evidence](evidence/editor-protocol-summary.json).


## Verify the terminal side of the stream

`codex-editor-ingress.py` is an internal Linux carrier. Its parent supplies an
existing private directory identity and an unused socket name. After `ready`,
the parent supplies the exact terminal PID, process birth, executable path and
SHA-256. The carrier accepts one connection and verifies Linux peer credentials
and the opened executable before HTTP upgrade or JSON delivery. It searches no
process tree and never reconnects to another client.

The wire uses bounded [WebSocket framing](https://www.rfc-editor.org/rfc/rfc6455)
with masked client frames, Unicode fragmentation, ping/pong and close handling.
Unsupported negotiation, binary data, duplicate JSON keys and malformed or
oversized messages close the carrier. Parent and peer identity stay checked;
initial setup is bounded to eight seconds. Graceful stop removes only the exact
owned socket. Parent death kills the carrier, leaving the owner responsible for
identity-checked socket cleanup; a replacement name is preserved.

Eleven lifecycle and synthetic wire tests plus five package checks pass. One
wire demonstration feeds exact account/resume messages into the existing
protocol witness. This is not an activated editor attachment: the parent
lifecycle, retained Terminal launch, upstream original-owner transport and native
TUI compatibility remain unfinished. The carrier selects no account or task,
sends no provider prompt and grants no forwarding or completion authority.
[Evidence, including the corrected shutdown failure](evidence/editor-ingress-summary.json).


## Join the carrier's parent lifecycle

`openCodexEditorIngress` requires callbacks for current selection, ownership
recording and bounded messages. It records intent before spawn, the original
child PID/birth before bind, and the socket identity before exposing readiness.
The caller owns the private directory. A peer attempt is spent once, including
failure or cancellation. Each send copies its bytes before asynchronous checks;
aggregate queued bytes and operations are bounded.

`close()` withdraws live readiness and closes input. `stop()` joins the exact
child, pending operations and consumer/ownership callbacks before checking the
original socket name. Process exit and socket cleanup are separate observations.
A replaced name is preserved and retirement stays rejected. No private state or
provider authority is inferred from these lifecycle facts.

Eight parent-lifecycle cases and five package checks pass, including cancellation
during ownership persistence and a connected socket replacement before send.
Production journal and signed editor route composition remain unfinished; those
callbacks use doubles in this cohort. [Evidence](evidence/editor-ingress-owner-summary.json).


The complete `7772cb3` run exposed a teardown race missed by the first focused
cohort. Signal handlers now set a stop flag; bounded I/O polling leaves final
socket retirement uninterrupted. A deterministic signal injected during cleanup,
stop during each startup wait, the carrier/parent lifecycle and package checks
pass together (26 tests). The eight-second startup deadline is unchanged. The
failed full receipt remains failed pending a new full run.
[Correction evidence](evidence/linux-777-complete-failure-summary.json).

## Restrict the editor connection

The internal relay now uses a dedicated connection from the original live owner.
Registration completes before any protocol request; owner stop joins pending
registration and retires that bridge with its other clients. The relay checks
effective restrictions and account identity on that connection, permits one exact
read-only/on-request resume, then checks the account again before retaining and
delivering acknowledgement. Unknown methods, new tasks, turns, account changes
and configuration writes have no forwarding path.

The Linux demonstration uses real ingress and upstream socket carriers, kernel
peer checks, and a synthetic terminal/provider. It verifies the exact resume and
refuses a model-turn attempt, then retires all owned processes and sockets.
Cancellation, changed accounts, unloading, lost replies, bounded queues and
pending callbacks are covered by seven groups / 79 tests.
[Exact source and evidence](evidence/editor-relay-summary.json).

Production journal/routes and retained Terminal activation remain unfinished.
The test retention callback is not the protected production journal. Native TUI
message/capability compatibility is unverified. The later source
[version contract](codex-version-contract.md) admits 0.167.0 after isolated
effective-configuration proof; live TUI compatibility remains open. No actual task attachment
or model request is claimed by this demonstration.

## Retain editor ownership before effects

The journal component now reserves the consumed reviewed selection in the actual
protected store, under a separate kernel lease. Creation must still fall within
the original thirty-second permit window. A lost reply, restarted host, stopped
record or duplicate request cannot obtain a second handle. Checkpoints preserve
the original private directory, upstream process, carrier/socket, exact terminal
peer and historical protocol acknowledgement. Only the retained in-memory handle
can advance that record; caller-supplied protocol messages are never stored.

Cleanup records remain writable after cancellation and distinguish uncertain
retirement from verified process/socket/directory cleanup. Journal metadata does
not establish current IDE attachment. Nine journal cases, ten authorization cases
and five package checks pass with the real encrypted store and kernel leases.
[Exact evidence](evidence/editor-journal-summary.json).

Production composition, signed routes, retained Terminal activation and recovery
after an interrupted host remain unfinished. No native task/account/hardware
operation was performed by these tests.

## Compose the owned connection

The internal connection service now records its intended private directory
before creation, obtains the dedicated client through the original acknowledged
task owner, and joins the journal with the actual ingress and restricted relay.
The acknowledgement is saved in protected state before reaching the synthetic
terminal. Duplicate requests across service instances cannot create another
endpoint. Workspace stop, explicit stop and shutdown join pending work; socket
substitution preserves the foreign entry and leaves retirement uncertain.
Ordinary Studio snapshots omit these private ownership records.

Five complete files pass 57 tests, including seven real Linux lifecycle cases,
the task-owner guard and package import. Typecheck and JavaScript parse checks
pass. An earlier import failure remains recorded.
[Exact evidence](evidence/editor-connections-summary.json).

Signed routes, typed client responses, retained Terminal activation and recovery
after an interrupted host remain unfinished. The provider and terminal in this
demonstration are controlled doubles; native TUI and 0.167.0 compatibility are
unaccepted. No live account, native task, model or keyboard operation ran.

## Recover only the original interrupted connection

Protected ownership now includes the original host PID, process birth, UID and
kernel boot identity. A fresh service cannot adopt a living host or obtain a new
endpoint while an unknown prior reservation remains unfinished. After that host
and its recorded carriers have exited, recovery checks the original protected
record, parent, directory and stale socket before removing those exact names.
It makes no provider/account request and signals no process. Unknown spawn
windows, missing host proof, replacement names and foreign contents stay preserved.

The demonstration abruptly kills an owned synthetic host, observes actual carrier
exit, and recovers its stale socket through a fresh service. Separate tests
preserve substituted and unrelated entries. Terminal disconnect now withdraws
acknowledgement immediately and joins dedicated connection cleanup while leaving
the original task owner alive. Six complete files pass 64 tests, with typecheck,
parse checks, package import and exact test cleanup. The earlier ESRCH fixture
failure is retained. [Evidence](evidence/editor-recovery-summary.json).

Signed routes, typed client responses and retained Terminal activation remain
unfinished. Native TUI and installed 0.167.0 compatibility are unaccepted. These
controlled demonstrations do not exercise live accounts, tasks, models or hardware.

## Use signed connection operations

The instance gateway now exposes closed, individually signed open, peer-pin,
observe, stop and recover requests. Each binds the reviewed editor selection to
the exact application build, process and nonce. Replies are checked by the typed
VS Code client; socket endpoints appear only on a fresh successful open. Duplicate
or historical retirement metadata cannot be interpreted as a current connection.
Requests carry no browser bearer, prompt, command or automatic retry.

Suite constructs the Linux lifecycle lazily with an existing private runtime root.
Workspace changes, keyboard-only mode and shutdown join editor retirement before
stopping original task owners. Uncertain exit blocks workspace selection, reports
keyboard-only refusal after saving that mode, and still attempts owner shutdown.

Seven complete groups pass 96 tests, including an actual signed HTTP → protected
journal → Linux ingress/upstream demonstration with synthetic terminal/provider
messages. Typecheck, compiled extension and CommonJS client checks pass; all exact
test and build cleanup verifies. A test that sampled acknowledgement before the
final current-state recheck is retained as failed evidence; bounded observation now
waits for the actual acknowledgement without changing production ordering.
[Evidence](evidence/editor-routing-summary.json).

Retained Terminal composition, command activation and native TUI/0.167.0 validation
remain unfinished or unaccepted. No real account, task, model or hardware action ran.

## Compose the retained Terminal with the restricted connection

After durable permission consumption, the launcher opens the dedicated restricted
endpoint and checks its exact socket identity. It creates one Terminal with the
original task arguments, observes that object's exact PID, birth and native image,
then pins the peer and waits for signed protocol acknowledgement within a bound.
Returning to the retained object rechecks both the original target and connection.
The observation records that acknowledgement was observed; it grants no current
IDE, model-turn or completion authority.

Lost replies, changed ingress, failed pinning and partial creation remain spent.
The launcher attempts exact connection retirement while retaining any returned
Terminal object. An owned terminal-close event withdraws acknowledgement and joins
one retirement. Shutdown cancels pending HTTP requests without first disabling
cleanup, joins work, retires connections and reports uncertain exit. It does not
dispose unrelated or neighboring Terminal objects.

Six groups / 46 tests pass. The end-to-end demonstration uses a real owned Node
terminal double, signed client and HTTP gateway, real protected store, kernel
leases, ingress and dedicated upstream. One exact synthetic resume is acknowledged;
a second launch is refused, retained focus is rechecked, and shutdown verifies
retirement while leaving the original provider alive. Typecheck, extension build,
twelve CommonJS method checks and exact test/build cleanup pass.
[Source-specific evidence](evidence/editor-terminal-connection-summary.json).

Production command activation is now connected through the
[editor task controls](editor-task-controls.md); see [current status](switchyard-status.md)
for installed and native terminal evidence. Actual graphical activation remains open.
Native Codex TUI behavior and installed 0.167.0 compatibility are unaccepted; no
real provider account, native task, model or keyboard action ran.

## Join a terminal that has already disconnected

Carrier cleanup can finish before the editor's close notification arrives. Exact
stop now returns the protected verified retirement record after its live handle
is gone. It makes no provider request, changes no journal data and grants no new
handle. An unknown, uncertain or differently bound request still refuses.

Five groups / 39 tests include ending the actual synthetic terminal process,
independently observing backend retirement, then successfully closing the retained
launcher. Duplicate exact stop stays immutable and another editor UUID refuses.
[Evidence](evidence/editor-retired-stop-summary.json). This correction is later
than the accepted 255-group complete Linux routing run.


## Verify the Windows editor target

The same target route now supports a closed Windows stdio binding: original Job
scope, worker PID, raw FILETIME birth and executable SHA-256. This is metadata,
not a socket endpoint, bearer token or permission to start another process.
Guardian identity retains its separate .NET tick convention.

Before returning that binding, the original owner invokes the read-only native
process probe with its retained executable path, file identity, size and digest.
The probe verifies the live process, held image, current user/session and unchanged
QUERY mask 8, and independently retires its helper. Concurrent inspections join
the same original query. Failed inspection closes admission; whole-owner shutdown
joins inspection and attempts both query-helper and original Job retirement even
if one fails.

The protected registry checks the acknowledged load, original task/account,
repository identity and current policy before and after this inspection and the
metadata read. New editor preparation requires an idle task; return observation
can also report an active task. Changed, missing or foreign coordinates refuse.
Logical editor registration rechecks this target before returning the client and
at later protocol boundaries. Preparing it submits no resume, prompt or terminal
launch.

Thirty-three focused groups pass **104 tests with two declared platform skips**,
plus typecheck. These include the real encrypted registry/kernel leases and
explicit provider/process-query doubles, original-load refusal, changed native
birth, concurrent/held inspection and independent retirement. The new unknown
helper case first exposed an expected-refusal handling error in test teardown;
its original bounded failure is retained and the corrected group passes. No
production retirement bound or success condition was relaxed.

The native fixture is extended to use actual Windows process reinspection and
protected registry target/client composition with a synthetic app server; this
now passes at `2d1cc65`: fifteen native client groups, 159 tests and no skips.
Exact source/merge tree, artifact, commands, bounds and cleanup verify.
[Native target evidence](evidence/windows-editor-target-native-summary.json).
[Target source evidence](evidence/windows-editor-target-source-summary.json),
[native channel evidence](evidence/retained-editor-client-native-summary.json).

## Workspace lifecycle for reviewed editor launches

Linux and Windows reviews retain the exact local VS Code workspace folder and
its change generation. Removing and reopening the same path requires a new
review. Replaced, ambiguous or remote folders cannot inherit the old permission.
The launcher checks that context across target inspection, image readback, signed
review, permission consumption, carrier opening, focus and process observation.

Project departure clears focus/acknowledgement observations and retires only the
original carrier. The exact terminal object and provider remain owned by their
existing lifecycles. Shutdown closes new work, aborts pending process observation,
then joins the original bounded signed exchanges before closing the transport.
An uncertain retirement remains a failure and cannot authorize a replacement.

The Linux correction passes 123 tests across eleven groups and both TypeScript
checks. Two composed cases use actual Linux sockets/processes and encrypted Suite
state with explicit Terminal/provider doubles. Windows has separate native client
acceptance. Guided project selection, command activation and interactive native
provider/TUI behavior remain unfinished.
[Linux evidence](evidence/linux-editor-project-context-summary.json),
[Windows evidence](evidence/windows-editor-project-context-native-summary.json).
