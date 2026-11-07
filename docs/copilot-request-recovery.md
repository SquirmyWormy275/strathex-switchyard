# A lost Copilot reply does not mean “send it again”

Switchyard records a design request in its encrypted workspace before creating a
Microsoft conversation or submitting chat. It records the returned conversation
identity before sending the first message. Lost acknowledgements, interrupted
delivery and local persistence failures preserve an unconfirmed outcome. A new
instance cannot silently repeat that delivery.

An account-scoped kernel lease spans delivery and local acceptance. Every send
rechecks that lease, its exact private owner/phase, the selected workspace,
policy and pinned credential. Changed owners or lost leases refuse; an old
writer cannot advance a reviewed request. GUID case changes cannot bypass the
same-account barrier. Unresolved records survive ordinary history retention.

API clients can provide a UUID `requestId` with a design request. Reusing it with
different content refuses. Exact completed repeats return the original response
only while its saved conversation and response digest still match; otherwise
they refuse instead of sending again. Existing clients without an ID have a
five-minute exact-content duplicate window. This is a compatibility bound, not
an unlimited replacement for explicit request IDs.

Unknown outcomes block further delivery for that account, including credential
refresh on behalf of another design request. After the original local owner no
longer holds its lease, a separate one-use review can mark the outcome
`reviewed-unconfirmed`. This records human acknowledgement only. It does not
cancel Microsoft processing, undo effects, resume a conversation, verify task
completion or replay the old request. A later design is a separate deliberate
submission; the original outcome remains recorded.

The authenticated local routes are:

| POST route | Closed request fields | Result |
| --- | --- | --- |
| `/api/suite/copilot/requests` | `compartment` | Saved metadata; no prompt, credential or live task claim |
| `/api/suite/copilot/requests/review` | `compartment`, `id` | Exact original-outcome review and one-use token |
| `/api/suite/copilot/requests/resolve` | `compartment`, `id`, `token` | Acknowledgement; remote cancellation stays unverified |
| `/api/suite/design` with Microsoft provider | Existing design fields; optional UUID `requestId` | Exact bounded design or original verified response |

The generic snapshot hides request journals and tombstones. At most 128 detailed
records and 4,096 explicit identity tombstones are retained. Unresolved records
are never silently discarded; full inventories refuse new delivery. Retiring
completed detail cannot make its explicit request ID reusable. Journals contain
digests and delivery metadata, not prompt text or credentials. Conversation
history remains separately account-bound and encrypted.

Software evidence uses real encrypted files, kernel locks and authenticated HTTP
with simulated Microsoft responses. Cases cover simultaneous separate service
instances, creation/chat acknowledgement loss, failed identity persistence,
lease/phase loss immediately before sending, retention, GUID case, tombstone
limits, stale/consumed approvals, private route boundaries and contradictory
records. Surrounding groups and the installed metadata proof are tracked in
[verification](verification.md); approved tenant/license/consent acceptance
remains separate.

Three independent Windows workers retain every account/lifecycle/recovery case.
The journal's three Windows files declare 120-second per-file bounds for
their native encrypted-state/kernel-owner transactions; Linux keeps its existing
45-second default. Original native broker/child/job deadlines are unchanged.
No assertion is removed or native acceptance inferred from a local pass.

The pilot's read-only installed check is:

```sh
node scripts/verify-copilot-journal-host.mjs --read-only-metadata
```

It mutually authenticates the installed listener, pins its source, verifies
metadata/privacy/refusal routes and preserves selected sealed bytes,
definitions, mode, device readouts, private endpoint and frozen Home. It creates
no workspace and contacts no Microsoft endpoint. This does not substitute for
a real approved work-account demonstration.

Ten isolated runner, route, account, lifecycle, request, Suite, integration,
kernel-lock and confirmation groups pass all 90 checks, with every child
cleanup verified (`isolated-test-f5580865-f7f4-45a8-86b2-1f3df73a1d5f.json`).
Type checking and the deterministic development BOM check pass. A prototype
final-drift assertion remains recorded as failed because identical completed
content correctly used the new cache; its fixture now gives the deliberately
new turn a fresh request ID (`copilot-journal-prototype-failed-1793894621566.json`).
No live Microsoft request was used by these software checks.
