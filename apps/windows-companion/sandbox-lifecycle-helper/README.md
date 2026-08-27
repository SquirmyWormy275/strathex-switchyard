# B122 Windows Sandbox lifecycle helper

`b122-sandbox-lifecycle.exe` is the fixed native host boundary for interactive
Windows Sandbox instances. It is separate from `b122-sandbox-worker.exe`, which
runs inside one-shot quarantine guests.

The companion invokes the helper only as `--stdio-v1`. A single bounded JSON
request can launch the fixed inbox `C:\Windows\System32\WindowsSandbox.exe`,
inspect an exact process identity, focus that exact process, or terminate it for
a guarded rebuild. The durable identity binds PID, process creation FILETIME,
canonical image path, executable volume/file index, and Windows session ID.
Focus and termination reopen and revalidate that complete identity immediately
before the effect, so PID reuse fails closed.

The helper accepts no repository executable, shell, PATH lookup, arbitrary
process image, or ambient command. Launch verifies the exact `.wsb` digest,
creates Windows Sandbox suspended, captures its native identity, rechecks the
configuration, and only then resumes it.

Build and smoke-test with the pinned repository-local .NET SDK:

```powershell
.\.tools\dotnet\dotnet.exe publish `
  .\apps\windows-companion\sandbox-lifecycle-helper\Sxsy.B122.SandboxLifecycleHelper.csproj `
  -c Release --no-restore -o .\.tools\sandbox-lifecycle-publish
.\.tools\sandbox-lifecycle-publish\b122-sandbox-lifecycle.exe --self-test
```

The verified Windows release must install this executable beside
`b122-sandbox-worker.exe`. Installation requires current-user presence and
durably pins the SHA-256 of both helpers and the exact repository recipe
catalog. The JavaScript-only npm package does not claim to include this native
boundary.
