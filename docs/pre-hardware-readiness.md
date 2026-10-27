# B122 pre-hardware readiness

Status date: 2026-09-02. This record distinguishes repository readiness from physical-keyboard acceptance.

## Completed before arrival

- The canonical 22-control / 65-assignment / 111-unassigned map is machine validated.
- Node.js is pinned to 24.14.0 for nvm, mise, package metadata, Linux CI, Windows CI, and bundled runtimes.
- Omarchy capability collection and exact-class native focus are host validated for VS Code `code` and Foot `foot`.
- Linux install prerequisites have a read-only preflight; missing packages block installation with an explicit package name.
- Isolated tests receive private `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` boundaries.
- The legend kit is deterministically generated from the canonical map in IBM Blue, Command Orange, and monochrome variants, with a calibration sheet, individual SVGs, and attribution-preserving source templates.
- The arrival-day harness generates and verifies all 176 chord slots and six transport/lifecycle cases without opening a hidraw device during identity capture.

## Intentionally unresolved

- Exact B122 VID, PID, serial behavior, HID usage, report descriptor, report ID, matrix coordinates, physical within-bank placement, Vial map, firmware build, rollover, LEDs, solenoid interaction, hot-plug, suspend/resume, and ergonomics.
- The B122-specific udev rule remains a placeholder and must not be installed.
- No F77 observation may be promoted into a B122 identity or acceptance receipt.
- All hardware-dependent acceptance gates remain **NOT ACCEPTED** until direct evidence exists.

## Omarchy workstation prerequisite

Run this before installing a Linux release:

```sh
deployment/linux/preflight-b122-linux.sh
```

The script is read-only. On the validated workstation `/usr/bin/espeak-ng` was the known missing prerequisite. Review the reported package names and install them through the workstation's normal administrator workflow before rerunning lifecycle validation.

## Evidence commands

```sh
npm run check:legends
npm run test:prehardware
npm run commission:b122 -- plan > b122-commissioning-plan.json
npm run commission:b122 -- capture > b122-hidraw-capture.json
```

`capture` reads Linux sysfs only. It does not open `/dev/hidraw*`, send packets, change permissions, or write a udev rule. Verification requires a separately completed operator observation receipt and cannot mutate acceptance documents.
