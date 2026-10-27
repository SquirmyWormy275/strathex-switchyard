# Pre-B122 workflow capture

The January 2027 B122 arrival leaves time for a ten-session baseline on Omarchy. Press **Super+Alt+R** on the owner's Omarchy workstation to start or stop a study session. While active, a temporary systemd user service samples only the foreground application's broad category every two seconds and records category durations. It discards raw window metadata immediately. It never records window titles, keystrokes, clipboard content, prompts, code, terminal content, or provider accounts. The service is stopped by the same keybinding and is not enabled at boot. `status` reports whether **a study session** is active; it is not an agent-status monitor.

Run it with the reviewed Node 24 runtime from the repository root:

```bash
mise exec node@24.14.0 -- node scripts/workflow-capture.mjs start linux task_1
mise exec node@24.14.0 -- node scripts/workflow-capture.mjs event resume codex keyboard success 1200 2 user
mise exec node@24.14.0 -- node scripts/workflow-capture.mjs event status codex palette blocked 800 4 none
mise exec node@24.14.0 -- node scripts/workflow-capture.mjs end
mise exec node@24.14.0 -- node scripts/workflow-capture.mjs report
mise exec node@24.14.0 -- node scripts/workflow-capture.mjs path
```

`event` fields are `kind surface method outcome duration_ms friction evidence`. Run `help` for the closed values. Duration is the measured time from intent to confirmed result in milliseconds; friction is 1–5. Use `provider` only for an exact provider observation, `companion` only for an authenticated companion observation, `user` for your own observation, and `none` when status cannot be proved. The keybinding captures broad app focus and time automatically; it cannot infer intent, friction, task identity, or agent status. Add deliberate events when those details matter. The recorder never upgrades a focus interval into a verified agent status.

Records live outside the repository at `${XDG_STATE_HOME:-$HOME/.local/state}/strathex-switchyard/workflow-study` on Linux or `%LOCALAPPDATA%\strathex-switchyard\workflow-study` on Windows. Run `npm run workflow -- path` to print the exact location and size on the current machine. The Linux directory and files must remain private (`0700`/`0600`). `SXSY_WORKFLOW_STUDY_DIR` can select an absolute local path for a controlled study. The JSONL log contains time, a generated session ID, machine, optional short task alias, broad focus category and duration, and any deliberate event fields. Reports aggregate focus duration by category plus counts, retries or blocks, total duration, and average friction by deliberate event kind. Each record is at most 2 KiB, and recording stops at 10 MiB while reserving room to end the active session. The tool never deletes or rotates study data automatically; preserve or move the log when it reaches the cap.

Use a pseudonymous task alias; never enter a customer, repository, person, prompt, file path, credential, or proprietary name. Capture at least ten representative sessions and note relevant omissions in a separate reviewed study record. The aggregate can guide implementation priority while the current 65 chord assignments stay fixed. See [the study protocol](03-workflow-study.md).

Live monitoring of Codex/ChatGPT or Claude requires an authorized adapter that binds an exact native session and attests its observation capability. The existing [read-only managed-session view](../README.md) can display companion-registered sessions but does not infer native agent state from an open window. Automatic counts should be added only after those adapters have passed host acceptance.
