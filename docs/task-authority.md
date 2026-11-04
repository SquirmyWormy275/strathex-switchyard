# Task authority in the suite

A saved conversation does not authorize repository changes. Switchyard now lets
an operator review and issue a short-lived **host local-commit authority** for
one verified coding task, plan revision, literal file list and complete Git
snapshot. The grant uses the existing control-plane authority and confirmation
ledgers inside the workspace's encrypted state.

The suite's commit-effect route is still unfinished. These controls establish
and revalidate its authority boundary; they do not enable native provider tools,
change a model's permissions, execute a plan, stage files or create a commit.
The existing companion commit broker remains a separate implementation until
its policy, containment and final-effect barriers are connected here.

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
   an execution permit; a future effect must independently check again.
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
Cancellation discards late results.

File hashing rejects parent links/junctions, descriptor replacement and content
changes. This route supports at most 4,096 input files, 4 MiB per file and 64 MiB
of input per snapshot. Unsupported or unreadable inputs make the target
incomplete. Only literal file grants are accepted, with at most 256 paths and a
1–60 minute lifetime. Wildcards, traversal, Git-internal paths and Windows path
aliases are rejected. The inventory retains live grants and a bounded recent
history; portable profiles cannot carry these local authorities or approvals.

Tests use real disposable Git repositories, independent filesystem checks and
synthetic native-task identities. Installed native-account acceptance is recorded
separately on the [verification page](verification.md). Provider completion,
execution authority and independently verified coding-task completion remain
different results.
