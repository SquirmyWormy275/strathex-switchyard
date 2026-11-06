# Preserve the original coding-task owner

The explicit Linux `createCodingTaskOwners` service holds an owned native
connection for one registered Codex task. Its protected record binds the original
thread, account fingerprint, repository directory and native listener. It does
not create a thread, submit a prompt, attach an IDE, or grant task authority.
Opening and reading observe metadata only. Loading an existing idle task requires
a separate exact review and one-use confirmation.
Studio now exposes separate owned-connection routes. Existing task creation and
reviewed-text APIs retain their stdio behavior; frontend and IDE handoff are unfinished.

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
