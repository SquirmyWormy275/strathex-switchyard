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

Local in-flight request shutdown on mode/workspace changes and durable
uncertain-effect/restart handling remain unfinished software. They are separate
from missing tenant acceptance; remote cancellation cannot be inferred from
closing a local HTTP request.
