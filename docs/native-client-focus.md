# Exact native ChatGPT main-window focus

The Linux Suite can focus the owner's repaired native ChatGPT main window and
the exact VS Code window described below. This
is one explicit navigation capability, separate from account identification,
conversation control, task resumption, typing or model submission. The
[Windows ChatGPT and VS Code backend](windows-native-focus.md) now supports explicit executable
review and durable focus ownership; its native desktop acceptance is pending.
Project selection and task-specific IDE attachment remain unfinished. Commissioned companion surfaces retain
their separate contracts.

The fixed target is the user-local repaired executable maintained by the existing
safe launcher. Discovery requires the current user's exact executable, a live
process birth identity and one unambiguous non-floating main window. Hidden,
unmapped, duplicate or malformed targets refuse. Floating overlays are never
targets. A class name alone cannot establish application identity.

The focus path checks policy, witnesses the target, checks policy again and
repeats the witness before dispatch. It sends only the verified compositor window
address. Readback must report that address and PID, with unchanged process birth,
followed by fresh policy authorization. There is no class-wide selection,
foreground typing, alternate application or browser fallback.

The authenticated physical-intent route uses the actual selected workspace;
caller-supplied compartment cannot redirect it. Persisted selection drift, Work
policy or keyboard-only mode refuse. Policy changes after the focus effect cannot
produce a verified success. Test injection remains internal to the service;
HTTP callers cannot supply process readers, executable paths or native commands.

Real direct and authenticated source-gateway demonstrations pass. The latter
uses an owned encrypted software workspace and normal authenticated gateway while
targeting the actual repaired native app. Unauthenticated access refuses. Both
retain unchanged process identity, exactly one mapped native main window and zero
floating overlays. The owned gateway fixture is removed; the installed selection,
safe launcher, voice repair and overlay guard remain intact. No prompt or keyboard
transaction occurs. [Receipt hashes and scope](evidence/native-main-window-focus-summary.json).

Four focused fault tests cover spoofed executables/owners, PID reuse, overlays,
hidden or duplicate windows, malformed addresses, wrong readback and policy
revocation. The authenticated gateway adds real encrypted-state checks for saved
selection and mode changes before/after effect. Six surrounding isolated groups
pass 65 checks; the final four-group gateway/package subset passes 38, with every
child cleanup verified and owned scratch removed. Type checking passes. These
demonstrations exercise current source; normal installed acceptance now passes as recorded below.


For normal installed-release acceptance, the bounded pilot verifier is:

```sh
mise exec node@24.14.0 -- node scripts/verify-native-focus-host.mjs --synthetic
```

It requires a ready installed app containing this exact source, an already open
repaired native main window and a selected Personal workspace without active user work.
It mutually authenticates the saved app before sending its bearer. A fixed empty
validation workspace is independently checked before use; an existing populated
workspace is preserved. It proves unauthenticated and keyboard-only refusal,
then exact focus through the normal installed gateway. Restoration returns the
validation workspace to keyboard-only and restores the original selection,
Personal definitions, private endpoint and frozen Home. The small encrypted
validation audit and JSON receipt are retained. It creates no native coding task,
feed, scanner fixture, prompt, credential account, keyboard or microphone access.
Normal installed `b82f056`, release
`a6c095ec81436d03fc136e7f6da73977c842e9cabb57ceb33f15a202daa11416`,
passes six update and all five focus/API/restoration checks. Receipt
`installed-native-main-window-1793881005201.json` verifies one mapped main window,
zero floating overlays, exact original selection/definitions/mode/private endpoint
and frozen Home restoration. The disposable package and proof checkout are
removed; no prompt, coding task, keyboard or microphone access. The first installed
attempt retains failed `installed-native-main-window-1793880918796.json`: its
verifier unnecessarily assumed the original Personal workspace was keyboard-only.
It stopped before any workspace mutation. Exact owned checkout cleanup and
unchanged failed outcome are recorded in
`failed-native-focus-installed-cleanup-1793881033321.json`. The corrected verifier
checks actual active work and independently settles every retained guardian
before selecting its empty fixture; it preserves the original mode.


## VS Code navigation

`native-vscode.focus/v1` now connects the same exact-process/window boundary to
the Suite's authenticated active-workspace intent route, reviewed shortcut
compiler, stable CLI gateway and host capability discovery. It requires one
current-user native `/usr/share/code/code` main window. The current verified
Wayland class is `com.microsoft.VSCode`; the earlier verified `code` class is also
accepted. Both still require the exact executable and unchanged process birth.
A class label alone, alternate editor, hidden/multiple windows or reused PID
cannot choose a target. Missing clients refuse without launching another app.

The local label is **Show VS Code** and the consequence is navigation. The
`native-vscode` provider is Personal-only under the default policy. Work and
keyboard-only checks occur before and after focus, with no personal fallback.
Repository, GitHub Copilot extension, account, editor task and agent-session
identity remain unverified. No content, prompt, URI, command or executable path
can be supplied through this route. Broader IDE/session integration and native
Windows focus remain unfinished.

Six isolated configuration/gateway/terminal/Suite/package/runner groups pass all
90 checks with every child cleanup verified and owned scratch removed
(`isolated-test-66903f0b-865b-492b-b007-3b68326d91b7.json`). Real native source-gateway
acceptance passes unauthenticated and keyboard-only refusals, then exact VS Code
focus, with the repaired ChatGPT identity unchanged and zero model prompts
(`native-vscode-gateway-1793881739644.json`). Its editor uses a separate temporary
profile and extensions directory with installed extensions disabled, following
[the documented isolation options](https://code.visualstudio.com/docs/configure/command-line#_isolating-vs-code-instances).
The first live prototype excludes the current verified class and refuses before
any focus effect; `native-vscode-gateway-failed-1793881702084.json` remains failed
and its owned gateway fixture is removed. The corrected path explicitly includes
the observed class; it does not broaden to arbitrary titles/classes.

The installed verifier accepts `--synthetic --client=vscode` as a separate mode;
the original command continues to check repaired ChatGPT. Normal installed `dd0cad1`, release
`c50a7624c39c2866c59e2c7275c0e7156f5142a73543360751468fcd8309f805`,
passes six normal update, five VS Code and five repaired ChatGPT compatibility
checks. Receipts `installed-native-main-window-1793882002589.json` and
`installed-native-main-window-1793882003855.json` verify full original selection,
definitions/mode/private endpoint and frozen Home restoration. Window counts are
scoped to the verified target process. Two earlier installed verifier journeys
remain failed with restoration: a later precise phase identifies a class-wide
count that included another application. The actual focus and process-readback
checks had passed before that terminal count. The corrected verifier counts only
the independently verified process and retains a dedicated class-collision test.

The exact owned editor unit is stopped; its cgroup is empty/removed and independent
process readback is clear. Its separate profile/extensions and proof checkout are
removed, the disposable package is removed and original user settings are
unchanged (`owned-vscode-retirement-1793882075618.json`). Another application
sharing VS Code's class remains open. After owned editor exit, the source target
refuses rather than focusing it (`native-vscode-no-fallback-1793882102370.json`).
No user editor instance is closed. [Receipt hashes and limits](evidence/native-vscode-focus-summary.json).


Native Windows client CI at `4fd8c28` retains a failed original 45-second combined
physical/gateway file despite all seventy reported assertions passing. The
independent exit deadline was not accepted; its archive digest and cleanup verify
in [the timeout summary](evidence/windows-client-4fd-timeout-summary.json).
The complete native focus gateway cases now run from their own required file,
with every assertion retained and the same 45-second per-child limit. The exact
client lane includes both files. Eight local runner/client groups pass 87 tests,
86 passed plus one declared platform skip, with every child cleanup verified
(`isolated-test-dbc2c702-1e9d-42d8-8a4a-9df1205e1778.json`). New native acceptance
is pending. The complete required inventory now contains 219 independently run
groups; earlier full checkpoints retain their original source-bound counts.

The independent Windows client rerun at `04d9d6c` passed all seven required
groups and 70 assertions, with every child cleanup verified. The [retained
summary](evidence/windows-04d-client-summary.json) binds the exact archive digest.
Both complete focus/physical-intent files keep their original deadlines. This
software contract result complements the actual Linux desktop demonstrations;
it does not establish native Windows desktop interaction.
