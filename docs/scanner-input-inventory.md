# Prepare scanner inputs

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
the separate scanner authority review. Existing authority still requires exact
classified file hashes and refuses enormous excluded inputs; this preview does
not loosen that boundary. Automatic complete-target scan assembly, persisted
operator-configured exclusions, scalable consequential build-tree snapshots,
staged-byte/history scanning and the frontend remain unfinished implementation.
See [explicit ignored scanner inputs](ignored-scanner-inputs.md) for the distinct
reviewed read-only scan path.
