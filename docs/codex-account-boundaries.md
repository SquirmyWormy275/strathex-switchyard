# Keep native Codex requests on their reviewed account

An owned Codex connection now treats documented account-change notifications as
an irreversible boundary for that connection. `account/updated` or a successful
or unconfirmed `account/login/completed` closes a pinned client, rejects its
pending requests and preserves unfinished request identities. Restoring the old
fingerprint cannot revive that connection or accept its late reply. These events
are distinct from rate-limit updates and a known cancelled login.
[Native authentication events](https://learn.chatgpt.com/docs/app-server#authentication-modes).

Initialization can make at most one additional read-only account read when an
initial auth event arrives during enrollment. It never retries a model turn,
thread creation or login. Later account reads revalidate the original connection
pin; a different or unavailable account closes the connection instead of silently
rebasing it. A metadata response followed by an auth notification is rejected,
and a partially acknowledged creation keeps its returned native ID.

Restricted turns also fence global auth notifications while waiting for a reply
or final account check. Immediately before the encrypted reply mutation, the
adapter rechecks its connection/epoch. Failure keeps the original turn ID and an
uncertain outcome with no retained reply or replacement submission. The existing
separate outcome-review and one-use approval rules remain in force.

Controlled stdio child processes and encrypted-state tests cover notification
ordering, restored fingerprints, failed initial enrollment, partial creation,
unchanged-account rate updates, failed login and the completion-to-persistence
gap. A final consolidated run passes seven focused and broader Suite/binding/design/
package groups with 78 checks and child cleanup; typecheck passes. The real
installed CLI 0.166.0 also verifies its current login and bounded inventory, then
exits 31 ms after its exact disposable owner is killed. That source compatibility
check creates no thread, submits no model prompt and changes no login.

This implements fences for the documented native notifications plus existing
account rechecks. A live controlled account-switch acceptance journey is still
open; the tests do not log the user out or claim coverage of every external
credential-store mutation. Native Windows and wider IDE/account integration
remain separate acceptance work.
[Exact receipts and source hashes](evidence/codex-account-boundary-summary.json).

The configuration designer shares the same final synchronous fence inside its
encrypted conversation mutation. Tests invalidate the connection after the final
account read, while storage admission is pending, with either a closed connection
or a changed epoch and the original fingerprint. Both retain the user's draft and
native session identity, save no late assistant reply and issue no replacement
model request. The seven-group follow-up passes 80 checks, including designer,
reviewed text, Claude/binding compatibility, packaging and runner CLI checks.
[Follow-up receipt and source hashes](evidence/codex-design-account-boundary-summary.json).

The earlier `6d298cfd` connection-fence source was also installed normally: six
update and seven private metadata checks passed, preserving all 54 workspaces,
selected sealed state and the frozen frontend. Its owned bundle and checkout were
removed. This metadata-only update does not establish live account-switch or
native designer-race acceptance.
[Installed update evidence](evidence/installed-account-fence-update-summary.json).

The final designer-fence source `60e87943` subsequently passed the same normal
installed six update/seven metadata checks. All 54 workspaces, selected sealed
state and frontend were preserved; its disposable checkout and bundle were
removed. The linked installed evidence records both source-specific updates.
