# Small bundles and interrupted-install recovery

A growing backend exposed two separate limits during history integration. The
ordinary Linux package crossed its existing 5 MiB test budget by 1,222 bytes.
The complete immutable `82eb764` run also found that interrupted-install recovery
still capped its descriptor at 513 entries, while a release already allows 640
payload files plus its content manifest.

The builder now ships six browser-only modules once, in the independently verified
frozen frontend. Their redundant backend copies are omitted. Shared modules such
as the keyboard catalog remain available to the backend. The frozen frontend
contents and normal entry point are unchanged. The current software fixture is
5,173,870 bytes/509 payload files, below the unchanged 5 MiB test budget. No SDK,
optional runtime, private data or test source is added.

Release validation and installation recovery now share the existing 640-payload-
file ceiling. Directory verification and the recovery descriptor account for the
additional content manifest. The existing 128 MiB production byte ceiling remains.
A real boundary test constructs a 640-file release from small owned source/data
fixtures, installs the baseline, terminates the update at its copy boundary,
preserves an unrelated edit, then recovers the original stopped stage after that
edit is removed. All original installed entries remain unchanged. The test copies
no SDK/runtime or user data and removes its owned export/build files afterward.

All 21 direct package/installation tests pass, including actual offline backend
startup, the frozen frontend, rollback/owner-loss and the new maximum-size recovery.
Three isolated package/installation/runner groups pass all 38 checks with child
cleanup (`isolated-test-3818ce71-13c8-4ac6-bd79-04f6a2f50f94.json`).
The original failures remain failed:

- Complete Linux `82eb764`: 213/214 groups pass, 1,266 passed tests, one failed
  installation-recovery assertion and ten declared skips. Receipt
  `isolated-test-cdb74631-c09b-4890-bb12-a1e95d1540a4.json` is retained.
- The separate eight-group ordinary compatibility run passes seven groups/19 tests
  and fails the 5 MiB package assertion. Receipt
  `isolated-test-bdd94636-1723-4e2b-8565-8ba06e5b6e2f.json` is retained; every
  child cleanup verifies.

Every full-run child cleanup verifies; independent process readback found no owned
process. The owned failed checkout, dependency aliases and fixture parent were
removed after diagnosis, with receipt
`failed-full-history-install-cleanup-1793875722780.json`. The failed full receipt's
SHA-256 is `b4f30c2d391219f30c604b735249d1ebbe7677cd72e65ea40eb51f456613d4f1`.
Installed `13635bb` passes six normal update/thirteen historical-scan/API checks
with both scanner exits, exact frozen frontend, full restoration and owned scratch
removed (`assignment-legends-1793875875539.json`,
`installed-shield-baseline-1793876047390.json`). Zero prompts or keyboard access.
The corrected immutable `13635bb` checkpoint passes all 217 required groups,
1,283 tests and ten declared skips, with every child cleanup verified and owned
fixtures/aliases/checkout removed (`isolated-test-799530a3-c749-4c04-b5f5-7503e7b7c0f6.json`).
