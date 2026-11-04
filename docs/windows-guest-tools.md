# Stage the embedded Windows worker

The reviewed guest worker now builds into the existing `Switchyard.Hotkeys`
image. `--stage-guest-tools` creates one private NTFS hard link named
`b122-sandbox-worker.exe`; the renamed image dispatches to the worker's existing
strict entry point. No second native runtime is copied. This is implemented
and software-tested; actual NTFS link and renamed-entry acceptance is pending
the native Windows CI journey.

The trusted host pins the installed helper's SHA-256. Callers cannot supply an
executable, source path, shell, arguments or replacement worker. The helper
pins its own image and parent directories, verifies its native identity and
digest, protects and reads back the new directory's inheritable DACL, then
creates and verifies the sole hard link. Both names must refer to the same
file. [Windows hard links](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createhardlinkw)
require the same volume and share the file security descriptor: the code never
changes the source file's ACL, and cross-volume staging has no copy fallback.

The host persists its encrypted ownership record before acknowledging native
readiness. It independently verifies the entire one-file tree, source identity,
bytes and digest before handing out a lease. Native stager exit and guest
consumer exit are separate cleanup requirements. Changed files, foreign entries,
replaced directories and uncertain owners are preserved. An interrupted request
cannot replay; a verified late stop releases the in-process resource slot for a
different reviewed operation. Input staging has the same late-stop correction.
The lease grants no sandbox protections.

All 44 staging, snapshot-exclusion and runner-inventory cases pass. A build with
the existing local SDK has zero warnings/errors. Six compiled checks establish
the host entry point, same-assembly worker, strict worker argument rejection
(exit 64 before guest checks), and refusal of all three native-only modes on
Linux. Source/assembly hashes are retained in
`windows-embedded-worker-build-20261104.json`; build/probe scratch was removed.
The separate Windows CI script now includes actual hard-link identity,
unchanged source bytes, protected directory, renamed-entry guard, independent
guardian exit and owned-link removal checks. It never creates a VM.

Selected recipe runtimes still need an equally exact staging contract. The
Studio Windows Run adapter and filesystem-bounded writable exchange also remain
unfinished implementation. Native VM startup/login/worker/stop acceptance needs
a supported Windows Sandbox host; that does not block this source work.
