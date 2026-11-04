# Run reviewed task inputs

Switchyard can connect a coding task to a separately approved Linux program
run. It stages only the exact files granted to that task, runs the reviewed
recipe inside Bubblewrap, retains native ownership, and reports the program's
bounded result. A successful program exit does not mark the coding task done.

This backend path is API-only while the frontend is frozen. The current policy
provides a read-only reviewed workspace, denied network and ambient credentials,
and a 64 MiB temporary filesystem. It never mounts the live repository. Writable
build outputs, Windows guest execution, debug,
web, environment and pipeline connections remain implementation work. Workspace
shutdown, keyboard-only mode and application shutdown stop owned executions.

## Try the boundaries

Use the pinned source runtime:

```sh
mise exec node@24.14.0 -- node --test tools/layout-studio/repository-execution.test.mjs tools/layout-studio/repository-execution-supervisor.test.mjs tools/layout-studio/repository-execution-staging.test.mjs
```

The Linux integration case uses the actual native guardian and namespace. The
portable cases use explicit process and namespace doubles; those cases make no
claim about Windows containment. Bubblewrap and a working user-namespace policy
are required for the Linux native case. No keyboard, existing project, account
or desktop configuration is changed by these source tests.

For an explicit normal installed Linux demonstration with one new disposable
repository, an empty native Codex task and zero model prompts:

```sh
mise exec node@24.14.0 -- node scripts/verify-repository-execution-host.mjs --synthetic
```

It requires the normal installed app and the existing permitted Codex login.
Ten checks passed at `0aeae75`; the private result is
`installed-repository-execution-1793810385256.json`. These include a separate exact
stop receipt, duplicate handling, a fresh reviewed Run after that stop and three
independently exited native guardians. Successful cleanup restores
selection, definitions, keyboard-only validation state and the private endpoint;
it retains the native empty-task history. Failed checks retain their synthetic
staging and evidence. Use `--compartment=execution-validation-suffix` for a new
explicit validation workspace when retained evidence prevents reusing the default.

## API sequence

Use the existing authenticated loopback transport and selected personal
workspace. Tokens belong in the private request body; never put them in a
repository or diagnostic log.

1. Create or bind the exact native coding task. Review and issue its task
   authority with `actions: ["run_target"]`. A previous commit-only authority
   cannot run a program. Include the recipe manifest and every selected input
   file in the task's explicit paths and untracked-file classifications.
2. POST `/api/suite/coding/execution/review` with `compartment`, a new
   `requestId` UUID, `authorityId`, repository-relative `manifestPath`, exact
   `manifestSha256`, and `action: "run_target"`.
3. Inspect the returned recipe, executable identity, target snapshot, execution
   policy and budget. POST `/api/suite/coding/execution/apply` with the same
   compartment/request ID and the separate one-use confirmation token.
4. POST `/api/suite/coding/execution/status` with compartment/request ID to
   observe the retained native result, independent exit and staging cleanup.
   Duplicate apply requests return the original admission result without
   starting another program. A new separately reviewed request has its own
   protected operation scope, including after a previous run was cancelled.

The complete v1 runtime manifest must name the selected repository root. Its
Run recipe must use managed, disposable execution and explicit
[`inputFiles`](reviewed-execution-inputs.md). Maximums are ten minutes, 512 KiB
captured stdout, 4 KiB diagnostic stderr and the existing bounded input manifest.
Only Run and its owned stop descriptor may appear in this connected manifest.
The request cannot provide a replacement command, arguments, PID or permission.

The task/account/directory binding, complete repository snapshot, manifest bytes,
executable identity and selected workspace are checked again before the effect.
The existing policy, checkpoint, budget, operation and receipt ledgers mediate
admission. Native readiness is persisted before the guardian receives its start
acknowledgement. Cancellation monitoring remains attached through managed exit.

## Stop one owned run

POST `/api/suite/coding/execution/stop/review` with `compartment`, the original
Run `requestId`, and a new `stopId` UUID. Inspect that exact managed-run binding,
then POST `/api/suite/coding/execution/stop/apply` with compartment, stop ID and
its separate one-use token. Stop requests cannot supply commands or process IDs.
The original coding authority need not be extended to stop an already owned
process; the selected Personal workspace and exact native handle are required.

A separate 15-second budget, operation and receipt cover the stop postcondition.
Admission is committed in one encrypted journal transaction, so repeated
Windows lock-helper startup does not spend that deadline on separate admission
writes. A failed admission commit cannot deliver the stop. Final scope and
deadline checks still occur before the native effect.
They never overwrite the original Run admission or claim that its program
completed. Unknown native exit keeps the stop unresolved and its budget occupied.
A later independent exit can release interrupted bookkeeping with an incomplete
result; it cannot manufacture a passing receipt. A lost final result can be
recovered from its exact protected receipt and verified native binding without
another stop. Native handles lost across restart are observed rather than
replaced with guessed PIDs.

Five service cases, focused stop faults, authenticated HTTP transport and
package-import checks pass. Normal installed per-run stop and a fresh approved
Run afterward pass the ten-check journey above. Native Windows backend
acceptance of the atomic admission change passes at `dbe62bb`.

## Retained evidence and recovery

Protected ownership records bind the task session, authority, snapshot, manifest,
operation and native guardian. They are omitted from ordinary profile snapshots.
Terminal observations can settle the budget without rewriting the original
admission result. Unknown native results remain unknown after independent exit.

Restart recovery observes retained guardians and never replays a command. A
reservation without a persisted readiness identity can become `not-started`
only while holding the same kernel resource lease used for startup: no start
acknowledgement could have been issued from that record. A live or uncertain
guardian blocks replacement. Staging cleanup requires independent native exit,
the original directory identity, the exact file set and unchanged reviewed
bytes. Changed or unfamiliar files and replacement directories are preserved.

Linux passes the reviewed executable through one inherited read-only descriptor;
an atomic pathname replacement during the guardian handshake cannot substitute
another tool. The descriptor is retained through native exit, without copying a
runtime to disk. This does not attest arbitrary host runtime libraries or grant
network, repository-write or provider permissions.
