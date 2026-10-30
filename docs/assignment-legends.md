# Print a reference for your keyboard

An assignment reference connects the keyboard drawing to the actions you saved:
the physical key ID, exact modifier, full action name, consequence and confirmation
requirement. Portable v2 profiles also retain each action's role and stable intent.
Local accounts, session IDs, paths, credentials and connection authority are excluded.
The reference describes saved definitions; it does not claim hardware readback or
an applied shortcut.

The backend export is implemented. The export control in the frozen frontend
is pending the next frontend iteration.

## Available output

| Format | Use |
| --- | --- |
| `review-html` | Self-contained keyboard drawing, assignment table, review issues and exact revision. Print or save to PDF through the browser. |
| `template-html` | Every insert page, with shared vector source geometry and A4 print styling. Print or save to PDF at actual size. |
| `template-svg` | One standalone A4 vector sheet, suitable for a print shop or compatible editor. `page` starts at zero. |

The template is cyber_engineer's retained IBM-compatible relegendable-cap sheet.
It retains the complete cut lines, clip clearances, 15 mm calibration box,
instructions and creator credit. Both the compact and full-side variants receive
the same numbered labels. Ink stays inside face rectangles extracted directly
from the pinned vector source; no key-unit-to-millimetre conversion is inferred.
This source is not evidence that an insert fits an untested cap or the pilot F77.

Print A4 at **100% / actual size**, with fit/shrink disabled. Measure the 15 mm
reference with a ruler. Cut and trial-fit one insert before printing a batch.
Keep the assignment reference beside the sheet: each number names one exact
action/modifier row. Unassigned actions remain in the reference and receive no
insert. Fifteen assigned actions fit on each page, in saved action order.

Labels wrap at word boundaries. A label that cannot fit at the minimum font size
blocks template generation. Supply a short print label; the full meaning remains
in the reference and manifest. No silent abbreviation or omitted action is used.

## Authenticated backend contract

`POST /api/suite/profile/legends/export` reads the selected saved profile. It
accepts the standard `compartment` field plus:

```json
{
  "options": {
    "format": "template-svg",
    "page": 0,
    "labels": { "task-resume": "Return" }
  }
}
```

Use the normal exact-origin bearer session. The caller cannot substitute a profile
through this route. Work export policy is checked before opening the document.
Keyboard-only mode permits this offline export and remains unchanged. The JSON
response contains `filename`, `mimeType`, `sha256`, `content` and a versioned
manifest with revision, numbered assignments, unassigned rows, review issues and
source provenance. No new dependency or transcription runtime is required.

## Evidence and limits

Focused tests cover authenticated HTTP export, policy rejection, source hashes,
literal face coordinates, pagination, portable role meanings, text escaping,
legibility bounds and preservation of the input definitions. An actual F77 Dvorak
catalog reference was rendered through librsvg/Cairo to one A4 PDF and inspected
as a PNG; labels and source cut lines remained clear. That is software/rendering
evidence. Printer scaling, physical cap fit and frontend click acceptance remain
unverified. The separate [canonical B122 kit](../legends/printable/README.md)
now uses the same literal faces plus source-derived flaps and clip clearances.
Its six PDF pages and 22 standalone SVGs were rendered and inspected; source
scale, readable font bounds and reproducible outputs are tested. It describes
the settled B122 control reference, independently of a saved general profile.

Source and reuse instructions: [cyber_engineer package](../third-party/cyber_engineer/README.md).
