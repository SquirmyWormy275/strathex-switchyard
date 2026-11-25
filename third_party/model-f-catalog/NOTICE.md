# Model F Labs catalog source

These unmodified files are configuration and geometry source from two QMK/Vial
firmware repositories. See `SOURCES.json` for every path, immutable upstream URL,
commit and SHA-256. Upstream licenses are retained at `ploxiln/LICENSE` and
`mymakercorner/LICENSE`; preserve file-level notices too. Contributors include
Model F Labs / Ellipse, wcass, xwhatsit, Pandrew, NathanA, ploxiln, Eric Becourt
(Rico), and the QMK/Vial community. The copies here are not relicensed.

`node scripts/build-model-f-catalog.mjs` verifies these files and generates the
offline catalog. The generator extracts geometry, named reference variants and
layer zero. It does not compile or distribute firmware. The resulting catalog
contains material derived from these GPL sources and retains their terms.
Modified generated data is identified by its generator and source manifest.

The October 30 identity addition retains 40 literal `config.h` UID headers from
the same pinned commits. Only the eight-byte `VIAL_KEYBOARD_UID` literal is
extracted; C/preprocessor expressions are not evaluated and other header settings
are not exposed as supported operations. All saved-preset UIDs are parsed from
their exact decimal source text, without JavaScript number rounding, and checked
against the corresponding header. Readout reconciliation requires the complete
definition as well as the UID. A source UID is not a unique device serial,
authenticated identity, physical case measurement or hardware-revision attestation.

Reference configurations are not backups or proof of a connected device's
controller, firmware, physical assembly, typing layout or current programming.
Diagnostic all-pads maps remain in source for traceability, but are not presented
as usable physical layouts. Product photos and manufacturer prose are not copied.
