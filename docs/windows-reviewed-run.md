# Exact Windows Run requests

The Windows connection uses a small host manifest to bind the selected input
files to the guest's existing catalog format. The live repository is never a
writable guest mapping. The validator and host-only runner are implemented;
the Studio policy/admission adapter is still being connected.

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
