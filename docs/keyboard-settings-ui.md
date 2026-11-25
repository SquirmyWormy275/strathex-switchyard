# Configure the capabilities your keyboard actually reports

The keyboard workbench now connects the existing firmware transaction backend to
readable forms. Start in **Customize → Keyboard readouts and configuration**.
Choose a saved readout and **Plan firmware settings** to explore without opening
a device. A separate **Read keyboard and review** action refreshes the connected
keyboard and shows the concrete proposal. **Apply** saves an encrypted baseline,
writes the reviewed configuration and verifies readback; **Restore device change**
uses that exact transaction.

The selected readout determines what appears:

- Ordinary keys, modifier keys, tap/hold behavior, layers and advertised macros,
  tap dances and Vial 6 features.
- Physical layout choices, onboard macro steps, advertised QMK settings and each
  recorded encoder direction.
- Tap-dance outputs and timing, two-to-four-key combos, modifier overrides and
  Vial 6 alternate-repeat entries. Modifiers and rule options have named controls.

Macro and dynamic-table replacement requires an explicit choice. Unknown rule
bits remain read-only unless that slot is explicitly cleared. Backend guards
preserve ordinary typing, refuse absent capabilities and retain recovery after an
interrupted write. Onboard macros send keystrokes to the foreground application;
they do not identify an agent task. Selecting another readout or workspace clears
an old proposal. Matrix labels come from the selected readout, never an unrelated
preview profile.

**Test physical key positions** offers a separate notice and consent checkbox.
After physical unlock, **Start consented test** checks the exact identity without
sampling switches. **Sample held keys** requests one sample; there is no automatic
polling. Each sample replaces the previous display. Stop, workspace/mode changes
and the 60-second limit clear the view. No samples are saved or sent to a provider.
**Relock firmware** is a separate explicit action with verified lock readback.
A fresh review also retires expired consent left behind by a reloaded page.

The check reports switch positions, not host characters, physical LEDs, rollover
or electrical behavior. No flashing, reset, calibration, solenoid drive or guessed
firmware capabilities are exposed.

## Executed evidence

The final original-manifest run passes **15 groups / 128 tests / zero skips**.
Eleven firmware interaction cases and four diagnostic interaction cases use the
actual authenticated HTTP service, encrypted store and real Vial codecs with a
synthetic transport. They exercise review/apply/restore, rejected proposals,
interrupted-write recovery, consent and late-result cancellation. Eight checks
against the running isolated server verify served assets, controls and refusal
of all live hardware routes. [Exact evidence](evidence/device-frontend-source-summary.json).

These checks do not establish browser rendering or physical keyboard acceptance.
Browser automation currently fails before navigation. The review bundle is
prepared independently of the installed app; the installed state is unchanged.
