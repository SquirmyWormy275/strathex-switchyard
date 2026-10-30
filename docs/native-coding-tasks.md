# Native coding tasks

Switchyard keeps coding tasks separate from the conversations that design a
keyboard. A task identifies one native provider session, its local account and
its repository. Selecting a window or observing an idle process does not prove
that work resumed or completed.

The current Codex backend supports a deliberately reviewed text turn on an exact
registered read-only task created by Switchyard. It uses installed Codex 0.166.0
and its existing first-party login. It does not configure an API key or choose a
fallback account. File changes and command execution are outside this route.
Saved native conversation context can be used by the model.

The task controls below are backend APIs. The frontend is frozen for review;
these new controls are not yet exposed there. Claude text tasks use the same protected review lifecycle;
first-turn creation and continuation have separate native contracts and their
installed acceptance passed native creation and continuation with two synthetic
text turns; interactive client attachment remains separate. General interactive attachment and broader execution-authority mediation remain
unfinished. Claude configuration-design continuation is a separate working path.

## Follow one task

1. Create an empty task with `coding/codex/create`, using a stable request UUID,
   a short local label and the exact Git working directory. Creation does not
   send a model prompt. A dedicated creator must verify exit before registration,
   releasing the native writer for a later reviewed turn. Existing daemon/terminal
   bindings remain with their original runtimes and cannot receive text here.
2. Review text with `coding/codex/turns/review`. Read its exact session, account
   fingerprint, directory identity and text. An older task without directory
   identity needs explicit binding again before this review.
3. After approving that scope, call `coding/codex/turns/submit` with the same
   `taskId` and `text`, a new stable `requestId` UUID and the returned one-use
   token. The token expires after five minutes. Changed text, account enrollment,
   login, repository identity or policy invalidates the scope.
4. Inspect `coding/codex/turns/list`. `provider-turn-completed` reports the native
   turn's response; `taskCompletionVerified` remains false. Repeating a retained
   request UUID returns the saved result without another submission.

Dedicated tasks are labelled ready for text review rather than resumable in an
attached client. A status check or a private runtime acknowledgement is not a
terminal/window attachment. Older daemon-bound tasks keep their separate legacy
read-only resume route; the app does not displace an existing native writer.

All paths are POST routes beneath `/api/suite/` on the authenticated private
loopback origin. Supply the selected `compartment` explicitly. Work policy rejects
Codex; keyboard-only mode prevents provider effects. Keep the private bearer token
out of scripts committed to Git, shell history and shared logs.

## Stop and recover

`coding/codex/turns/cancel` takes the exact `requestId`. It interrupts an
acknowledged turn or closes the owned connection before acknowledgement, without
guessing a native turn ID. Keyboard-only selection stops this workspace's owned
connections and fences delayed startup. Direct-child exit does not attest to a
general process tree or reverse effects already performed elsewhere.

An interrupted connection, missing acknowledgement or changed account leaves an
`outcome-unconfirmed` record. Switchyard retains the original request and any
returned turn ID. It blocks another text turn for that task until the outcome is
deliberately reviewed through `coding/codex/turns/outcome/review` and
`coding/codex/turns/outcome/resolve`. Resolution records acknowledgement of the
uncertainty; it does not retry, cancel external work or verify completion. A later
submission still requires fresh review, account/root checks and an idle native
task. An unconfirmed owned process exit blocks replacement independently.

`coding/codex/turns/delete` removes a completed, failed-before-turn or deliberately
resolved local record by `id`. Pending uncertainty cannot be silently deleted.
Protected local text history is bounded to 32 records. Completed content follows
workspace retention; unresolved identities are preserved for recovery. This does
not delete the installed provider's own native conversation history.

## Verify the installed path

After packaging and updating the normal application:

```sh
mise exec node@24.14.0 -- node scripts/verify-codex-submission-host.mjs --synthetic
```

The script creates a dedicated temporary Git directory, reviews and submits one
tiny prompt through the normal API, verifies its exact reply/acknowledgement and
duplicate/replay behavior, then restores keyboard-only mode and removes its
synthetic local records and staging. An uncertain outcome retains recovery data.
It never claims external task completion or physical-key acceptance. See the
[evidence and remaining work](switchyard-status.md) and
[full requirement ledger](switchyard-requirements.md).


## Create and continue a Claude text task

Claude Code uses its separate `coding/claude/turns/` routes with the same
`review`, `submit`, `list`, `cancel`, `outcome/review`, `outcome/resolve` and `delete`
operations. The reviewed native version is 2.1.308. Use `coding/claude/text/create` with a stable request UUID, exact Git directory
and local label. This reserves an account/directory-bound task and requested
session UUID locally. It explicitly returns `nativeConversationCreated: false`,
`nativeIdentityVerified: false` and `capabilities.sessionIdentifiable: false`; no
native conversation, background worker or model prompt is created yet.

The first reviewed turn uses `--session-id` with that requested UUID. Only an
exact successful native reply marks the task
`nativeIdentityVerified: true`; later turns use `--resume` with the same UUID. An
interrupted or rejected first creation retains its requested identity and blocks
another creation, including after restart or local outcome review. It never
falls back from resume to creation or forks the conversation.

The older `coding/claude/create` still creates an empty native background job.
A background job stopped before its first turn has no saved conversation to
resume. Its identity is preserved; it is not converted into a new print task.
An existing owned background conversation must first be stopped through
`coding/claude/stop/review` and `coding/claude/stop`. Live, waiting and externally
bound clients cannot receive text through this path.

Each review/submission checks native auth and inventory. Print continuation uses
safe mode, no tools/MCP/hooks/Chrome, plan mode and denied permission prompts.
The returned native UUID must match, with a successful bounded result and no
permission denials. Its provider envelope verifies the session; this contract has
no Codex-style native turn acknowledgement. Records explicitly keep `turnId: null`
and `nativeTurnIdSupported: false`; a local request UUID is not relabelled as a
native turn ID. A changed post-turn account or wrong-session reply is not retained.

The two providers share the protected approval/idempotency/retention/recovery
code but retain distinct native adapters and action scopes. They cannot consume
or delete each other's text records. Keyboard-only shutdown stops an owned print
before reconciling its original background inventory. This is direct-child stop
evidence; broader provider-tree containment remains separate implementation work.

Run the installed journey in a Git directory already trusted by the native CLI:

```sh
mise exec node@24.14.0 -- node scripts/verify-claude-submission-host.mjs --synthetic
```

It reserves one local task, separately reviews two tiny prompts, checks native
creation and exact continuation plus duplicate/replay behavior, then restores
keyboard-only mode and removes
its synthetic local records. It never changes native workspace-trust settings,
deletes native user history or grants file/command authority. Its native result
passed nine normal installed checks with two synthetic prompts, exact UUID
continuation, duplicate/replay rejection and keyboard-only cleanup. Native pipe,
policy, first-turn lifecycle and crash-recovery tests pass.
