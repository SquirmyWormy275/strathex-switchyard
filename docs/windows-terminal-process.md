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

The actual Windows test is registered in client CI. It observes an owned Node
fixture, rechecks its birth, and refuses changed birth, changed image digest and
an exited PID. Linux verification skips that native case; compilation and doubles
do not establish native acceptance.

Remaining implementation includes authenticated Suite routing, Windows editor
terminal orchestration and a peer-authenticated transport. Task/account binding
and protocol acknowledgement remain separate from process evidence. Frontend
and editor command activation remain frozen.
