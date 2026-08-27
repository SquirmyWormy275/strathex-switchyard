# SXSY-B122 deterministic safe demo

This directory contains a fixed, offline simulation of fail-closed B122 outcomes.
It is documentation media, not an executable control-plane acceptance test.

- `SXSY-B122-safe-demo.html` is the interactive four-frame playback.
- `SXSY-B122-safe-demo.svg` is the printable storyboard.
- `SXSY-B122-safe-demo.png` is the fixed raster storyboard used by the PDF.
- `SXSY-B122-safe-demo.json` is the canonical deterministic frame record.

Open the HTML file locally in a browser and select **Next simulated frame**. The
page has no external references and a restrictive Content Security Policy. It
does not contact a keyboard, provider, Git remote, credential store, scanner,
or network service. It supplies no acceptance evidence, and every one of the 27
acceptance gates remains NOT ACCEPTED.

Regenerate and verify it from the repository root:

```powershell
python .\scripts\generate_b122_documentation.py
python .\scripts\generate_b122_documentation.py --check
python -m pytest .\docs\tests\test_b122_documentation.py -q
```
