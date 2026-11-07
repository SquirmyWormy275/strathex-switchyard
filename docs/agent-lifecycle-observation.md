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
custom-agent status and acknowledgements remain authenticated self-reports, while
command queue/claim/retirement use local-lifecycle provenance. Every event keeps
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

## Custom-agent command history

External status and acknowledgement reports retain their original occurrence
time across SDK queues, sequence persistence and encrypted-state leases. The
server captures the opted-in recording generation before waiting to commit.
Pause/resume or replacement consent cannot inherit a queued report, even when
timestamps match. A report can still update its exact authenticated agent or
claim while being omitted from observation history. The source SDKs use the same
30-second freshness limit; late messages do not gain a new timestamp to pass it.

Nine original groups pass 141 tests, including signed HTTP through two stores
sharing the real encrypted state lease, fresh-report acceptance, and Node/Python
timestamp checks. The original two failing consent regressions are retained.
Native Windows acceptance and the installed update are separate from this source
result. [Evidence](evidence/external-agent-consent-source-summary.json).

The same explicit `agent-events` recording now includes commands handled through
the authenticated custom-agent bridge. These events retain one of its six fixed
intents, a compartment-specific command digest and a bounded phase/status pair.
They omit raw command/session/agent IDs, labels, credentials and handoff content.
The command digest uses a separate namespace from adapter-status observations.
No new recording source or automatic recording is enabled.

| Phase | Meaning and provenance |
| --- | --- |
| `adapter-command-queued` | Local reservation; no delivery established. |
| `adapter-command-claimed` | Local one-use claim committed for an authenticated poll; receipt by the external process remains unverified. |
| `adapter-command-retired` | A changed session cancelled an unclaimed command or left a claimed command uncertain; no replay or external cancellation claim. |
| `adapter-command-acknowledged` | The authenticated adapter reported completed, failed or cancelled; external task completion remains unverified. |

Each hook runs inside the existing command-state transaction. Failed persistence
commits neither the command transition nor its observation. Replayed claims,
duplicate dispatch and repeated acknowledgements add no events. A late exact
acknowledgement can resolve its old claim without refreshing the replacement
session. Paused/excluded/out-of-interval events are omitted and never backfilled.
The existing Personal policy, companion mode, consent, exclusions and 2,000-event
ceiling still apply. These are status metadata, not deliberate user marks or
evidence of intent, completion, measured time savings or permission to act.

Seven isolated groups pass 92 checks, including five new focused cases and an
extended real bundled-agent journey through the authenticated HTTP server and
encrypted store. The command is claimed and acknowledged, sensitive text stays
out of observations and plaintext state, and both owned example processes exit.
Failed-save injection uses a memory store; provider checks elsewhere use doubles.
Typecheck, the original package budget and exact owned cleanup pass. Native
Windows and live installed command execution remain separate.
[Evidence](evidence/custom-agent-command-observation-summary.json).

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

Reviewed Codex and Claude Code text turns now append local reservation, persisted
identity, reply, failure/uncertainty and deliberate outcome-review metadata inside
their existing encrypted transactions. Their `coding-text:` correlation namespace
stays distinct from task identities even when the same raw UUID appears in both
domains. The hooks add no state transaction or provider request. Codex can record
its supported turn acknowledgement; Claude supplies none, so no acknowledgement
event is invented. All these phases retain local-lifecycle provenance and keep
task completion and measured savings false. A reserved request does not prove
delivery; a reviewed uncertain outcome does not prove cancellation or completion.

Five isolated collector/Codex/Claude/Suite/package groups pass 56 checks with
cleanup, including actual encrypted state, real child-process provider doubles,
duplicate submission, pause before acknowledgement, category/source exclusions,
content omission and namespace collision. Native model-turn metadata acceptance
is separate from those provider doubles. The installed proof has an explicit opt-in:

```sh
node scripts/verify-agent-observation-host.mjs --synthetic-reviewed-text-metadata
```

This flag reuses the idle existing validation workspace and submits one separately
reviewed tiny synthetic Codex turn through the normal installed API. It checks the
three local text phases and duplicate suppression, then independently verifies
captured native process exit and removes only its own successful records/staging.
Uncertain failures retain their original context. Cleanup attempts recording stop,
keyboard-only shutdown, process readback and selection restoration independently.
The original `--synthetic-native-metadata` flag still submits zero model prompts.
Neither flag creates a workspace or changes hardware, microphone or frontend.
Native Claude text-event acceptance and broader runtime/external streams remain
outstanding; no continuous native stream is claimed by these local hooks.

The normal installed source `095f5dd`, release `07dddc50…`, now passes six update,
seven privacy/metadata and five actual native text-journey checks. One reviewed
synthetic Codex turn records the three local text phases with separate correlation;
its duplicate returns the saved result without another event. Three captured
native processes independently exit, including two from text preparation/execution.
Only its task, turn, observation and staging are removed. All 54 workspaces remain;
selection returns to Personal and validation returns to keyboard-only with zero
tasks, turns or active observations. The updater already retired its bundle, and
the disposable checkout/marker are removed. The CLI retains one synthetic native
conversation with one Ready reply. Definitions and frozen Home are preserved;
fresh mode fences and normal audit bookkeeping remain, so no byte-exact sealed
state claim is made after this native journey.
[Installed text-event evidence](evidence/installed-text-observation-summary.json).

The normal installed source `7d9310a` passes six update and seven privacy/metadata
checks with all 54 workspace identities, plus exact installed hash pins for the
configuration adapter, collector and workflow boundary. This journey preserves
selected sealed bytes, selection and frozen frontend, creates no workspace and
submits no model request. Its bundle and checkout are removed. These are installed
source/privacy checks; native configuration-turn event acceptance is still open.
[Installed configuration observation evidence](evidence/installed-design-observation-summary.json).

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


## Recording intervals

Agent, host-action and editor metadata now share a protected timestamp boundary.
A delayed event from before consent or the latest explicit resume is omitted.
Resume records its boundary in the existing encrypted state transaction;
repeating resume does not move it, and a backward wall clock cannot lower it.
Older recordings use their creation timestamp until deliberately resumed.
This does not backfill missed intervals, erase existing events or change task
results. It adds no provider request, authority or frontend control.

Nine isolated groups / 105 tests pass, including the normal encrypted API,
source-specific boundary cases and the existing rollback/lifecycle tests.
The host journal fixture now uses its real synthetic recording start rather than
a timestamp predating consent. Typecheck and exact owned child/tree/temporary
parent cleanup pass. [Evidence](evidence/observation-window-summary.json).

Installed source `e7cec91` now passes six pure in-memory command-history checks
within a 26-check metadata update. The exact tested module hashes verify. All
54 semantic workspace snapshots and frozen frontend bytes remain unchanged,
53 sealed files remain byte-identical, and the prepared bundle is removed.
No live recording, command, provider or model request is started by these checks.
[Installed evidence](evidence/installed-command-observation-summary.json).

Reviewed uncertainty for a retired custom-agent claim now records the fixed
`adapter-command-outcome-reviewed` phase with `unknown` status and local lifecycle
provenance. It shares the original explicit agent-event consent, exclusion,
pause/interval, privacy and capacity fences. It neither verifies an external
outcome nor resends work. [Recovery contract](custom-agent-revocation.md#review-an-uncertain-claim),
[source evidence](evidence/custom-agent-outcome-source-summary.json).

Owned Codex design and reviewed-text turns now also accept fixed native runtime
status notifications under the original recording consent and account/role/task
binding. This is separate from local lifecycle events and does not create a
subscription or provider request. Twenty-seven groups pass 191 tests, including
encrypted-state demonstrations and package/installer checks. Broader external
streams and live-provider acceptance remain separate.
[Runtime status contract](codex-runtime-observation.md).
