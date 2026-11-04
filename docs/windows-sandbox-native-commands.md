# Native Windows Sandbox commands

Switchyard's fixed Windows helper implements bounded Sandbox metadata, list,
start, stop, connect, login-probe and worker-execution verbs. The encrypted host
transport records each native guardian before acknowledging it and retains
uncertain results without replay. The managed guest lifecycle and Studio
Windows Run connection are still unfinished implementation; these command
boundaries alone are not a working Windows task run.

The helper accepts one closed JSON request through `--windows-sandbox-cli`.
It resolves only the current user's known-folder
`Microsoft/WindowsApps/wsb.exe` AppExecLink and pins its native tag. An ordinary
executable from the repository, current directory, PATH or legacy viewer is not
substituted. This identifies the current-user activation alias; metadata does
not attest the package identity, enabled feature, guest readiness or containment.

Start accepts only an exact UTF-8 configuration digest and a bounded XML
configuration with denied network/GPU/recording/redirection, protected client,
bounded memory and three disjoint folder mappings. Inputs/tools are read-only;
the owned exchange is writable. DTDs, extra mappings and logon commands are
refused. The backend now omits automatic recipe startup in reviewed mode: the
guest identity must be persisted and acknowledged before the worker can run.

Native startup requires an empty inventory and verifies the exact requested
guest UUID afterward. Ambiguous startup cannot become an owned successful
session. Stop addresses only its exact UUID and independently lists afterward
to verify absence. Connect is a separate viewer request. Login probes run only
the fixed guest `whoami.exe`; execution runs only the fixed guest worker with
bounded literal catalog/request/output paths. The helper clears its child
environment and exposes no general executable or shell field.

The host transport requires the exact protected operation, review digest,
provider, VM and configuration. It holds a cross-process native-command lease,
persists readiness before acknowledgement, independently observes command exit,
and withholds new commands while an earlier native exit is unknown. A stopped
CLI process never becomes a stopped-VM claim. Start/connect/execute/stop
tombstones remain on the VM record even after settled command history retires.
Unknown results cannot replay effects. Owned stop cleanup can proceed after
provider mode changes without granting another program action.

Windows `wsb exec` reports the guest program's exit code inside its JSON payload;
the CLI itself can return zero for a failed guest program. The helper retains
that distinction, including unsigned Windows exit-code bit patterns. Inventory
parse failures remain unknown rather than becoming an empty list.

The command and JSON contracts were checked against Microsoft's
[CLI reference](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli)
and [native CLI wrapper and payload models](https://github.com/microsoft/WinAppCli/tree/main/src/winapp-CLI/WinApp.Cli/ExecutionTargets/WindowsSandbox).
The AppExecLink tag is defined in Microsoft's
[reparse-tag protocol reference](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fscc/c8e77b37-3909-4fe6-a4ea-2b9d423b1ee4).

Five transport fault cases pass, including readiness/result write failures,
unknown native exit across instances, wrong scope and durable duplicate
tombstones. Combined HTTP/privacy/inventory checks pass; package imports and
type checking pass. The complete changed C# helper compiles with zero warnings
or errors using the existing SDK. Linux rejects the Windows-only mode before
effects. Build receipt: `windows-sandbox-cli-build-20261104.json`.

Windows CI now exercises metadata through the actual owned native transport
without creating a VM. That new check is pending. Actual VM startup, viewer/login,
worker execution, stop and restart acceptance require a supported Windows Sandbox
host. The higher-level guest coordinator remains code to finish, independently
of those host checks.
