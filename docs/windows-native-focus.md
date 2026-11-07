# Reviewed Windows ChatGPT focus

The Suite backend can review an exact local ChatGPT executable, save its identity
in the selected encrypted workspace, and focus its one verified existing window.
This is navigation only: it does not establish the signed-in account, identify a
conversation, resume a task, launch an application or submit a prompt.

The service and authenticated gateway are implemented and exercised with the real
encrypted store, executable hashing and native protocol parser. Windows process,
Authenticode and window responses are synthetic in those checks. Actual Windows
desktop acceptance remains pending. The frozen frontend has no new configuration
controls; Windows VS Code focus remains unfinished.

## Explicit configuration

The existing authenticated, same-origin Suite API provides these routes:

| Route | Input and result |
| --- | --- |
| `POST /api/suite/native-focus/review` | `implementation: "native-chatgpt.focus/v1"` and an exact `executablePath`; returns the observed identity, one-use `reviewId` and required confirmation text. |
| `POST /api/suite/native-focus/configure` | The exact `reviewId` and `confirmation`; revalidates the application before saving the configuration. |
| `POST /api/suite/intent` | The implementation and a request UUID; dispatches only within the actual selected workspace. No executable path or command is accepted here. |
| `POST /api/suite/native-focus/recover` | No operation selectors; observes original helper retirement without repeating focus. This works in keyboard-only mode. |

Review and configuration require the active Personal companion workspace. Work
policy, keyboard-only mode, selection changes and account-policy changes refuse.
Review is local and expires after five minutes; at most 32 reviews are retained.
The confirmation binds the canonical path, bytes, Authenticode signer, exact
64-bit file identity and product role. Changing the returned preview cannot
change the retained review. Configuration rechecks every identity field. The
signature runtime requires the explicit Windows system directory, with no
alternate runtime or account lookup fallback.

The Windows package contains the exact helper, its linked native source, and
the executable-identity and process implementations. Linux loads its existing
compositor implementation and does not carry the Windows-only TypeScript files.
The original full Linux package limit remains five MiB, including the manifest.

## One focus attempt and its recovery

Every attempt holds a cross-process desktop lease. Before any provider request,
the focus-only helper's exact PID and creation time are written to the encrypted
operation record. Discovery must find exactly one matching existing window. A
separate focus helper revalidates process birth, window identity, current user and
session; the host rechecks executable bytes and workspace authority at the final
effect barrier. The operation is durably marked potentially effective before
authorization can be sent. Success also requires native foreground readback,
original helper closure, persisted retirement and current policy.

An unknown helper exit retains the original process port. It cannot be replaced
until that exact child has verified retirement. After a restart, the packaged
read-only query observes the saved PID and birth. A reused PID proves the original
process is gone; it does not identify a replacement target. Query access stays at
`PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE` and `TOKEN_QUERY` **8**. Recovery
does not terminate or focus another process, and does not turn an uncertain focus
outcome into success. Cancellation and shutdown join in-flight recovery.

Completed request UUIDs return their stored result without another focus effect.
Foreign-workspace UUIDs and unresolved replays refuse. The store retains the most
recent 64 settled attempts, plus unresolved records and any unretired owners.
This is bounded recent-request replay protection, not indefinite deduplication.
Definite before-effect refusals can age out; uncertain effects remain preserved.
At 64 unresolved attempts, further attempts refuse pending explicit review of
that history. Recovery proves helper retirement, not the historical focus result.

Workspace changes preserve the original selection if helper retirement is
unconfirmed. Choosing keyboard-only saves that policy immediately, but does not
claim all processes stopped until retirement verifies. Protected owner records
are omitted from the ordinary Suite snapshot. The external application is never
closed by these operations.

[Source verification and retained receipt hashes](evidence/windows-native-focus-source-summary.json).
The [helper protocol](../apps/windows-companion/provider-desktop-helper/README.md)
documents the native messages and access constraints.
