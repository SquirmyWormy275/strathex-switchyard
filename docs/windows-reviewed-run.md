# Reviewed Windows Run and exact stop

The Windows Studio platform factory connects a selected task to an isolated
program run. Task authority, one-use approval, checkpoints and budgets precede
native execution. The live repository is never writable inside the guest, and
program exit never marks the provider's coding task complete.

Normal personal-host privileged storage setup remains unfinished software.
Actual interactive VM acceptance requires a supported Windows Sandbox host;
filesystem CI and runner doubles do not establish that acceptance. The frontend
remains frozen for review.

```mermaid
flowchart LR
  Task[Task authority and selected bytes] --> Review[One-use review]
  Review --> Ledger[Checkpoint and budget]
  Ledger --> Preflight[Read-only host prerequisite check]
  Preflight --> Inputs[Read-only inputs and pinned tools]
  Inputs --> Guest[Exact guest and bounded exchange]
  Guest --> Exit[Independent native and VM exit]
  Exit --> Output[Verify output or failure logs]
  Output --> Result[Result and separate storage retirement]
  Stop[Separately approved exact stop] --> Guest
```

## Declare the exact inputs

A host manifest binds the existing guest catalog to explicit non-production
files. It has exactly these fields:

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

Replace placeholder digests and sizes with the actual bytes. The manifest
cannot approve itself: it and every input must match the separately granted
task snapshot. The selected guest catalog contains one `run_target` recipe,
using the exact host-pinned `C:\B122\tools\node.exe` digest. Its first argument
names a selected `.mjs`, `.cjs` or `.js` file through `{INPUT_ROOT}`. Inline code,
host commands, replacement runtimes and implicit repository copies are refused.

Inputs retain the shared 4 MiB per-file, 64 MiB total and 4,096-file/path bounds.
The recipe limit is nine minutes, leaving a minute inside the ten-minute guest
bound; the encompassing policy deadline can cancel earlier. Captured output is
at most 512 KiB. Credentials, fixed environment overrides, Node startup
injections, unknown tokens and ambiguous paths are rejected. Python, debug,
web and pipeline connections are separate remaining work.

## Own the guest and its storage

After reserving the exact operation, the runner observes the current-user
Sandbox AppExecLink and the native helper's storage privilege before staging.
Metadata opens the process token with `TOKEN_QUERY`, reads at most 256 privilege
entries twice and requires unchanged bytes. It reports only assigned/enabled
flags and whether privileged setup is required. It never enables or grants a
privilege, installs a service, opens a volume or claims containment. This follows
the documented [GetTokenInformation access contract](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)
and [TOKEN_PRIVILEGES layout](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_privileges).

Missing Sandbox support or an unassigned storage privilege settles the consumed
operation as unavailable before input/tool/image staging. A new approval is
required to try again after setup; duplicate requests preserve the original
result. Personal-host privileged setup is still unfinished. Readiness is an
observation, not permission to elevate the application.

The host-only runner stages exactly selected bytes, hard-links the existing
worker and Node image, creates one original fixed-capacity disk and transfers
it once into a trusted writable lease. No runtime-copy fallback is allowed.
Native Sandbox startup pins the original image/mount identities, footer, volume
GUID, exact extent/capacity and three closed mappings. Inputs/tools are read-only;
only the owned exchange is writable. Network and host redirection are denied.
[Native storage contract](windows-bounded-exchange.md).

A kernel lease spans preparation, guest execution and cleanup. Another process
must acquire it before recovery touches the guest; a missing VM during live
preparation is not an abandoned operation. Readiness persists exact ownership
before acknowledgement. Unknown effects cannot replay. Scope changes and durable
exact-operation cancellation markers stop the original owner.

Run admission, eventual program result, independent exit and storage retirement
are separate records. Only the native volume service can detach/remove its
original disk. Generic backend cleanup cannot traverse that mount. A known
program result survives failed storage cleanup; replacement remains blocked
until the original ownership reconciles. General snapshots omit these records.

## Stop and read results

Exact stop has its own confirmation, operation, 120-second Windows budget and
receipt. Its immutable original admission is distinct from the eventual program
result. PIDs, guest IDs and commands are not accepted. This Windows allowance
does not change the Linux stop budget. A lost final write can recover an already
recorded passing receipt. Late exit without that receipt preserves an incomplete
stop result and cannot replay cancellation or the worker.

Successful output is extracted only after exact VM/native exit and manifest,
path, size, digest, resource-field and current-scope checks. Failed v2 results
must also match the independently observed guest exit code, including signed
Windows bits. They may retain only `process.stdout.txt` and
`process.stderr.txt`, within the shared output bound. `diagnosticRoot` is
separate from successful `resultRoot`; the execution stays failed.

Status reads expose redacted text only from those two verified files, inside
the exact operation's owned result directory. Descriptor hashing and directory
identity checks reject changed bytes or substituted roots. Missing/changed
output becomes unavailable without rewriting the original Run result. Unknown
exit releases no diagnostic bytes. These files are untrusted program data and
grant no task authority.

## Verify the boundaries

Thirteen Studio admission/stop/output cases use real task grants, Git inspection,
encrypted ledgers, file reads and kernel locks with an explicit Windows runner
double. The combined policy/inventory/backend/package group passes 66 checks.
Type checking passes. Four cases invoke the actual compiled C# result formatter;
its warning-free build and six Linux native-only guards pass. They validate wire
format and guards, not an actual VM or native Job enforcement.

The Windows policy workflow runs complete policy, recovery, stop and output test
files as separate jobs, with each file explicitly present in the required
inventory. Each Windows group is capped at five minutes. This follows the first
whole-file run's four-minute timeout: its first four cases completed, but the
run remains failed in `windows-policy-63cb-failed.json`. No case or assertion was
removed. `scripts/verify-windows-policy.mjs --synthetic --suite=policy` selects
one complete group; omitting `--suite` runs them all. It provisions pinned Node
and locked dependencies without a .NET or optional-runtime download, opens no
VM/account/keyboard and retains only a small seven-day receipt.

All four jobs passed at `cdd86cb` in workflow `41914612230`. Digest-verified
`windows-policy-cdd-{policy,recovery,stop,output}.json` receipts retain the exact
results and verified child cleanup. Prerequisite transport/session/runner checks
pass 30/30 locally; the actual Windows token query remains a native CI check.

[Current verification](verification.md) identifies exact source checkpoints,
installed Linux demonstrations and all 30 native Windows filesystem checks.
[The requirement ledger](switchyard-requirements.md) separates unfinished
software from hardware/account acceptance.
