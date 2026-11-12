# Scan current, staged and historical versions together

Codebase Audit and Release Shield can include all three sources in one reviewed
scan. Add both `"includeIndex": true` and `"historyDepth": 1` through
[scanner preparation](scanner-input-inventory.md) or the
[draft API](scanner-recipe-drafts.md). Depth remains one through six.
The preparation policy is `bounded-current-index-and-history/v1`.

Each version retains its typed worktree, index or commit/blob descriptor. A clean
current file does not hide findings in staged or historical versions. Reports
preserve provenance and existing incomplete-coverage gaps.

## Authority and private inputs

Both witnesses must retain the same reviewed HEAD. Current files, index rows,
history rows and generated controls share the original 256-input limit.
Each reader independently rechecks the exact task, account, workspace and source
snapshot. Saving and execution retain their separate reviews.

The index reader finishes before the history reader starts. Bounded copies of
index bytes survive that first lease and are zeroed after success or failure.
Native inspection leases never overlap. Historical traversal, stopping boundary,
shallow state and original blobs remain independently verified. Reserved virtual
paths cannot fall back to physical worktree files.

Windows requires both packet and witness hashes for both sources before handoff.
The combined Git payload fits the existing **320 KiB** raw transport limit; the
whole private request fits **512 KiB**. NTFS staging retains its ancestor/file
identity controls. No token, privilege, ACL or account boundary changes.
General Run and pipelines cannot consume these scanner-only aliases.

## Evidence and limits

The latest results across **56 focused groups pass 348 tests**, with five declared
platform skips. A real Linux scan detects synthetic secrets in staged and
historical versions, preserves original worktree/index/HEAD, refuses replay and
verifies native exit and staging removal. Windows transport and guest doubles
verify combined proofs and late source drift. Actual mixed NTFS staging now
passes on Windows at `edb76de`: two groups, 20 passing tests and one Linux-only
skip. Exact source/merge trees, artifact hashes, original commands, bounds and
child/tree cleanup verify. The scanner guest remains doubled.
[Native evidence](evidence/windows-mixed-scanner-native-summary.json).
[Source evidence](evidence/scanner-mixed-input-source-summary.json).

Typecheck and offline compilation of 34 native sources pass with zero warnings
or errors. The owned 33-file, 1,486,912-byte compiler output and empty test parent
are removed. Initial selector-import, obsolete-refusal and CI scheduling failures
remain recorded with passing corrections. A sixth Windows worker preserves the
original load ceiling, child bounds and 20-minute job deadline.

Coverage remains bounded first-parent history for currently granted paths.
Other refs, deleted ungranted paths, renames and broader security coverage remain
unfinished. Frozen frontend controls, interactive Windows journeys, real accounts
and physical devices are separate.
