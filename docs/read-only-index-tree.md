# Capture an index tree without changing Git state

The protected repository inspector now reconstructs the logical index tree from
`git ls-files --stage -z`. It no longer runs `git write-tree` during target capture.
The latter can refresh the physical index's tree-cache extension and create tree
objects, even when it changes no branch or working file.

Tree reconstruction uses Git's exact object framing, bytewise file/directory
ordering and SHA-1 or SHA-256 format. It handles regular, executable, symbolic-link
and gitlink metadata without opening their targets. Empty indexes have the proper
empty-tree identity. Unmerged/sparse entries, malformed object IDs, duplicate or
conflicting paths, and listings beyond 4,096 entries or 256 KiB are refused; target
capture becomes incomplete. Scanner preparation keeps its narrower portable
regular-file bounds and existing submodule refusal.

The returned tree is an identity calculated from metadata. It does not assert
that a corresponding tree object was written or that source bytes were scanned.
All task/account/branch, file-digest and explicit authority requirements remain.
Native query deadlines and output limits are unchanged; `write-tree` is removed
from the protected inspector's query allowlist.

The historical-preparation test exposed the original cache mutation with a newly
staged file. Independent real Git fixtures now verify both object formats, nested
ordering, empty/executable/link/gitlink entries, byte-identical cold index files
and unchanged object databases. Their reference `write-tree` runs only after
the preservation assertions. The staged HTTP test also uses an unwarmed index.
These are isolated source checks, with no live user repository or provider task.

This correction covers `GitCliInspector` and the protected Suite inspector.
The legacy companion snapshot helper and approved Git mutation handlers have
separate implementations; this document does not claim they were changed.
