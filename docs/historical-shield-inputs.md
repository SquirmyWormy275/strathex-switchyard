# Scan explicitly reviewed historical versions

Removing a secret from today's file does not remove it from earlier commits.
Linux Codebase Audit and Release Shield now connect the bounded
[history byte reader](git-history-inputs.md) to the existing pinned scanner,
separate review/approval, private disposable inputs and authenticated receipts.
This is a selected-path, first-parent subset with incomplete coverage.

A reviewed request includes every witnessed regular version of each selected
path within one depth, using a reserved disposable alias:

```json
{
  "path": ".switchyard-history/DERIVED_COMMIT/src/app.js",
  "sha256": "EXACT_SOURCE_SHA256",
  "size": 64,
  "source": {
    "kind": "git-history",
    "path": "src/app.js",
    "commit": "DERIVED_COMMIT",
    "objectId": "DERIVED_BLOB_ID",
    "mode": "100644",
    "depth": 4
  }
}
```

`DERIVED_COMMIT` and `DERIVED_BLOB_ID` stand for actual hexadecimal identities
returned by the witness API. Neither becomes a caller-selected Git command or
revision: the host independently derives bounded history from current HEAD and
compares every declared commit/path/blob/mode/size/hash to verified raw objects.
All versions returned for the selected paths must be included. Original paths
must belong to the exact active task-owned file grant; a virtual alias does not
expand that grant. Current files can be scanned alongside historical versions.

Review, admission and private staging repeat the witness. Protected scope binds
HEAD, selected depth/paths, stopping boundary, exact rows and the aggregate history
metadata hash. The private consumer rechecks the exact derived traversal and shallow state after staging;
a changed revision removes owned copies before starting a scanner. Borrowed
buffers are cleared on success and failure. Historical bytes use a separate
`historyBytes` channel; they are never labeled as Git index bytes. Original
repository aliases are never created, and physical aliases cannot substitute.
General Run/pipelines, other Shield actions, nested aliases and control/feed files
cannot use this channel. Combined index/history requests remain unimplemented
and refuse explicitly. The [Windows historical scanner connection](windows-history-staging.md) now passes
software contracts with the guest doubled; native NTFS/guest/installed acceptance
remains separate. An unconnected host refuses instead of using current files.

Reports preserve original historical source descriptors, redact values, and bind
`gitHistoryInputs` in authenticated tool evidence. The report retains
`git_history_partially_scanned`, incomplete coverage and no complete passing
gate. Other refs, non-first-parent branches, messages, renames, unselected paths
and versions beyond the bounded/shallow boundary remain uninspected. Deleted
historical paths can be witnessed, but a path absent from the current grant cannot
yet be scanned through this connection. Automatic scope assembly, broader history,
full scanners and user-facing review remain unfinished software.

Five focused cases pass, including an actual isolated scanner finding a synthetic
secret removed from the current file, authenticated commit/blob provenance,
exact replay, unchanged original index/worktree/HEAD, verified native exit and
staging cleanup. A late-HEAD-change case removes staged copies and starts no
scanner. Pure contracts refuse invented/omitted/changed versions and unsupported
mixed sources; a real private-staging case rejects general execution, wrong bytes
and physical alias fallback. Private-consumer tests independently verify borrowed
buffer clearing on both success and late revision failure. Six isolated scanner/
history/index/runner groups pass all 60 checks with child cleanup
(`isolated-test-cc61dae8-a7f3-4781-acae-d8c4661e19f1.json`). A subsequent
three-group/21-check run covers the exact traversal recheck, including a changed
shallow chain whose boolean remains true (`isolated-test-db045785-1e6d-4abc-bd24-870649db6d74.json`).
Ten surrounding Windows/Linux execution, scanner, staging and package groups pass
22 checks with child cleanup (`isolated-test-35db7f9e-d4a0-4779-9444-448c060c2414.json`).
Type checking and the unchanged seven-component development BOM check pass.

The installed synthetic journey is now repeatable with:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_codebase_audit --historical-scan
```

The first installed `82eb764` journey retains failed receipt
`installed-shield-baseline-1793874504741.json`. Both actual scanner runs completed:
the historical-only secret was found with exact provenance and the current clean
comparison remained incomplete. The overall verifier then incorrectly attempted
to read a deliberately virtual history alias from the original repository. Its
original-state restoration and both scanner exits passed; the verifier now skips
both private Git alias namespaces while retaining checks of actual current files.
The failed outcome remains failed. Exact synthetic fixture/trust retirement,
sixteen retained query exits, two scanner exits, owned source/signing/package/
staging and proof-checkout cleanup verify in
`failed-history-proof-cleanup-1793874565999.json`. Corrected installed `4901cc8`, release
`ffd440981ebb02b4ffb887c94a8f7951a47608244a5bd5e9f3553de86cf7c471`,
passes six update/thirteen actual historical-scan/API checks. Both scanner exits,
exact provenance, replay/feed retirement and full restoration verify. Receipts
`assignment-legends-1793874653637.json` and
`installed-shield-baseline-1793874824975.json` are retained. Owned source/signing/
packages/staging/bundle/proof checkout removed; one empty task, zero prompts,
no keyboard access. It creates only a synthetic repository and
one empty native task, submits no model prompts and opens no keyboard.

## Native Windows staging acceptance

Source `6b4089c`, equal-tree execution `44014879`, passes six original native
NTFS history packet checks with the built Windows helper. Private ACL/root
identity, exact object/content/packet hashes, native rejection after JavaScript
validation, all three independent guardian exits and owned scratch retirement
verify. Original worktree/physical alias/unselected bytes and the helper image
remain unchanged. The packet witness is synthetic; this proof does not observe
an actual Git repository or launch a task/guest.

The corresponding Windows scanner file separately passes both original cases
on an actual Windows host, with the guest doubled and child/tree cleanup verified.
Both artifact ZIP SHA-256 values, original proof schemas and equal source/merge
tree are verified; no ZIP is retained. Actual guest and installed Windows
acceptance remain separate.
[Native evidence](evidence/native-history-index-leases-summary.json).
