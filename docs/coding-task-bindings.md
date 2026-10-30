# Exact coding-task bindings

Coding tasks are separate from the keyboard configuration designer. The backend
now binds real Codex daemon threads to a local task, working directory, compartment
and current-login fingerprint. It can inventory recent daemon threads, bind an
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

Native task-window focus, exact interactive client resumption, supervised terminal
lifecycle, approved review/handoff submission, cancellation and integration with
the existing exact-scope authority broker remain unfinished. Claude Code task
inventory/control and the Windows general coding-task transport are also
implementation work. Existing configuration conversations, SDK integrations and
native Windows hotkeys are separate capabilities and do not imply those are done.
