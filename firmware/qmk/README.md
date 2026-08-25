# B122 QMK/Vial signal firmware

This tree contains the complete hardware-independent firmware and transport source. Firmware emits bounded intent signals only. It cannot execute a host action and has no process, shell, filesystem, Git, credential, provider, or network interface.

## Canonical map and framing

`packages/protocol/src/b122.ts` exports the one canonical machine-readable map: 22 controls, 65 settled assignments, and intentionally absent assignments for all other chord slots. `packages/protocol/scripts/generate-manifest.mjs` SHA-256 hashes its canonical JSON and generates both the package JSON and `b122_manifest.h`. The current map SHA-256 is:

`7b8a6eb7e043665c04751a0fee15ee54d9793f9df288f9278bc8dc955f4174fc`

Every QMK Raw-HID report is exactly 32 bytes:

| Bytes | Meaning |
| --- | --- |
| 0–1 | B122 magic (`B1 22`) |
| 2–3 | protocol version and message type |
| 4–7 | flags, payload length, reserved zeros |
| 8–11 | connection epoch |
| 12–15 | monotonic message counter |
| 16–27 | typed payload, including boot nonce |
| 28–31 | CRC-32 of bytes 0–27 |

The message vocabulary is HELLO, HELLO_ACK, SIGNAL, ACK, NACK, and STATUS. HELLO binds protocol version, connection epoch, boot nonce, and the first 64 bits of the checked map SHA-256. The host rejects an incompatible map, a stale epoch, counter replay/gap, malformed reserved bytes, inconsistent assigned-bit claims, and corruption. Exact duplicate retries are acknowledged without emitting a second signal.

## Build and package

Generate/check derived map artifacts:

```powershell
node packages/protocol/scripts/generate-manifest.mjs --write
node packages/protocol/scripts/generate-manifest.mjs
```

Run deterministic no-hardware verification:

```powershell
node firmware/verify.mjs
```

Create a self-contained keymap overlay:

```powershell
./firmware/package-qmk.ps1 -OutputDirectory C:\safe\output
```

After inspecting the exact keyboard name and matrix in a Vial-QMK checkout, compile the overlay:

```powershell
./firmware/build-qmk.ps1 -QmkRoot C:\src\vial-qmk -Keyboard <exact-inspected-keyboard>
```

`B122_LAYOUT` is deliberately not guessed. The included Vial definition is a logical 1x22 validation/package definition; its coordinates must be replaced with the inspected physical matrix. The Vial unlock chord must also be selected on the real matrix before flashing.

## Windows Raw HID helper

`firmware/windows-hid-helper` is a .NET 8 Windows native helper source. It uses SetupAPI and HID APIs to enumerate interfaces and requires an exact VID, PID, usage page, usage, and optional serial. It reads/writes only 32-byte reports, reconnects after removal, and exchanges bounded JSON-line records with the companion. The TypeScript transport accepts only a canonical helper path beneath its installation root and an exact host-owned SHA-256; it never searches ambient PATH or falls back to an arbitrary HID device.

## Physical-only residuals

Source completion is not physical acceptance. The exact Leyden Jar controller/keyboard target, matrix coordinates, VID/PID/usage tuple, report-ID behavior, Vial unlock chord, EEPROM behavior, flash size, LEDs, hot-plug/sleep/resume behavior, coexistence with the existing diagnostic channel, key legends, modifier ergonomics, and device firmware flashing all require the actual keyboard and remain unaccepted.
