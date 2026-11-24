# Switchyard build sequence

Revision 2 supersedes any earlier first-slice ceiling. All required suite modules must be implemented; the stages are dependency order, not stopping points. The authoritative statuses are in [the requirement ledger](switchyard-requirements.md). All accepted requirements remain tracked here. See the
[continuation record](switchyard-status.md) for current receipts and next tasks.

| Area | Implemented behavior | Remaining work or acceptance |
| --- | --- | --- |
| Product and keyboard model | Home/catalog, recommended setup, editable workflow/roles, portable geometry and reviewed configuration model. All 40 pinned Model F source definitions are included. | Guided role/device controls are connected. Actual browser task and visual acceptance remain open. |
| Device connection | Distinct Vial and original-xwhatsit transports; matched F77 readout; bounded review/apply/readback/restore paths with synthetic evidence. | Physical transaction, typing, hotplug and controller-lineage acceptance. Preserve Dvorak firmware and US host layout. |
| Coding integrations | Account-bound Codex/Claude sessions, reviewed text, uncertainty recovery, owned loading and signed editor launcher. Codex 0.166.0/0.167.0 configuration contract is installed. | Guided projects and commands are connected. Interactive TUI/task handoff and controlled account-switch trials remain unaccepted. [Current boundaries](windows-editor-transport.md). |
| Work integrations | Separate Microsoft 365 Copilot and GitHub Copilot surfaces, enrolled-account policy and durable request/recovery records. Useful keyboard-only Work mode. | Approved Microsoft tenant and supported live work-surface acceptance. Personal providers never become a fallback. |
| Observation and voice | Consented category, deliberate, agent, host-action and editor metadata; pause/stop/review/delete/exclusions; bounded local audio/transcript queue and recovery. Actual synthetic-audio checks pass with imperfect recognition. | Frontend controls are connected. Broader external streams and interactive microphone/capture acceptance remain open. [Voice recovery](voice-recovery.md). |
| Extensibility | Versioned authenticated SDK, JavaScript/Python bindings, examples, exact command claims, revocation and uncertain-outcome recovery. | Broader provider containment and independent live-agent trials. [SDK](../integrations/README.md). |
| Portability | Versioned geometry/typing assumptions, mode preferences, stable intents and reviewed migration; imports clear local authority. Installed HTTP migration/export and restart are demonstrated. | Guided migration UI is connected. Second-machine/device acceptance remains open. [Portable profiles](portable-profiles.md). |
| Policy and storage | Provider/account boundaries, independent compartment keys, OS credential storage, authenticated encryption, scoped handoffs, retention and replay protection. | Managed-client-data approval, independent assessment and broader provider containment. A Work label is not a sandbox. |
| Host execution and scanning | Reviewed task inputs, supervised Git/processes, Linux containment, Windows storage broker, signed findings and offline package/advisory checks. | Complete scanner coverage/provenance/context and live Windows guest acceptance. The current six-workflow baseline passes; historical failures remain retained. [Current evidence](switchyard-status.md). |
| Installation and maintenance | Small versioned Linux/Windows packages, launchers, update/rollback/recovery/uninstall and optional-runtime maintenance. The normal Linux installation preserves 54 saved workspaces; the status page binds each update to exact evidence. | Complete native Windows source and packaging pass at 8dd849e. Interactive host acceptance remains separate. Public signing/key management, licensing and release approval remain open. [Installation](suite-installation.md). |
| External/future | F77 remains the pilot; B122 is a separate specialist preset with 27 open physical gates. | Physical B122, employer approval, independent assessment, macOS and optional external hardware. These do not defer executable Linux/Windows work. |

This table describes current implementation, not a completion percentage. The
[requirement ledger](switchyard-requirements.md) preserves feature-specific paths,
checks and remaining limitations. The [status page](switchyard-status.md) binds
accepted results to their exact source revisions.

Tests must cover model migration, unsafe imports, conflicts, stale review,
baseline failure, partial application/readback mismatch, recovery, and actual UI
task completion. Use synthetic observations. Preserve Windows failures as
platform-specific evidence rather than modifying Windows code to pass on Linux.

No new files are moved solely for directory symmetry. Learn through
[Use Switchyard](switchyard-configuration.md), [Alex's F77](../examples/alex-f77/README.md),
and [Alex's B122](../examples/alex-b122/README.md).

## Current execution agreement

Frontend completion is authorized. The application uses a committed immutable
frontend pin for each deliberate UI update. GitHub is the working record:
commit and push tested, coherent checkpoints to the feature branch, maintain
draft PR #20 and keep the requirement ledger current. No merge, public release
or visibility change is authorized.

Use the installed pinned runtime and dependencies. Keep current plus one rollback,
small dated recovery/evidence files and the original worktrees. Remove only
verified generated staging after installation and readback. Never remove user
recovery copies, credentials or irreplaceable data as cleanup. Remote CI artifacts
have short retention and do not establish physical or interactive acceptance.

The owner confirmed on November 24 that B122 hardware, an interactive Windows
machine and an approved Microsoft 365 tenant are unavailable. Keep their checks
separate from source completion. Browser attachment currently fails before page
loading; use supported browser controls when that dependency is restored. See
[the continuation boundaries](switchyard-continuation.md#preserve-the-operating-boundaries)
for the device, account, runtime and workstation constraints.
