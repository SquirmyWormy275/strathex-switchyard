# Acceptance-gate register

Every gate below is **not evaluated** in this baseline. The tests only cover
the static protocol and preview-only router; they do not satisfy an acceptance
gate.

| # | Gate | Status |
| --- | --- | --- |
| 1 | Hardware identity and chord uniqueness | Not evaluated |
| 2 | Multi-target integrity and picker-or-stop | Not evaluated |
| 3 | Honest unknown/stale/unavailable states | Not evaluated |
| 4 | Durable idempotency and crash reconciliation | Not evaluated |
| 5 | Test-data and production-credential isolation | Not evaluated |
| 6 | Scoped authority without bypass | Not evaluated |
| 7 | Immediate complete TargetSnapshot revalidation | Not evaluated |
| 8 | Containment honesty | Not evaluated |
| 9 | Claude/Codex provider parity | Not evaluated |
| 10 | Council failure cases | Not evaluated |
| 11 | Voice binding and redaction | Not evaluated |
| 12 | Quarantine isolation boundaries | Not evaluated |
| 13 | Checkpoint recoverability | Not evaluated |
| 14 | Physical usability and legends | Not evaluated |
| 15 | Mediated-only mutation enforcement | Not evaluated |
| 16 | Crash after every child side effect | Not evaluated |
| 17 | Snapshot invalidation inputs | Not evaluated |
| 18 | Prompt-injection resistance | Not evaluated |
| 19 | Credential isolation in high-risk paths | Not evaluated |
| 20 | Persistent containment and authenticated release | Not evaluated |
| 21 | Council epoch and lease safety | Not evaluated |
| 22 | Transport lifecycle and Raw HID coexistence | Not evaluated |
| 23 | Adapter degradation | Not evaluated |
| 24 | Partial-failure recovery | Not evaluated |
| 25 | Voice privacy and single-target routing | Not evaluated |
| 26 | Untrusted URL defense | Not evaluated |
| 27 | Budget, retry, concurrency, and cancellation | Not evaluated |

High-consequence controls cannot be enabled by changing this document. They need
the corresponding mediated implementation and observed gate evidence.
