# QMK firmware transport

`keymaps/b122/keymap.c` is a QMK-compatible reference keymap. It maps logical
control IDs 1–22 to the protocol packet consumed by `packages/protocol`:

| Byte | Meaning |
| --- | --- |
| 0 | `0xB1` marker |
| 1 | protocol version (`1`) |
| 2 | logical control ID (1–22) |
| 3 | modifier mask (`Shift=1`, `Alt=2`, `Ctrl=4`) |
| 4–5 | little-endian sequence number |
| 6 | XOR checksum of bytes 0–5 |
| 7+ | zero |

The exact B122/Leyden Jar controller, matrix, RAW HID endpoint size, and Vial
configuration have not been selected or tested. `B122_LAYOUT` is therefore an
explicit integration seam, not a claim that the file is flash-ready. The
hardware identity, modifier ergonomics, transport lifecycle, hot-plug,
sleep/resume, multi-keyboard, and Raw HID coexistence acceptance gate remains
open.
