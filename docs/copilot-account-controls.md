# Connect Work and inspect an uncertain reply

In **Your tools → Microsoft 365 Copilot**, select your Copilot-only Work workspace.
Personal providers remain unavailable in Work. The account display describes saved
enrollment; it does not claim a current license or a successful Graph connection.

1. Open **Connect an approved Graph account**. Enter the organization-approved
   tenant and public-client application IDs and confirm the permitted surface.
2. Choose **Start Microsoft sign-in**. Open the displayed Microsoft address yourself
   and review its permissions. Switchyard displays the device code and expiry.
3. Choose **Check sign-in** after completing Microsoft's flow. Pending responses
   display the required interval before another check. There is no automatic polling.
4. **Stop this sign-in** invalidates only that exact local device-code session and
   aborts its outstanding verification. It reports whether local work settled, including a pending policy check before token exchange.
   It does not remove saved credentials or claim remote cancellation.

A workspace or mode transition retires its account flow. Late replies cannot
populate another workspace. A lost enrollment reply reads back saved local
account metadata without retrying the token exchange. Previously stored credentials
may remain, including an enrollment already saved before a stop; the account
display is the place to inspect that result.

## When a design reply is missing

Each explicit Microsoft design submission now carries its own UUID. It is retained
in the encrypted delivery journal and shown beside an unconfirmed reply. The draft
stays intact; the UI does not submit it again automatically.

Open **Review saved delivery outcomes → Load saved outcomes**. Select the original
request to inspect its exact account, local/native conversation references,
delivery phase and retained outcome. Loading reads local metadata, not Microsoft.
The generic workspace snapshot continues to hide the private request journal.

**Review this uncertainty** obtains a short-lived, one-use confirmation for that
exact original record and current workspace policy. Read it, then separately choose
**Record that I reviewed this uncertainty**. Cancellation leaves the outcome alone.
Acknowledgement preserves the original uncertainty; it does not replay a prompt,
cancel Microsoft processing or establish task completion. An active owner must
settle before its outcome can be acknowledged. These local controls also work in
keyboard-only mode. Changing selection, workspace, mode or account invalidates
the pending approval. A lost successful acknowledgement refreshes local history
without repeating the operation.

The new authenticated `POST /api/suite/copilot/login/cancel` route accepts only
`compartment` and `loginId` (plus the Suite's internal `workspaceBaseUrl` field).
The backend refuses a different workspace's session. Polling a foreign session
also refuses without deleting the original session. Cancelling does not stop a
different design request or log out an existing account.

## Evidence and limits

Ten interaction cases exercise the actual HTTP server, encrypted state, account
and delivery lifecycle, with explicit synthetic Microsoft responses. They cover
sign-in cadence, cross-workspace refusal, cancellation during credential
verification, lost enrollment/acknowledgement replies, policy changes, late
responses, keyboard-only review and the actual designer's durable request UUID.
[Source evidence](evidence/copilot-ui-source-summary.json) records the original
fixture failure, original bounds and cleanup.

The running synthetic demonstration includes an uncertain Work request and supports
local review/acknowledgement. Every account/model/device operation remains refused.
Approved tenant, license, delegated consent and live account acceptance require
their separate checks. Browser visual acceptance and normal installed adoption
are separate from this source checkpoint. See the [delivery contract](copilot-request-recovery.md)
and [account binding contract](copilot-account-binding.md).
