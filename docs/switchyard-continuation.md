# Continue the full Switchyard suite

The October 29 Rev2 assignment remains incomplete. Continue independently executable implementation and verification; a passing subset is not completion. The F77 is the pilot, not the scope limit.

Use the existing `feat/switchyard-configuration-loop` checkout and publish regular checkpoints to [draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20). Inspect Git status/history first. Checkpoint hashes are evidence, not reset instructions. Do not merge or release.

Start with [current status](switchyard-status.md), the [requirement ledger](switchyard-requirements.md), and [verification](verification.md). Earlier continuation details remain in [the checkpoint at 9ab076a](https://github.com/SquirmyWormy275/strathex-switchyard/blob/9ab076ab95eb73cb4a5ff64cb9a955fe24ff0106/docs/switchyard-continuation.md).

## Preserve the user's boundaries

- Home/catalog frontend and editor command activation are frozen for owner review. No asset/UI changes, browser automation or reloads during backend work.
- Continue normally without delegation. Claude Code is a contingency for actual token exhaustion; compaction is not exhaustion.
- Use cached F77 readouts and pinned source only. No new HID, unlock, write, reset, flash, bootloader, solenoid or electrical operation. Preserve firmware Dvorak and US host input. The [26-file source audit](solenoid-capability-audit.md) establishes handler capabilities, not physical/electrical acceptance.
- No live login/logout/account switching, model requests, real native task creation/resume or installed agent enrollment/revocation/commands in backend checks. Use isolated synthetic providers and explicit read-only metadata.
- Keep Windows descendant token access at QUERY mask **8** and process access at **0x101000**. Do not widen ACLs, SID/account rules or privileges, or add identity/runtime fallbacks. Only newly owned anonymous pipes receive their scoped ACLs.
- Preserve the repaired native ChatGPT main-window voice, hidden overlay, saved artwork and desktop guard. No Seagate, game, mount or display work.
- No new local SDK, runtime, model or dependency downloads. Use existing Node 24.14.0 and `.tools/dotnet-8.0.424`. Put the actual pinned Node bin directory first on PATH for supervised builds; mise shims fail in isolated homes without project trust. Do not change trust settings.
- Normal application updates must retain a dated backup/reason and verify persistent-file readback. Keep current plus one rollback, all workspace identities/semantic snapshots, selection and frozen frontend.
- Never manually dispatch, cancel or retry CI, expand deadlines, add skips or weaken assertions to obtain a pass. Normal branch pushes schedule checks. Re-read remote status before reporting a result.

## Current installed backend

| Identity | Verified checkpoint |
| --- | --- |
| Source | `9266c1248af9a8f8c8bd355b5b0b150bcc957e0e` |
| Release | `0c71eced8cddd1d184b430947fbe11f79a791c3328ea1a99cc21af714facc297` |
| Rollback | `8aa0cc4c80cfd45c1c48c0725139be7a1e1870fb2bbc749ecd849d026100d1dc` |
| Frozen frontend | `24100ef601b810efb0cda95e4fe0842d2944560734b02c4cf482c25e19150543` |

The normal installed update passes **102 metadata/refusal checks across 59 exact module hashes**. All 54 semantic workspaces, four profiles, 57 workflows, selection and one pending keyboard-only conversation are preserved. 53 sealed files are byte-identical; one changes audit metadata only. The selected Personal workspace returns a complete empty saved-project inventory without native observation or task authority. Populated inventory has separate source/native coverage.

Dated backup and launcher readback verify. The payload has 554 files/4,750,121 bytes; current plus one rollback remain. Its exact 555-file/4,849,605-byte prepared bundle is removed. Host-facing task-owner, Copilot-journal and signed-intent verifiers run sequentially. Do not repeat executed installation or cleanup scripts. [Installed evidence](evidence/installed-codex-status-consent-summary.json).

Complete Linux at the same source is accepted: **356 groups, 2,333 passing tests, 32 declared skips**. Original receipt `e19a2513-00d0-4f53-b1b1-726f467955f4` preserves manifest, commands, bounds and cleanup. The unit exited zero; its checkout, nine dependency aliases, 803 generated files/11,910,385 bytes, test parent and active marker are removed. Other worktrees remain untouched. No complete Linux run is active.

The temporary wrapper's original syntax failure preceded every test and remains retained. The corrected reusable private template uses whole-token placeholder replacement and syntax-checks the wrapper before launch. Do not rerun executed start/audit/cleanup scripts. [Complete Linux evidence](evidence/linux-9266c12-complete-summary.json).

## Current Windows verification

Source `4db5948e63df68501b56ac4d6690f3a86cf001e4` passes all **462 groups, 2,910 tests and 246 declared skips**. All 21 original worker receipts are independently audited against the source/merge tree, toolchain, manifest, commands, bounds and cleanup. Run `42461208384` uses merge `29faa91ee774e760c62e658e676df3cc916d79c1`, tree `3c4d0b86eaa8f6f59ec07897d4ed25888d63693e`. Its native collector is accepted: exact scope, manifest, all cohort identities/digests and totals match the independent audit; all 23 workflow jobs pass. [Complete source evidence](evidence/complete-windows-4db5948-summary.json).

The earlier full package run `42397684952` at `90fa879` completed all 462 groups in about 61 minutes, within its existing 90-minute limit. **Two native fixture assertions failed.** The receipt has 2,900 passes, two failures and 246 declared skips, with exact cleanup. Preserve the [audited original failure](evidence/windows-package-90fa879-failure-summary.json).

- The extensionless synthetic Codex provider inherited the packaged repository's module context. Original bytes initialize under CommonJS and disconnect under a module parent. Dynamic imports correct the fixture without changing its RPC contract or production transport.
- The recovery fixture saved a SUBST helper path where production recovery requires canonical identity. It now captures the canonical path before ownership. The production saved-helper/digest guard is unchanged.

Both corrected files pass **22 native Windows tests with zero skips** at `4db5948`; their two complete workers pass 48 groups/328 tests with 15 declared skips. [Scoped native follow-up](evidence/windows-fixture-native-4db5948-summary.json), [local regressions and corrections](evidence/windows-package-fixture-corrections-summary.json). This is source evidence, not full package acceptance.

The later `6089285` native test creates an owned directory junction, checks identical helper bytes and regular-file status, refuses the alias as saved identity, then accepts the untouched original canonical row. Its local three-group run passes 29 tests with five declared platform skips; the alias assertions now pass inside the independently audited `db24634` Windows package test receipt. No production identity is rewritten or relaxed.

The latest source `db24634` also has a passing native collector and all 462 package test groups pass (2,910 tests; 246 declared skips). The package receipt is independently audited. Release construction then fails with CA1416 in the standalone provider helper's `EditorEndpointSecurity` method. The local Windows guard now fixes the identical compiler invocation while preserving warnings-as-errors, ACL/identity checks and QUERY-only access. The portable self-test and two Linux refusals pass; eight original contract groups pass 48 tests/one declared skip. Its 34-file/561,965-byte build staging is removed with original/corrected logs retained and no package downloads. [Package stage](evidence/windows-package-db24634-tests-summary.json), [compiler correction](evidence/provider-helper-platform-source-summary.json).

Next remote checks:

1. The early native preflight is now accepted at `7529718`: client run `42539354532`, helper job `128910595134`, merge `1f2bf2d153eebedeaf488a911f1fe1812dac4d42`, source/merge tree `ec96edb826e7ba408d9b3c1c2155cb2b3d51b1d3`. The standalone helper publishes and passes its own-process self-test under the unchanged 15-minute bound, pinned offline toolchain and QUERY 8. [Native evidence](evidence/provider-helper-platform-native-summary.json). No binary was downloaded locally. The adjacent voice target compiles offline; 33 staging files/377,415 bytes are removed. Do not rerun executed reproduction/build/cleanup scripts.
2. Follow ordinary source run `42539354478` and full package run `42539354588` at `7529718`, or their exact newer-source replacements. Require the complete release job to pass its remaining native publishing/packaging stages. Source and package test-stage acceptance do not establish a finished release.
3. Preserve the two `db24634` preliminary HTTP 504 failures before tests (jobs `128691327134` and `128691327237`); no receipts exist. The next normal source push can schedule a fresh run. Do not dispatch/cancel/retry CI manually.

The frontend-freeze clarification is pending with the owner. Until answered, continue independent backend/package work without changing Home/catalog/editor activation.
Only bounded digest-verified JSON receipts remain locally outside the checkout. ZIPs were read in memory; no native runtime archive or disposable checkout is retained. Package verification keeps ordered builds/compiled consumers followed by at most two independent children. [Scheduling contract](evidence/windows-paired-verification-summary.json).

## Recent backend behavior

- Signed saved-project discovery and exact-project task choices are implemented in both typed editor clients. Current protected owner/load/task records and workspace policy determine eligibility. Listing does not inspect a native provider, write state or grant execution. Fresh exact review remains mandatory. Picker/command activation is frozen. [Contract](coding-task-owners.md#find-eligible-saved-projects).
- Named role choices provide readable local connection labels and digest-checked binding. Listing/binding is separate from dispatch authority. [Contract](role-dispatch-binding.md#choose-a-saved-connection-by-name).
- Claude task/design admission accepts exactly reviewed 2.1.308, 2.1.317 and 2.1.319; unknown versions refuse before account/task reservation. The original version refusal and failing task-version regression are retained. Earlier real read-only version/account checks verified independent guardian exits without prompts or login changes. [Admission evidence](evidence/claude-version-admission-summary.json).
- Claude and Codex status recording captures the original recording generation and provider observation time, preventing queued results from entering resumed or replacement consent. Unknown/stale status stays explicit. Original failing regressions remain retained. [Claude evidence](evidence/claude-status-consent-summary.json), [Codex evidence](evidence/codex-status-consent-summary.json).
- Signed external-agent reports retain occurrence time across Node/Python SDK queues and encrypted-state waits, with the same consent boundaries. [Evidence](evidence/external-agent-consent-source-summary.json).

The connected backend demo runs with `node scripts/demo-switchyard-backend.mjs --synthetic`. Seven stages use normal encrypted stores, authenticated HTTP and signed SDK: F77 Dvorak setup, role binding/status dispatch, observation/refinement, saved-state recovery, portable import and Work-policy refusals. The agent and second host are explicit fixtures; temporary servers/state are removed. This grants no live provider, hardware, microphone or UI acceptance. [Demo](backend-demonstration.md), [native Windows demo](evidence/backend-connected-demo-native-summary.json).

Claude's native attach command can restart a stopped session and exposes no verified live-only flag. The attachment launcher remains unfinished and grants no launch/attachment authority. Do not wire it into focus/status or claim that app focus resumes an exact task.

## Retained unresolved failures

Passing follow-ups do not establish the cause of earlier intermittent failures. Preserve original receipts and existing deadlines:

- [Native focus retirement](evidence/native-focus-retirement-failure-summary.json): exit/recording and deadline/rejection diagnostics are available; the original two-second retirement bound remains.
- [Restricted-storage retirement](evidence/restricted-storage-47c80be-failure-summary.json): retain native phase/error diagnostics and QUERY-only permissions.
- [Host-action settlement](evidence/host-action-settlement-diagnostic-summary.json): the original two-second observation expired. Fixture cleanup and closed diagnostic tags improved; original 75 ms coordination/effect and 2,000 ms observation limits remain. The [15-test native follow-up](evidence/host-action-settlement-native-followup-summary.json) passes without proving the original cause.

## Continue required product work

Use the [requirement ledger](switchyard-requirements.md) as scope. Guided role/device controls, production editor activation/task attachment and broader supported external observation streams remain implementation work. Portability, controller and conversation backend paths have substantial coverage: identify the specific missing behavior before adding a subsystem. Additional Shield syntax is not a separate handover requirement and must not displace the required suite.

Keep unfinished software separate from checks requiring physical F77/B122 hardware, an approved Microsoft tenant, interactive Windows/UAC/guest access, a live microphone or approved native task/account operations. A synthetic provider or installed metadata-only proof does not accept those external behaviors.

Publish tested source and evidence regularly. Retain original failures and frontend review artifacts; remove only verified owned staging. Keep this file focused on current state and actionable next work; use linked evidence and Git history for older checkpoints.
