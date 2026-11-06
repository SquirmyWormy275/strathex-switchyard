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

The tests use synthetic credentials and isolated workspaces. Installed acceptance,
native Windows execution and frontend controls remain separate; the frontend is
still frozen. This is authorization retirement, not deletion of unresolved history.
