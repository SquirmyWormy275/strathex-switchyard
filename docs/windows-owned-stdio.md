# A persistent Windows process owned by Switchyard

`openWindowsOwnedStdio()` provides a bounded byte stream backed by one original
Windows Job. It is the process layer needed for persistent Codex task ownership.
The provider, task registry, durable editor journal and Suite routes are still
separate integration work. This primitive grants no model or account authority.

The packaged helper's new `--owned-stdio` role reuses the existing Job creation,
creation-time child assignment, suspended startup, private anonymous pipes and
read-only status query. Existing token QUERY mask 8, ACL rules and privileges
remain unchanged. The original bounded command role retains its deadlines.

The caller retains the owner before helper launch, the exact guardian scope
before worker creation, and the exact suspended worker before resume. A held
executable file must match the caller's SHA-256. The private request includes an
explicit executable, argument array, neutral working directory and filtered
desktop environment. It has no shell or runtime-injection fallback.

Guardian birth uses the existing runtime-status .NET tick convention. Worker
birth uses raw Windows FILETIME, matching the terminal process probe. These are
distinct coordinates; neither is guessed from a PID or replaced after failure.

Input and output use canonical base64 chunks of at most 16 KiB, each acknowledged
before another chunk in that direction. Node limits queued input to 2 MiB and
64 writes, readable buffering to a 32 KiB high-water mark, and pending control
bytes to 64 KiB. The native parent reader remains independent of worker input,
so a blocked writer cannot prevent parent EOF from terminating the original Job.
Stderr is drained without retaining its contents.

The persistent role has no whole-task command deadline. Startup permits 30
seconds on the host and ten seconds for each native acknowledgement. Closure of
either exposed stream, protocol failure, parent loss or explicit stop closes
admission. Shutdown joins startup callbacks and writes, then verifies original
helper exit and independently queries the original Job. Native tree retirement
has a three-second bound. A refused status query still retires its own query
child; unconfirmed Job exit cannot produce a stopped result. No process is
adopted and no replacement is launched.

Seventeen focused groups pass **142 tests with eleven declared platform skips**;
typecheck passes. Thirty-five C# sources compile offline with zero warnings or
errors. The exact 33-file, 1,561,459-byte compiler output was removed. No SDK,
runtime, dependency or model download was added.
[Source evidence](evidence/windows-owned-stdio-source-summary.json).

Linux checks use an explicitly named guardian double and actual owned child
processes. Three actual Windows CI cases cover byte exchange, abrupt guardian
loss with a descendant, and stopping while worker input/output are blocked.
Their acceptance is pending. They use synthetic Node workers, never a live
provider, account or saved task.

The earlier authenticated editor transport and task-protocol composition pass
twelve Windows client groups at `f1167c9`: 127 tests and no skips. The composition
uses provider/peer doubles; the separate carrier case uses actual Windows process
queries. That source predates this persistent process layer.
[Native composition evidence](evidence/windows-editor-connection-native-summary.json),
[editor contract](windows-editor-transport.md).
