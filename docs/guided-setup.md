# From a keyboard layout to a connected control

Switchyard starts with four useful controls: return, progress, review and handoff.
The frontend now connects saved layouts, typing evidence and named tool choices.
Saving a connection, trying it and installing a shortcut are separate reviewed actions.

## Try the isolated demonstration

With the repository's existing Node 24.14.0 environment:

    node scripts/demo-switchyard-ui.mjs --synthetic

Open the private local link printed by the command. This uses fresh encrypted
state, a synthetic F77 Dvorak readout and a signed example agent. It does not open
real hardware, sign in, start native tasks, use a microphone or install shortcuts.

1. On **Home**, choose F77 Classic, expand typing options and choose Dvorak if
   desired, then **Use this setup**. These are reference choices only.
2. Follow **Review my typing layer**. Select the saved readout and **Inspect
   source match**. Its date, historical status, controller uncertainty and
   unavailable solenoid controls remain visible.
3. Choose **Use this typing layer**, review the physical choices and open the
   saved layout. Switchyard preserves the captured keycodes and saves a separate
   editable profile. The ordinary typing layer is not programmed onto a device.
4. In **Settings**, deliberately choose **Personal companion**.
5. In **Agents**, choose **Builder → Check progress**, then the named synthetic
   builder. If its next heartbeat has not arrived, use **Refresh**.
6. **Review connection → Save connection** changes local configuration only.
   **Try connected control** opens a second review before dispatching. The example
   agent acknowledges the status request; its report does not verify task completion.
7. Switch to **Work** to see its separate keyboard-only state and policy. The
   demonstration refuses real hardware, accounts and native-task operations.

Stop the command with Ctrl+C to remove only its owned synthetic state directory.
The normal installed workspaces and their keys are independent.

## Use your own workspace

The same controls run against the normal local Suite. Home points to the next
step based on the open profile, its typing evidence, companion mode and saved
connections. A source-reference preset cannot install a host shortcut. Use a saved
readout or deliberately read a connected keyboard first.

The tool picker lists compatible saved connections by name, including supported
coding tasks, design conversations, custom agents and app homepages. Available
controls differ by target. An app homepage is never presented as an exact task.
An empty selection remains empty, and a late response from another workspace
cannot re-enable the picker. The backend refuses a connection changed after review.

In **Customize → Connect to this computer**, select an assigned action and either
a saved role control or native ChatGPT focus. Review the exact shortcut and host
changes before applying. Trial, keep and restore retain their existing backend
guards. Opening the keyboard-readout panel itself performs no discovery or HID I/O.

## What has and has not been verified

Automated interaction checks execute the browser modules against an event/selection
fixture and the real authenticated HTTP/encrypted-store backend. They cover named
selection, empty selection, review-before-save, stale target refusal, workspace
transitions, keyboard-only guidance and cached readouts without HID or state writes.
They are not visual-browser acceptance. The original fourteen-group run passes
156 tests; the final five-group follow-up passes 40 tests, with overlapping
coverage. Original bounds and cleanup verify. [Source evidence](evidence/guided-ui-source-summary.json).

The local browser automation currently fails before navigation/inspection with a
tool-side timeout-options error. Resetting its connection did not resolve it; the
in-app browser is unavailable. Visual layout, responsive interaction and an actual
browser walkthrough remain pending. Do not describe this frontend as visually
accepted. Physical F77/B122, approved work accounts, native tasks and microphone
acceptance remain separate.

Production editor command activation, additional device controls and the remaining
flows in the [requirement ledger](switchyard-requirements.md) are still implementation
work. This guided checkpoint is not completion of the full Rev2 suite.
