# Preserve the original coding-task owner

The explicit Linux `createCodingTaskOwners` service holds an owned metadata
connection for one registered Codex task. Its protected record binds the original
thread, account fingerprint, repository directory and native listener. It does
not create or resume a thread, submit a prompt, attach an IDE, or grant task authority.
Production Studio routes still use stdio; connecting this service is unfinished.

A request first reserves its UUID under a per-task kernel lease. The listener
then records its private directory before startup, guardian before provider start,
socket/alias after readiness, and account after authentication. A duplicate request
returns its original record. Another host cannot adopt its live connection, and
another request cannot replace it until retirement is independently verified.

Reads recheck permission, exact saved task, native account, original repository
identity and protected owner before and after asynchronous metadata access. A
changed binding refuses delivery. Public views contain local IDs and capability
limits; native process/socket/account details remain in encrypted state.

Shutdown stops only owned resources and retains uncertainty when exit cannot be
verified. Restart recovery consumes the exact saved identities and verifies
retirement; it never guesses a PID, adopts a global daemon, or starts a replacement.
Incomplete ownership records are preserved for review. Request history is bounded
and retained for duplicate prevention rather than silently recycled.

Run the focused software proof with the pinned runtime:

```sh
mise exec node@24.14.0 -- node --experimental-transform-types --test tools/layout-studio/coding-task-owners.test.mjs
```

Nine registry cases cover real encrypted state and kernel leases, concurrent
instances, changed account/repository/task/owner, failed persistence, late shutdown,
no replay and exact recovery. One case composes the actual Unix listener and bridge
with a controlled provider double. The complete related cohort passes 76 tests;
final registry and package checks pass thirteen with exact cleanup. These checks
create no real provider task and do not establish live account or IDE acceptance.
[Exact evidence](evidence/coding-task-owner-summary.json).

Retirement also compares the protected native identity with the original live
owner. A substituted saved owner stays uncertain even if the in-memory process
has exited. [Final guard evidence](evidence/random-access-owner-retirement-summary.json).
