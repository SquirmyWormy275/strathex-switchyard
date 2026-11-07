# August 2026 workflow reassessment

**Scope:** retrospective review of the owner's late-August local task records, August commits in Switchyard and adjacent projects, and first-party harness documentation available in October 2026. This is design input, not a representative ten-session observation sample or permission to change the accepted 65 chords.

## Observed direction in the owner's work

- Work increasingly continued an exact prior task after an interruption or machine event. Losing the identity of the active task and its verified state created more friction than opening another fresh window.
- Omarchy commissioning, keyboard setup, display recovery, and preservation work required an agent to inspect and operate the actual host, retain backups, and verify user-visible outcomes. A planner-to-terminal Markdown paste was only one handoff form.
- Adjacent repositories moved toward longer bounded jobs, immutable release evidence, recovery receipts, and preservation of existing data. The useful supervisory questions became “what task is this?”, “what did it actually finish?”, “what is waiting on me?”, and “can it resume safely?”
- The owner's Omarchy clipboard already provides convenient cross-application copying. Switchyard Handoff should add exact task, target, plan, decision, and authority context when a supported adapter exists; it should not duplicate plain copy and paste.
- The owner now uses native ChatGPT on Linux with a verified main-window voice repair. A future focus or voice adapter must respect that installed launcher and keep the unsafe desktop overlay hidden. A browser URL is not the local app identity.

These observations come from a narrow late-August record and current workstation operating notes. Frequency, elapsed time, and physical key ergonomics were not measured; the workflow-study exit rule remains open.

## Harness changes to account for

- Codex has persistent thread start/resume, project instruction discovery, and managed worktrees. An adapter should bind an **exact existing thread** where supported and avoid treating a fresh VS Code terminal as the only coding surface. [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Projects and chats](https://learn.chatgpt.com/docs/projects), [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees).
- Reusable skills, plugins, and browser/site tools can carry workflow-specific logic through supported surfaces. Switchyard should discover a capability and version rather than copy a provider's full workflow into a key handler. [Build skills](https://learn.chatgpt.com/docs/build-skills), [Plugins](https://learn.chatgpt.com/docs/plugins), [August updates](https://learn.chatgpt.com/docs/whats-new).
- Claude Code supports subagents, teams, and hooks. These do not make an arbitrary Claude desktop window observable or mediated by Switchyard. A Claude adapter must attest the exact session, status, and permitted control surface before making such claims. [Subagents](https://code.claude.com/docs/en/sub-agents), [Agent teams](https://code.claude.com/docs/en/agent-teams), [Hooks](https://code.claude.com/docs/en/hooks-guide).

## Priority without chord remapping

1. Make the existing read-only **Show Managed Sessions** command show refreshed task and target bindings, status provenance, and capability level. Unknown stays unknown.
2. Evaluate Re-anchor, Find Blocked/Finished, Handoff, Proof, and Pipeline against actual Linux task resumes and release work before adding provider effects.
3. Preserve the current Handoff and Voice chord meanings, but test their presentation against native ChatGPT/Codex, Claude, Omarchy clipboard, and main-window voice. Do not run duplicate voice surfaces or force a clipboard step.
4. Treat the current Compound key and large autonomous paths as configured capabilities, with unavailable behavior when the workflow is absent. Do not infer that one installed repository workflow is universal.
5. Run the workflow study and physical trial before proposing any future semantic or physical map revision. The present 65 assignments remain the contract.
