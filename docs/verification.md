# Verify Switchyard

Verification has a source, a scope and a retained receipt. A passing parser test
does not establish a working desktop integration, and a later focused pass does
not replace an earlier failed full run. Start with [current status](switchyard-status.md)
for what is installed and the [requirement ledger](switchyard-requirements.md)
for work that remains.

## Current evidence

| Scope | Source | Accepted result and limits |
| --- | --- | --- |
| Complete Linux source | `72e7c22` | 376 groups, 2,574 passes, 32 declared skips. Original commands, bounds, serial order and owned-tree cleanup audited. [Receipt](evidence/linux-72e7c22-complete-summary.json). |
| Later legacy history account checks | `7317371` | Three regressions reproduced the omission; 13 integration groups pass 139 tests/one existing skip. Separate package and type checks pass. [Evidence](evidence/codex-legacy-read-account-summary.json). |
| Installed Linux application | `a7958c4` | 42 served/installation/API/state and 123 metadata checks, 65 exact module hashes; all 54 semantic workspaces and three conversations preserved. [Receipt](evidence/installed-history-discovery-summary.json). |
| Installed pilot editor extension | `42655aa` | 53 exact payload hashes and eight module checks. Actual graphical activation remains unaccepted. [Receipt](evidence/installed-editor-terminal-summary.json). |
| Real Codex 0.167 terminal | `42655aa` | Synthetic saved history rendered through the production relay, including paginated older history. No model prompt or live task. [Contract](codex-terminal-compatibility.md). |
| Audited Windows client | `3222727` | 31 groups, 362 passes, zero skips. Includes retained legacy-history account regressions; predates the lease-input correction. [Evidence](evidence/native-client-3222727-summary.json). |
| Windows UI failure measurements | `72e7c22` / `7317371` | Original scanner/execution files exceed 45 seconds. State and guardian waits dominate the observed phases; timings overlap. [Failed receipts](evidence/native-ui-timing-failure-summary.json). |
| Windows lease input correction | `f4dcc79` | Two offline builds, 2,117 portable checks and nine local groups/82 passes/one existing skip. Native complete-source follow-up passes below. [Source evidence](evidence/lease-blocking-source-summary.json). |
| Earlier complete Windows package | `7529718` | 462 groups, 2,910 passes, 246 declared skips; eight jobs pass. This does not accept later source. [Receipt](evidence/windows-package-7529718-summary.json). |

The lease correction now has complete native source acceptance at `f4dcc79`:
482 groups, 3,157 passes and 246 declared skips. All 23 workers and the native
collector pass; original receipts, commands, bounds and cleanup are audited.
[Complete Windows receipt](evidence/complete-windows-f4dcc79-summary.json).
The later historical-name discovery passes ten integration groups/80 tests/one
existing skip and eighteen package/installation groups/26 tests, with typecheck.
Normal installation now passes the checks above; Windows follow-up remains pending.
[Discovery evidence](evidence/history-path-discovery-source-summary.json).

Counts from overlapping runs must not be added. The complete Linux result predates
the later account-read correction. The installed app, extension and synthetic
preview have separate source identities.

## Run the platform checks

Use the pinned Node 24.14.0 runtime and the repository's existing locked
dependencies. From the repository root:

```sh
mise exec node@24.14.0 -- npm run typecheck
mise exec node@24.14.0 -- npm test
```

`npm test` selects the complete platform manifest. It runs dependency builds in
order, supervises each original child, enforces its timeout and output bound, and
writes a final receipt under `.sxsy-verification/`. Progress records are explicitly
incomplete; only the final receipt can establish acceptance.

On an appropriately prepared native Windows host, the same entry point supports
`npm test -- --windows-pairs`: builds and compiled-output consumers retain
dependency order, then at most two independent groups run together. This does not
change any group's command, deadline, assertion or skip allowance. Windows helper,
SDK and optional-runtime preparation belongs to the
[Windows release workflow](../.github/workflows); a Linux build cannot execute
those native contracts.

For a focused source change, select original manifest entries through the
exported runner. For example, this checks the state-lock and file-storage
contracts without inventing a different command or timeout:

```sh
mise exec node@24.14.0 -- node --experimental-transform-types --input-type=module -e '
import { requiredGroups, runVerification } from "./scripts/run-isolated-tests.mjs";
const files = new Set([
  "tools/layout-studio/state-lock.test.mjs",
  "tools/layout-studio/private-fs.test.mjs"
]);
const groups = requiredGroups.filter(group => files.has(group.file));
if (groups.length !== files.size) throw Error("Original test groups missing");
const { receipt, receiptPath } = await runVerification({ groups });
console.log(JSON.stringify({ receiptPath, totals: receipt.totals }));
process.exitCode = receipt.success ? 0 : 1;
'
```

Native Windows cases require the prepared helper. Existing platform skips remain
visible; a focused result must name that scope. Do not treat an omitted group as
a passed group.

## Read a receipt

Check these fields together:

1. The exact source commit/tree and toolchain identity, where supplied by the
   enclosing build or worker receipt.
2. `requiredGroups` against the original manifest and each child's original
   `command` and `effectiveTimeoutMs`.
3. `testCounts`, including the declared skip inventory, zero-test plans,
   cancellations and todo cases.
4. Exit status, timeout, output digest/bounds and `failureDiagnostic`.
5. Independent process-tree termination and owned-root cleanup.
6. Receipt/progress persistence and the final aggregate `success`.

A timeout can leave individually passing TAP cases in its diagnostic excerpt.
Those partial cases do not accept the unfinished file. Keep the failed receipt.
The Windows complete-source collector also requires every worker, one matching
source/toolchain scope and original manifest order; a cancelled or missing worker
cannot be replaced with a result from another commit.

Normal branch pushes schedule CI. Preserve existing deadlines and assertions;
do not manufacture green checks by retrying a workflow, adding skips or replacing
an unaccepted scope with a narrower one.

## Demonstrations and installed checks

The [connected backend demonstration](backend-demonstration.md) exercises
encrypted state, authenticated HTTP and reviewed dispatch using synthetic
providers. The [guided setup](guided-setup.md) and [editor task walkthrough](editor-task-controls.md)
describe the corresponding user journeys.

Installed verification compares exact served assets and module hashes before
using metadata or in-memory fixtures. Its evidence says which actual effects,
if any, occurred. An update preserves saved workspaces, workflows and conversations,
records a dated recovery copy and retains current plus one rollback. Temporary
packages and owned verification checkouts are removed only after identity and
content checks.

Physical F77/B122 behavior, printed legend fit, microphone capture, graphical IDE
activation, browser task/visual review and approved provider/tenant behavior are
separate acceptance dependencies. The current browser-control connection fails
before page inspection. These dependencies do not excuse an unfinished software
path. Linux Claude Desktop binding/launch/focus and the remaining integration
limits stay explicit in [current status](switchyard-status.md).

## Historical records

The full chronological log, including original failures and historical source
links, remains in [the verification record at f4dcc79](https://github.com/SquirmyWormy275/strathex-switchyard/blob/f4dcc7930294512f4f725c6163cbbf8cdf65ca32/docs/verification.md).
The files under [evidence](evidence/) are retained. Historical “next” or “frontend
frozen” statements describe their original checkpoint and are not current
instructions.
