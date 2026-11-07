# Generate a scanner setup for review

The authenticated `POST /api/suite/coding/authority/scanner-draft` route assembles
the pinned scanner engine, selected signed feed content, request and execution
recipe into one draft. It uses the same bound native task, Personal workspace,
file witnesses and generated-tree exclusion policy as the automatic scanner
review. It writes no repository files, grants no authority and starts no scan.

```json
{
  "taskId": "11111111-1111-4111-8111-111111111111",
  "action": "shield_codebase_audit",
  "planRevision": "scan-1",
  "scannerFixtureId": "selected-installed-scanner",
  "advisoryFixtureId": "selected-installed-advisory"
}
```

Use actual task and installed feed identities. The advisory field is optional.
Add `includeIndex: true` or `historyDepth: 1..6` for the supported independent
[staged/history selections](scanner-input-inventory.md). Mixed index/history
execution remains unsupported. Commands, paths, imported approvals and arbitrary
feed URLs cannot override this route.

The response contains UTF-8 generated `files`, each with its exact path, size and
SHA-256, under one new UUID-named directory. It also includes the recipe, request,
manifest identity, verified feed metadata and a proposed authority scope for
after saving. Repository source contents stay private; only their descriptors
appear in the draft. Generated engine/feed/control text is deliberately returned
so the operator can review what would be saved. Existing source bytes, index and
HEAD remain unchanged by preparation.

Signed feed content is rehashed and trust, revocation and expiry are checked
again after assembly. Task/account/workspace and target changes refuse the draft.
Source/feed files retain the scanner's 2 MiB per-file bound and selected source
bytes its 16 MiB total. Request and recipe JSON each fit 128 KiB. Generated controls
count toward the 256-input recipe and 256-path authority bounds. The shared
execution-input validator also enforces portable names and directory depth.

Saving is a separate step. After saving the exact new control files, obtain a
fresh ordinary task-authority review and then a separate execution review using
the returned manifest path/hash. The draft contains no approval token. Its
suggested classifications do not override actual Git state; changed or ignored
control files can require fresh classification. Execution rechecks source bytes,
the shipped engine and installed feed trust through its existing boundaries.

The source demonstration exercises this full save/review/scan sequence in an
isolated repository and finds a synthetic private key with a real Linux scanner.
It preserves the original index/HEAD, refuses duplicate execution and verifies
native/staging retirement. Twelve draft cases cover authenticated normal Suite
wiring, privacy, drift, revoked/expired feeds, current/index/history selections
and byte/path bounds. The latest results across 31 focused groups pass 154 tests,
including all package/update/recovery scenarios. A reproduced directory-depth
defect and initial TypeScript annotation failure remain recorded; both are fixed.
[Source evidence](evidence/scanner-recipe-draft-source-summary.json).

Automatic reviewed saving/installation and frozen frontend controls remain
unfinished. This draft API does not establish a normal UI setup journey, a real
Windows guest scan, broad security coverage or a complete passing Shield gate.
\nInstalled `6ab9b1e` verifies scan-draft assembly within **76 metadata/in-memory
checks and 30 exact module hashes**. All 54 semantic workspaces, selection,
pending keyboard-only conversation and frozen frontend are preserved; 53 sealed
files are byte-identical and one changes only audit metadata. All four profiles
and 57 workflows remain compatible. Dated backup and launcher readback verify;
current plus one rollback remain. The exact 533-file, 5,213,310-byte prepared
bundle is removed. No installed draft, scanner, native provider task, account/model
request or hardware operation was invoked.
[Installed evidence](evidence/installed-scanner-recipe-draft-summary.json).
