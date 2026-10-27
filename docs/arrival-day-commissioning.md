# B122 arrival-day commissioning

Do not borrow facts from another keyboard. In particular, USB `1209:4704` with serial `vial:f64c2b3c` is the previously observed F77 and is explicitly rejected by the verifier as B122 evidence.

## 1. Preserve the factory state

1. Photograph the unopened hardware and record manufacturer markings.
2. Connect the B122 directly, with no unreviewed USB remapper in the path.
3. Export and archive the factory Vial configuration before changing a key or firmware image.
4. Record the exact Vial/QMK versions used for the export.

## 2. Capture identity without touching the device node

```sh
npm run commission:b122 -- capture > b122-hidraw-capture.json
```

The capture receipt must state `readOnly: true` and `deviceNodesOpened: false`. Select the candidate only after correlating connect/disconnect events and the physical label. Record its exact hidraw node, canonical sysfs path, VID, PID, serial if present, and report-descriptor SHA-256. Do not install the udev template yet.

## 3. Establish transport deliberately

1. Review the observed descriptor and factory Vial map.
2. Decide the Raw HID report identity and framing from evidence, not from the F77 or an earlier proposal.
3. Implement or configure the narrow identity, then revalidate it across open.
4. Preserve a recovery firmware/configuration profile before the first modified flash.

## 4. Execute the 176-slot matrix

```sh
npm run commission:b122 -- plan > b122-commissioning-plan.json
```

For every one of 22 controls, observe normal, Shift, Alt, Shift+Alt, Ctrl, Ctrl+Shift, Ctrl+Alt, and Ctrl+Shift+Alt exactly once. Record:

- `dispatched` plus the exact canonical handler for each of the 65 assigned slots;
- `inert` plus a null handler for each of the 111 intentionally unassigned slots;
- no duplicate, missing, or unknown chord.

The three deliberately unused modifier families must remain inert on every control. Gated handlers may dispatch only to their mediated blocked/preview state; the key never supplies authorization.

## 5. Observe lifecycle cases

Record timestamped, positive evidence for:

- hot-plug and unplug/replug recovery;
- suspend and resume;
- Vial coexistence without transport corruption;
- rollover while ordinary typing continues;
- all relevant LED states;
- solenoid interaction, including transport stability and user control.

Also verify the ordinary keyboard and B122 coexist without layout leakage, repeated events, or unintended commands.

## 6. Verify, then review acceptance separately

Create `b122-commissioning-observations.json` using schema `sxsy-b122-commissioning-observations/v1`, then run:

```sh
npm run commission:b122 -- verify \
  --capture b122-hidraw-capture.json \
  --observations b122-commissioning-observations.json \
  > b122-commissioning-verification.json
```

The verifier fails closed on placeholder identity, a mismatched capture, the known F77 serial, incomplete lifecycle evidence, or any chord mismatch. A passing receipt reports `acceptanceMutationPerformed: false`: a human review must still decide which acceptance gates, if any, have enough evidence to change.

## 7. Settle physical placement and print

Only after direct ergonomic use, settle the within-bank physical order. Update the canonical placement source before replacing the pre-hardware A/W logical-order labels. Print at A4 actual size / 100%, verify the 15 mm box, inspect all cut lines, and retain an uncut master sheet.
