# Attribution Register

This register is a project control, not a ceremonial acknowledgements page. Add an entry before importing third-party code, artwork, geometry, photography, documentation, or firmware.

Last reviewed: 2026-08-20.

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
- **Use here:** Geometry and production reference for SXSY-B122 insert prototypes.
- **Files copied:** None in the initial repository foundation.
- **Required treatment:** Preserve creator credit, the permission notice, calibration instructions, and any icon-level notices if upstream example artwork is distributed. Prefer original SXSY-B122 artwork over copying example icons.

### Remix Icon

- **Contribution:** Icons appearing in the upstream example template.
- **Canonical source:** [Remix Icon](https://remixicon.com/)
- **License reported by the template:** Apache License.
- **Use here:** No Remix Icon artwork is currently copied or planned. Reassess if any icon is imported.

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
