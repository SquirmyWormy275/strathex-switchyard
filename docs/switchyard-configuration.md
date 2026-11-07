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
compatibility checks. This correction has source acceptance; installed
acceptance is pending. [Evidence](evidence/workflow-identity-source-summary.json).

The [Studio guide](../tools/layout-studio/README.md) covers QMK imports, aggregate
observations, direct editing and exports. The [portable-profile guide](portable-profiles.md)
explains which preferences travel and which local bindings must be reviewed again.
Home/catalog is frozen for review, and newer backend capabilities may not yet
have UI controls.

This is a private development build, with no public installer or new release.
See [current behavior and evidence](switchyard-status.md) before applying changes.
