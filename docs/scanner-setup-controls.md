# Prepare a scanner setup in the Studio

Activity → **Prepare a scanner setup** starts from a named saved coding task and
already installed signed scanner/advisory feeds. Loading their metadata queries no
native provider and downloads no feed.

Choose current files, optional separately witnessed staged Git versions, and up
to six first-parent commits for codebase/release review. Preparing the review
checks the native task, read-only repository metadata, bounded source inputs and
signed feed content. The dialog starts with the project, new output directory, current/staged/historical
file lists, exclusions, feed names and coverage limits. Each generated file expands
to its exact text and hash. **Technical details and verification hashes** retains
the complete preparation metadata and proposed permission scope; it starts closed.
Cancelling or changing the form/workspace clears both views and the approval.
[Readable-review and clearing regressions](evidence/scanner-review-readable-source-summary.json)
pass 58 checks across five original integration groups. Normal installed **167df7b** passes 45 served/state/presentation checks and 126
metadata checks. Prepared staging is removed; visual acceptance remains separate.
[Installed receipt](evidence/installed-desktop-host-summary.json).

Bounded history review also lists names found in older inspected commits but
absent from the selected HEAD and outside the selected history inputs. Up to 64
portable regular-file names appear, with exact omitted/unsupported counts. Names
come from already verified trees; they are not added to the scan or its permission.
Deeper history and other branches remain uninspected.
[Discovery evidence](evidence/history-path-discovery-source-summary.json).

Confirming the save creates only the reviewed new control files. Existing source
paths are never replaced. The saved setup offers two explicit next steps:

1. **Prepare its task permission** fills the separate permission form. It grants
   nothing: inspect and confirm the fresh task/account/repository/file scope.
2. **Select its execution recipe** finds a unique current saved permission for
   the exact task/action/manifest and fills the execution form. Multiple or missing
   grants require explicit selection or a fresh permission. Review and confirm
   execution separately; selecting the recipe never starts a scan.

Form and workspace changes discard generated review text and approval. Lost
responses and partial writes remain visible. **Inspect interrupted saves** checks
original ownership/output without writing, deleting or replaying files; uncertain
output stays preserved. History alone neither refreshes feed trust nor grants
current task authority. A clean bounded scan never proves complete security coverage.

The controls reuse [scanner drafts](scanner-recipe-drafts.md),
[reviewed saving](scanner-recipe-saving.md), [task permissions](task-permission-controls.md)
and [execution](reviewed-execution-controls.md). [Feed trust installation](feed-maintenance-controls.md) is a separate reviewed
operator decision in Settings. Browser visual review and live native account,
Windows guest and scanner-feed acceptance remain distinct from source tests.

[Source tests and exact boundaries](evidence/scanner-ui-source-summary.json) record
93 passing tests in eight original groups and 22 passes in the final three UI
groups, with overlap. Seven interaction cases include staged/history provenance,
partial-save recovery, lost successful replies and scope changes.
