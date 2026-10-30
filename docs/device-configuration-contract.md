# Device configuration transactions

The authenticated local suite accepts reviewed key, onboard macro and physical
layout-option and advertised standard QMK setting changes through the same
baseline/apply/readback/restore path.
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
that mask. Advertised tap-dance, combo and encoder transactions are implemented below;
their expanded frontend editing controls remain unfinished.

Vial 4+ standard QMK settings are queried in bounded advancing pages. Only the
advertised IDs with a known codec can be read or edited: standard IDs 1–27 cover
tap/hold timing, modifier flags, repeat, mouse/wheel keys and rollover. Per-field
width/range checks apply; unknown/vendor IDs, reset, calibration and solenoid
commands cannot be selected. Missing or malformed optional setting replies leave
keymap/macros readable but setting writes unavailable. Pre-4 firmware is not probed.

Setting proposals require the exact current `before` value and an explicit
reviewed `value`. Known bitfield masks preserve unknown bits. Protected baselines
record a versioned setting codec. A partial multi-byte write can restore only
bytes matching its known before/after values; unrelated edits fail before any
recovery write. Restore preserves unowned bits, even if another tool changed them.
Changes to timing/modifier/rollover behavior require an ordinary-typing trial.

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

## Consented physical-key diagnostic

The backend provides a separate Vial switch-matrix test. Review requires the
currently selected Personal workspace, companion mode, recording permission and
a protected device readout no older than two minutes. It performs no HID I/O.
The notice explains that switch positions can reveal typing and asks the user to
close sensitive applications. Starting requires `consent: true` and the exact
one-use review token. Start rechecks live identity, the complete definition and
physical unlock; it does not read any pressed keys.

The caller can then request individual samples for at most 60 seconds and 240
samples, at least 100 ms apart. There is no background polling. Each sample
rechecks the protected scope, live identity and definition, with unlock checks
before and after the matrix query. Samples contain matrix coordinates only;
they are never written to compartment state, logs or a provider. A workspace
switch, keyboard-only mode, explicit stop, expiry, service restart or shutdown
revokes capture. Policy/identity failures discard late responses and require a
new explicit review. Stopping an in-flight request aborts its exact owned HID
transport and waits for it to settle.

Authenticated POST routes, in order:

1. `/api/suite/devices/matrix/review`: `{ compartment, deviceId }` returns
   `reviewId`, `consentToken`, notice and limits.
2. `/api/suite/devices/matrix/start`: `{ compartment, reviewId, consentToken,
   consent: true }` returns the ephemeral test `id` and deadline.
3. `/api/suite/devices/matrix/sample`: `{ compartment, id }` returns one sample.
4. `/api/suite/devices/matrix/stop`: `{ compartment, id }` revokes that test.

Stop does not silently relock firmware. The separate
`/api/suite/devices/lock` route accepts `{ compartment, deviceId }`, stops that
workspace's diagnostic, verifies the previously read exact identity, sends only
Vial's volatile lock command and verifies locked readback. Insecure firmware
that ignores relock is reported as unverified. No keymap, flash or electrical
setting is written. The frontend controls remain unfinished while frozen.

The codec follows the pinned firmware's
[matrix query](https://github.com/vial-kb/vial-qmk/blob/dd43959ae5c08d8a28d38a1acf7b04e86b14a344/quantum/via.c#L228)
and [lock contract](https://github.com/vial-kb/vial-qmk/blob/dd43959ae5c08d8a28d38a1acf7b04e86b14a344/quantum/vial.c#L139).
The firmware's compile guard is `(floor(cols / 8) + 1) * rows <= 28`; a matrix
outside that guard is rejected before any switch query, even when a different
packing calculation appears to fit. Rows use big-endian bytes with column zero
in the low bit. Malformed headers, lengths, padding, columns and lock replies
are rejected. Original xwhatsit does not inherit this Vial capability. Passing
fault transports does not establish actual typing, host layout, rollover or
physical LED behavior.

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

To include an advertised timing setting, add
`"qmkSettings": [{"id": 7, "before": 200, "value": 250}]` inside
`configuration`. These numbers are a synthetic API example, not a recommended
timing or permission to alter a connected keyboard. Use its actual readout.

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
Setting IDs, bounds and packing were checked against the same pinned GUI's
[settings catalog](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/resources/base/qmk_settings.json)
and the pinned firmware's
[query/get/set implementation](https://github.com/vial-kb/vial-qmk/blob/dd43959ae5c08d8a28d38a1acf7b04e86b14a344/quantum/qmk_settings.c).

Fault-transport tests cover exact wire-version boundaries, combined changes,
unknown option bits, opaque macros, storage overflow, typing fallback, backup
failure, interrupted writes, rejected readback, unrelated edits and restart
restoration, setting-query bounds, partial setting writes and preserved unknown
bits. They are software evidence; real key output, unlock, hot-plug and
typing behavior require the relevant physical keyboard.


## Tap-dance and combo transactions

A Vial 4+ snapshot now reads the advertised dynamic-entry counts and bounded
five-word tap-dance/combo records. It preserves unknown outputs in unedited
slots. Malformed advertisements, failed reads and older protocols do not enable
these writes. Key-override and alternate-repeat tables use the same transaction
boundary with their distinct mixed-width codecs; see the rule section below.

Add `tapDances` or `combos` to the same reviewed `configuration` object:

```json
{
  "tapDances": [{
    "index": 0, "before": [0, 0, 0, 0, 200],
    "tap": 4, "hold": { "kind": "momentary-layer", "layer": 1 },
    "doubleTap": 6, "tapHold": 0, "termMs": 250
  }],
  "changes": [{
    "layer": 0, "row": 0, "col": 0, "before": 4,
    "after": { "kind": "tap-dance", "index": 0 }
  }],
  "combos": [{
    "index": 0, "before": [0, 0, 0, 0, 0],
    "keys": [4, 5], "output": 6
  }]
}
```

This is a synthetic two-key example. It is not a configuration recommendation for
the disconnected F77. Use exact advertised indices, current entry words and
recorded keycodes. A combo can be cleared with only `index`, exact `before` and
`"disable": true`. Dynamic outputs reject raw firmware controls, HID error codes
and nested tap-dances. Combo triggers must be distinct ordinary keys present in
the recorded keymap.

A new TD key reference is checked against the proposed tap table so the ordinary
base-layer fallback remains available. A TD already referenced on the typing
layer must retain its tap output; move that reference through a separate review
before changing the tap meaning. Applying installs verified table entries before
new key references. Restoration removes those references before restoring their
tables. Every write requires physical unlock, exact current/baseline comparison,
status acknowledgement and readback. Interrupted byte mixtures remain recoverable
only within the transaction's before/after values; unrelated edits stop recovery
before any restoration write.

Nine additional fault-transport tests cover exact packing and protocol bounds,
combined TD/key changes, opaque slots, combo clearing, typing fallback, locked or
failed backups, partial writes, unplug/reconnect, bad readback and preflight of
unrelated edits. Physical typing, tap timing, chords and unlock acceptance remain
pending on real hardware. The frozen frontend does not expose these controls yet.

The wire contract follows the pinned GUI's
[dynamic advertisement](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/protocol/dynamic.py),
[tap-dance](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/protocol/tap_dance.py)
and [combo](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/protocol/combo.py)
code and the matching [firmware command handlers](https://github.com/vial-kb/vial-qmk/blob/dd43959ae5c08d8a28d38a1acf7b04e86b14a344/quantum/vial.c).
Switchyard implements the codecs independently; no upstream firmware is copied.


## Encoder directions

Snapshots now read both directions on each layer for indices explicitly declared
by Vial's KLE encoder markers. Missing indices are not probed. The decoder checks
normalized index/marker positions for KLE alignments 0 and 4; malformed or
unsupported centered encoder definitions leave encoder writes unavailable.
An echoed unsupported GET response also leaves writes unavailable. Existing
opaque values in other indices/directions are preserved.

Add direction changes to the same `configuration` object, using actual readout:

```json
{
  "encoders": [{
    "layer": 0, "index": 0, "direction": 0, "before": 4,
    "after": { "kind": "modified", "modifiers": 1, "keycode": 6 }
  }]
}
```

This is a synthetic example, not evidence that the F77 has an encoder. Directions
0/1 are the firmware indices; physical rotation needs a hardware trial. Each
proposal checks the advertised index, exact layer/direction and current value.
The existing baseline/unlock/review/replay/readback/restoration path applies.
Writes use the documented big-endian keycode payload and verify both the response
scope and fresh direction readback. Partial words are recoverable only within
the exact before/after bytes. Unrelated owned-direction edits stop all restoration
writes; unowned directions retain their latest values. New encoder TD references
restore before their tap tables.

Nine additional fault tests exercise label decoding, advertised-index gaps,
big-endian packets, unsupported reads, permission/baseline failures, interrupted
writes, unplug/reconnect, unrelated changes and combined TD restoration. The
shared synthetic transport stays outside production bundles. Actual knob behavior
and the corresponding frontend controls remain unaccepted/unimplemented,
respectively.

Source checks use the pinned GUI's
[KLE label normalization](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/kle_serial.py),
[encoder identification/read/write](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/protocol/keyboard_comm.py)
and the already linked firmware handlers. No layout labels are treated as host
commands or authority.

## Key overrides and alternate repeat

All four dynamic table counts are read from the same Vial advertisement and
bounded to 64 entries per kind. Key overrides transfer three little-endian
16-bit fields and four bytes (10 bytes); alternate repeat transfers two
little-endian 16-bit fields and two bytes (6 bytes). GET operations are 5/7 and
SET operations 6/8 within `FE 0D`. Reads require status zero; writes require status
and exact subsequent GET readback. Restoration compares every owned byte against
its before/after values, so an interrupted 16-bit field can be recovered without
accepting an unrelated third value. Raw unedited entries remain unchanged.

Add `keyOverrides` or `alternateRepeatKeys` to the same reviewed configuration
object. Every edit names its exact advertised index and raw `before` entry from
the fresh readout. Unknown/reserved option bits make that entry read-only unless
it is explicitly cleared with the exclusive `{index, before, disable: true}`
form. Each option is a required named boolean; extra or omitted fields fail
before a device write. Modifier lists use `lctrl`, `lshift`, `lalt`, `lgui`,
`rctrl`, `rshift`, `ralt`, `rgui`, without duplicates.

An override names a trigger already present in the keymap, an ordinary/no-op or
modified ordinary replacement, explicit layers 0–15 within the device's actual
layer count, and required/negative/suppressed modifiers. An enabled rule on the
typing layer must require a modifier unless its recorded trigger already embeds
one. Conflicting required/negative masks and enabled rules without an activation
event are rejected. This preserves plain unmodified typing. Macro, layer, nested
rule and firmware-control outputs are not accepted as override replacements.

For example, after reading an actual empty override slot on a keyboard that
contains Backspace, this proposal maps either Shift+Backspace to Delete on layer
zero. `oneModifier` makes either Shift sufficient:

```json
{
  "keyOverrides": [{
    "index": 0, "before": [0, 0, 0, 0, 0, 0, 0],
    "trigger": 42, "replacement": 76, "layers": [0],
    "triggerMods": ["lshift", "rshift"],
    "negativeMods": [], "suppressedMods": ["lshift", "rshift"],
    "options": {
      "activateOnTrigger": true, "activateOnRequiredModifier": false,
      "activateOnNegativeModifierRelease": false, "oneModifier": true,
      "noReregisterTrigger": false, "keepOnOtherKeyDown": false, "enabled": true
    }
  }]
}
```

Alternate-repeat edits require Vial 6. Their fields are `key`, `alternate`,
`allowedMods`, and options `defaultToAlternate`, `bidirectional`,
`ignoreModifierHandedness`, `enabled`. Keys are ordinary HID values or the
existing closed `modified` form. A default mapping may explicitly use no-op as
its trigger; other triggers must have an ordinary meaning present in the
recorded keymap. The dedicated repeat action must still be assigned to a key
or encoder and tried physically. This is a foreground keyboard function, not an
exact agent-session resume action.

Vial 6 also accepts the closed semantic key forms `{kind: "repeat"}` and
`{kind: "alternate-repeat"}` when a verified alternate-repeat table is
advertised. `{kind: "caps-word"}` and `{kind: "layer-lock"}` require the
corresponding advertised feature bits. Older GUI migration sentinels are never
sent as firmware keycodes. The ordinary base-layer fallback check still applies
to assignments of these controls. Unsupported firmware cannot gain a feature
merely by putting its name in a proposal.

The independently implemented codecs are checked against the pinned upstream
[wire structures and options](https://github.com/vial-kb/vial-qmk/blob/dd43959ae5c08d8a28d38a1acf7b04e86b14a344/quantum/vial.h),
[override GUI protocol](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/protocol/key_override.py),
[alternate-repeat GUI protocol](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/protocol/alt_repeat_key.py)
and [Vial 6 keycode values](https://github.com/vial-kb/vial-gui/blob/aef8222a2d0429a183b2ed692d5f9efcfd383f08/src/main/python/keycodes/keycodes_v6.py).
Tests assert literal wire packets, guarded proposals, partial-field recovery,
unplug/reconnect, readback failure, unrelated edits, reserved-bit preservation,
physical unlock, failed backup and consumed-review rejection. These are software
fault transports; no physical typing, repeat or modifier behavior is accepted.

## Host lock indicators

`POST /api/suite/host/keyboard-indicators` performs an explicit one-shot read. It
changes no keys, indicators, modes or firmware and does not retain a recording.
Authentication and the exact local origin are still required. This read is usable
in keyboard-only mode, independently of any assistant account. Frontend exposure
is pending the frozen review.

Linux reads only the kernel's `inputN::numlock`, `capslock` and `scrolllock` LED
class brightness values. Reports preserve each input instance separately: two
keyboards can disagree, and unavailable or malformed values remain null. There
is no invented single global Num Lock value and no inferred F77 association.

Windows uses a fixed read-only helper mode under the native Job guardian. Only
three toggle booleans leave the native process; the 256-key bitmap stays in
memory. Its scope is the documented
[GetKeyboardState calling-thread snapshot](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getkeyboardstate),
which is not claimed as live foreground-thread or physical LED attestation.
The helper neither attaches another input thread nor injects key events. Its
native API/field/cleanup check is included in the Windows observer CI step;
actual interactive Num Lock behavior remains a separate acceptance check.

Responses explicitly keep `physicalDeviceLinked`, `physicalLightVerified`,
`liveDesktopStateVerified` and `keyboardWritten` false. A lock indicator read
does not establish the keyboard's firmware Num Lock mapping. Read and identify
the actual controller separately; its typing/host LED interaction still needs
that device. The installed Linux check is
`scripts/verify-keyboard-indicators-host.mjs --read-only`.
