# Exact Codex tasks

Switchyard binds one native Codex session to a local task label, first-party
login and exact repository directory. Keyboard configuration conversations use
separate identities. A window title, process argument or recent chat is not an
exact coding-task binding.

For the complete text-review and recovery sequence, start with the
[native coding task walkthrough](native-coding-tasks.md).

## Current implementation

The default metadata adapter on Linux and Windows uses an owned private native
stdio connection with the reviewed **Codex 0.166.0** contract. It checks the
native version, effective restrictions and existing first-party account before
use. It does not configure an API key or redirect to another provider.

New tasks use a separate restricted creator. Its exact direct child must exit
before registration, releasing the native writer for later reviewed text. An
uncertain creator exit preserves the returned identity and prevents a new
creator from replacing it. The metadata connection never owns that writer.

| Operation | Behavior |
| --- | --- |
| Discovery/list | Installed native CLI and metadata; no thread history or model prompt. |
| Bind | Exact native session/root/login, with authenticated compartment ownership. External tasks remain observation-only. |
| Create | One empty read-only task per stable request UUID; retains partial native identities rather than relaunching. |
| Status | Refreshes the exact binding. Idle/not-loaded is not verified task completion. |
| Reviewed text | Dedicated tasks only. Exact account/root/text approval, private restricted turn, acknowledgement retention and durable duplicate prevention. |
| Cancel/outcome review | Stops the owned connection and preserves uncertainty for deliberate review; never guesses a missing turn ID or retries automatically. |
| Legacy runtime resume | Separate read-only route for older owned daemon tasks. Its own native account is checked. It does not focus a terminal or submit a prompt. |

Dedicated tasks advertise readiness for text review, not an attached native
client. The app does not displace an existing daemon/TUI writer. A native check
confirmed that unsubscribing alone does not release that writer. General exact
interactive attachment remains implementation work.

## Trust and policy

The adapter disables 34 explicit feature paths, all discovered MCP servers and
automatic project-document loading. Generated MCP entries receive complete,
explicitly disabled transports so native parsing cannot turn a partial override
into an enabled tool. Restrictions are read back for the repository before and
after continuation; ignored or unsupported configuration fields are not treated
as controls. The native read-only sandbox remains enforced. Saved native thread
context can be used by the model. This route grants no execution authority.

A saved task records the native directory device/inode identity. Replacing a
directory at the same pathname cannot inherit its task. An older binding without
that identity requires explicit binding again. Known directory or account
identities cannot be silently overwritten.

Session ownership is authenticated and compartment scoped. Work policy rejects
Codex; keyboard-only mode prevents provider effects and fences delayed startup.
Mode shutdown closes only owned connections. Independent process-tree mediation,
verified task completion and employer approval are not inferred from these checks.

## Evidence

The normal installed Linux application passed an actual reviewed text journey:
create an exact empty task, review one tiny prompt, obtain `Ready` with its exact
native turn ID, reuse the saved result on duplicate submission, reject consumed
and unauthenticated approvals, then restore keyboard-only mode and remove the
synthetic local records/directory. Source checkpoint **201a942**; private receipt
`installed-reviewed-codex-text-1793377263795.json`. The native CLI retains its
small synthetic history entry; Personal definitions and active selection were
preserved. This is a provider-turn check, not coding-task completion.

The restricted native configuration/ephemeral-turn and metadata-only parent-loss
checks also passed. Actual native exit after SIGKILL was **31 ms**. The complete
source suite passed 115 Linux groups (817 tests: 808 passed, 9 expected platform
skips) at that checkpoint. Windows framing/policy/lifecycle paths are
software-tested; actual Windows native-account/window acceptance remains open.
See the [current evidence](switchyard-status.md) for exact revisions and receipts.

```sh
mise exec node@24.14.0 -- node scripts/verify-codex-stdio-host.mjs --read-only
mise exec node@24.14.0 -- node scripts/verify-codex-submission-host.mjs --synthetic
```

The first command creates no thread and sends no model prompt. The second creates
one disposable local task and deliberately submits one tiny native prompt through
the normally installed app. Both require an already permitted Personal account.
No foreground typing or keyboard firmware operation is used.
