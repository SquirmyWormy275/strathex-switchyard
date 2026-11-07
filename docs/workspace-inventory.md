# Every saved workspace remains discoverable

The old metadata list silently returned its first 32 entries. A later workspace
could still exist with its protected key and sealed state, yet disappear from
bootstrap discovery or be refused by an uninitialized route. The pilot has 54
saved workspaces, so this was a real setup limit.

The store now returns every valid sealed-workspace identity in deterministic
order, up to an explicit 256-entry metadata bound. Overflow and a matching entry
that is a directory or link refuse with an explanation; neither returns a partial
inventory. Listing uses filenames without decrypting content or opening workspace
keys. Private files, keys and selections are preserved. This metadata bound is
not permission to remove older audit records.

The existing bootstrap response uses this complete list. A separate authenticated
route avoids provider discovery:

```text
POST /api/suite/compartment/inventory
{}
```

The closed response identifies schema `switchyard-compartment-inventory/v1`,
`compartments` containing only IDs, `activeCompartment`, `complete: true`,
`authorityGranted: false` and `providerObserved: false`. Normal selected-workspace
initialization remains in effect. Selection, provider and replay fields refuse;
saved selection drift must be resolved through the application first. Metadata
does not establish account, content or task authority.

Four isolated Suite/lock/restoration/verifier groups pass 31 checks with every
cleanup verified (`isolated-test-cef284b0-5dc0-4a2b-b01f-5cd67e42789b.json`). The
regression creates 54 real sealed workspaces, keeps a selected identity beyond
the old cutoff, verifies metadata with credential reads disabled, exercises
bootstrap and the fixed route, and checks non-file substitution, the full bound
and selection drift. The first fixture compared pre-restart bytes with deliberate
restart bookkeeping; its failed receipt `isolated-test-6a27a4ff-1611-4314-b7c7-5639229173e2.json`
remains retained. The corrected preservation baseline is taken after restart.

The normal installed read-only verifier now checks this inventory alongside
journal privacy/refusal boundaries:

```sh
node scripts/verify-copilot-journal-host.mjs --read-only-metadata
```

It creates no workspace and submits no provider request or keyboard transaction.
Normal installed source `2276ac2`, release `f325bc46…`, now passes six update
and seven actual metadata/privacy checks. All 54 saved pilot identities appear;
selected sealed bytes, definitions/mode/readouts, endpoint and frozen Home stay
unchanged. The owned bundle/checkout are removed, with zero provider requests,
model prompts, new workspaces or keyboard access.
[Exact receipts](evidence/installed-copilot-journal-summary.json).
