# Editor workflow history

An explicitly started Personal recording can now include the protected editor
connection's lifecycle. Select `editor-events` through the existing observation
API with `consent: true`; earlier agent or host-action consent does not enable it.
The frontend remains frozen and does not yet expose this source.

Four fixed events describe reservation, protocol acknowledgement, verified
resource retirement and unconfirmed retirement. They share a compartment-scoped
digest so a review can correlate one connection without retaining raw task,
account, repository, socket or process identities. No prompt or terminal content
is recorded. Every event identifies the protected journal as its source and
explicitly declines live IDE attachment, task completion and measured time savings.

Each event commits in the same encrypted transaction as its ownership checkpoint.
A failed transaction retains neither the checkpoint nor its event. Work policy,
keyboard-only mode, pause/stop and any Codex, terminal or VS Code exclusion prevent
recording. The source does not backfill paused intervals. Duplicate or stale
transitions collapse; reaching 2,000 events pauses recording without deleting
earlier events. Existing session review, deletion and retention still apply.

Seven isolated groups pass 84 tests. The demonstration uses actual encrypted
state, Linux connection carriers and a controlled provider/terminal to record
reservation, acknowledgement and exact cleanup. Other checks cover failed commit,
pause, source consent, exclusions, bounds and private field omission. Typecheck,
child/tree cleanup and removal of the empty owned test parent pass.

This is backend software evidence. Installed acceptance, frontend controls and
native TUI/Windows acceptance remain separate. Two earlier runs retained three
fixture failures each: their manually seeded recordings omitted the retention
timestamp. Correcting the fixtures required no retention-policy change.
[Evidence](evidence/editor-workflow-observation-summary.json).


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
