# Keep a command with its original role binding

**Try connected control** now sends workflow content only for an explicit
handoff. Previously the frontend included an empty message for every action,
causing an otherwise valid app-homepage launch to refuse. The complete frontend
journey now saves a homepage connection, cancels one action review, and sends
one confirmed request through the real launch service with a synthetic portal.

Reviewed frontend dispatch also uses the active and persisted workspace generation
already used by physical shortcuts. A workspace change, round trip, independent
same-name selection or shutdown before enqueue refuses the original request.
An already queued command remains with its original authenticated session; a late
result cannot be attributed to the new workspace. An explicitly unselected
workspace refuses before initialization or provider work.

Nine regression cases reproduce the original failures. The final sixteen groups
pass **237 tests and one declared Windows skip**, preserving original commands,
bounds and child cleanup. HTTP, encrypted storage and selection witnesses are
real; external agents and the native portal are fixtures. The three role files
are included in the original bounded Windows client lane. Visual and native
Windows follow-up remain separate.
[Evidence](evidence/reviewed-role-dispatch-source-summary.json).

Reassigning a workflow role invalidates a custom-agent request that has not yet
entered the queue. The enqueue transaction checks the exact binding and role
definition under the same state lease as the command write. Changing the target,
removing or editing the role, or deliberately rebinding it to the same agent all
invalidate the earlier request. Each new binding receives a fresh local identity;
existing bindings remain usable until deliberately replaced.

A command that was already queued stays with its original authenticated session.
If the role changes before the result is recorded, dispatch reports uncertainty
and does not attribute that result to the replacement role. It does not cancel,
redirect or automatically repeat the original command. Inspect that agent's
command record before issuing another deliberate request.

Seven regression and demonstration cases use encrypted temporary workspaces and
authenticated agent messages. They cover four changes before enqueue, a change
after enqueue, one-time polling and acknowledgement by the replacement session,
and legacy compatibility. Five cases reproduced the original bug. The corrected
six-group check passes 88 tests with one declared Windows-only skip; both
TypeScript checks pass. Original process bounds and cleanup verify.
[Source evidence](evidence/role-dispatch-binding-source-summary.json).

A physical shortcut also captures the active workspace's selection generation.
Starting a departure invalidates the request even if the departure fails or the
user returns to the same workspace. The custom-agent enqueue checks the saved
selection and the active generation under its state lease; shutdown refuses the
pending command. The existing native-focus and fixed-client-launch callbacks
receive the same workspace guard. A fresh request after deliberately returning
works normally. Commands already queued keep their original session.

Five additional cases reproduced the earlier workspace race. The expanded check
passes seven groups, 106 tests and one declared platform skip, with both
TypeScript checks. It includes authenticated HTTP native-focus doubles, round-trip
workspace changes and a failed departure. The local generation belongs to the running Suite; persisted
selection identity now supplies the additional cross-instance check below.
[Workspace lifecycle evidence](evidence/physical-workspace-lifecycle-source-summary.json).

Claude's exact interactive-task focus now carries the same role and workspace
guard through session verification, final process/window observation and native
navigation. The tmux path checks it after validating the socket and before
switching panes. If authorization changes after pane selection, compositor focus
is refused; the original pane action is not automatically reversed or repeated.
Three regressions reproduced the earlier focus effects after a role/workspace
change. Ten focused groups pass 141 tests and one declared platform skip, plus
both TypeScript checks. Process, provider, window and tmux observations are
explicit doubles. [Claude focus evidence](evidence/claude-focus-role-boundary-source-summary.json).

Legacy owned Codex coding-task resume now checks the same role/workspace guard
after observing the exact task and again after transport initialization, just
before sending the command. An authorization check that settles after the
original deadline or disconnection cannot send. A pending acknowledgement cannot
be shared with a different binding; ordinary requests with the same authority
still share one pending result. The original exact thread, repository and
read-only permission checks remain. As the [official app-server contract](https://learn.chatgpt.com/docs/app-server)
describes, reopening a thread and starting a model turn are separate operations;
this path adds no model prompt.

Three regressions reproduced stale resume effects and a missing transport guard.
The corrected thirteen-group check passes 167 tests and one platform skip, with
both TypeScript checks. Its real Unix socket/WebSocket fixture uses a synthetic
daemon and verifies refusal, timeout, late authorization and successful resume.
[Codex resume evidence](evidence/codex-task-resume-role-boundary-source-summary.json).

Configuration conversations now carry the guard through resume and cancellation,
Codex thread/turn submission, Claude guardian readiness and Microsoft request
delivery. Reply storage checks the original binding under the encrypted state
lease. A stale reply cannot become the replacement role's proposal or history.
Microsoft delivery already attempted remains `outcome-unconfirmed`, with no
automatic retry or claim that a remote request was cancelled.

Five conversation regressions and three Microsoft regressions reproduced the
earlier behavior. Eighteen focused groups pass 226 tests and one platform skip,
with both TypeScript checks. Eleven final conversation cases also verify the
retained delivery journal. Claude fixtures use bounded Node children; all native
providers, accounts and model responses are synthetic. Initial fixture mistakes
and the existing submission-error wrapper are classified separately from the
product regressions in the [conversation evidence](evidence/conversation-role-boundaries-source-summary.json).

These checks do not undo effects that happened before a role changed. Original
commands, uncertain delivery records and owned-process cleanup stay intact.
Windows task-window focus remains unsupported. No live account, model, installed
agent, keyboard or frontend operation was used for this verification. The full
suite and real provider/tenant/hardware acceptance remain separate.

Normal installed Linux `08fa7ea` includes these corrections. It passes 86
metadata/refusal checks against 54 exact module hashes, including in-memory
original-workspace and leased-role refusal followed by a valid synthetic enqueue.
All 54 semantic workspaces, four profiles, 57 workflows, selection and the pending
keyboard-only conversation are preserved. The dated launcher backup and readback
verify; the 553-file temporary package is removed, leaving current plus one
rollback. This installed check makes no live provider, model, native focus or
keyboard request. [Installed evidence](evidence/installed-role-boundaries-summary.json).

Each deliberate saved workspace selection now receives a fresh generation,
including a same-name selection by another store/instance. Physical dispatch
captures the complete persisted selection digest, so an intervening committed
round trip cannot revive the old request. Legacy and absent selection records
remain read-only until a deliberate selection; ordinary callers still receive
the selected name. A queued original command stays intact, while stale result
attribution is refused. A fresh request uses the final saved identity normally.

Two cases reproduced the earlier bug. Seven focused groups pass 111 tests and
one declared platform skip, plus both TypeScript checks. Independent stores share
real temporary encrypted files; agent messages are authenticated fixtures. This
is change detection at existing boundaries, not a global selection lease across
native effects. Manual restoration of byte-identical old selection files remains
outside it. This correction is source-only after installed `384cf8b`.
[Persisted selection evidence](evidence/persisted-selection-source-summary.json).


## Choose a saved connection by name

The authenticated `/api/suite/roles/choices` route accepts a saved `roleId`
and stable `intent`. The Suite chooses its active workspace; callers cannot
substitute a compartment. In companion mode it returns readable labels and local
connection IDs for compatible coding tasks, configuration conversations, custom
agents and documented homepage surfaces. Existing policy and action checks filter
the list. Keyboard-only mode refuses; Copilot-only Work cannot offer personal
providers. Stale custom agents and unsupported actions are omitted.

Each row contains `provider`, `targetKind`, `targetId`, `label` and
`choiceDigest`. Send the selection fields, without the display label, along
with the original role/intent to `/api/suite/roles/bind-choice`. That route
rechecks the saved state under its ordinary state lease before saving the local
binding. It returns only the local binding identity and selection metadata.

The digest detects changes to the role, policy, enrolled accounts, original
session, capabilities, previous role binding or workspace-selection generation.
It is a concurrency check, not an approval token. A heartbeat alone does not
invalidate the choice; fresh capability/status checks still run before saving.
Changed or replayed choices refuse without overwriting the replacement binding.

Both results report `nativeObserved:false` and `authorityGranted:false`.
No native session IDs, account fingerprints, credentials, prompts or reply text
are returned. Listing writes nothing; binding changes only local configuration
and never dispatches an agent command. Actual dispatch still performs its
existing account/session/policy checks and action-specific reviews.

Seven groups pass 101 tests with one declared platform skip, plus both TypeScript
checks. The demonstration uses real encrypted storage and authenticated HTTP with
explicit synthetic agent sessions. The guided frontend now uses this contract with named choices and separate save/dispatch reviews. Live account/task and visual browser acceptance remain unfinished. See [guided setup](guided-setup.md).
[Source evidence](evidence/role-choices-source-summary.json).
