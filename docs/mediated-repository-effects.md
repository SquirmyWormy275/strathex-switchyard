# Mediated repository effects

The companion's local-commit component now stages verified bytes without running
repository filters and creates commits through Git's plumbing interfaces. The
suite authority API is already connected; its separate commit-effect admission
and recovery connection is still unfinished. A suite authority grant currently
does not execute this component or change native provider permissions.

## From reviewed target to commit

The typed Git broker first checks its policy permit, selected task/plan, owned
paths, containment fence and final target guard. The handler then holds a private
worktree lease and reconstructs the exact tracked/untracked worktree manifests.
Their digests must match the approved target, using the same input classifications.
Every staged file is read through a bounded native descriptor with parent and
file identity checks; its digest must match that manifest witness.

The content crosses a private binary stdin pipe into
[`git hash-object --no-filters`](https://git-scm.com/docs/git-hash-object).
The returned blob ID must match an independently computed object hash. A private
index receives only those exact blobs or positively observed tracked deletions.
Tracked modes are preserved; new blobs are ordinary non-executable files.
Content remains literal: Git attributes do not transform line endings, encodings
or bytes through this route. This keeps the committed content tied to the review.

After fresh target checks and a real shared-index lock,
[`git commit-tree`](https://git-scm.com/docs/git-commit-tree) constructs the
reviewed tree/parent object. An expected-old-HEAD
[`git update-ref`](https://git-scm.com/docs/git-update-ref) changes only the
reviewed branch. A competing branch update is preserved. Exact commit/tree
readback precedes shared-index reconciliation and successful completion.

Default-branch or detached targets first need a separately reviewed branch step.
It creates the branch and changes HEAD in one reference transaction with the
original symbolic-ref or object precondition. It never checks out worktree files.
The result requires a new target capture and commit review. Git must support
symbolic-reference transactions; no checkout fallback is selected when it does
not. Git's transaction locks and preconditions protect the updates; concurrent
readers can still observe individual reference updates as documented by Git.

Repository hooks, fsmonitor, external diff/text conversion, global/system Git
configuration, object replacement refs and interactive credentials cannot supply
execution through these commands. Signing is disabled for this exact local
transaction. No push, PR operation or merge is selected by the local handler.

## Bounds and recovery

The witness supports at most 4,096 files, 4 MiB per input and 64 MiB total.
Each owned commit blob is limited to the 512 KiB private-pipe contract, with
at most 256 literal owned paths. Unsupported or unreadable input is rejected.
Command stdout must be valid UTF-8: malformed Unix filename bytes cannot silently
alias a different Unicode file. Ordinary file contents may contain arbitrary bytes.

Temporary indices live outside the repository under a hash of the durable
operation ID. Successful cleanup removes owned files and empty staging folders.
An unconfirmed native command exit retains the exact indices, hooks directory
and locks for recovery, with an ambiguous result. It does not guess that a
process stopped or release a lock while an unknown effect may still be running.
The suite must connect independent native-exit reconciliation and recovery
before enabling this effect API. The existing companion handler remains behind
its own broker and final-effect guard; it is not a standalone authority boundary.

Seventeen tests use actual disposable repositories and Git processes. They cover
ordinary/private-index commits, branch/detached setup, stale targets, competing
reference updates, exact binary content, changed witnesses and tripwire filters,
diff drivers, text conversion, fsmonitor and hooks. Descriptor-bound index and
private worktree leases preserve another writer's replacement or in-place lock
change. Original index bytes are copied through the held descriptor, and
replacement bytes are synced and read back before the owned lock is renamed.
A host preservation callback records native file identities and the original
index digest before any reference mutation. A simulated unconfirmed native
exit checks preservation; it is not a claimed physical crash. These tests are
registered in both the Linux and Windows release lanes. Native Windows acceptance
for the updated implementation is pending.


## Suite transport and durable native demonstration

The host-only repository effect transport now runs the handler's Git commands
through native guardians. A kernel resource lease serializes the native
repository identity, and every command rechecks host authorization, workspace
policy and original repository/Git directory identities. Git receives only
trusted handler argv, the exact operation's private index, a fixed environment
and the explicitly reviewed author. Provider, SDK and HTTP payloads have no
argv entry point. Linked Git common directories are explicitly unsupported.

The host stores each guardian identity in its AEAD compartment before acknowledging
startup, and independently checks native exit before recording stopped state.
An expected reference update, including its old/new object IDs, is durably
recorded before that command may start. Unknown exits, cancellation and restart
retain the scope and scratch; replacement is blocked pending explicit no-replay
reconciliation. A readback failure after a successful reference update also
retains the exact handler indices and leases.

The existing durable runtime uses a hash-chained journal inside the same locked
AEAD workspace for policy, sessions, authority, confirmation, budgets, checkpoints,
operations and receipts. The original index and target are copied into encrypted
checkpoint data, independently hashed on readback, and referenced by the core
checkpoint ledger before broker admission. No plaintext recovery copy is written.
The checkpoint's recovery guide authorizes no restore or deletion.

Five integration scenarios pass. One uses the actual native Linux guardian,
Git and kernel leases: a separately confirmed durable operation commits exact
binary bytes with the reviewed author, preserves another edited file, reconciles
the shared index, independently verifies every retained guardian exited, and
rejects approval replay. The native coding identity in this disposable fixture
is synthetic; no provider task or model prompt is created. The remaining cases
check encrypted journal rollback/isolation/corruption, author/lease rejection,
retention across an unknown exit/restart and cancellation with late output.
Native Windows has a declared skip for the Linux guardian journey; its existing
helper lane separately checks the underlying native command transport.

The suite's public commit admission and operator recovery routes are still
unconnected. This internal demonstration does not enable the task authority
API to execute a commit. Those routes and normal installed acceptance remain
implementation work. The transport currently bounds an operation to 128 commands
and two minutes, each command to ten seconds, and index checkpoints to 512 KiB.
Encrypted checkpoint and effect journal inventories each have a 2 MiB bound;
recovery data is preserved when either fills. The offline suite now includes only
the runtime dependency closure and the three Git helpers, with a 5 MiB Linux
source-bundle test budget; no Node, .NET, model or Python runtime is copied.

Reproduce the disposable native demonstration and fault cases with Node 24:

```sh
mise exec node@24.14.0 -- node --test tools/layout-studio/repository-effects.test.mjs
```

It creates its own private state, synthetic identity and local repository, verifies
the resulting commit and native exits, then removes that fixture. It neither
prompts a model nor commits changes in this checkout.
