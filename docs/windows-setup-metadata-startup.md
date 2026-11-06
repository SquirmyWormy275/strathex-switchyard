# Windows setup metadata startup

The restricted owner now creates its identity worker, but native `20dc066`
reports exit **3221225794 / 0xC0000142**, with zero output bytes. Windows defines
this as DLL initialization failure. The original owner remains **0/8**; the
specific failing module is not established.
[Native receipt](evidence/setup-worker-native-summary.json),
[Microsoft status codes](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-erref/596a1078-e883-4972-9bbc-49e60bebca55).

`Switchyard.Setup.exe --metadata` reads the current user identity. Its shell and
COM APIs are used only by the separate installation/elevation path. Eagerly
loading those libraries imposes unused UI dependencies on metadata startup.
That is a candidate explanation of this failure, not an established diagnosis.

The candidate defers `shell32.dll` and `ole32.dll` with the MSVC delay-load helper.
The original entrypoint restricts DLL search to System32 before any first call;
the executable retains `/DEPENDENTLOADFLAG:0x800`, static CRT, control-flow guard
and its original native entrypoint. The APIs and installation/elevation branches
are unchanged. No alternate runtime, permission expansion, account change or
desktop grant is introduced.
[MSVC delay loading](https://learn.microsoft.com/en-us/cpp/build/reference/delayload-delay-load-import?view=msvc-170).

Native setup preflight now checks actual PE bytes: x64 identity, bounded
unambiguous section/RVA mappings, System32 dependency flags, terminated import
tables, exactly those two deferred modules and no eager UI imports. The parser
loads no DLL and does not claim runtime module isolation. The original six
preflight assertions, lifecycle checks and eight restricted-owner assertions
remain required.

Four isolated groups pass **50 tests**, including malformed/truncated/overlapping
address refusal, unexpected eager imports, missing/duplicate delayed modules,
original native transport behavior and release packaging. All child/tree cleanup
is verified. There is no local Windows compiler acceptance; CI must build and
execute this candidate using its existing toolchain. The installed app is unchanged.
[Source evidence](evidence/setup-deferred-imports-source-summary.json).

## Native result and console startup candidate

Native source `56d115e` builds and passes all six ordinary setup checks. Its
actual PE import table verifies the deferred shell/COM libraries and System32
dependency flags. The restricted worker still exits `0xC0000142` with zero
output; all eight original owner checks remain unaccepted. Deferred imports
alone did not resolve the failure.
[Native receipt](evidence/setup-deferred-imports-native-summary.json).

An earlier exact-image native helper comparison under the same restricted token
reached code only when console initialization was avoided. The subsequent GUI
helper also reached its entrypoint in both launch modes. This is relevant evidence
for the next setup candidate, not proof that setup has the same failing dependency.
[Comparison](evidence/windows-lease-console-native-summary.json),
[helper follow-up](windows-helper-startup.md).

Setup already communicates through inherited handles and has no console input,
console output or console allocation API. The next candidate selects the Windows
GUI subsystem while explicitly retaining `wmainCRTStartup`, so the ordinary C++
runtime initialization, wide command-line arguments and existing `wmain` remain.
The native PE proof now refuses a console-subsystem image. No GUI window is added
by this linker setting; the existing explicit elevation API remains the sole UI
branch. Production process creation, Job containment and suspended acknowledgement
are unchanged.
[Microsoft subsystem selection](https://learn.microsoft.com/en-us/cpp/build/reference/subsystem-specify-subsystem?view=msvc-170),
[CRT entrypoint](https://learn.microsoft.com/en-us/cpp/build/reference/entry-entry-point-symbol?view=msvc-170).

The exact-image native preflight and original restricted owner must execute this
candidate in CI. Source checks do not establish Windows startup acceptance.

Four focused groups pass **50 tests, zero skips**, including console/unknown
subsystem refusal, original native transport and packaging checks. Child/tree
cleanup verifies. [Source receipt](evidence/setup-gui-source-summary.json).

## GUI subsystem native follow-up

Native `c9a858a` verifies the actual GUI image and passes all six ordinary setup
checks. Restricted identity startup now completes, and the unchanged original
owner reaches **seven of eight checks**. The remaining failure is final
exit/fixture retirement after the CI descendant-registration limit is reached;
setup startup is no longer the failing phase.
[Native receipt](evidence/setup-gui-native-summary.json),
[final-registration correction](windows-descendant-query.md#final-retirement-registration).

This narrows the observed startup failure to a console-subsystem dependency
under this restricted native environment. It still does not identify a specific
failing DLL, accept an ordinary user account or establish an interactive UAC/guest
journey.
