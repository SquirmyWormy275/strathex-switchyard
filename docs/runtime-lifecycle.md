# Optional runtime maintenance

Switchyard keeps one shared local Python environment and one pinned English
speech model outside the application bundles. Protected workspaces, provider
credentials and device recovery baselines are separate from that software.

## Installer process boundary

The new internal runtime command supervisor verifies its executable digest and
waits for a durable caller acknowledgement before starting a fixed installer or
probe command. It captures bounded stdout, discards stderr (which can include
signed download URLs), and requires direct-child and descendant exit before
claiming a completed operation. Unconfirmed exit preserves recovery state.

On Linux the guardian anchors its own native session. `setpriv` installs a
parent-death signal before a small Node `execve` shim checks its actual parent;
the command inherits that signal across exec. Parent stdin loss kills the owned
session. The supervisor cleans up remaining session members after a command
exits. This boundary supports the fixed Python/uv installer commands; it does
not claim to sandbox arbitrary programs that deliberately escape the session.
The implementation uses [util-linux setpriv](https://github.com/util-linux/util-linux/blob/v2.39.3/sys-utils/setpriv.c)
and [Node 24.14 execve](https://nodejs.org/download/release/v24.14.0/docs/api/process.html#processexecvefile-args-env).

On Windows a separate private stdio mode in the existing native helper creates
a kill-on-close Job Object. Restricted handle inheritance and creation-time job
assignment contain even a suspended child if the guardian dies during process
creation. This mode does not call the helper's hotkey or foreground APIs.

The Linux tests exercise acknowledgement failure, nonzero exit, output limits,
timeouts, lingering descendants, installer loss and guardian loss with actual
processes. The C# code builds without warnings. Native Windows execution is a
separate CI step after building the helper; a cross-build is not Windows runtime
acceptance.

## Implementation status

The supervisor, versioned storage and closed installed commands are implemented:
`switchyard runtime check|install|update|rollback|recover|uninstall`.
The source setup entry delegates to the same lifecycle.

An existing matching legacy environment/model is adopted in place. New immutable
components live under `versions/<uuid>`; unchanged environments/models are
shared. Atomic selection retains the current and previous records. Each app
resolves the retained runtime matching its own exact specification. Roll back an
application before selecting a runtime requiring that older application.

Stored inventories bind regular file content, modes and known uv interpreter
links using exact 64-bit file identities while reading. Destructive cleanup
checks every candidate first, preserves unrelated/changed content, and journals
the inventory before deleting generated software. Recovery accepts already
removed entries only within that recorded cleanup. Old unreferenced specs are
pruned too. Legacy empty uv/Hugging Face advisory locks have a narrow permission
exception inside the private runtime; executable and package content do not.

The installed coordinator acquires installation/start ownership, verifies the
exact application, blocks other registered instances, stops the owned app and
holds its ownership boundary while software changes. A private resume journal
restores the previous running state through the ordinary launcher. Interrupted
commands retain their native guardian scope; recovery refuses active or
unconfirmed workers. Protected workspaces, credentials, audio and device
baselines are outside the cleanup tree. Shared uv-managed Python installations
are not removed.

Synthetic/fault tests cover reuse, legacy adoption, rollback, pruning,
verification failure, uncertain worker exit, interrupted promotion/cleanup,
uninstall and exact application quiescence/restart. Voice/HID/example consumers
resolve selected versions and disable bytecode writes. Actual pilot adoption and
native Windows lifecycle acceptance are tracked separately in the
[implementation evidence](switchyard-status.md). A working runtime is never
rebuilt merely to demonstrate an installer.
