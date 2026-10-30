# Exact coding-task bindings

Coding tasks are separate from the keyboard configuration designer. The backend
binds real Codex app-server threads to a local task, working directory, compartment
and current-login fingerprint. It can inventory recent threads, bind an
existing exact thread, create one empty read-only thread per durable request, and
refresh its runtime status. The frozen frontend does not expose this task panel
yet. General coding-task integration is still in progress.

Switchyard-created read-only threads can also resume their exact daemon runtime.
This verifies directory, login and permissions again, excludes transcript history
from the reply, and submits no model prompt. Active or approval-waiting tasks are
left alone. Binding an existing external task does not grant this resume capability
or change its permissions. Window focus and coding execution are separate.

## Scope and authority

The first adapter is `switchyard.codex-daemon/v1`, using Codex's private
current-user Unix control socket and its native installed CLI. It was exercised
with Codex 0.165.0 on Linux. Discovery distinguishes prohibited providers, a
missing CLI, a stopped/unavailable daemon and a reachable runtime. It does not
equate any of those with task completion.

Binding requires an exact local directory with Git metadata, an exact provider
thread ID and provider readback of the same working directory. This verifies the
directory binding, not a commit/tree snapshot or Git authority. The local runtime
must identify its current ChatGPT login. Only a fingerprint is retained; email is
not copied into task bindings. That fingerprint is not organization/workspace
attestation. The API-key account contract lacks a stable account identifier, so
the adapter does not invent one. Copilot-only Work policy rejects this adapter
before contacting the Codex runtime.

An existing external session cannot be assigned to a second compartment through
this binding path. Private ownership records contain hashes, authenticated with
the owning compartment's independent key. They contain no plaintext provider
session IDs or customer labels. Imported portable profiles cannot supply these
local bindings or expand policy.

Creating an empty thread reserves a stable request UUID in encrypted state before
contacting Codex. Repeated or concurrent requests reuse that record. A timeout or
partial failure becomes `creation-uncertain`, without automatic creation of
another thread. When a returned thread ID is known, it is retained even if a later
follow-up fails. An explicit exact-status request can reconcile that retained
identity. If no ID was returned, an operator can deliberately bind an identified
existing thread; automatic retries do not guess which one was created.

New threads use read-only sandboxing and on-request approval. Their injected
binding metadata contains an opaque generated task ID, not the local friendly
label. No user/model prompt is submitted. Binding or checking an existing thread
does not change its permissions.

Observations expire after 30 seconds. Refresh rechecks the current local login,
the exact thread and the exact working directory. A changed login is rejected.
`idle`, `active`, `waiting-on-approval`, `error` and `not-observed` describe provider
runtime state; none verifies a coding outcome. The capability response keeps
focus, launch, task control, cancellation and mediation false. Daemon resume is
offered only for the owned read-only contract.

## Backend surface

The authenticated local API exposes these POST routes:

| Route under `/api/suite/coding/codex/` | Operation |
| --- | --- |
| `discovery` | Distinguish CLI/daemon/policy availability and declared adapter capabilities |
| `list` | Read this compartment's saved local bindings with observation freshness |
| `bind` | Validate `sessionId`, `repositoryRoot` and a short local `label` |
| `create` | Reserve `requestId` (UUID), directory and label, then create one empty thread |
| `status` | Revalidate a saved local binding by its `id` |
| `resume` | Resume an owned read-only runtime by its saved `id`, without prompting |

Every request is scoped by `compartment`. A workflow role can bind
`targetKind: "coding-task"`, provider `codex`, exact target ID and intent `status`
or the supported owned-runtime `resume`. The same closed physical-intent gateway
then addresses that exact coding task.
Unsupported role intents are rejected instead of being reinterpreted as a
configuration conversation or sent into the foreground window.

## Evidence and remaining work

An actual authenticated HTTP smoke check created one empty thread through the
installed local Codex daemon, verified the returned thread/directory/login
binding, prevented a second creation and read back `idle`. The thread used
read-only/on-request permissions and received no model prompt. Exact IDs and
receipts remain in private local state. This is provider-runtime evidence, not
proof of a completed coding task.
An additional real HTTP check resumed the same thread and read back idle with
read-only/on-request permissions. Model prompting, window focus and task
completion were explicitly false.

Tests cover directory/account mismatch, Work prohibition before provider access,
staleness, cross-compartment ownership, tampering, concurrent/restarted duplicate
requests, partial creation and exact role routing.

Claude Code has a separate [native task adapter](claude-task-bindings.md) for
inventory, exact account/directory/session bindings, durable empty background
creation and reviewed owned-session stops. Its actual Linux HTTP exchange passed
without a model prompt. It does not imply equivalence with this Codex adapter.

Native task-window focus, exact interactive client resumption, supervised terminal
lifecycle, approved review/handoff submission, cancellation and integration with
the existing exact-scope authority broker remain unfinished. Further Claude task
controls remain implementation work. The Windows stdio task transport is now
implemented; its native installed-CLI/account acceptance is still open. Existing configuration conversations, SDK integrations and
native Windows hotkeys are separate capabilities and do not imply those are done.

## Windows task transport

Windows uses `switchyard.codex-stdio/v1` instead of a Unix socket. On the first
permitted request it starts one owned native app-server per compartment through
private stdin/stdout pipes. Shell/unified execution, computer use, code-mode
hosting, hooks, plugins/apps/memories, both multi-agent flags and web search are
explicitly disabled, together with the discovered enabled MCP servers, with
effective configuration readback. Provider
API keys and runtime injection variables do not enter the child environment.
The existing native CLI login supplies identity; no new token store is introduced.

The closed transport supports metadata inventory/read, local-login fingerprinting,
empty read-only/on-request creation and exact owned read-only runtime resume.
Create verifies returned identity, working directory and sandbox/approval policy
before persisting the bounded local assistant marker. It submits no user/model
turn. Resume excludes transcript history and reads permissions back. An identity
returned before a later failure, including mode-off, remains available for exact
recovery and does not authorize automatic replacement creation.

Creation/resume also reads the effective configuration for the exact repository
before and after the native acknowledgement. An additional project-local MCP
server or changed required feature prevents continuation; the private startup
directory's configuration alone is insufficient. The same restrictions accompany
the exact thread request. If the post-creation check fails, the returned identity
is retained and no marker/model content is submitted. This is a restricted
metadata transport, not the general execution-authority broker.

Mode-off stops only the owned compartment's app-server. Pending initialization is
fenced against late startup. Unconfirmed exit blocks replacement until exact exit
is verified. The Linux default still uses the existing shared daemon and leaves
that shared service running.

Eleven tests exercise actual JSON-lines child-process pipes and Windows service
composition, permission/directory/account boundaries, creation idempotency,
retained partial identities, mode-off and unconfirmed-stop isolation. The built
Windows backend checks passed through `e5e8ab0`; these newer project/feature checks
are awaiting that runner. Native Windows
installed-CLI/account and interactive-window acceptance remain separate.

A real Linux CLI check against Codex **0.166.0** identified the existing login,
read metadata inventory and verified the exact owned native app-server exited
**31 ms** after its wrapper was killed. No new thread or model prompt was created.
Private receipts are `runtime-verification/codex-stdio-1793360185995.json` and
`runtime-verification/codex-stdio-parent-loss-1793360373712.json`.
This does not claim actual Windows account acceptance or new-transport create/
resume acceptance. Run the repeatable read-only parent-loss check with:

```sh
mise exec node@24.14.0 -- node scripts/verify-codex-stdio-host.mjs --read-only
```

The transport follows the [official app-server documentation](https://learn.chatgpt.com/docs/app-server)
for JSON-lines initialization and metadata-only read/resume. Installed response
fields are independently checked; API evolution cannot silently broaden permissions.


## Reviewed text continuation

[Follow the native task walkthrough](native-coding-tasks.md) for the new separate
text-review/submission/outcome-recovery backend. It accepts only exact registered
read-only tasks created by Switchyard, verifies native directory identity and
first-party login, and uses a private restricted connection. The 34 feature
restrictions, disabled generated MCP transports and zero automatic project-doc
bytes are read back. It grants no execution authority and does not report a
provider reply as verified task completion. Native interactive attachment and
corresponding frontend controls remain unfinished.
