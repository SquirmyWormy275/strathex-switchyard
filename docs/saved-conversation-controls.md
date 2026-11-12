# Continue a saved design conversation

Open **Customize → Design together → Continue a saved conversation**. Choose the
assistant, then the saved context you want. The history shows that conversation
alone. Selection reads local encrypted state; it does not contact a provider,
resume a native task or submit a message.

Unsent drafts remain separate for each workspace, assistant and conversation in
this page's memory. Switching destinations restores that destination's draft;
reloading the page discards unsent drafts. Submitted context follows the workspace's
encrypted retention policy. **New** deliberately selects a new conversation.

## Review an older account binding

An older Codex or Claude conversation can have a native session ID without a
verified original account. Its Discuss button stays unavailable until you choose
**Review account binding**. This explicitly checks the installed provider's current
account metadata; it does not log in, send saved context or submit a model prompt.

Read the exact provider/session, current account fingerprint, context digest,
saved messages and proposal. **Save this account binding** consumes the backend's
one-use review. A changed login, context, policy or expired token refuses the
change. Cancellation saves nothing. A known account binding cannot be replaced
through this legacy flow. The original account remains unverified after binding.

## Send, inspect and recover

**Discuss** sends your draft to the selected conversation under the existing
account and policy checks. The form prevents overlapping submissions. A response
for an old workspace or a changed layout cannot replace the current proposal.
**Check native status** explicitly queries the selected account-bound Codex thread
or observes the owned Claude process. Neither proves task completion or attaches
a terminal. **Cancel turn** targets the pending native conversation and reports
the backend's actual cancellation result. Work Copilot retains its separate
[request recovery contract](copilot-request-recovery.md).

If the reply is lost, the draft remains visible and another submission is blocked.
Choose **Refresh saved context**, inspect the retained conversation, then deliberately
select the context before sending again. Refresh never resubmits a message. A lost
binding response likewise reads back history without repeating the mutation.
Keyboard-only mode permits local history browsing and disables provider operations.

## Evidence and limits

Nine interaction cases use authenticated HTTP, real encrypted stores and durable
account-binding reviews. Native provider/account observations are explicit doubles.
Eight original groups pass 73 tests; three final interaction groups pass 23 with
overlap and zero skips. Eight running-demo checks verify served files, synthetic
history and refusal of native operations. [Exact receipts and source hashes](evidence/conversation-ui-source-summary.json).

The original scheduling failure is retained. The complete Windows source lane
now distributes unchanged cases across 22 software workers and one ordered
assembly worker, preserving its workload allowance, deadlines and assertions.
No live account/model/task operation or visual browser acceptance is claimed.
The [native coding-task controls](native-coding-tasks.md) are a separate workflow.
