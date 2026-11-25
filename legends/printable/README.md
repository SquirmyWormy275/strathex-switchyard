# B122 control inserts

Print the [calibration sheet](../../output/pdf/SXSY-B122-legends-calibration.pdf)
on A4 at **actual size / 100%** first. Measure its 15 mm box and trial-fit one
insert before making a batch.

Choose a two-page sheet: [IBM blue](../../output/pdf/SXSY-B122-legends-ibm-blue.pdf),
[command orange](../../output/pdf/SXSY-B122-legends-command-orange.pdf), or
[monochrome](../../output/pdf/SXSY-B122-legends-monochrome.pdf). Each contains the
agent-control bank and workspace-command bank, in both compact and full-flap
variants. The [operator guide](../../output/pdf/SXSY-B122-operator-quick-guide.pdf)
explains the 22 controls and their 65 settled chords.

The 22 editable [individual SVGs](individual/) use the source's actual point
dimensions, flap shapes and clip cuts. Labels wrap without stretched glyphs or
fonts below 4.75 pt. A01/W01 identify documentation order; they are not physical
matrix positions. Text artwork is a reference kit; final branded artwork and
physical cap fit remain separate acceptance work.

The generator checks the retained PDF/SVG hashes, matches every face against the
literal source, and derives safe flap regions around the clip cuts. The
[manifest](legend-manifest.json) records source hashes and print limits. Regenerate
with `python scripts/generate_b122_legends.py`; verify with `--check`, using the
pinned [documentation dependencies](../../scripts/b122-docs-requirements.txt).

Geometry by **cyber_engineer (GeekHack), @Mates_ENGINEER**. Preserve the
[source package and reuse instructions](../../third-party/cyber_engineer/README.md).
These sheets do not grant execution authority or establish hardware acceptance.
