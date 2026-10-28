# Switchyard Layout Studio

An offline, controller-neutral planning tool for people designing agent-first
bindings on Model F Labs keyboards and other QMK-capable boards. It helps turn
repeated agent work into a reviewable physical layout plan. It does not generate
firmware, write Vial settings, or install OS shortcuts.

## Start in three steps

1. From the repository root, run `npm run layout:studio` with Node.js 24.14.0.
   On this Linux workstation, `mise exec node@24.14.0 -- npm run layout:studio`
   selects that runtime. The same npm command works on Windows with Node.js
   24.14.0 installed.
2. Open the loopback URL printed in the terminal. Use **Explore the demo** to
   learn the interface, or import the exact QMK `info.json` for
   your keyboard and select its physical `LAYOUT_*`.
3. Import that keyboard's matching QMK `keymap.json` to record the ordinary
   base layer. Add actions, estimate how often you use them, assign each to a
   key and modifier, review warnings, then download the JSON plan and Markdown
   review sheet. Action cards can be edited after creation; a removed action
   has a brief Undo option.

**Optional workflow evidence:** On a checkout with the Switchyard workflow
recorder, run `node scripts/workflow-capture.mjs report` and save its JSON
output to a local file. Import that file through **Aggregate study report**, or
use **Try sample observations** to try the flow. The studio retains
only completed/started session counts and broad deliberate-event summaries;
it discards focus durations, timestamps, task aliases, and unknown fields.
It accepts no raw JSONL log. Suggested intent names are starting points:
select **Use as draft**, enter your own times-per-day and seconds-saved
estimates, then add and place the action yourself. A `resume` count does not
prove an exact agent task was resumed, and a focus interval says nothing about
agent status. Suggestions are sorted by a simple heuristic (count × average
friction + 2 × retry/blocked count), not measured time savings. The exported
review sheet states the evidence boundary.

The server binds only to `127.0.0.1` and serves fixed files. Imported data
stays in the browser tab until you download it; no account, database, or
external service is used. The studio marks unsaved changes and warns before
replacing an unsaved plan. Download **editable plan** before closing the tab;
the Markdown review sheet is a separate reading copy. **Copy plan JSON** is a
fallback when a browser blocks a download; paste that text into a local file.
Closing the terminal stops the server.

## Interface decisions

- The four visible stages keep the path from keyboard evidence to review in
  one place. Workflow observations are optional, and the action editor is
  available as soon as a board is loaded.
- The keyboard preview and action cards offer both visual key picking and
  labelled dropdowns. The dropdown path works without pointer precision.
- Editing preserves a binding, Escape cancels a key pick, and removing an
  action offers Undo. The review and unsaved-state messages remain visible
  before export. Reduced-motion settings disable smooth scrolling.
- Action priority is labelled as an estimate, while layout health names
  structural issues. Neither indicator claims physical acceptance.

## Use another Model F Labs keyboard

Model F Labs currently describes [Leyden Jar controllers for F122, B104, and
B122, with xwhatsit on other new Model F and Beam Spring models](https://modelfkeyboards.com/manual/).
The studio does not infer a model's switch matrix or controller from its name.
Bring the exact configuration for the keyboard and controller you own.

QMK's [`info.json` physical layout](https://docs.qmk.fm/reference_info_json)
provides key geometry and matrix coordinates. A matching QMK Configurator
`keymap.json` supplies the normal typing layer in the same key order. Check
the board and layout names before import. The studio refuses a mismatched
layout or key count, and compares keyboard IDs when `info.json` provides one.
If it does not, the owner must verify that the files came from the same board.

If there is no suitable QMK `info.json`, make a reviewed Switchyard board
profile yourself and import it through **Plan or board profile**. Its
minimal shape is:

```json
{
  "schema": "sxsy-board-profile/v1",
  "name": "My exact keyboard and revision",
  "layout": "My physical layout",
  "controller": "unknown",
  "source": "manual",
  "keys": [
    { "id": "m0_0", "label": "F1", "matrix": [0, 0], "x": 0, "y": 0, "w": 1, "h": 1, "baseKeycode": "KC_F1" }
  ]
}
```

Use `controller: "xwhatsit"` or `"leyden_jar"` only after verifying your
unit. This field documents the source; it does not enable flashing. Include
every physical key and its actual ordinary base keycode before treating the
typing-impact review as complete. Key IDs and matrix positions must be unique.

[Vial's keyboard definition](https://get.vial.today/docs/porting-to-via.html)
is a different format from QMK `info.json`. Do not rename one to the other.
The studio does not import Vial JSON or claim that its exported plan is a Vial
keymap.

## What the review catches

- Two actions assigned to the same key and modifier.
- An unmodified agent action that would replace a recorded ordinary keycode.
- A high-consequence action without an explicit confirmation step.
- Missing typing-layer evidence or actions that have not been placed.
- Optional aggregate workflow evidence, with incomplete-session counts and
  broad event kinds kept separate from self-reported daily estimates.
- Ctrl+Alt chords that may act as AltGr, and Super/Windows chords that may
  collide with desktop shortcuts. Test both on the actual target systems.

The priority number is self-reported frequency multiplied by estimated seconds
saved. It helps sort candidates; it is not a measured productivity result.
Ergonomics, ghosting, firmware size, controller compatibility, Raw HID,
hot-plug behavior, OS support, and physical key feel still require review on
the actual keyboard. A chord never grants authority to an agent. For the
SXSY-B122, the [canonical 65 assignments](../../packages/protocol/src/b122.ts)
remain the accepted project map and are not changed by this tool.

## Why there is no firmware export yet

Model F Labs keyboard families use different controller and matrix definitions.
Generating a flashable keymap from a visual plan without the exact backed-up
factory layout could break normal typing. A later target adapter can turn a
reviewed plan into a candidate QMK/Vial configuration for a specific verified
board, while keeping ordinary USB HID typing independent of Switchyard.

## Path to a shareable keyboard builder

1. Validate the exact B122 controller, matrix, ordinary typing layer, and
   unplug/replug behavior on the physical unit when it arrives.
2. Add versioned board profiles only for Model F Labs variants whose matrix
   and controller have been checked against a real unit. Keep plans portable
   so people can exchange action inventories without sharing private workflow
   recordings.
3. Add target-specific exports with round-trip tests: a reviewed candidate
   firmware keymap and separate Linux/Windows host binding manifests. Require
   an ordinary-key fallback and explicit confirmation for consequential
   actions. Keep the accepted B122 65-chord contract as its own versioned
   preset rather than rewriting it for another keyboard.

The present studio is step zero: an importable, inspectable planning format
and a browser interface that can be tested without owning a B122.

The repository has no public redistribution license yet. The tool is available
to collaborators in the private repository; public sharing follows the
[licensing plan](../../LICENSING.md) and [publication gate](../../docs/06-publication-gate.md).
