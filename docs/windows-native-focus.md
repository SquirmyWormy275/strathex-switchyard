# Reviewed Windows native app focus

The Suite can review an exact local ChatGPT, Claude Desktop or stable Microsoft VS Code executable, save its identity
in the selected encrypted workspace, and focus its one verified existing window.
This is navigation only: it does not establish the signed-in account, identify a
conversation, resume a task, launch an application or submit a prompt.

The service and authenticated gateway are implemented and exercised with the real
encrypted store, executable hashing and native protocol parser. Windows process,
Authenticode and window responses are synthetic in those checks. Actual Windows
desktop acceptance remains pending. In **Your tools → Return to an open app**, choose the
application, review its installed executable, save that exact identity, then
review returning to its already open window. **Customize → Connect to this
computer** can review a navigation shortcut after that setup. Project selection
and task-specific IDE attachment remain unfinished.

## Explicit configuration

The existing authenticated, same-origin Suite API provides these routes:

| Route | Input and result |
| --- | --- |
| `POST /api/suite/native-focus/review` | `implementation: "native-chatgpt.focus/v1"`, `"native-vscode.focus/v1"` or `"native-claude-desktop.focus/v1"`, and an exact `executablePath`; returns the observed identity, one-use `reviewId` and required confirmation text. |
| `POST /api/suite/native-focus/configure` | The exact `reviewId` and `confirmation`; revalidates the application before saving the configuration. |
| `POST /api/suite/intent` | The implementation and a request UUID; dispatches only within the actual selected workspace. No executable path or command is accepted here. |
| `POST /api/suite/native-focus/recover` | No operation selectors; observes original helper retirement without repeating focus. This works in keyboard-only mode. |

Physical dispatch first checks the persisted selected workspace and its policy,
before validating a request UUID. A caller-supplied compartment cannot redirect
that selection. The policy is checked again at the existing effect boundaries.
[Native failure and regression correction](evidence/windows-focus-policy-source-summary.json).

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

VS Code has its own protected configuration and request identity. A ChatGPT
request cannot be replayed against the editor. The helper accepts the editor only
through its focus-only entrypoint; the companion's four provider enrollments and
launch profiles are unchanged. Stable VS Code is bound to its compiled product
identity and Windows version metadata; Insiders and Code - OSS are not alternate
targets. Microsoft's [Windows build metadata](https://github.com/microsoft/vscode/blob/main/build/gulpfile.vscode.ts)
sets the company and product-name fields used by the native image check. Actual
installed Windows image acceptance is still required.

## One focus attempt and its recovery

Windows discovery now exposes the implemented shortcut controls. Previously it
returned `shortcuts: false` on every non-Linux host, disabling the frontend even
when the Windows backend was present. Availability does not claim registration:
host layout remains unknown, app windows remain unobserved, and the native helper
still verifies the US host layout and chord at registration. Five groups/78 tests
pass through the real authenticated discovery route and pure metadata checks.
[Discovery evidence](evidence/windows-shortcut-discovery-source-summary.json).

The normal Linux installation contains these exact sources and passes 61 served
asset/API checks and 106 installed metadata checks across 62 module hashes. All
54 semantic workspaces, 57 workflow definitions and three conversations remain
intact. The current release and one rollback remain; both prepared copies are
removed after digest/ownership verification. This accepts the installed Linux
refusal and metadata boundaries, not an interactive Windows desktop.
[Installed evidence](evidence/installed-claude-desktop-controls-summary.json).

Claude Desktop has its own encrypted configuration and compiled desktop product
identity. It cannot reuse a ChatGPT request or select Claude Code. The existing
native helper still requires exact executable bytes, Authenticode identity,
file identity and Windows product/company metadata. An installed package update
requires a fresh review. No MSIX family, entrypoint or publisher is guessed, and
no package registration or settings are changed. The official Windows app uses
[per-user MSIX deployment](https://support.claude.com/en/articles/12622703-deploy-claude-desktop-for-windows).
Its real installed image must still pass this boundary; software fixtures are
not evidence that a particular released image does.

Linux Claude Desktop focus and application launching remain unfinished. The
[official Linux beta](https://support.claude.com/en/articles/10065433-install-claude-desktop)
targets Ubuntu/Debian; the presence of a Claude Code URL handler on this Arch
workstation does not establish that installation. Linux requests refuse without
probing or focusing a substitute application. The Windows controls are exercised
through authenticated HTTP and encrypted storage with native signature/window
doubles. [Claude Desktop source evidence](evidence/claude-desktop-focus-source-summary.json).

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

[ChatGPT service checkpoint](evidence/windows-native-focus-source-summary.json) and
[VS Code extension with retained receipt hashes](evidence/windows-vscode-focus-source-summary.json).
The [helper protocol](../apps/windows-companion/provider-desktop-helper/README.md)
documents the native messages and access constraints.

Installed `94a0135` verifies the corrected Suite hash within 74 metadata/in-memory
checks and 22 exact module hashes. All 54 semantic workspaces, selected workspace
and frozen frontend remain preserved; the dated backup and launcher readback
verify, and exact prepared staging is removed. This does not invoke native focus.
[Installed evidence](evidence/installed-windows-focus-policy-summary.json).

The native Windows client lane at `4f56477` passes seven groups and 94 tests
without skips, including the policy-ordering correction. Exact artifact digest,
source/merge tree, commands, bounds and child/tree cleanup verify. Interactive
desktop focus remains separate.
[Native receipt](evidence/windows-client-4f56477-passed-summary.json).
