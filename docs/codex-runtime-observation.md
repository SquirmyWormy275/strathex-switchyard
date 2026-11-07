# Observe status during an owned Codex turn

Switchyard can record runtime status while an already authorized Codex design
conversation or reviewed coding-text turn runs. This supplements local request
and reply history with the provider's reported active, waiting-on-approval, idle,
error or not-loaded state. None of these states proves that the user's task is
complete.

The existing observation session must explicitly include `agent-events`, remain
recording in a personal companion workspace, and permit the `codex` category.
Starting a turn does not enable recording. Pausing, deleting, excluding the source
or changing the original binding prevents later metadata from being retained.
The narrow authenticated `/api/suite/observation/start` route supplies this
consent; guided frontend exposure remains unfinished.

Only `thread/status/changed` notifications on the exact owned connection and
thread are considered. The native account and turn generation remain pinned;
the original role or coding-task binding is checked again inside the encrypted
write. A new or resumed recording cannot inherit an earlier queued event. The
stored record contains fixed status/provenance, local time and a compartment-bound
subject digest. It contains no prompt, reply, file path, account or native thread
identifier. Sending aggregate observations to a designer still requires the
separate existing observation review.

Repeated statuses collapse. Up to 64 distinct transitions are accepted within
the original turn deadline and output bounds. Accepted writes finish before a
successful reply is retained. Overflow or failed persistence leaves the turn
unconfirmed, invokes its existing owned cleanup and never submits a replacement.
A callback that finishes after cancellation, timeout or an account change cannot
write late metadata.

This observes an existing turn; it creates no provider process, subscription,
resume or model request. As the [official app-server contract](https://learn.chatgpt.com/docs/app-server)
explains, a metadata-only thread read does not subscribe to runtime events. There
is no continuous external-session observer here. Unsupported status shapes are
ignored, so complete stream coverage is not claimed.

Twenty-seven groups pass 191 tests with no skips, and both TypeScript checks
pass. Encrypted-state demonstrations cover design and reviewed-text paths,
privacy, consent and role changes before persistence. Transport responses are
synthetic. Packaging and installer scenarios pass; live provider and native
Windows acceptance are separate. Fixture retention/startup mistakes remain
classified in the [source evidence](evidence/codex-runtime-observation-source-summary.json).
