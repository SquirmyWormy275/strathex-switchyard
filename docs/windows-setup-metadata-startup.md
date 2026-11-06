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
