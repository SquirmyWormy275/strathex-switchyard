# Verify an exact Windows editor terminal process

The Windows helper can now verify a specific terminal PID against its reviewed
executable. This is a prerequisite for task-specific editor attachment. It does
not yet connect the Suite or VS Code launcher to a Windows task.

`createWindowsTerminalProcessProbe().inspect()` accepts an exact PID, optional
previous process birth time, and executable path, SHA-256, volume, file ID and
size. The caller supplies a cancellation signal and fresh-context check. The
packaged adapter requires the verified Windows release and helper hash.

The native helper holds the original process handle, checks current user and
session, pins the executable file and hashes that held file. It checks the named
file and process again before returning. Repeated observations require the
original birth time. File IDs and birth times remain decimal strings to preserve
all 64 bits. Ambiguous paths, extra properties and substituted responses refuse.
There is no title match, process search, ancestor lookup or pathname-byte fallback.

Process access is limited to query and synchronization; token access remains
QUERY mask **8**. The observed target is never terminated or focused. Only the
query helper is supervised and retired. Unknown helper exit blocks replacement;
closing joins pending context reads and independently verifies helper retirement.
Requests allow ten seconds, 16 KiB of output and no captured stderr.

Fifteen focused groups pass **192 tests with two declared platform skips**.
Typecheck and all 34 native C# sources compile offline without warnings or errors.
The exact 33-file, 1,507,256-byte temporary compiler output is removed.
[Source evidence](evidence/windows-terminal-process-source-summary.json).

The actual Windows test now passes at `dec4dd5`, within eight client groups and
100 tests with no skips. It observes an owned Node fixture, rechecks its birth,
and refuses changed birth, changed image digest and an exited PID. Exact source,
artifact, commands, original bounds and cleanup verify.
[Native evidence](evidence/windows-terminal-process-native-summary.json).

Remaining implementation includes authenticated Suite routing, Windows editor
terminal orchestration and a peer-authenticated transport. Task/account binding
and protocol acknowledgement remain separate from process evidence. Frontend
and editor command activation remain frozen.


## Bind a held loopback connection to that process

`inspectPeer()` additionally requires a previous birth observation and the exact
IPv4 loopback client/server tuple. The native helper checks one established TCP
entry with that PID before and after hashing the held executable. It never
discovers a PID from a port or selects a nearby process. Table reads are limited
to 2 MiB and three allocation attempts; no endpoint table is returned or retained.
[Windows TCP ownership API](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable).

`inspectWindowsTerminalSocket()` derives that tuple from the caller's actual held
socket. It checks the socket around every context read, aborts when the socket
closes, and joins pending callbacks before returning. It leaves socket ownership
with the caller. A synchronous context callback cannot re-enter a reserved probe.

The latest results across thirteen focused groups pass **172 tests with three
declared platform skips**. Real local sockets exercise tuple selection, lifecycle
and cancellation with an explicit Windows probe double. All 34 native sources
compile offline without warnings/errors; the exact 33-file, 1,506,496-byte
compiler output is removed.
[Peer source evidence](evidence/windows-terminal-peer-source-summary.json).

The new actual Windows test binds an owned Node client, refuses the server's PID
and a reversed tuple, then refuses the closed connection. It is registered in
client CI and awaits native acceptance. This observation is a point-in-time
check; the transport must retain and recheck its socket. Authenticated WebSocket
transport, Suite routing and task-specific editor attachment remain unfinished.
