# Design from a selected demonstration

Switchyard's backend can now include a reviewed observation summary in a Codex or
Claude configuration request. This connects recorded activity to the existing
editable workflow and layout proposal. Sending a request never applies that
proposal, changes a key, starts a task or installs a role binding.

The selection controls remain unfinished in the frozen frontend. The working
demonstration uses the authenticated local HTTP API, real encrypted storage and
synthetic provider processes/protocols. It does not establish live account, model
or user-interface acceptance.

## Review and send

1. Pause or stop the demonstration. Choose one to eight sessions in the same
   personal workspace and choose Codex or Claude as the intended designer.
2. POST `provider` and `sessionIds` to
   `/api/suite/design/observations/review`. Review the returned `context` and
   confirmation explanation. This request starts no provider and changes no
   observation data.
3. Include `observationReview: { sessionIds, reviewId, confirmed: true }` with
   the ordinary `/api/suite/design` request. The backend regenerates and verifies
   the summary; callers cannot supply substitute context.
4. Review the returned process and layout proposal through the existing design
   flow. Adoption and local connections retain their independent checks.

Omitting `observationReview` sends no observation summary. Recording consent alone
never selects or sends observations. The work policy continues to prohibit
recording/export; requesting observation context for work Copilot is refused
before credentials or Microsoft requests. No personal-provider fallback occurs.

## What travels

Only selected-session ordinals, event counts grouped by fixed kind and provenance,
and sampled milliseconds in fixed application categories. The summary explicitly
distinguishes user marks, authenticated self-reports, native status observations,
local lifecycle records, host actions and editor journal records. It does not
include raw events, timestamps, native/session/agent IDs, subject digests, text,
window titles, accounts or unselected sessions.

Sampled category time is an estimate. Neither it nor event counts establish
intent, task completion or measured savings. The designer must ask before
proposing a process change.

The review binds the selected source snapshots, workspace, policy, mode selection,
stored account scope and destination provider. Changed/deleted/resumed sessions
require a new review. Codex rechecks after its final account check and before
turn submission; Claude rechecks at guardian readiness before input delivery.
Cancellation while the Codex check awaits cannot submit a late prompt. Normal
adapter account/version checks still apply. Deleting a source cannot recall
context already sent to a provider.

## Evidence and packaging

Twenty-eight focused groups pass 154 distinct checks, including HTTP bearer/origin
refusals, unchanged review bytes, both provider doubles, late deletion and
cancellation. The initial fixtures exposed retention and initialization-baseline
mistakes; corrected runs and original failures are retained.
[Source evidence](evidence/design-observations-source-summary.json).

The first package check exceeded its original 5 MiB limit by 4,711 bytes.
Bundles now declare `gzip-json/v1` for the first-party catalog provenance index.
The bounded decoder preserves every JSON field, rejects corrupt/oversized data
and never retries another encoding. Source checkouts retain ordinary JSON.
Upstream source files, notices and frozen frontend bytes remain unchanged.
The complete synthetic package is 5,163,619 bytes; all sixteen installation and
recovery scenarios pass. The limit was not raised.

Installed metadata acceptance and native Windows acceptance of this change
remain pending. See [current status](switchyard-status.md) for broader limits.
