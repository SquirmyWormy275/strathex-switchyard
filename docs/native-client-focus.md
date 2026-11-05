# Exact native ChatGPT main-window focus

The Linux Suite can focus the owner's repaired native ChatGPT main window. This
is one explicit navigation capability, separate from account identification,
conversation control, task resumption, typing or model submission. Other desktop
and IDE bindings remain unfinished in the Suite; commissioned companion surfaces
retain their separate contracts.

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
