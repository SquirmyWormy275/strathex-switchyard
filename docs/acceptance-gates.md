# Acceptance-gate register

Every gate below is **NOT ACCEPTED**. The repository now contains local,
software-only mechanisms and isolated tests for relevant pieces of many gates,
but it has no authenticated hardware, operating-system, provider, credential,
or external-service evidence that would satisfy an acceptance gate. See
[software-only-completion-audit.md](software-only-completion-audit.md) for the
precise mechanism-to-evidence boundary.

| # | Gate | Status |
| --- | --- | --- |
| 1 | Hardware identity and chord uniqueness | NOT ACCEPTED |
| 2 | Multi-target integrity and picker-or-stop | NOT ACCEPTED |
| 3 | Honest unknown/stale/unavailable states | NOT ACCEPTED |
| 4 | Durable idempotency and crash reconciliation | NOT ACCEPTED |
| 5 | Test-data and production-credential isolation | NOT ACCEPTED |
| 6 | Scoped authority without bypass | NOT ACCEPTED |
| 7 | Immediate complete TargetSnapshot revalidation | NOT ACCEPTED |
| 8 | Containment honesty | NOT ACCEPTED |
| 9 | Claude/Codex provider parity | NOT ACCEPTED |
| 10 | Council failure cases | NOT ACCEPTED |
| 11 | Voice binding and redaction | NOT ACCEPTED |
| 12 | Quarantine isolation boundaries | NOT ACCEPTED |
| 13 | Checkpoint recoverability | NOT ACCEPTED |
| 14 | Physical usability and legends | NOT ACCEPTED |
| 15 | Mediated-only mutation enforcement | NOT ACCEPTED |
| 16 | Crash after every child side effect | NOT ACCEPTED |
| 17 | Snapshot invalidation inputs | NOT ACCEPTED |
| 18 | Prompt-injection resistance | NOT ACCEPTED |
| 19 | Credential isolation in high-risk paths | NOT ACCEPTED |
| 20 | Persistent containment and authenticated release | NOT ACCEPTED |
| 21 | Council epoch and lease safety | NOT ACCEPTED |
| 22 | Transport lifecycle and Raw HID coexistence | NOT ACCEPTED |
| 23 | Adapter degradation | NOT ACCEPTED |
| 24 | Partial-failure recovery | NOT ACCEPTED |
| 25 | Voice privacy and single-target routing | NOT ACCEPTED |
| 26 | Untrusted URL defense | NOT ACCEPTED |
| 27 | Budget, retry, concurrency, and cancellation | NOT ACCEPTED |

High-consequence controls cannot be enabled by changing this document. They need
the corresponding mediated implementation and observed gate evidence.
