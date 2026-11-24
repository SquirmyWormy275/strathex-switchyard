# Try the Switchyard configuration workspace

Use Node 24.14.0 from `.node-version`. From the repository root:

```sh
mise exec node@24.14.0 -- npm ci --ignore-scripts
mise exec node@24.14.0 -- npm run layout:studio
```

Open the printed local URL. Home introduces the recommended setup; choose your
keyboard and use its reference arrangement, then open Customize to edit it.
A reference cannot establish your actual firmware or typing layer. Read/import
the actual configuration before reviewing a host or device change.

Saved workflows contain named steps, roles and ordering relationships. Reordering
an unchanged label preserves its identity; renaming a role creates a new identity
so it cannot inherit an old agent connection. A proposed workflow is editable
data, not permission to run an agent or modify a keyboard. Local tool connections
and device transactions have their own review and capability checks.

The backend correction rejects non-string role/step IDs, unknown relationships,
duplicate edges and cycles. Rejected edits preserve the encrypted profile,
bindings and revision history. All 57 existing saved workflows pass read-only
compatibility checks. Five read-only/in-memory checks also pass against the
installed workflow module. [Source evidence](evidence/workflow-identity-source-summary.json),
[installed evidence](evidence/installed-workflow-identity-summary.json).

Portable imports and local role connections now require literal string identities.
Malformed v1 imports can no longer acquire helper defaults or replace the current
encrypted arrangement. Two regressions reproduce the original defect; five
focused groups/81 checks plus six verifier guards pass. All four saved profile
documents remain compatible and all 54 sealed workspace files are unchanged.
Legacy Studio-plan migration and intentional helper defaults still work.
Typecheck, original package bounds and exact owned cleanup pass. Five installed profile checks now pass in the 66-check metadata update;
native Windows profile correction acceptance remains separate.
[Installed evidence](evidence/installed-profile-identity-summary.json).
[Source evidence](evidence/profile-identity-source-summary.json).


The [Studio guide](../tools/layout-studio/README.md) covers QMK imports, aggregate
observations, direct editing and exports. The [portable-profile guide](portable-profiles.md)
explains which preferences travel and which local bindings must be reviewed again.
Guided role/device setup, saved conversations, task controls, scanner setup and
reviewed execution share this interface. Browser task acceptance remains open.

If saved workspaces cannot load because the desktop keyring is locked, unlock it
in the system password prompt and choose **Retry workspace connection**. Keep
the encrypted workspace files and their existing keys; resetting them is not a
connection repair. The retry preserves an unsaved layout and does not replay
previous keyboard, application or agent actions.

Switching workspaces saves the current layout before opening the destination.
If saving fails, your unsaved layout stays open. If the destination cannot load,
retry its connection; the previous layout remains saved in its original workspace.
When another window changes the selected workspace, use the workspace menu to
choose deliberately. Reconnecting alone never moves your current draft there.

This is a private development build, with no public installer or new release.
See [current behavior and evidence](switchyard-status.md) before applying changes.
