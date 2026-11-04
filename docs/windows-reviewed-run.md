# Exact Windows Run requests

The Windows connection uses a small host manifest to bind the selected input
files to the guest's existing catalog format. The live repository is never a
writable guest mapping. The validator and host-only runner are implemented;
the Studio platform factory now connects policy admission and separate stop approval.

`run.json` has exactly these fields:

```json
{
  "schema": "switchyard-windows-reviewed-run/v1",
  "version": 1,
  "recipeId": "run_target",
  "catalogPath": "guest.json",
  "catalogSha256": "<SHA-256 of the exact guest.json bytes>",
  "inputFiles": [
    {"path":"guest.json","sha256":"<SHA-256>","size":123,"classification":"non-production"},
    {"path":"program.mjs","sha256":"<SHA-256>","size":123,"classification":"non-production"}
  ]
}
```

The placeholder digests and sizes above must be replaced with the actual bytes;
the document cannot approve itself. The manifest and every input must match the
separately granted task snapshot. The guest catalog must itself be selected.
Inputs retain the shared 4 MiB per-file, 64 MiB total, 4,096-file/path bounds.

The catalog contains one `run_target` recipe using the exact host-pinned
`C:\B122\tools\node.exe` digest. Its first argument names an explicitly selected
`.mjs`, `.cjs` or `.js` file through `{INPUT_ROOT}`. Inline code, host commands,
replacement runtimes and implicit repository copies are refused. Remaining
arguments are bounded literals. Working files and artifacts live in the bounded
guest exchange; selected inputs remain read-only.

The validator limits recipe execution to nine minutes, leaving a minute for the
managed guest lifecycle within the ten-minute host bound. Captured output is at
most 512 KiB. Fixed environment entries, Node startup injections, credentials,
unknown tokens, ambiguous artifact names and traversal paths are rejected.
These are the currently connected recipe limits, not claims of Python, build,
debug, web or pipeline action completion.

Seven checks validate actual selected-file loading, stale or absent task
witnesses, unchanged private files, buffer clearing, exact runtime/catalog
binding, resource limits, forbidden arguments/environments and invalid UTF-8.
They create no VM, account, keyboard connection or runtime copy. Native mapping
acceptance is separately proven by all 30 checks at `e4ef1f06`, workflow
41898161164; the digest-verified JSON receipt is
`windows-bounded-mapping-e4ef-native.json`.

The runner's cross-process preparation fence uses a kernel resource lease.
A nonblocking probe distinguishes an actually held lease from unavailable or
failed lock verification; unknown errors remain errors. Cleanup cannot infer
that a live preparation is abandoned merely because its VM has not started.
The original blocking state-lock behavior is unchanged. The new probe is tested
against another actual process, owner death, independent store instances and a
callback failure whose error code resembles a busy lock. Native Windows probe
acceptance is included in the short filesystem workflow.

## Host orchestration

`createWindowsReviewedRunner` connects the native input, worker/runtime, image,
bounded-volume and managed-session services to the backend. Its caller must
already own policy admission and supply the exact current task guard. Paths to
replacement helpers, runtimes or host commands are not request fields. Source
and runtime hashes are rechecked before the durable Run reservation; each native
service retains its own original readiness and exit records.

The runner holds its kernel lease through preparation, guest output validation
and cleanup. Recovery in another process must acquire that lease before touching
the guest or its staging. The native cleanup callbacks additionally probe the
same lease so they cannot mistake preparation for an absent consumer. Mode
shutdown cancels the owned boundary and waits for its result.

A backend completion requires fresh independent guest/native exit readback
before the runner reports completion. The original backend observation, admitted
result and storage retirement are recorded separately. Unknown exit preserves
all assets and blocks replacement. Failed cleanup leaves a known program result
intact while blocking another Run; later reconciliation cannot replay or upgrade
the original program result. General workspace snapshots omit these records.

The combined runner/manifest/kernel-lock/privacy/release group passes 43 checks;
type checking passes. Nine orchestration cases use explicit native service/VM
doubles with actual encrypted records, file reads and kernel leases. They cover
cross-process recovery during preparation and guest execution, stale scope,
ambiguous reservation, unsupported prerequisites, cancellation and late cleanup.
Native Windows acceptance of the new runner/probe cases is pending. Actual
supported-host VM execution and the Studio admission connection remain separate.

Windows workflow 41903318562 at `62c71e5` passed the real kernel probe and
owner-death checks, then failed its explicit test-inventory gate: the new
manifest-validator suite had not been listed. Its failed record is retained as
`windows-run-inventory-62c71-failed.json`; no native journey ran in that failed
workflow. Both new suites are now in the required inventory. The corrected
inventory/runner/manifest/lock/privacy group passes all 56 local checks. Native
Windows rerun is pending; no failure or required check was waived.

Cancellation is now durable and scoped to one protected Run operation. A second
instance records the stop marker; the original owner observes it through bounded
polling, aborts the exact managed boundary and retains its original result. No
PID or unrelated guest can be supplied. Workspace shutdown records cancellation
for retained runs before stopping local handles; cross-process recovery still
requires the same kernel lease. The combined inventory/runner/manifest/lock/
privacy group passes 57 checks, including a real encrypted cross-instance stop
request against an explicit guest double. The ten orchestration cases do not
claim an actual Windows VM.

## Studio policy and exact stop

The Windows platform factory now selects this runner through the same task
authority, one-use confirmation, checkpoint, target resolver, budget and receipt
services used by Linux. The review binds source directory identity, input
witnesses, catalog, runtime/helper prerequisites and the current workspace.
Changed inputs, revoked grants, a substituted prerequisite or a failed protected
checkpoint cannot dispatch the guest. An unavailable preflight remains a
no-program outcome.

Exact stop has a separate confirmation, operation, 120-second Windows budget and
receipt. The immutable Run admission is distinct from the eventual program
result. Stop targets only the protected operation; PIDs, guest IDs and commands
are not accepted. Its budget is separate from the unchanged Linux stop budget.
A lost final write can recover an already recorded passing receipt. Late exit
without such a receipt preserves an incomplete stop result and cannot replay
cancellation or the worker.

Eleven Studio admission/stop/restart cases pass using real task grants, Git
inspection, encrypted policy/checkpoint/budget/receipt ledgers and an explicit
Windows runner double. A separate 41-check platform/package group passes,
including the existing actual Linux host broker. Type checking passes. Native
filesystem acceptance and supported interactive VM acceptance remain separate.
The frontend is unchanged.

## Failed-program diagnostics

A nonzero reviewed guest program can now produce a failed v2 result containing
its actual process exit code and only `process.stdout.txt` /
`process.stderr.txt`. The worker preserves the exit code, skips declared build
artifacts and keeps its shared output bound. Successful v2 results retain their
existing shape.

The backend binds a failed manifest to the independently observed guest exit
code, including signed Windows exit-code bits. It requires the original request,
resource claims, exact guest stop, native exit, input/volume leases, output
hashes and the current extraction guard. Mismatched exit codes, additional
artifacts, false resource fields, changed hashes and oversized logs are refused.
The copied logs have a separate `diagnosticRoot`; `resultRoot` remains absent
and the execution stays failed. Unknown VM exit releases no diagnostic bytes.
The original native volume service still owns retirement.

The related backend/helper/installation/lifecycle/release group passes 46 checks
with one declared platform skip (47 total); type checking passes. Four cases
invoke the actual compiled C# result formatter, including unsuccessful and signed
exit codes. The helper builds with zero warnings/errors; six real Linux mode
guards pass. Build/probe scratch was removed after retaining source/assembly
hashes in `windows-failure-results-build-20261104.json`. These compiled cases
validate the wire format, not native Job enforcement or an actual VM task.

The focused Windows policy workflow runs the required inventory and Studio
admission/stop group through the same isolated runner. It provisions pinned
Node and locked dependencies, opens no VM/account/keyboard and does not download
a .NET toolchain or optional runtime. A small seven-day receipt artifact keeps
its native-Windows policy result separate from the filesystem and full-release
lanes. Entry point: `scripts/verify-windows-policy.mjs --synthetic`.
