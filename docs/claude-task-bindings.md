# Claude Code task bindings

Claude coding tasks are separate from configuration conversations, Codex tasks
and Claude Desktop. This backend uses the installed native CLI's supported
`auth status --json` and `agents --json --all --cwd` contracts. Actual acceptance
used **2.1.308 on Linux**. Windows uses the same argument-based process path;
native Windows CLI/account acceptance remains pending. The frozen morning
frontend does not expose this task panel yet.

## Available behavior

- Discover the native CLI and a supported first-party account.
- Inventory an exact Git directory without reading transcripts, prompts,
  terminal output or provider display names.
- Bind a full session UUID, directory and account fingerprint. Background tasks
  retain Claude's short job ID too; interactive sessions remain distinct.
- Create an empty tools-disabled/plan background task with customizations,
  hooks, MCP and Chrome integration disabled. No model prompt is supplied.
  Friendly labels stay local; the CLI receives an opaque generated name.
- Recheck exact identity and runtime state. A workflow role's `status` intent
  addresses that task. Observations expire after 30 seconds. Provider `done`
  means its last turn finished, not independent acceptance of the task's result.
- Review and stop a background task created by Switchyard. External bindings
  are observation-only. Stopping retains the conversation and does not undo
  previous effects or prove completion.
- Focus a live interactive Claude session in a direct Foot window on Linux.
  The adapter verifies the exact current native session/PID, executable, user,
  directory, foreground process group, process start identity, terminal ancestry
  and compositor address before dispatch, then verifies native session and focus
  readback again. A second summon reuses that same session and window.

Creation reserves a stable request UUID in encrypted state before launch.
Repeated requests reuse it. Claude's `--bg` owns its session ID and **ignores
`--session-id`**; the adapter retains its returned short ID, then verifies the
full UUID through native inventory. Failed follow-ups retain known identities
and become `creation-uncertain`. Explicit status can reconcile a known short ID.
No returned identity means no guessing by name, latest session or directory, and
no automatic relaunch.

Inventory `startedAt` changes from live-process start time to job-record creation
time when a worker exits. It is not an immutable conversation identity. The UUID,
job ID, directory and local-login fingerprint bind the task; stop confirmation
also captures the current process and runtime row.

## Authority and lifecycle

The existing `DurableConfirmationLedger` provides expiry, exact scope matching
and one-use consumption. A narrow adapter runs that logic inside the suite's
kernel-locked AES-GCM transaction, rather than its separate file journal.
Tokens are returned once; only digests are persisted. No reauthentication or
additional OS security boundary is claimed.

Review binds compartment, provider, task, account fingerprint, directory,
conversation/job IDs, PID and runtime row. Changes require another review. The
token is consumed **before** `claude stop <exact-id>`. Readback must report the
same UUID/job as stopped with no listed live PID. Uncertain outcomes cannot reuse
that token. This is an owned-process stop, not authority for tools, repository
writes, approvals or other operations; broader broker integration remains open.

Keyboard-only selection and graceful shutdown stop recorded, identity-verified
background tasks created by Switchyard and its direct command children. They
preserve external bound tasks and the shared Claude service. Unknown/replaced
identities make cleanup unconfirmed. An abrupt suite crash can leave a native
background job alive; restart retains identity and never launches a replacement
automatically. Broader crash supervision and terminal lifecycle are unfinished.

Account fingerprints include the provider-reported first-party login and org ID.
They do not establish employer approval. Work policy rejects Claude before CLI
contact. Credentials and native job/history storage remain with the installed
CLI, outside suite encryption. This is not an OS sandbox or managed-client
deployment. The child environment strips provider/routing injection and sets the
CLI's documented switches disabling nonessential traffic, telemetry and error
reporting.

## Backend surface

Authenticated same-origin POST routes under `/api/suite/coding/claude/`:

| Route | Input and result |
| --- | --- |
| `discovery` | Version, account availability, capabilities and limits |
| `inventory` | `repositoryRoot`; normalized native identities/runtime fields |
| `list` | Saved Claude bindings in this compartment |
| `bind` | Full `sessionId`, exact directory, local `label` |
| `create` | Stable `requestId` UUID, directory and label; one empty task |
| `status` | Saved task `id`; recheck identity and account |
| `focus` | Live interactive task `id`; verify/focus its exact direct Foot window |
| `stop/review` | Owned task `id`; exact scope and one-use confirmation |
| `stop` | Same `id` and returned `token`; stop and verify readback |

All requests name `compartment`. Roles support provider `claude-code`,
`targetKind: "coding-task"` and intent `status`, plus `summon` for live
interactive bindings. Other task-role intents fail
without selecting a configuration conversation.

## Evidence and unfinished controls

Actual HTTP acceptance created an empty task, prevented a duplicate, observed
the exact session, consumed a reviewed stop and rejected replay. No model prompt
or HID operation was involved. A native contract trial also identified an
interactive session. Initial CLI setup used a dated private configuration backup;
only the empty private contract directory was trusted.

Tests cover inventory/account rejection, compartment ownership, uncertain
creation/reconciliation, expiry, changed scope/PID, replay, uncertain stops,
owned-only cleanup and exact role routing. A real native Foot/Claude trial passed
focus and repeat-summon against the same session; its owned terminal exited and
the original desktop focus was restored. Startup produced one not-yet-verified
inventory response; only read-only inventory was retried, and no focus occurred
until identity was verified. No model prompt or terminal text was sent.

This is exact-session **focus**, with `taskResumptionVerified: false`. It does
not submit work, restart a stopped task, identify a background attachment window,
or support tmux/screen, shared Foot servers, other terminals or Windows windows.
These cases fail explicitly without title matching or foreground typing.
Terminal attachment, approved review/handoff submission and broader mediated
execution remain implementation work. Background `--resume` can create a copy when a
conversation is running, so it is not used as an exact-resume shortcut. Native
`attach <id>` is the supported direction for the unfinished terminal adapter.

Primary contracts: [CLI reference](https://code.claude.com/docs/en/cli-reference),
[inventory and lifecycle](https://code.claude.com/docs/en/agent-view#list-sessions-as-json),
[environment switches](https://code.claude.com/docs/en/env-vars).
