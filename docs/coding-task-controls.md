# Connect a coding task and review text

Open **Your tools → Coding tasks and reviewed text**. These conversations concern
your project; [Design together](saved-conversation-controls.md) configures your
keyboard. Saved task selection reads only this workspace's protected metadata.

1. Choose Codex or Claude Code. Under **Create or connect a task**, name it and
   enter its exact Git project directory. Review the proposed connection.
2. Confirm creation. Codex creates one empty native thread and verifies its creator
   exited. Claude reserves an account/directory-bound UUID locally; it does not
   yet create a native conversation or worker. Neither sends a model prompt.
3. Select the saved task and write a message. **Review exact text and destination**
   checks the current native account, version, task and directory identity. Read
   the exact text, session, account fingerprint, restrictions and expiry.
4. **Send this reviewed text** consumes that one-use review with a stable request
   UUID. Inspect the retained reply and native acknowledgement. The provider's
   completed reply does not verify the coding task's completion.

Connecting an existing native session requires its exact ID. The backend checks
that identity and project; no title or most-recent task is guessed. Existing
sessions retain their original runtime. That connection does not make them
eligible for dedicated-text submission or attach a terminal.

## Cancel and recover deliberately

**Cancel exact owned turn** remains available during submission and names the
original request. Its result reports whether the owned connection stopped;
earlier effects are not reversed. No other session is cancelled.

A missing creation or text reply preserves the request identity. Refresh saved
tasks and replies to inspect the durable result. No request is automatically
replayed. Uncertain turns block another text submission. **Review uncertain
outcome** records that you inspected the uncertainty; it does not retry the turn
or verify external completion. Local outcome review remains available in
keyboard-only mode, with provider operations disabled.

If Claude's first conversation creation is uncertain, review that outcome before
choosing **Recover an uncertain first Claude conversation · resume only**.
Review fresh text and confirm separately. The backend uses only the original
requested UUID; unavailable native history cannot trigger a replacement or fork.
The exact requested session remains unverified until its native reply verifies.

Completed or deliberately resolved local text records can be separately reviewed
for deletion. Pending uncertainty and unverified owned-runtime exit refuse
deletion. The native provider's history and the saved task remain unchanged.

Workspace, provider and input changes invalidate reviews. Late results cannot
populate another workspace. Text is limited to 12,000 UTF-8 bytes. Submission
uses the designer's existing 130-second browser response wait for the backend's
120-second native turn contract; metadata requests retain their 15-second wait.
No test or native deadline was enlarged.

## Evidence and remaining work

Eleven interaction cases use real authenticated HTTP, encrypted state, directory
identity, creation/binding services and durable one-use text reviews. Native
account/task transports are explicit doubles. Eight original groups pass 102
tests, including production Codex/Claude adapter suites; six final groups pass
65 with overlap and zero skips. Eleven running-preview checks verify served
controls, synthetic history and refusals. [Exact source and receipts](evidence/task-ui-source-summary.json).

These controls do not launch or stop Claude background sessions or attach an
interactive terminal. Those remain distinct implementation/acceptance work.
Live account/model/task operations, visual browser review and full latest-source
Linux/Windows acceptance are unverified. [Backend contracts](native-coding-tasks.md),
[editor controls](editor-task-controls.md), [current status](switchyard-status.md).
