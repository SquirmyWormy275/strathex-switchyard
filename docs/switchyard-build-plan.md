# Switchyard build sequence

Revision 2 supersedes any earlier first-slice ceiling. All required suite modules must be implemented; the stages are dependency order, not stopping points. The authoritative statuses are in [the requirement ledger](switchyard-requirements.md). All accepted requirements remain tracked here. See the
[continuation record](switchyard-status.md) for current receipts and next tasks.

| Area | Implemented behavior | Remaining work or acceptance |
| --- | --- | --- |
| Product and keyboard model | Home/catalog, recommended setup, editable workflow/roles, portable geometry and reviewed configuration model. All 40 pinned Model F source definitions are included. | Guided role/device wiring and visual acceptance of the frozen frontend. |
| Device connection | Distinct Vial and original-xwhatsit transports; matched F77 readout; bounded review/apply/readback/restore paths with synthetic evidence. | Physical transaction, typing, hotplug and controller-lineage acceptance. Preserve Dvorak firmware and US host layout. |
| Coding integrations | Account-bound Codex/Claude sessions, reviewed text, uncertainty recovery, owned loading and signed editor launcher. Codex 0.166.0/0.167.0 configuration contract is installed. | Live TUI/task handoff, controlled account-switch trials, guided project selection and command activation. [Current boundaries](windows-editor-transport.md). |
| Work integrations | Separate Microsoft 365 Copilot and GitHub Copilot surfaces, enrolled-account policy and durable request/recovery records. Useful keyboard-only Work mode. | Approved Microsoft tenant and supported live work-surface acceptance. Personal providers never become a fallback. |
| Observation and voice | Consented category, deliberate, agent, host-action and editor metadata; pause/stop/review/delete/exclusions; bounded local audio/transcript queue and recovery. Actual synthetic-audio checks pass with imperfect recognition. | Broader external streams, frontend controls and interactive microphone/capture acceptance. [Voice recovery](voice-recovery.md). |
| Extensibility | Versioned authenticated SDK, JavaScript/Python bindings, examples, exact command claims, revocation and uncertain-outcome recovery. | Broader provider containment and independent live-agent trials. [SDK](../integrations/README.md). |
| Portability | Versioned geometry/typing assumptions, mode preferences, stable intents and reviewed migration; imports clear local authority. Installed HTTP migration/export and restart are demonstrated. | Guided migration UI and second-machine/device acceptance. [Portable profiles](portable-profiles.md). |
| Policy and storage | Provider/account boundaries, independent compartment keys, OS credential storage, authenticated encryption, scoped handoffs, retention and replay protection. | Managed-client-data approval, independent assessment and broader provider containment. A Work label is not a sandbox. |
| Host execution and scanning | Reviewed task inputs, supervised Git/processes, Linux containment, Windows storage broker, signed findings and offline package/advisory checks. | Complete scanner coverage/provenance/context, live Windows guest acceptance and the intermittent restricted-storage retirement failure. [Current evidence](switchyard-status.md). |
| Installation and maintenance | Small versioned Linux/Windows packages, launchers, update/rollback/recovery/uninstall and optional-runtime maintenance. Installed Linux `51a73c7` preserves all 54 workspaces. | Newer complete native Windows verification and interactive host acceptance. Public signing/key management, licensing and release approval remain open. [Installation](suite-installation.md). |
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

The user will review the frozen frontend in the morning while backend work
continues. Keep review build `24100ef601b8` unchanged until that review; the live
backend may advance behind it. GitHub is the working record: commit and push
tested, coherent checkpoints to the feature branch, maintain draft PR #20 and
keep the requirement ledger current. Do not leave another large unpushed local
iteration. Keep only required runtimes/models, the current review build and small
recovery/evidence files locally. Remove verified duplicate downloads, generated
staging and build intermediates; never remove original worktrees, user recovery
copies, credentials or irreplaceable data as cleanup. Remote CI artifacts have
short retention and do not constitute a public release or hardware acceptance.
