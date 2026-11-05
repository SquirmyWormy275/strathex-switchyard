# Task authority in the suite

A saved conversation does not authorize repository changes. Switchyard now lets
an operator review and issue a short-lived **host task authority** for
one verified coding task, plan revision, literal file list and complete Git
snapshot. The grant uses the existing control-plane authority and confirmation
ledgers inside the workspace's encrypted state.

Authority and effects use separate approvals. These authority routes do not
enable native provider tools, change model permissions or execute a plan. The
[host commit API](mediated-repository-effects.md#review-and-execute-one-local-commit)
now independently reviews and executes a local commit through the existing
policy, checkpoint, budget, operation and native ownership barriers. Recovery
inspection is read-only; [separately approved recovery](mediated-repository-effects.md)
reconciles exact owned metadata without replay. Connected execution grants cover
Run on Linux/Windows and local-gate/clean-reproduction recipes on Linux, each
with its separate [execution review](reviewed-task-execution.md).

## Review an exact scope

All routes are authenticated POST requests below `/api/suite/coding/authority/`.
Use the selected Personal workspace in companion mode and a verified dedicated
Codex or Claude task. Work policy, unknown tasks, uncertain turns and unsettled
native process ownership are rejected. Claude requires a verified native
conversation, not just a locally reserved UUID.

1. Call `review` with the fields below. Inspect the returned native identity,
   account fingerprint, repository identity, complete target and exact file list.
2. Call `issue` with the identical fields and returned one-use `token` within
   five minutes. Changed files, classifications, task/account or policy invalidate
   the approval. A repeated token cannot mint another grant.
3. Call `revalidate` with the grant `id` before using it. Expiry, revocation,
   changed snapshots or changed bindings deny authorization. This result is not
   an execution permit; the separately reviewed effect independently checks again.
4. Use `list` to inspect the workspace's protected records, or `revoke` with an
   exact `id`. Revocation works in keyboard-only mode. Workspace suspension,
   keyboard-only selection and orderly shutdown revoke owned grants.

Example review body, using a real task UUID from this workspace:

```json
{
  "compartment": "personal",
  "taskId": "00000000-0000-4000-8000-000000000000",
  "planRevision": "reviewed-plan-3",
  "paths": ["src/example.ts"],
  "lifetimeMinutes": 15,
  "classifications": {
    "includedUntracked": [],
    "excludedUntracked": ["scratch.txt"],
    "excludedIgnored": [".env.local"]
  }
}
```

Every present untracked and ignored file needs an explicit classification.
Excluded files still contribute their digests to the snapshot; changing one
invalidates the reviewed scope. Credential-bearing origin URLs are rejected
before a target can be returned. Use a credential-free HTTPS or SSH origin with
host-observed default-branch metadata. This initial authority path requires a
non-default feature branch and does not support submodule repositories.

## Native inspection and recovery

Git runs through fixed read-only argument vectors with no shell. System/global
Git configuration, interactive prompts, external protocols and repository
fsmonitor commands are disabled. Each command has native process supervision,
a ten-second deadline and bounded output. Its exact guardian scope is encrypted
before execution and verified exit is recorded. An unsettled scope survives
restart and blocks replacement until independent native readback verifies exit.
Cancellation discards late results. Git temporary files use a private, identity-bound
runtime directory, removed after verified guardian exit. An unsettled guardian
retains its scratch for recovery. A missing optional upstream is represented as
unavailable metadata, independently of successful process supervision.

File hashing rejects parent links/junctions, descriptor replacement and content
changes. This route supports at most 4,096 input files, 4 MiB per file and 64 MiB
of input per snapshot. Unsupported or unreadable inputs make the target
incomplete. Only literal file grants are accepted, with at most 256 paths and a
1–60 minute lifetime. Wildcards, traversal, Git-internal paths and Windows path
aliases are rejected. The inventory retains live grants and a bounded recent
history; portable profiles cannot carry these local authorities or approvals.

Tests use real disposable Git repositories, independent filesystem checks and
synthetic native-task identities. Seven normal installed checks passed with an actual empty native Codex task,
zero model prompts and independent exit verification for eight retained guardians.
Detailed acceptance is recorded on the [verification page](verification.md). Provider completion,
execution authority and independently verified coding-task completion remain
different results.

On the installed Linux pilot, the explicit synthetic journey creates an empty
native task without sending a model prompt:

```sh
mise exec node@24.14.0 -- node scripts/verify-task-authority-host.mjs --synthetic
```

It uses a disposable Git repository, checks replay and changed-target rejection,
revokes the grant and restores workspace selection/keyboard-only mode. An
uncertain result retains its exact protected records and staging for recovery.

## Fresh protected reads

Repository admission can check provider permission within the same freshly
opened, authenticated workspace snapshot. The already reviewed provider is pinned
across later reads. A different provider, unavailable compartment key or revoked
grant refuses admission; keys are read again on each access. Initial record lookup
still precedes a fresh permission-bound read, and the ledger evaluates that fresh
state before an effect. Target recapture, per-query checks and durable guardian
ready/exit records remain in place.

Nine focused groups pass 70 checks, including revocation between record lookup and
admission, a locally valid provider substitution, unavailable keys, private index/
history and ignored inputs, actual scanner/pipeline behavior and packaging.
On one paired Btrfs synthetic fixture, explicit snapshot/authorization reads drop
from 1,816 to 1,067; target captures stay at ten and ready/exit records at 120 each.
The Git query guardian is doubled in this fixture; the real scanner exit is
verified. Apply takes 4.073 then 3.857 seconds in these samples. This is a local
measurement, not a general speed guarantee or proof of the earlier timeout cause.

The two previously timed-out files pass separately at 35.042 and 27.523 seconds
under their original 120-second bounds. Earlier failed full runs remain failed;
a complete new-source Linux run and installed acceptance are separate checks.
[Exact hashes, receipts and cleanup](evidence/fresh-protected-reads-summary.json).

The immutable `9dc0a944` Linux code checkpoint subsequently passes the complete
235-group manifest: 1,445 passed tests, ten declared skips and verified child/
checkout/fixture cleanup. [Complete receipt](evidence/linux-9dc-complete-summary.json).

Windows client contracts at the same PR head pass seven groups/73 checks. Its
separate authority file completes ten passing subtests, then exceeds its original
240-second aggregate file bound. That failed attempt remains failed. The two new
admission-state regressions now live beside receipt-state checks in an existing
independent child; authority CI includes the whole child. All cases stay required,
with both 240-second child limits and the 12-minute CI step unchanged. Linux
follow-up selection/state groups pass 31 checks; corrected native Windows
acceptance is pending. [Windows evidence](evidence/windows-authority-9dc-timeout-summary.json).
