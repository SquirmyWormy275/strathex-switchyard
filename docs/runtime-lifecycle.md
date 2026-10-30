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

The supervisor is implemented and tested on Linux. Versioned component storage,
normal installed runtime commands, crash recovery and coordinated uninstall are
still being connected. The existing one-shot runtime setup has not yet been
replaced by that lifecycle. A working existing runtime is never rebuilt merely
to demonstrate an installer.
