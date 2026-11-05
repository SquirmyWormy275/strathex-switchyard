# Observe task metadata with explicit consent

An observation session with the `agent-events` source can now retain bounded
metadata from Switchyard's Codex and Claude Code task adapters. It records local
request reservation, exact identity binding, uncertain creation and observed
provider status. The supported read-only Codex resume and owned Claude stop paths
also record their local observations. Normal status requests supply these
observations; starting recording does not start an agent or a systemwide monitor.

The collector requires Personal policy, Personal companion mode, a recording
session and the explicit source. Paused, stopped, keyboard-only and Work sessions
collect nothing. Codex respects the `codex` category exclusion, Claude Code
respects `claude`, and custom adapters respect `other`. The existing authenticated
custom-agent path now shares these exclusion and capacity rules while retaining
its adapter self-report provenance.

Each event contains fixed provider/phase/status metadata, timestamp and a
compartment-specific subject digest. It excludes raw task/session IDs, labels,
account fingerprints, repository paths, prompts and returned content. Local
lifecycle bookkeeping and provider-status observations have distinct provenance;
custom-agent events remain authenticated self-reports. Every event keeps
`taskCompletionVerified: false` and `timeSavingMeasured: false`. A reported finished
turn does not establish completion of the user's task.

Identical status polls collapse; a changed status produces another observation.
Unknown status text becomes `unknown`, and stale status observations are ignored.
The event count describes retained observations, not every provider poll or user
action. At the existing 2,000-event ceiling the session pauses without discarding
its original events. Existing review, deletion, workspace suspension and retention
continue to apply. No event creates task authority or starts another provider.

This covers operations seen by the named task adapters. Broader external agent
event streams and exact IDE tab attachments remain separate implementation work.
Work policy continues to prohibit recording.

Configuration conversations now append local request reservation, validated
reply persistence and failure events inside their existing encrypted transaction.
Their correlation namespace is distinct from coding tasks, and no prompt,
proposal, reply text, account or native session identity enters the observation.
A reservation does not prove delivery: a subsequent account refusal can record
local failure before any model call. These events add no provider request and
inherit the same consent/mode/source/exclusion/pause limits. Four isolated
collector/Suite/Claude-design/package groups pass 39 checks with cleanup
(`isolated-test-5cf7e991-659d-4452-9b5b-9f1cea3157b8.json`). Provider responses in
these checks are simulated; no native design turn was submitted for this change.
Broader configuration runtime-status and external lifecycle streams remain separate.

Seven isolated collector/task/bridge/Suite/runner/package groups pass 85 checks
with every cleanup verified (`isolated-test-84a838e4-fc9c-447d-ad62-7721135461df.json`).
Cases execute real encrypted state with explicit provider doubles, preserving
account/directory guards and testing reservation, changed status, pause,
exclusions, deduplication, provenance and content omission. The prototype's memory
store omitted companion mode, so the strict collector correctly refused its
capacity case. Its failed receipt `isolated-test-fd6af7d7-9b58-4a98-9743-980f79fab84e.json`
is retained; the corrected fixture explicitly selects the permitted mode and
preserves the original capacity assertion.

The installed native demonstration is deliberately gated:

```sh
node scripts/verify-agent-observation-host.mjs --synthetic-native-metadata
```

It requires the existing idle `authority-validation` workspace, reuses its
Personal policy, and creates one empty native account-bound Codex task without a
model request. It checks local/native provenance, duplicate polls and pause,
then independently reads back retained native process exit. Only its exact
observation/task row and disposable repository are retired. Definitions,
selection and frozen Home are restored; fresh mode fences and normal audit
bookkeeping remain. The native CLI retains the one empty task. Normal installed source `ea5a0f7`, release `7096e4c8…`, now passes six update,
seven metadata and four actual native-journey checks. The retained native Codex
metadata process independently exits; the exact proof rows, repository, bundle
and checkout are removed. The existing 54-workspace inventory is unchanged,
selection returns to Personal and validation mode returns to keyboard-only.
No model request, new workspace, HID or microphone operation occurs. This native
journey establishes Codex event acceptance; Claude event acceptance still has
software evidence separately.
[Exact summary](evidence/installed-agent-observation-summary.json).
