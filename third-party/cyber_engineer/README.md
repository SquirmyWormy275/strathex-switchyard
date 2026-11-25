# cyber_engineer relegendable-keycap template package

These three files were supplied directly to the maintainer. `ReadMe.txt` is preserved byte-for-byte. The two PDFs are print-optimized distribution derivatives produced with Ghostscript `pdfwrite`, `/prepress`, PDF 1.7, font subsetting/compression, and duplicate-image detection; their A4 media box, vector geometry, visible notices, and 15 mm calibration target were then visually and programmatically checked.

| File | SHA-256 |
|---|---|
| `example-template.pdf` | `11cfaa8ebc0baed0bfb4e274f805242a37269566c181b388efdd750abc1f035b` |
| `pure-template.pdf` | `a16192b9c8cc7f1031527a9b5e60b25fe1aa8eaf1592b9be4d6abc97be4b6040` |
| `ReadMe.txt` | `c83ff59d960441832a6a111e1bc1565228ebe156634cff94ca21e9f76585171b` |

The originally supplied PDF hashes are retained for provenance: `3e2d036cdf22e50fc5d0bf6df41f4d75a3f1ec5fb06ebf98e4eb283a4875da8f` (`example-template.pdf`) and `5f0608395a20316011d8678ae761d7a67b42038af292175420da445c97631d77` (`pure-template.pdf`).

Creator: **cyber_engineer** (GeekHack), Twitter **@Mates_ENGINEER**.

The included `ReadMe.txt` welcomes editing, remixing, and redistribution and requests creator credit for official distributions. It also instructs operators to print on A4 at actual size and verify the 15 mm reference box. The example PDF includes some Remix Icon artwork under the Apache License; the generated SXSY-B122 legend artwork does not copy those icons.

No standard SPDX license identifier is asserted for this package. Preserve this README, the supplied instructions, the visible PDF notices, and the root `ATTRIBUTION.md` entry whenever redistributing it or geometry-derived sheets.

`pure-template.svg` is a vector-only conversion of the retained blank PDF, made
with Poppler `pdftocairo` 26.10.0. It preserves the entire page, cut lines,
calibration box and creator notices for the app's profile-derived print export.
SHA-256: `06bb168f1cf6b7cf4d2a84041626d032a62d41b41e1dff2377fcaa32355ec2b3`.
Regenerate with `pdftocairo -svg pure-template.pdf pure-template.svg`; review the
result and update the checked hash deliberately if the converter changes bytes.
This source geometry does not establish a fit on an untested cap or keyboard.

`template-faces.json` records the 18 compact and 15 full variant face rectangles
directly from the retained SVG's axis-aligned rectangle paths, in SVG points.
The application insets its ink by 0.5 points on every edge, preserving source
outlines and clip cuts. These are template coordinates, not keyboard pitch or
a measurement of the user's caps.

The canonical B122 generator also matches all 33 faces back to the literal SVG
and derives its sixty full-insert flaps and side clip cuts from that same pinned
source. Its colored ink stays inside those boundaries; each standalone insert
retains the sixteen original face/flap/clip paths at their actual point scale.
No new physical-fit or third-party artwork-license claim is added.
