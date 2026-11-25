# Alex's F77 test bed

The Model F Labs F77 is Switchyard's first personal hardware test bed. The host
uses US QWERTY; Dvorak is in the keyboard's dynamic configuration. Preserve that
separation. On October 29 the keyboard was disconnected, so no fresh firmware,
matrix, physical control, solenoid, or keymap acceptance is claimed.

Private Vial snapshots and firmware recovery artifacts remain outside Git.
A snapshot may inform a preview after its layout choices are checked; it is not
a live read or a complete restorable firmware backup.

Use the [configuration tutorial](../../docs/switchyard-configuration.md) for the
host-only loop. Device application requires reconnecting the F77, reading its
actual identity/configuration, capturing a fresh baseline, and verifying the
specific supported operation. Never infer controller capabilities from a label.
