# Switchyard continuation — October 29, 2026

Branch: `feat/switchyard-configuration-loop`. Base: `25824cc` (Omarchy foundation),
with Studio commits `1b79c12`, `3700081`, `ccf220e`, `96b0ea4` cherry-picked and
their additive conflicts reconciled. Original worktrees were clean and retained.

Direction: [product brief](switchyard-product.md). Decisions and all deferred
requirements: [ADR](decisions/001-switchyard-configuration.md) and
[build plan](switchyard-build-plan.md).

Initial host inspection: Omarchy, Hyprland 0.56.2, Node 24.14.0 available.
US QWERTY host layout. F77 absent from USB/sysfs and compositor input inventory;
no HID device was opened and no keyboard configuration changed. Native ChatGPT
main window uses the repaired user-local executable. No Switchyard user service
was running. Private historical F77 Vial snapshots exist outside Git; they are
not live reads. Do not commit local serials or recovery paths.

Baseline installation: `mise exec node@24.14.0 -- npm ci --ignore-scripts` passed.
Focused Studio/recorder/shortcut checks and typecheck are being established.
Historical Studio cross-host result was 158/178 groups; this is not the new
integrated result. Windows, F77, Copilot, managed compartments, native voice and
physical B122 remain unaccepted.

Startup: `mise exec node@24.14.0 -- npm run layout:studio`.
Checks: `mise exec node@24.14.0 -- npm test` and `npm run typecheck` under that
same runtime. Updated receipts and demonstration results follow implementation.

Next three executable tasks:

1. Implement and test versioned profile/proposal import against the existing plan.
2. Connect authenticated review/apply/readback/restore for a bounded host shortcut.
3. Exercise real UI tasks and host rollback; update this record with exact receipts.

Revision 2 received during implementation: full suite required. See the [authoritative ledger](switchyard-requirements.md). The current source is partial; the host focus loop is only an intermediate test. Updated handover SHA-256 is `8c3bee6c378548dedab7fed7e959b426d2d9bb7609835d88d354c37cb9e80adb`. Focused model/transaction/API tests: 24/24 passed. Integrated baseline Studio/recorder/shortcut tests: 18/18; baseline typecheck passed. Native UI and live host application have not yet been exercised.
