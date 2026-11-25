# Scan a file that was deleted from Git

A clean working directory can still have a secret in an earlier commit. For a
Codebase Audit or Release review, Switchyard can include deleted files from the
selected first-parent history without restoring them to the project.

In **Activity → Prepare a scanner setup**, select a history depth and enable
**Include files deleted from this history range**. Review the current, staged and
historical versions, then save the new control files. **Prepare its task
permission** carries the historical scope into a separate, visible read-only
section. Confirm that permission and separately review the execution recipe.

The historical grant binds literal paths, depth, starting HEAD and a digest of
verified commit headers, trees, blobs and absence evidence. Permission issuance,
revalidation and private byte consumption check those bindings again. The complete
historical selection must match; a subset, extra path, changed depth or changed
history cannot reuse the grant. Current files retain their existing task-owned
snapshot and classification rules. Index inputs cannot borrow historical access.

The existing limits remain: eight selected history paths, six first-parent
commits, 256 combined recipe inputs, original Git object limits, and the smaller
320 KiB Windows transport allowance. Unsupported or excessive removed paths
refuse automatic assembly. Newly staged files with no historical version remain
current/index inputs. No ref, command, arbitrary commit or approval can be injected
through the selection.

The source demonstration saves reviewed control files, obtains a fresh permission
and runs the real isolated Linux scanner against a synthetic secret in a deleted
file. It verifies a historical finding, redacted output, unchanged project index
and HEAD, no recreated deleted file, independent process exit and owned staging
cleanup. The Windows path uses actual Git blobs with an explicit guest double.
UI interaction tests cover the authenticated selection and handoff, not graphical
rendering. [Exact evidence](evidence/removed-history-scope-source-summary.json).

This is bounded history coverage. Other branches, deeper history, commit messages
and rename following remain outside the scan. A clean result does not establish
complete security coverage. Native Windows guest, live account and browser visual
acceptance remain separate.
