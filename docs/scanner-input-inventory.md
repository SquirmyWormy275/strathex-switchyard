# Prepare scanner inputs

## Prepare a review automatically

`POST /api/suite/coding/authority/scanner-review` prepares an exact current-file
review for one bound task and one connected Shield action:

```json
{
  "taskId": "11111111-1111-4111-8111-111111111111",
  "action": "shield_codebase_audit",
  "planRevision": "review-1"
}
```

The UUID above is an example; use the actual task identity. This route gathers
tracked and new files, includes recognized ignored secret inputs, and proposes
whole ignored generated directories as explicit exclusions. It then captures
the actual file hashes and excluded-directory identities through the existing
protected inspector. It refuses unknown ignored paths, missing tracked files,
changed file sets, revision drift and task/account/workspace changes. Use the
metadata preview below and the ordinary exact-file review for unsupported cases.

The response contains the normal `requires-confirmation` review, exact `scope`
and a `preparation` summary. Nothing is granted or scanned. Display every included
path and exclusion before passing the unchanged proposal fields and its one-use
token to `coding/authority/issue`. Issuance captures the inputs again; later scans
still need their existing separate execution review. The generated proposal
cannot authorize commits, general commands or arbitrary ignored-tree exclusions.

The existing feature-branch, native-task and Personal companion requirements
remain. At most 256 selected files and 32 named generated roots fit this path;
no files are silently truncated. Generated contents, unselected staged/history versions and
broader security coverage remain unverified. A complete target snapshot means
the displayed scope is witnessed, not that the repository passed a security scan.
Frontend controls remain pending.

## Include staged versions in the review

Add `"includeIndex": true` to the same request to prepare the complete supported
index alongside the current-file scope. Omitted or `false` keeps the existing
current-file behavior. The response uses `bounded-current-and-index/v1` and adds
`preparation.indexInputs`, `indexTree` and `indexMetadataSha256`. Each input has the
exact reserved path, SHA-256, byte length and Git source descriptor required by
the [staged scanner contract](staged-shield-inputs.md). No source bytes are returned.
`fileCount` counts current paths; `indexInputs.length` counts their staged copies.

Preparation derives every tracked path from the captured repository, witnesses
its raw staged blob, reconstructs the complete Git tree and compares it to the
reviewed snapshot. It then captures the target again. An index temporarily
changed during witnessing cannot match merely because it returns to its original
state afterward. HEAD, worktree, task, account and selected-workspace drift also
refuse confirmation. Both SHA-1 and SHA-256 repositories use Git's exact object
framing and bytewise directory ordering; ambiguous portable names are refused.

This path accepts 1–64 regular tracked files, at most 256 KiB per staged blob,
448 KiB combined staged content, and at most 256 current-plus-staged inputs.
Windows retains its smaller 320 KiB native transport limit. Existing UTF-8,
metadata, output and deadline bounds remain. Oversized selections are refused
whole; links, submodules and unknown ignored classifications remain unsupported.

The returned descriptors can populate a separately reviewed Shield request and
recipe allowlist. Preparation neither writes those files nor grants authority
nor starts a scanner. Authority owns the original source paths; reserved aliases
exist only inside disposable staging. Execution independently re-witnesses the
bytes. Automatic recipe/feed assembly, broader history and frontend controls
remain unfinished; this preparation does not establish complete security coverage.

## Include bounded history in the review

For Codebase Audit or Release Shield, add `"historyDepth": 4` to prepare historical
versions of the current tracked paths. Choose a depth from one to six. This uses
the existing raw commit/tree/blob verifier; callers cannot import revisions,
object IDs, paths or arbitrary Git commands. `includeIndex: true` cannot be combined
with this option because mixed index/history execution remains unimplemented.

The `bounded-current-and-history/v1` response adds `historyInputs` with the exact
reserved paths and source descriptors for the [historical scanner](historical-shield-inputs.md).
It also returns the observed HEAD, selected paths/depth, metadata digest, stopping
boundary, shallow flag, absent versions and explicit coverage gaps. New staged
paths absent from the selected commits stay absent; no source version is invented.
Only names currently tracked are automatically selected. Historical paths removed
from the current repository require the separate explicit reader and remain
outside this automatic authority path.

At most eight tracked paths and 48 historical versions fit this preparation.
The reader retains its 256 KiB per-blob and 448 KiB aggregate unique-byte limits.
Windows also counts repeated versions against its 320 KiB transport limit.
Current paths plus historical descriptors must fit the 256-file execution limit;
excess inputs are refused whole. A final target capture refuses intervening HEAD,
index, worktree, task, account or selected-workspace changes before confirmation.

This prepares metadata for a separately reviewed request and recipe. It neither
assembles those control files nor starts a scanner. The history gaps still include
other refs, non-first-parent branches, commit messages, renames and versions beyond
the chosen depth or shallow boundary. Authority and security coverage remain
ungranted/unverified until their separate steps; no complete passing gate is added.

## Preview names before choosing a scope

The authenticated `coding/authority/scanner-inputs` API accepts one bound native
`taskId` in the active Personal companion compartment. It returns a read-only
metadata preview to help an operator choose inputs for a later exact scan.
It grants no authority, issues no security receipt and submits no model prompt.

The preview lists tracked and new paths, groups ignored directories and identifies
ignored `.env` variants, npm/Python credential configuration, named credential
JSON and certificate/key-file names outside its declared build trees. Unknown
ignored paths stay unclassified. The response lists the exact built-in names and
build-tree prefixes used by this preparation policy.

Git's [NUL and directory listing modes](https://git-scm.com/docs/git-ls-files)
provide literal names without expanding every ignored build file. Fixed Git
queries disable fsmonitor, untracked caching, interactive credentials, network
protocols and shell execution. Git consults its configuration and ignore metadata;
the application does not hash source-file bytes or return their contents.

Large ignored `node_modules`, virtual environments, caches, `dist`, `build`,
`target` and coverage trees are shown as possible exclusions for operator review.
Their contents, including secret-file names hidden inside them, remain uninspected.
Other ignored directories can contain both known secret-file names and unknown
paths; finding one relevant name does not establish that directory's coverage.
Path kinds describe Git's listing, not verified regular files or safe links.

The API checks the bound native task/account and repository identity before and
after inspection, verifies a stable HEAD and tracks every native query guardian.
Mode/selection/account changes and unknown input fields refuse the preview.
It uses the existing 45-second inspection budget, ten-second query deadlines,
256 KiB query output and 4,096 combined path bound. Ambiguous, duplicate,
traversing, reserved or malformed paths fail closed. Owned scratch is removed
only after native exit; uncertain ownership retains the existing recovery path.

Every preview remains incomplete: file and staged bytes are unwitnessed,
unclassified ignored paths and build-tree contents remain unknown, and no complete
repository scope is established. Its metadata digest is a preparation fingerprint,
not a target snapshot or approval token. Worktree contents can change after listing.

Four focused tests cover bounded parsing/classification, real Git, an authenticated
HTTP journey with an 80 MiB sparse ignored build file, unchanged source/index/HEAD,
no granted authority, task/account/revision drift and verified probe cleanup.
Thirty-four surrounding authority, ignored-input, runner and package cases pass,
with type checking. The new file also passes its normal isolated group with
verified child cleanup (`isolated-test-56f81042-a616-4957-85a1-44d15d9a8152.json`).
The first installed verifier failed after the preview because it incorrectly
required an empty receipt journal despite three legitimate feed-maintenance
receipts. That failed outcome is retained in
`installed-shield-baseline-1793862918331.json`; original user state was restored,
no scanner program or model prompt ran. The verifier now compares the journal
before/after inventory. Exact synthetic cleanup passes with seven independently exited preview probes,
retired public packages/trust, restored original state and removed source/signing/
sparse build fixture (`failed-inventory-proof-cleanup-1793863016294.json`).

Normal installed `bfb7f1d` then passes six update and sixteen actual preview/scan
checks. Receipts `assignment-legends-1793863080369.json` and
`installed-shield-baseline-1793863236319.json` retain the unchanged prior journal,
no granted inventory authority, exact native probe exits, later separate ignored-
secret scans, two scanner exits and full restoration. Owned source/signing/
packages/staging/bundle/proof checkout are removed; one empty task, zero prompts.

For a synthetic installed demonstration after updating to this source, run:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_change_scan --ignored-secret-input --inventory-preview
```

The verifier removes its own large sparse build fixture after inspection, before
the separate scanner authority review. Existing authority still requires exact classified file hashes. A separate
[reviewed generated-tree policy](ignored-build-tree-policy.md) can now exclude
whole named ignored roots using explicit directory-identity witnesses; the
preview does not apply that policy or grant it. The automatic current-file review
above now assembles supported bounded selections. General complete-target scan assembly, persisted
operator-configured general exclusions,
history scanning and the frontend remain unfinished implementation. A separate
[explicit Linux staged-input scan](staged-shield-inputs.md) now preserves both
index and worktree origin; bounded staged descriptors can now be prepared above.
Automatic complete recipe assembly remains unfinished. Windows staging now has contract checks;
actual NTFS/guest acceptance remains separate.
See [explicit ignored scanner inputs](ignored-scanner-inputs.md) for the distinct
reviewed read-only scan path.

## Automatic review verification

Twenty-five groups pass 100 checks; a five-case composed follow-up brings this
change to 102 distinct checks. The authenticated HTTP review covers one-use
issuance, ignored secrets, explicit build exclusions, hash drift and preserved
original files/index/HEAD. One actual Linux scanner run and one Windows guest
double retain authenticated incomplete findings, replay refusal and cleanup.
Native task identity and Git guardian witnesses use controlled doubles in these
fixtures; the Linux scanner process itself executes and independently exits.

The first focused run exposed two fixture assertions that assumed an empty
confirmation array existed. A later broad run caught the omitted new timeout
inventory entry and a complete test bundle exceeding 5 MiB by 410 bytes. Both
failed receipts remain recorded. The builder now leaves two unused first-party
README copies in the repository; attribution, third-party notices, pinned
upstream files and the frozen frontend remain. The corrected complete test
bundle is 5,228,487 bytes, with the original budget unchanged. All sixteen
installation scenarios pass. These source checks do not accept live installed
scanning, a real Windows guest or frontend controls.
[Evidence](evidence/scanner-review-source-summary.json).

Installed `49a5053` now verifies the exact tested modules and SDK preflight
within 34 metadata/synthetic checks, preserving all 54 workspaces and frozen
frontend bytes. This installed verification starts no live task, scanner or
enrolled agent. [Installed evidence](evidence/installed-scanner-sdk-summary.json).

### Staged preparation verification

Thirty-three groups pass 129 tests, with original commands, deadlines, skips and
child/tree cleanup verified. Independent real Git repositories establish SHA-1
and SHA-256 tree framing, nested directory ordering, empty and executable blobs.
The authenticated HTTP journey returns no source text and preserves the original
index. Changed index, HEAD, worktree, account and workspace selection refuse
confirmation, including an index mismatch between two unchanged snapshots.
Separate Linux execution detects a staged-only secret; the Windows guest double
retains the same reviewed origin and incomplete result. Both preserve the
original worktree/index/HEAD and verify owned process/staging retirement.

The missing-feature red receipt and an intermediate fixture failure are retained:
the fixture originally captured index bytes before its own reference `write-tree`
command refreshed Git's tree cache. Capturing the baseline after that reference
command corrected that fixture, but did not cover a cold index. The new history
review exposed a real cache mutation in protected target capture; the correction
and independent cold-index/object-database checks are recorded below.
Typecheck, installation recovery and the original 5 MiB package limit pass.
Owned temporary test staging is removed. Live installed scanning, actual Windows
guest behavior and frontend controls are not accepted by these source tests.
[Evidence](evidence/scanner-index-review-source-summary.json).

Installed `ba172a1` verifies the exact staged-preparation modules within 76
metadata/in-memory checks and preserves all 54 semantic workspaces and frozen
frontend bytes. The prepared bundle is removed after normal versioned update.
This is installed source/compatibility verification; it starts no installed
scanner or native provider task.
[Installed evidence](evidence/installed-scanner-index-review-summary.json).

### Historical preparation and read-only inspection verification

The latest results across 58 focused groups pass 202 tests, with original
commands, deadlines, skip counts and child/tree cleanup verified. Thirteen new
history cases cover authenticated preparation, explicit absence/shallow bounds,
drift refusal and separately reviewed historical-only detection in an actual
Linux scanner and a Windows guest double. Independent Git SHA-1/SHA-256 fixtures
verify that protected target capture preserves cold index bytes and the object
database. [Read-only index contract](read-only-index-tree.md).

The initial broad run failed packaging and a long Unix-socket fixture path.
The short owned test root fixes the latter; adding the new tree module to the
builder's explicit runtime closure fixes packaged startup. All seventeen package
and installation groups pass after that change. Failed receipts remain retained;
no timeout, package budget or product assertion was relaxed. Type checking
passes and both empty owned test parents are removed.
[Source evidence](evidence/scanner-history-review-source-summary.json).

These are isolated source checks. The installed backend has not yet been updated
to this checkpoint; native Windows history acceptance, recipe/feed assembly,
mixed index/history execution and frozen frontend controls remain separate.
