# Review a run and keep its evidence

Activity → **Run a reviewed task** connects the existing execution backend to the
Studio. It starts collapsed and loads saved permissions only when requested.
A Personal workspace in companion mode is required.

1. Load saved permissions and runs. Choose the project/plan permission and an
   action it actually grants: Run, a local gate, clean reproduction or one of
   the connected Shield scans. Expired/revoked permissions cannot start a review.
2. Choose a manifest path from the literal granted files, then select that local
   recipe file. The browser hashes at most 128 KiB; only its digest is sent. The
   backend verifies the actual repository file and exact task/account/snapshot.
3. Review the executable, arguments, environment, complete input descriptors,
   isolation, budget and any scanner scope. Confirm once to submit that request.
4. Select a retained run and choose **Observe this run**. Original admission,
   later process result, native exit, cleanup and historical receipt status are
   distinct. Bounded redacted output is plain text. No task-completion or current
   gate-eligibility claim follows from a successful process exit.
5. **Review stop** requires a separate exact-owned-run approval. It neither
   rolls back earlier effects nor rewrites the original admission.

Workspace, permission, action, file or history selection changes invalidate an
open review. Lost replies retain an explicit unknown outcome; refreshing history
never retries execution. There is no background status polling. A manual status
request may reconcile retained ownership and independently verified cleanup.

New task permission issuance and scanner-recipe creation are still separate
frontend work. Existing saved permissions are usable here; source-only and
installed API contracts remain in [task authority](task-authority.md),
[execution](reviewed-task-execution.md) and [scanner saving](scanner-recipe-saving.md).
Browser visual acceptance remains blocked by the browser-control failure.

## Run the source demonstration

On Linux with the existing runtime and working Bubblewrap/user namespaces:

```sh
node --experimental-transform-types scripts/demo-switchyard-execution.mjs --synthetic
```

This uses a new disposable Git repository, synthetic provider identity, real
encrypted state and authenticated HTTP. An actual owned Linux process runs in
its namespace; independent exit and staging cleanup must verify. The demonstration
checks the original files/index/HEAD and a duplicate approval before removing its
owned root. It uses no existing account, model, keyboard or user workspace.
It is a source-checkout command, not an installed-bundle or Windows guest test.

The nine-group source run passes 69 tests with no skips. The final seven-case UI
run adds lost-successful-reply coverage and overlaps that run. Eight checks pass
against the isolated interactive preview. Original failures, commands, bounds and
cleanup remain recorded in [the source evidence](evidence/execution-ui-source-summary.json).
