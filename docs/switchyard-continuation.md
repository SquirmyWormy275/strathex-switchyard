# Continue the full Switchyard suite

The full October 29 Rev2 assignment is incomplete. Continue independently
executable implementation and validation; a passing subset is not completion.
The [requirement ledger](switchyard-requirements.md) defines scope. Start with
[current status](switchyard-status.md) and [verification](verification.md) for
accepted and failed source checkpoints.

Use the existing `feat/switchyard-configuration-loop` checkout and keep
[draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20)
updated. Read `git status` and `git log` for the newest published implementation;
checkpoint hashes below identify evidence, not an instruction to reset the branch.
Keep commits on GitHub regularly. Do not merge or release.

## Decisions to preserve

- The Home/catalog frontend is frozen for owner review. Do not change assets,
  automate its browser or reload it during backend work.
- Claude Code is a contingency for actual token exhaustion, not a request to
  delegate normal implementation. Compaction is not exhaustion.
- The F77 is the pilot. Use protected cached readouts and source research here;
  no new HID, unlock, writes, reset, flash, bootloader or electrical operation is
  authorized by these backend tasks. Preserve firmware Dvorak and US host input.
- Preserve the repaired native ChatGPT main-window voice path, hidden overlay,
  saved pet artwork and workstation click guard. No Seagate work is requested.
- No approved Microsoft work tenant is available. Simulated Graph checks and
  local metadata acceptance do not establish tenant/license/consent acceptance.
- Native Windows CI is available. Pending or failed native software checks are
  unfinished validation, separate from actual guest, UAC, account and hardware
  checks. B122 hardware and its 27 physical gates remain unaccepted.

## Current executable state

Use `mise exec node@24.14.0 -- …`. Reuse `.tools/dotnet-8.0.424`; do not download
another SDK, runtime or voice model onto the workstation. Private verification
receipts live under `~/.local/state/strathex-switchyard/runtime-verification/`.
Keep small receipts and source; retire exact owned staging after exit verifies.

| Source | Accepted evidence | Limit |
| --- | --- | --- |
| Linux `370c21e` | Complete 241-group run: 1,509 passed tests, eleven declared skips; all child/tree and owned checkout/dependency/build cleanup verifies. [Receipt](evidence/linux-370-complete-summary.json). | Later changes have focused evidence. Its full-run marker and checkout are removed. Inspect `/tmp/switchyard-full-linux-path.json` before starting any later full run. |
| Native Windows `ce5be6a` | Eighteen lease tests and one declared skip; Supply Chain scenario and 23 policy-output tests pass. Digests and child/tree cleanup verify. [Receipts](evidence/native-state-lease-ce5-summary.json). | The restricted primary-child journey still fails; its latest detached run exits 134. Earlier PowerShell startup failures remain recorded. |
| Installed Linux `c5d2d28` | Six update/seven metadata checks, fifteen checks each for Supply Chain/Release, four actual scanner exits and original 54 workspace identities restored. [Installed evidence](evidence/installed-cvss-context-summary.json). | Published source is newer than the installed application. Do not confuse source verification with installed acceptance. |
| Owned Codex Unix task adapter | Actual installed CLI: two read-only account operations, verifier permission revocation and exact listener/bridge/socket retirement. [Evidence](evidence/codex-unix-task-adapter-summary.json). | Explicit adapter; main Studio uses stdio. Complete task/IDE composition remains unfinished. No native thread, prompt or account change is authorized in the current backend work. |

The Windows lock path now invokes only the shipped helper's
`--state-lease-worker` mode. Source CI builds it once per run using the existing
pinned toolchain and verifies source/size/digest before staging at the fixed
runtime path. There is no PowerShell fallback. Keep the original acquisition,
release and child/test deadlines. [Contract](private-state-locking.md).

The restricted child at `8c6f91a` identifies its assertion as `ncrypto::CSPRNG`,
`node.cc:1221`. Exact artifact digest, fixed source location and pipe retirement
verify; the child still exits 134 with no result. Determine the Windows random
source failure next. The prepared fixed CNG probe compares system-preferred
and explicit-provider RNG statuses under restricted and original tokens; it
retains no entropy and verifies handle/buffer cleanup. Both managed builds and
1,856 portable checks pass; twenty registry/report cases and typecheck pass.
Native execution is pending. No weaker entropy or token relaxation is introduced.
[Probe and final owner-retirement guard](evidence/random-access-owner-retirement-summary.json). [Native evidence](evidence/windows-random-assertion-native-summary.json).

The complete local `370c21e` run passes 241/241 groups, 1,509 tests and eleven
declared skips. All child/tree and owned checkout/alias/build/marker cleanup verifies.
A new complete 242-group run is starting at the next published checkpoint; inspect
`/tmp/switchyard-full-linux-path.json` before starting or cleaning a run. The preceding `efbaa52` full run
remains failed; its concurrency assertion and shutdown lifecycle corrections are
included in the accepted source.

The explicit `createCodingTaskOwners` service now persists original owner stages
and task/account/repository binding under real private leases. Five files pass 76
tests; final eight registry and five packaging checks pass with exact cleanup and
typecheck. Actual Unix listener/bridge composition uses a controlled provider double.
The manifest now has 242 Linux groups, without a complete run of this later source.
Production still uses stdio; the service currently observes metadata only and neither
loads a task nor grants IDE attachment. [Contract](coding-task-owners.md).

The subsequent Codex creator boundary verifies its own account and the original
repository/reservation before thread creation and marker injection, including
after asynchronous project setup. Six related files pass 81 tests and typecheck.
No native thread, model prompt or account change was requested. Full persistent
task/IDE composition remains unfinished.
[Creator evidence](evidence/coding-creator-boundary-summary.json).

F77 source research verifies 26 pinned files across two builds with no allowed
haptic operations. Use cached readouts only. Real Claude/tmux registered navigation
stopped at workspace trust; do not bypass it. The latest attempt restores original
workspace/focus and retires owned processes/socket/cache.
[Hardware audit](solenoid-capability-audit.md),
[trust boundary](evidence/installed-tmux-trust-boundary-summary.json).

## Next executable tasks

1. Diagnose the restricted child's native Windows random-source failure. Verify
   artifact digest and source/merge identity, distinguish access observations from
   child acceptance, and repair the actual initialization failure without broadening
   token/desktop/service authority. Continue other work while CI runs.
2. Connect the protected task-owner service to reviewed task loading and supported
   IDE/terminal attachment, then normal Studio routing. Recheck compartment, account, repository
   and original native owner before every effect. Process ancestry alone cannot
   identify an IDE terminal tab. Use provider doubles for task/model operations
   unless their native execution is separately authorized.
3. Continue the remaining ledger requirements, including complete Shield scope,
   additional input/severity/ecosystem semantics and broader workflow observation.
   These are unfinished software, not excuses to wait for unavailable hardware.
4. When a coherent source checkpoint is ready, verify the normal versioned
   application update and a permitted installed journey. Restore the original
   workspace identities, selection, endpoint and frozen frontend; independently
   verify all owned process exits and remove only exact owned staging.

The frontend remains frozen, including browser automation/reloads. Do not expand
permissions, alter desktop configuration, request models, switch accounts or touch
HID while verifying these backend changes. Report the scope actually exercised.
