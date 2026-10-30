# Switchyard authoritative requirement ledger

Revision 2 (October 29, 2026) replaces the original minimum-outcome handover.
The F77 is the pilot device for the full suite. Stages are execution order, not
stopping points. Implementation and validation are independent statuses.

Implementation: not started / in progress / implemented / unsupported by verified external contract.
Validation: not run / software-tested / host-tested / hardware-tested.
Tests use synthetic data unless explicitly labelled host/hardware evidence.

| Requirement | Implementation | Validation | Actual paths | UI entry | Tests | Remaining implementation / exact blocked validation |
| --- | --- | --- | --- | --- | --- | --- |
| Product shell and UX | in progress | software-tested | tools/layout-studio/{app.mjs,index.html,style.css} | Keyboard / action editor / review | configuration.test.mjs; model.test.mjs | Real UI and unified conversation/workflow views still required |
| Discovery and compatibility | in progress | software-tested | tools/layout-studio/host.mjs | This computer | configuration.test.mjs | USB candidate discovery only; firmware/configuration reads and tool discovery incomplete |
| Workflow observation | in progress | software-tested | scripts/workflow-{capture,monitor}.mjs | Aggregate report import | scripts/workflow-capture.test.mjs | Integrate session controls, pause, deletion, retention and agent events |
| Workflow design | in progress | software-tested | tools/layout-studio/{model,workspace}.mjs | Actions / proposal review | configuration.test.mjs | Editable process graph and roles not yet implemented |
| Conversation | in progress | software-tested | tools/layout-studio/workspace.mjs | Assistant context / proposal import | configuration.test.mjs | Real in-app Codex/Claude connection not implemented; JSON import alone is partial |
| Voice | not started | not run | Existing companion audio references only | None yet | None yet | Implement capture, pause/resume, transcript review, encrypted continuity; transcription credentials absent |
| Keyboard configuration | in progress | software-tested | tools/layout-studio/{vial-snapshot,host}.mjs | Saved Vial preview / host review | configuration.test.mjs | Host transactions implemented; live dynamic keymap/layers/macros/settings transactions unfinished |
| Controller targets | not started | not run | Existing B122 signal transport is separate | None yet | B122 protocol tests are not Vial tests | Implement Vial and original-xwhatsit transports/protocols; physical F77/B122 validation blocked by absence |
| Physical agent controls | in progress | software-tested | tools/layout-studio/host.mjs; existing companions | Show ChatGPT connection | configuration.test.mjs | Focus-only host action; exact agent role summon/resume/review/handoff/status unfinished |
| Codex and Claude Code | in progress | software-tested | scripts/codex-*; apps/vscode-extension/src/codex-daemon-status.cjs | Existing inventory outside product UI | Existing Codex tests | Concrete suite-connected agent controls and conversation unfinished |
| Microsoft 365 Copilot | not started | not run | None yet | None yet | None yet | Implement approved web/Graph routes, policy and Copilot-only scenario; tenant acceptance needs approved account |
| Extensibility | not started | not run | Existing provider host differs from requested SDK | None yet | None yet | Implement authenticated event/action SDK and executable custom/LangChain examples |
| Portability | in progress | software-tested | tools/layout-studio/workspace.mjs | Profile export/import | configuration.test.mjs | Versioned plan migration implemented; workflow/role/compatibility/mode portability unfinished |
| Linux and Windows | in progress | software-tested | Existing companions/deployment; tools/layout-studio/host.mjs | Linux host connection | Native Linux suite pending integrated run | New suite Windows device/shortcut/lifecycle path unfinished; Windows runtime host unavailable |
| Compartment enforcement | not started | not run | Existing companion credentials/policy provide references | None yet | None yet | Implement independent protected keys/storage and enforce provider/account/content/export/recording rules in suite |
| Legends and documentation | in progress | software-tested | Existing legends; Studio Markdown export; docs/switchyard-* | Download review sheet | Existing legend generation checks | Assignment legends and verified sizing rules need integrated export |
| Lifecycle | in progress | software-tested | tools/layout-studio/host.mjs; existing deployment | Keep / Restore host connection | configuration.test.mjs | Restartable host receipts implemented; saved workspace and new suite install/update/rollback/uninstall unfinished |
| Engineering evidence | in progress | software-tested | tools/layout-studio/configuration.test.mjs; docs/switchyard-status.md | Errors and review receipts | 24 focused tests pass | Full integrated Linux suite and actual UI/installed pilot pending |

## Boundaries and resumable external checks

- F77 is absent: live identity, firmware/protocol readback, unlock, ordinary typing, hot-plug and hardware transactions cannot be accepted. Complete software work using fault transports, then reconnect the device and run those exact checks. Historical Vial snapshots are not current evidence.
- B122 has not arrived: its physical matrix/typing/LED/rollover/ergonomics and 27 gates remain open. Its software adapters and tests remain required now.
- No Windows host or PowerShell is available locally: implement/build/test portable Windows paths here; later run actual device, shortcut, credential and lifecycle scenarios on an authorized Windows host.
- No work tenant is authorized: implement documented M365 supported routes and synthetic Copilot-only policy tests; actual tenant/account/permission behavior awaits approved access. Never probe the work laptop.
- No transcription API key is configured: implement microphone/session/protected storage and permitted transcription client; provider acceptance needs an explicitly configured supported local engine or credentials. Do not call transcript import full voice.
- Independent security assessment, employer approval, public release, licensing decisions and future macOS acceptance are separate gates. Required policy/storage controls are implementation work now.

## Cross-cutting accepted requirements

Preserve Dvorak firmware plus US host layout; exact device/controller identity; no guessed solenoid timing, flash, EEPROM reset or bootloader operation. Maintain separate ordinary typing and intent/authority boundaries. Use exact targets, stale-status handling, cancellation and duplicate-launch prevention. Protect origin/auth/replay/path boundaries and redact logs. No automatic provider/account fallback, sensitive portable state, shared compartment keys, or inferred employer trust. Unknown hosts use keyboard-only mode. Observation must expose consent, sources, pause/stop, exclusions, retention, review and deletion. Voice must preserve incremental reviewed decisions. Stable intents and migrations require deliberate revision. Native ChatGPT must use the repaired main window and preserve overlay guard/artwork.

All named integrations remain distinct: Codex, Claude Code, Claude desktop, Microsoft 365 Copilot, GitHub Copilot, custom/LangChain agents, and explicit extension recipes for other tools. Do not infer universal capability from a generic bridge.
