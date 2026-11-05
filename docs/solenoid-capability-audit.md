# Solenoid source support and live capability

The protected device identification response now includes a `haptics` report.
It describes pinned source declarations separately from live state, fitted
hardware, electrical limits and authorized control. Reading it performs no HID
transaction and changes no profile or device configuration.

Two F77 builds have audited declarations. The WCASS Vial 4 build enables the
solenoid haptic driver in its [pinned build rule](https://github.com/ploxiln/vial-qmk/blob/c832c9b0edfa554c6e8344cb732f14620e63b210/keyboards/xwhatsit/brand_new_model_f/f77/wcass/rules.mk).
Its file SHA-256 is `836a228e4f4b30cca87bf2b3786ae38823f957de74802d4607e685fbc5abb5a4`.
The Leyden Jar F77 Vial 6 build separately selects that driver in its
[pinned rule](https://github.com/mymakercorner/vial-qmk/blob/761cb1c1b71ed91c48185f3e03465702b21e49f4/keyboards/leyden_jar/f77/rules.mk),
SHA-256 `d27327cb0f0456eb6574a58de7bac6ff1d92bba05cc4f0d139a10861984177a0`.
The protocol versions come from the corresponding
[WCASS fork header](https://github.com/ploxiln/vial-qmk/blob/c832c9b0edfa554c6e8344cb732f14620e63b210/quantum/vial.h)
and [Leyden fork header](https://github.com/mymakercorner/vial-qmk/blob/761cb1c1b71ed91c48185f3e03465702b21e49f4/quantum/vial.h).

The report requires a unique exact match of the protected UID, complete keyboard
definition, VIA/Vial versions and pinned source revision. Product names, geometry,
a copied UID, caller-authored capability fields or another protocol version do
not enable controls. Other catalog builds remain unverified by this audit. Source
identity remains a source comparison, not authentication of the running firmware.

Even for the matched pilot, the report keeps live state and control unavailable,
electrical/timing limits unverified and `allowedOperations` empty. A build rule
cannot establish the fitted driver, wiring, present coil state or safe limits.
The current configuration readout has no verified approved solenoid control path.
No default dwell value is proposed or inferred. Existing timing and drive behavior
are preserved. QMK's [haptic documentation](https://docs.qmk.fm/features/haptic_feedback)
describes firmware build/driver configuration; it does not attest this device.

The existing identification API uses only the selected compartment's protected
readout. Historical captures stay historical. Device writes, key assignment,
unlock, reset, flash, bootloader and electrical operations remain outside this
inspection. No new physical operation is authorized by source matching.

Seven capability/catalog cases pass, including both exact builds, unknown and
conflicting identities, protocol mismatch, caller-authored fields, unchanged
snapshots/profiles/mode, cross-compartment refusal and an instrumented zero-HID
API path. Source metadata also cannot bypass the existing firmware-control
keycode rejection. Twenty-five inventory/readout and twenty-three package/Suite
checks pass. The installed pilot can be inspected without a new USB query:

```sh
mise exec node@24.14.0 -- node scripts/verify-haptic-source-host.mjs \
  --cached-readout --device-id=EXACT_PREVIOUSLY_RECORDED_DEVICE_SHA256
```

The verifier requires one original protected Personal readout and checks exact
source facts plus preservation of readout, profile, workflow, mode, transactions,
selection and private endpoint. It has no HID transport and submits no prompts.
Normal installed `6a45643` passes six update and three cached-readout API checks,
with zero HID transactions and zero prompts. Receipts
`assignment-legends-1793861120925.json` and
`installed-haptic-source-1793861121084.json` retain exact source facts and
original-state preservation; owned bundle and proof checkout are removed.

Runtime-state/control integration remains unfinished protocol work. Fitted
hardware, electrical behavior and any exact physical transaction require separate
acceptance and authorization. This distinction is retained in the
[requirement ledger](switchyard-requirements.md); neither missing implementation
nor unavailable physical verification is reported as a complete capability.
