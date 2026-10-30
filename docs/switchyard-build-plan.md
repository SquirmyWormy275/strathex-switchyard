# Switchyard build sequence

Revision 2 supersedes any earlier first-slice ceiling. All required suite modules must be implemented; the stages are dependency order, not stopping points. The authoritative statuses are in [the requirement ledger](switchyard-requirements.md). All accepted requirements remain tracked here. See the
[continuation record](switchyard-status.md) for current receipts and next tasks.

| Milestone | Work | Dependency / status |
| --- | --- | --- |
| A | Isolated integration; product split; runnable Studio; recorder and Codex work retained; live device discovery | In progress |
| B | Shared proposal/direct model; compatibility review; private baseline; bounded host apply/readback/trial/restore; F77 identity and configuration | Host loop first; F77 currently absent |
| C | Agent-authored proposals; workflow aggregates; exact Codex task controls; Claude Code hooks and exact sessions; Microsoft 365 Copilot investigation | Existing inventory retained; new adapter controls pending |
| D | Portable profile migration; guest/keyboard-only and Copilot-only scenarios; Windows shortcuts/device access; native Windows verification | Portable model first; Windows host unavailable |
| E | Required controller adapters, broader observation/voice, SDK, policy/storage, Linux/Windows installation | Implement now; hardware/provider acceptance is separate |
| Future/external | Physical B122, Windows/tenant host acceptance, independent assessment, macOS, optional external hardware | Only these checks/future targets are deferred by design |
| Managed security | Enforced provider/account/endpoint policy; independent compartment keys; credential store; AEAD and key recovery; scoped handoffs; retention/deletion; redacted logs | Designed; no managed-client-data acceptance |
| Distribution | Installer/update/uninstall/rollback; signed releases and key lifecycle; licensing and publication | Existing private B122 preview retained; new product packaging pending |
| UX | One keyboard workspace; direct and conversation consistency; no mandatory model; accessible selection and responsive geometry; failures preserve work | First implementation in progress |
| Observation | Tell me / Watch me / preset; optional recording sources; consent, pause/stop/review/delete/exclusions; reviewable transcripts and long-session recovery | Aggregate recorder retained; native audio/screen capture pending |
| Integration breadth | Separate Codex, Claude Code/desktop, M365/GitHub Copilot, Cursor, Figma, LangChain/custom adapters; truthful capability/staleness reporting; no silent provider fallback | Closed focus action first; SDK and vendor controls pending |

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
