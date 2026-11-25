# Review one task permission

Open Activity → **Prepare task permissions**. The task picker uses saved local
coding-session metadata; opening it queries no native provider. It offers registered
Codex tasks and verified Claude Code tasks in a Personal companion workspace.

Choose one connected action, a plan revision, a 1–60 minute lifetime and literal
project-relative files. The additional classification fields explicitly include or
exclude untracked and ignored files. Ignored inputs and generated-tree exclusions
are restricted to the pinned scanner by the backend.

**Inspect task and review permission** checks the actual native task, account,
repository identity, Git snapshot and file scope. It starts no program. The review
shows that exact scope and requires a separate confirmation to save the grant.
Changed task/account/policy/files invalidate it. Saving publishes only the new grant
identity to the execution selector; a recipe still needs its own review and approval.

Saved permissions can be revalidated or separately reviewed for revocation.
Revocation also works in keyboard-only mode. It does not undo effects or establish
that an owned process stopped; use the separate execution stop control.

Workspace and form changes invalidate an open review. A lost response is retained
as unknown in the UI, followed by metadata-only history; the UI never automatically
issues another grant. A late reply cannot populate another workspace.

These controls use the existing [task-authority contract](task-authority.md) and
[reviewed execution workbench](reviewed-execution-controls.md). The [scanner setup controls](scanner-setup-controls.md) can fill a saved setup's
file scope here for a fresh review. Live native account use and browser
visual acceptance remain separate from the HTTP interaction tests.

Eight original groups pass 66 tests without skips. The final eight-case UI run
adds combined permission-to-execution selection and overlaps the broader run.
Eight checks pass on the isolated running preview. Exact commands, bounds and
cleanup verify. [Source evidence](evidence/authority-ui-source-summary.json).
