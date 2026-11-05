# Microsoft work conversations stay bound to their account

A saved Microsoft 365 Copilot conversation can continue only under the exact
account that created its local record. Legacy conversations without that binding
and conversations from another enrolled account refuse before a Graph POST.
No personal provider or alternate credential is substituted.

Each design turn obtains one validated delegated credential, then checks its
tenant/client/account/token/refresh/expiry binding and current compartment policy
before and after each Graph call and before saving. Credential replacement after
creation prevents chat submission; replacement during a chat rejects the old
reply. Final persistence also rechecks the exact local conversation/session/
account identity instead of overwriting a changed binding. Invalid local token
identities or expiry refuse before Graph access. Raw credentials remain in the
OS-protected credential store, not conversation metadata or error messages.

Five account-bound cases and nine integration cases pass in two isolated groups
with real encrypted local state, simulated Microsoft responses and verified
cleanup (`isolated-test-a4a91ecf-6572-4d51-929c-cb82ce5e86fc.json`). The first
prototype fixture omitted timestamps, so normal retention correctly removed its
seeded conversations; its two failed assertions remain retained in
`isolated-test-55fc6ed5-e19a-45fb-8faf-e0d830b83f98.json`. The valid timestamped
fixture now exercises both refusal boundaries. No tenant, account or provider
endpoint was contacted.

The [documented Graph Chat contract](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotconversation-chat)
remains a beta API for delegated work/school accounts, requiring the listed
permissions. Microsoft documents that [response message text](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/chat/resources/copilotconversationresponsemessage)
can recap a prompt or contain the model response; its type alone does not prove
a speaker role. This adapter proposes configuration; it grants no task authority
or verified completion. Approved tenant/license/consent acceptance remains open.

Local in-flight requests now have per-compartment generations and abort signals.
A deliberate new sign-in, workspace switch, keyboard-only mode or application
shutdown invalidates prior operations, clears device-code sessions and blocks
follow-up requests and late response acceptance. The real Suite checks both its
active selection and the saved selection; transitions suspend new Copilot work
before waiting for other owners. Mode/selection checks run before transport,
after response bodies and at final persistence/readback.

The transport keeps its original sixty-second and 1 MiB bounds, disables
redirects and releases/cancels response readers. Stop waits at most one second
for local settlement and reports whether it actually settled. Generation fences
continue to reject a late transport that ignored abort. `remoteCancellationVerified`
remains false: closing local HTTP cannot undo a delivered request or a response
already retained in account-bound private history. No proposal is applied.

Five isolated runner/account/lifecycle/Suite/integration groups pass 58 checks
with every cleanup verified (`isolated-test-29524493-24b4-423e-9a7a-45f76d8549c5.json`).
Final account/lifecycle checks pass all fifteen cases with cleanup, including
stopping after private history persistence
(`isolated-test-5753c369-d16b-4fc9-8e05-f8f6e47fd36e.json`). These execute real
encrypted state and the actual Suite mode/workspace/shutdown composition with
simulated network responses. Type checking passes. No Microsoft endpoint is
contacted.

Durable delivery reservation, account kernel ownership, restart refusal and
separately reviewed acknowledgement are now implemented in source. Their
[request/recovery contract](copilot-request-recovery.md) preserves unknown remote
effects and never turns local acknowledgement into completion. Approved work
tenant, license and consent acceptance remain separate account checks.
