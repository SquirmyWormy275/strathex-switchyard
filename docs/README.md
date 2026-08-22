# Documentation provenance

- `SXSY-B122-complete-key-specification-and-audit.md` is the accepted complete
  22-key specification and includes its full adversarial review and 27 gates.
  It was copied faithfully from the accepted local source artifact on 2026-08-22;
  only three trailing Markdown line-break spaces were normalized.
- `SXSY-B122-key-decisions-historical-ledger.md` is the historical incremental
  ledger, retained for traceability. It is superseded by the complete design.
- `historical-interview-notes-reconstructed.md` is a clearly labelled
  reconstruction from the accepted specification and ledger. It is not a
  verbatim transcript.
- `adversarial-review.md` is a source-backed, implementation-oriented index of
  the review in section 9 of the complete design. It is not a substitute for
  that complete source.

The implementation follows the documented safety boundary: a keyboard signal
may route an intent, but only mediated execution can enforce policy.
