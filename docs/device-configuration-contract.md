# Device configuration transactions

The authenticated local suite accepts reviewed key, onboard macro and physical
layout-option changes through the same baseline/apply/readback/restore path.
These backend capabilities are implemented; the frozen morning frontend still
exposes only ordinary key edits. Expanded editing controls are unfinished UI work.

## What is supported

VIA 9 with Vial 1–6 provides bounded keymap edits. Semantic key forms select
version-correct macro slots, momentary layers, layer taps, mod taps and modified
ordinary keys. Layer/slot bounds come from the device readout. Raw firmware-control
integers, bootloader entry, EEPROM reset, calibration and solenoid changes are
excluded. Base-layer validation retains every recorded typing meaning, including
ordinary taps on supported dual-role keys.

Macro edits support printable ASCII text, ordinary HID tap/down/up sequences and,
on Vial 2+, bounded delays. Held keys must balance. Unedited macro slots retain
their opaque bytes; storage capacity and the final sentinel are checked before
review. Text output still depends on firmware and host typing layouts. Unicode
output and arbitrary 16-bit macro actions are not implemented. Onboard macros
type into the foreground; they do not identify or control an agent session.

Physical layout choices use the definition's reverse-packed option bits and
preserve unknown higher bits. Choosing a layout does not rearrange physical keys.
Recovery checks its owned option bits and preserves unrelated changes outside
that mask. Tap-dance/combo/encoder/settings editing remains unfinished.

Original xwhatsit 0.9.0 remains a separate 8-byte, 8-bit-scancode adapter. Vial
macro/layer-option requests are rejected on that protocol. No compatibility is
inferred from a Model F product name or catalog geometry.

## Transaction behavior

Review captures a complete configuration baseline. Apply consumes a short-lived,
one-use review and requires fresh identity/configuration equality and physical
unlock where supported. The protected compartment stores its baseline before
any write. A kernel lock serializes Switchyard processes using the same device;
every HID operation checks the held lease. Other manufacturers' configuration
tools do not share that lock and should be closed during a transaction.

Macro writes set QMK's final-buffer-byte execution guard to `0xff`, verify the
guard, write and verify the body, then commit the final zero and read back again.
Interrupted writes remain disabled until recovery. Recovery preflights every
owned key, macro byte and option before writing, rejects unrelated edits, and
restores/readbacks the original content. Disconnection or a locked device leaves
an explicit recovery-pending transaction across restart.

USB interface identity and firmware UID are configuration evidence, not hardware
attestation. A firmware UID can be shared across units; serial-less interfaces
depend on their current OS path. Real reconnection and operator checks remain
part of hardware acceptance. No F77 hardware transaction is accepted while the
pilot device is absent.

## Backend request example

This is a developer contract example, not a command to run on the owner's device.
The `deviceId` must come from fresh authenticated discovery and the matrix/layer
and `before` values from its actual readout. Existing array-only key requests
continue to work.

```json
{
  "compartment": "personal",
  "deviceId": "<discovered configuration interface hash>",
  "configuration": {
    "changes": [
      { "layer": 1, "row": 0, "col": 0, "before": 1,
        "after": { "kind": "macro", "index": 0 } }
    ],
    "macros": [
      { "index": 0, "actions": [
        { "type": "text", "text": "Review the evidence" }
      ] }
    ],
    "layoutOptions": [0, 1]
  }
}
```

POST to `/api/suite/devices/review`, inspect the returned changes, then use its
`reviewId` with `/api/suite/devices/apply`. `/api/suite/devices/restore` accepts the
resulting transaction `id`. A review never writes configuration.

## Source contracts and evidence

Wire facts were checked against Vial GUI revision
`aef8222a2d0429a183b2ed692d5f9efcfd383f08`:
[protocol constants](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/protocol/constants.py),
[macro encoding](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/macro/macro_action.py),
[pre-6 keycodes](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/keycodes/keycodes_v5.py)
and [Vial 6 keycodes](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/keycodes/keycodes_v6.py).
The commit guard follows
[Vial QMK dynamic macro storage](https://github.com/vial-kb/vial-qmk/blob/dd43959ae5c08d8a28d38a1acf7b04e86b14a344/quantum/dynamic_keymap.c).
These are independently implemented protocol operations, not copied firmware.

Fault-transport tests cover exact wire-version boundaries, combined changes,
unknown option bits, opaque macros, storage overflow, typing fallback, backup
failure, interrupted writes, rejected readback, unrelated edits and restart
restoration. They are software evidence; real key output, unlock, hot-plug and
typing behavior require the relevant physical keyboard.
