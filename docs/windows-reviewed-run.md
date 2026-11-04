# Exact Windows Run requests

The Windows connection uses a small host manifest to bind the selected input
files to the guest's existing catalog format. The live repository is never a
writable guest mapping. This validator is implemented; the Studio admission
adapter is still being connected.

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
