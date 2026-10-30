# Attribution Register

This register is a project control, not a ceremonial acknowledgements page. Add an entry before importing third-party code, artwork, geometry, photography, documentation, or firmware.

Last reviewed: 2026-09-02.

## Model F Labs configuration catalog (2026-10-29)

The offline catalog uses Vial definitions, reference keymaps and physical geometry from
[ploxiln/vial-qmk](https://github.com/ploxiln/vial-qmk/tree/c832c9b0edfa554c6e8344cb732f14620e63b210)
and [mymakercorner/vial-qmk](https://github.com/mymakercorner/vial-qmk/tree/761cb1c1b71ed91c48185f3e03465702b21e49f4).
Credit remains with Model F Labs / Ellipse, wcass, xwhatsit, Pandrew, NathanA,
ploxiln, Eric Becourt (Rico), and QMK/Vial contributors. The firmware repositories
ship GPL version 2; file-level GPL-2.0-or-later notices are preserved where present.
This is distinct from the Leyden Jar hardware repository's license.

Every copied file, immutable upstream URL and SHA-256 is listed in
`third_party/model-f-catalog/SOURCES.json`. Each upstream copy of `LICENSE` and all
copied source notices are retained. `NOTICE.md` explains the generated catalog.
Only definitions and reference configuration source are imported: no firmware
binary, flashing tool, product photography, or manufacturer marketing prose.
The generated catalog remains subject to these upstream terms; the root licensing
decision does not relicense it. Catalog research also uses the manufacturer's
[models](https://modelfkeyboards.com/) and [manual](https://modelfkeyboards.com/manual/),
linked as evidence without copying their prose. No affiliation is claimed.

## Contributor lineage

### Model F Labs / Ellipse (Joe)

- **Contribution:** Modern Model F and beam-spring keyboard project; manufacturer of the B122 hardware platform.
- **Canonical sources:** [B122 product page](https://www.modelfkeyboards.com/product/beam-spring-b122-keyboard/), [project manual](https://www.modelfkeyboards.com/manual/)
- **Use here:** Product identification, compatibility context, and links only at this stage.
- **Files copied:** None.
- **Relationship:** Independent project; no endorsement or affiliation claimed.

### Rico / mymakercorner

- **Contribution:** RP2040 Leyden Jar controller PCB, associated development, repository, and firmware links.
- **Canonical source:** [mymakercorner/Leyden_Jar](https://github.com/mymakercorner/Leyden_Jar)
- **License reported upstream:** GPL-3.0, with stated exceptions for two SnapEDA 3D models under CC BY-SA 4.0 plus the SnapEDA Design Exception 1.0.
- **Use here:** Architecture and contributor-lineage reference only at this stage.
- **Files copied:** None.

The Leyden Jar project records the following upstream lineage, which SXSY-B122 preserves:

- **Tom Wong-Cornall / xwhatsit:** original IBM capsense USB replacement controller design and capacitive-sensing lineage.
- **Ellipse of Model F Labs:** initiation and coordination of the modern keyboard/controller effort and manufacture of the new keyboards.
- **wcass:** controller variants and switch-plate PCB designs.
- **Pandrew:** controller work and the QMK/VIA firmware port, improvement, and maintenance.

See the Leyden Jar repository's “How the project started,” “Comparison with existing controllers,” and “Special thanks” sections for Rico's primary account.

### Vial

- **Contribution:** Real-time keyboard configuration GUI and Vial-specific QMK fork.
- **Canonical sources:** [vial-kb/vial-gui](https://github.com/vial-kb/vial-gui), [vial-kb/vial-qmk](https://github.com/vial-kb/vial-qmk)
- **License reported upstream:** GPL-2.0 for Vial GUI; Vial-QMK contains GPL-2.0 and component-specific notices that must be preserved file by file.
- **Use here:** Planned configuration and possible firmware integration.
- **Files copied:** None.

### QMK community

- **Contribution:** Keyboard firmware foundations used by Vial-QMK.
- **Canonical source:** [qmk/qmk_firmware](https://github.com/qmk/qmk_firmware)
- **License:** GPL-2.0 with file/component-specific notices.
- **Use here:** Indirect firmware lineage; no files copied at this stage.

### Microsoft .NET runtime

- **Contribution:** Runtime components statically bundled into the two self-contained Windows helper executables.
- **Canonical source:** [dotnet/runtime](https://github.com/dotnet/runtime)
- **License:** MIT with component-level third-party notices.
- **Use here:** Windows Sandbox guest-helper and Raw-HID helper runtime.
- **Distributed notices:** `deployment/windows/licenses/DOTNET-RUNTIME-LICENSE.txt` and `deployment/windows/licenses/DOTNET-RUNTIME-THIRD-PARTY-NOTICES.txt`, pinned to runtime 8.0.30.

### cyber_engineer / @Mates_ENGINEER

- **Contribution:** A4 relegendable-keycap geometry, example sheet, blank sheet, print calibration target, and package instructions for Model F122-style relegendable keycaps.
- **Source received:** `example-template.pdf`, `pure-template.pdf`, and `ReadMe.txt`, supplied directly to the maintainer.
- **Permission statement:** The included `ReadMe.txt` expressly welcomes editing, remixing, and redistribution and requests credit to “cyber_engineer” (`@Mates_ENGINEER`) for official distributions.
- **License classification:** Informal written permission; no standard license identifier stated.
- **Upstream notices visible in example PDF:** Template credit to cyber_engineer (GeekHack); some example icons credited to Remix Icon under the Apache License.
- **Use here:** Authoritative A4 geometry and calibration reference for the generated SXSY-B122 insert kit.
- **Files copied:** `third-party/cyber_engineer/ReadMe.txt` is byte-identical to the supplied package. The two PDFs are print-optimized distribution derivatives; their original and distributed SHA-256 values and exact transformation are recorded in the local README.
- **Original SXSY-B122 derivatives:** `output/pdf/SXSY-B122-legends-*.pdf`, `output/pdf/SXSY-B122-legends-calibration.pdf`, and `legends/printable/individual/*.svg` contain original project typography and control labels over or derived from the supplied geometry. No example icons were copied into the generated inserts.
- **Required treatment:** Preserve creator credit, the permission notice, calibration instructions, and any icon-level notices if upstream example artwork is distributed. Prefer original SXSY-B122 artwork over copying example icons.

### Remix Icon

- **Contribution:** Icons appearing in the upstream example template.
- **Canonical source:** [Remix Icon](https://remixicon.com/)
- **License reported by the template:** Apache License.
- **Use here:** Remix Icon artwork remains visible only in the preserved upstream `example-template.pdf`; no Remix Icon artwork is copied into generated SXSY-B122 inserts.

## Registration template

```text
Name:
Contributor or organization:
Contribution:
Canonical source:
License or permission basis:
Exact files/portions used:
Modifications:
Required notices:
Date accessed:
Verification notes:
```
