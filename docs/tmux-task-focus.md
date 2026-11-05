# Return to an exact task pane

An existing interactive Claude task in tmux can use the normal protected
`coding/claude/focus` route and its task-role summon intent. The backend selects
the exact pane, verifies selection and then focuses its one attached Foot or
Alacritty window. It sends no terminal text, creates no server and claims no
task resumption or completion. New tmux sessions are not launched by this route.

## Establish the native target

The registered provider/account/repository/session must first pass the existing
live inventory checks. The CLI must have the expected executable, current-user
ownership, directory, process birth and foreground terminal group. Its ancestry
must reach the actual tmux server, optionally through one supported shell.

Only `TMUX` and `TMUX_PANE` coordinates are decoded from that verified process's
bounded environment read. Other environment values are neither decoded nor
returned; the temporary byte buffer is cleared. A missing, duplicate, malformed,
oversized or inconsistent coordinate refuses the target. No terminal title,
current directory guess or ambient `TMUX` value supplies identity.

The server socket and private parent must belong to the current user, retain
their exact filesystem identities and reject links/unprotected permissions.
Code-owned tmux commands use the explicit socket with `-N`, which prevents
starting a replacement server. Native pane/root PID, terminal device, server PID
and birth must agree. Exactly one attached client for the task's session must
lead to a supported direct terminal with one mapped compositor window. Multiple
clients or multiple windows per terminal process refuse selection.

## Keep navigation within its scope

The backend examines tmux hooks at global/session/window/pane scopes before
issuing metadata commands with possible after hooks. Configured hook bodies
refuse navigation and are never returned or changed. Metadata formats contain
only fixed native IDs, PIDs and device paths. Pane/client targets accept closed
numeric IDs and exact PTYs, with bounded output and command deadlines.

The account/session and entire native witness are rechecked before selection.
`switch-client -E` selects the exact pane without updating the session environment.
Selection readback and another provider check precede compositor dispatch.
Final pane, window, process and account readback are required for success. A
change after pane selection can refuse the later window effect; it does not
produce a successful focus result or trigger fallback/replay.

## Evidence and remaining acceptance

Seven tmux fault cases cover malformed/private metadata, configured hooks,
shared clients, incorrect TTY/owner/process, PID/socket changes, account
revocation, pane selection and compositor readback. The surrounding six-group
baseline passes 64 checks and the final three-group runner/window subset
passes 31. The final Claude/window capability subset passes all 29 checks in
three independently exited groups. Every child cleanup verifies; type checking
passes. [Pinned source/evidence summary](evidence/tmux-native-pane-summary.json).

A real private tmux server, two native processes and an attached Foot window
demonstrate changing to the exact second pane and verifying actual compositor
focus. Receipt `tmux-native-pane-1793887673453.json` records three session checks,
zero model prompts and no keyboard access. This demonstration uses a synthetic
CLI identity; a registered real Claude session and normal installed API path
have separate acceptance. All five owned processes, both transient units and
the exact private socket/directory are removed
(`tmux-native-cleanup-1793887736504.json`).

The first UI fixture failed before navigation because systemd expanded a literal
tmux session ID. Its failed receipt remains failed; the corrected fixture
disables environment expansion. The earlier detached prototype also retired
without a UI acceptance claim. No user terminal configuration, launcher,
keyboard mapping, provider account or model conversation was changed.
