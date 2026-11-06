# Revoke and replace a custom agent

An enrolled custom agent can poll reviewed commands until its authorization is
revoked. Switchyard now provides a deliberate backend path to retire that access
without deleting command history or claiming that external work stopped.

Use the existing authenticated, same-origin Suite API:

1. `POST /api/suite/agents/revoke/review` with `{ "agentId": "my-agent" }`.
   Review its exact session, queued/claimed counts and number of role bindings.
2. `POST /api/suite/agents/revoke` with that `agentId` and the returned
   `confirmation.token`. The five-minute token is one-use and binds the current
   enrollment, capabilities, session, command states, workspace policy and roles.
3. To replace it, deliberately call the existing `agents/enroll` endpoint with
   the same ID, name and selected capabilities. Distribute the newly returned
   credential to the intended adapter, wait for authenticated readiness, then
   bind its roles again. There is no automatic reenrollment.

Revocation persists in the encrypted workspace. It removes only that agent's
role bindings, marks unclaimed commands cancelled locally and keeps claimed
commands uncertain. The existing credential remains in its bounded OS-store
slot but cannot authenticate new messages. Replacement overwrites that same
slot with a fresh credential and assigns a new enrollment generation. History
and unresolved claims stay present and count toward the existing limits.

Authentication and sequence acceptance now share the locked state transaction.
A credential read cannot race past revocation and be accepted under a replacement.
Command claims and role dispatch also bind the enrollment generation. Reusing
an agent ID or session string cannot revive an old role or let the new credential
acknowledge an old claim. Existing v2 SDK messages remain unchanged; older
enrollments retain their legacy generation until deliberately revoked.

If a bundled example is owned by this Suite process, the route joins its exact
child retirement and returns separate `ownedExample` evidence. An uncertain stop
still blocks a replacement process. A failed stop-journal write does not hide the
already durable `revoked` result. `externalProcessStopped: false` remains explicit:
revoking authorization cannot establish that an independently owned external
agent or a previously claimed task stopped.

Failed state persistence does not promote a replacement. If its credential write
succeeded first, the existing revoked state continues to reject both old and new
credentials; a fresh deliberate enrollment can retry using the same slot. A
consumed revocation token is not reused after a failed state commit: review again.
Changing claims, roles or enrollment invalidates an earlier review. Work policy
and keyboard-only restrictions remain in force.

Eight isolated groups pass 86 checks, including seven encrypted-state revocation
cases and two Suite cases. The actual authenticated HTTP demonstration launches,
revokes and confirms exit of one bundled Node agent, rejects automatic restart,
then explicitly reenrolls, rebinds and retires its replacement. It also refuses
a stale role even when its session string matches the replacement. Fault checks
preserve durable revocation after uncertain exit or an unavailable stop journal.
Typecheck, original package bounds and owned cleanup pass.
[Source evidence](evidence/custom-agent-revocation-source-summary.json).

The tests use synthetic credentials and isolated workspaces. Normal installed
`b3ce0a9` additionally passes seven pure in-memory credential/revocation checks
inside its 27-check metadata update, with six exact tested module hashes and all
54 workspaces preserved. No live agent is revoked or started by that update.
[Installed evidence](evidence/installed-agent-security-summary.json).
Live installed revocation, native Windows execution and frontend controls remain
separate; the frontend is still frozen. This is authorization retirement, not
deletion of unresolved history.

## Review an uncertain claim

When a session is replaced or its authorization revoked, a previously claimed
command remains `uncertain-session-ended`. It cannot be retried automatically
or acknowledged by a replacement credential. To record a deliberate review:

1. `POST /api/suite/agents/outcome/review` with the exact `agentId` and `commandId`.
   The response contains its original intent, session, timing and retained handoff
   text, plus a one-use confirmation. Only uncertain claims from retired sessions
   are eligible; queued, active and acknowledged commands refuse.
2. `POST /api/suite/agents/outcome/resolve` with those IDs and the returned token.
   The saved status becomes `reviewed-unconfirmed`, with an explicit review time
   and `externalOutcomeVerified: false`. No provider command is sent.

This acknowledgement of uncertainty does not declare completion, failure or
cancellation. A reviewed record becomes eligible for the existing 64-command
history retention when a later, separately requested command needs capacity.
Other unresolved records remain intact. The review explicitly describes this
retention consequence; no replacement action is automatically queued.

The token binds the exact command contents and current enrollment/policy. A late
authenticated acknowledgement before consumption or before final persistence wins
over stale review. Reenrollment, expiry, wrong-scope tokens and replay refuse. A
failed state write preserves the original claim and observation events and requires
a fresh review. If recording is explicitly enabled for agent events, a fixed
`adapter-command-outcome-reviewed` event records local provenance and `unknown`
status without raw command identity or handoff text.

Five new recovery cases and the existing integration/package contracts pass
in eight groups/91 checks, including actual owner-authenticated HTTP, both late-ack
races, failed persistence and the full history limit. The first test attempt had
two incomplete synthetic recording timestamps; those fixtures were corrected
without changing retention rules or deadlines. Typecheck, complete package bounds
and exact owned cleanup pass. Installed recovery and native Windows acceptance
remain separate. [Recovery evidence](evidence/custom-agent-outcome-source-summary.json).
