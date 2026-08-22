# Adversarial review — implementation index

> Source: section 9 of the accepted complete specification. This index makes
> the implementation consequences explicit; the source document is controlling.

## What holds up

- The two-bank model is coherent and maps concrete operator friction.
- Empty modifier space and harder-to-trigger exceptional chords reduce accidental
  activation, although they are never a security boundary.
- Fresh state plus receipts is stronger than standing prompts for Re-anchor,
  Proof, Council, and repair-like workflows.

## Risks that shape this baseline

- Keyboard firmware is the smallest part; a usable product needs a companion,
  extension, registry, adapters, brokers, protected receipts, and recovery.
- `TargetSnapshot` must include dirty state and policy/scanner/environment
  inputs, not only a commit hash.
- Arbitrary desktop and terminal sessions cannot be assumed blocked, finished,
  coordinated, or enforceable. Unknown is an honest state.
- `.venv` is not isolation. Full Sandbox and Quarantine require enforceable
  boundaries for filesystem, credentials, data, network, and resources.
- Repository, CI, logs, browser content, and dependency output are untrusted;
  none may alter authority, targets, recipients, or gates.
- External side effects can survive crashes. Durable operation identifiers and
  provider reconciliation are required before retries can be safe.

## Resulting implementation rules

1. No companion command may silently commit, push, merge, force-push, approve
   permissions, or submit a prompt.
2. Multi-repo or multi-window ambiguity must stop or open a picker.
3. All baseline host output is an intent/preview; no green status implies a
   missing credential, unavailable adapter, stale receipt, or untested gate.
4. High-consequence control paths are hard-disabled in code until mediated
   execution and their acceptance evidence exist.
