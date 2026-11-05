# Record local runs and scans with explicit consent

Switchyard can retain a private workflow history of the runs, gates and scans it
mediates. Start an observation with the separate `host-action-events` source.
Existing `agent-events` consent does not enable this source. This backend API is
available while frontend changes remain frozen; the UI does not yet offer it.

```json
{
  "compartment": "YOUR_PERSONAL_WORKSPACE",
  "sources": ["host-action-events"],
  "exclusions": [],
  "consent": true
}
```

Send this body through the normal authenticated local
`POST /api/suite/observation/start` endpoint after deliberately selecting Personal
companion mode. The existing observation state, review and deletion endpoints
apply. Work policy prohibits recording. Keyboard-only mode, paused/stopped
sessions, missing source consent and the `codex`/`claude` category exclusions
prevent collection. Recording does not launch a provider, scan or monitor.

The collector shares the protected execution journal transaction on Linux and
Windows. It adds no provider request, process or state write. A failed transaction
cannot leave an observation for a journal entry that never committed. With no
eligible recording, the hook returns before searching the journal.

| Phase | What the metadata establishes |
| --- | --- |
| `host-action-prepared` | Switchyard durably prepared a local operation. It does not establish that a program started. |
| `host-action-result-recorded` | Switchyard recorded a typed local command status, including `running`, `completed` or an incomplete/failure outcome. It does not independently establish native exit. |
| `host-action-receipt-recorded` | A protected local scan/gate receipt was issued with its original typed result. Ordinary runs without such evidence do not acquire a receipt event. |
| `host-action-receipt-invalidated` | That receipt was subsequently retired. Historical results remain in their own records. |

Only the closed implemented Run/Pipeline/Shield actions and the host's registered
Linux/Windows mediation adapters participate. Child effects, arbitrary adapter
self-reports and unrelated journal domains do not. Provider attribution comes
from the session entry that existed when the operation was prepared; subsequent
session reuse cannot relabel an older operation or receipt.

Events contain a fixed action, provider, phase, status, timestamp and a
compartment-specific digest for correlation. They omit commands, output, source,
paths, account fingerprints and raw task/session/operation/receipt identities.
Their provenance is `switchyard-local-host-action`. They retain
`taskCompletionVerified: false` and `timeSavingMeasured: false`. A local command or
receipt never establishes completion of the user's broader agent task.

Identical phase/status metadata collapses. Paused periods do not backfill on
resume. At 2,000 retained events the recording pauses and preserves its history.
The existing encrypted retention and deletion rules apply.

The focused tests cover consent, Work and keyboard-only refusal, pause/exclusion,
capacity, privacy, immutable attribution, malformed scopes, deduplication and
encrypted rollback. Linux execution and a Windows guest double exercise the
shared hook; the latter does not prove a Windows kernel or guest boundary.
Seven isolated groups pass 66 checks with all process-tree termination and child cleanup verified; typecheck also passes. [Software evidence](evidence/host-action-observation-summary.json).
External event streams, continuous IDE attachment and UI exposure remain
unfinished implementation.

The installed demonstration is a separately selected offline fixture:

```sh
node scripts/verify-shield-host.mjs --synthetic \
  --action=shield_supply_chain --pep440-requirements --host-action-events
```

It creates its own Personal proof workspace, explicitly starts recording, runs
the two real isolated scanner cases, verifies duplicate suppression and receipt
retirement metadata, then stops recording and returns to keyboard-only. It
submits no model prompt or public advisory query. Successful proof workspaces
retain their encrypted native identity/audit evidence through the normal owned
archive procedure. Installed acceptance must be recorded separately from tests.
