# Original xwhatsit: configuration evidence, not a Vial alias

The adapter implements the original vendor's **ibm-capsense-usb 0.9.0** protocol.
The [author's source index](https://static.wongcornall.com/ibm-capsense-usb/0.9.0/)
provides the
[619,806-byte source archive](https://static.wongcornall.com/ibm-capsense-usb/0.9.0/ibm-capsense-usb_0.9.0.tar.gz).
Its SHA-256 is
`50ad711d35d50245f513f8c41a74048788184de1a31e9401a53519827a95397f`.
The original source is copyright Tom Wong-Cornall and licensed GPLv3-or-later;
this adapter uses an independently implemented wire contract and retains its
source references. No firmware or vendor program is executed during verification.

## Supported configuration readout

The exact discovered configuration interface must open as
`original-xwhatsit-0.9`. Reporting-state changes use eight-byte command-zero
packets. The adapter stops the previous stream before selecting a new one and
quiesces the stream on exit, including failures.

| Reporting state | Meaning and validation |
| --- | --- |
| 9 | Exact `0.9.0` version, fixed frame length and trailing nulls. |
| 1 | Four layers; known 4/8-row and 12/16/23-column framing; recognized keyboard type and report-mode byte. These are protocol constraints, not physical-model identification. |
| 7 | Rotating column-major keymap, with layer/slice/column encoded in its second byte. All positions must arrive; malformed indices, reserved bytes, truncation and conflicting duplicates reject the readout. |
| 10 | Expansion mode and two value bytes. Remaining bytes must match the known zero padding. |

The expansion codec recognizes modes 0–14: disabled, solenoid/buzzer, lock LED
output, or solenoid/buzzer plus an open/closed lock switch. In solenoid modes the
vendor utility names the two values extend and retract milliseconds. Unknown
mode bytes remain unknown with raw values intact. The backend does **not** claim
that a solenoid is connected, the driver or wiring is identified, those timing
values are electrically safe, a physical light changed, or the host lock state
matches the configured switch. It provides no expansion setter.

The ordinary key editor keeps its protected baseline/apply/readback/restore
path. Command 5 calls the vendor's EEPROM byte updater directly, so no additional
store command is issued. Unowned expansion values survive key restoration.
Legacy codes 1 and 2 identify calibration references; code 3 controls expansion.
Their existing positions cannot be edited here, and none can be newly assigned.
Code 0 means ignored; it does not inherit Vial's code-1 transparency. New unknown
scancodes are rejected while existing opaque values remain preserved in readouts.
Macro, layer-condition, calibration, bootloader and expansion-control editing
remain separate unfinished capabilities.

## Traceability and validation

| Archive-relative source | SHA-256 | Contract evidence |
| --- | --- | --- |
| `src/diag.c` | `e20ce3b923d1f702bc852eda35d02e800c4c4e36ef0f618b5a1aab71640c11c7` | Fixed reporting frames, column stream, expansion getter and setter dispatch. |
| `src/exp_types.h` | `5891d314edf2feac7c0620bba17069979e4be7bca2e823876155b22c801b2a9f` | Expansion mode numbering. |
| `src/layers.c` | `9c8ef0161d66bf8ac3c6292a01a730e39eaa5735c3c7e592a9134ff2dc961716` | Direct persistent key writes and erased-byte handling. |
| `src/kbd_defs.h` | `f722652801eb8b148ec542a3ee19f1b24ed5ee2f804c1ef364800d5206b27ea3` | Calibration/expansion and layer-key meanings. |

The [seven protocol tests](../tools/layout-studio/xwhatsit-expansion.test.mjs)
exercise all declared modes, unknown values, three source framing shapes,
rotating streams, bad identity/version/dimensions, malformed and incomplete
frames, duplicate conflicts, ordinary key apply/replay/restore and protected
calibration/expansion codes. All 82 focused device/configuration tests pass.
These are fault transports; actual legacy-controller readback, unplug/reconnect,
power-cycle persistence, ordinary typing and physical expansion acceptance are
still open. This path does not grant Vial unlock, matrix capture or haptic control.
