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

The `2eeb2f9` full Linux run now passes 243 groups / 1,548 tests with eleven declared skips and exact staging cleanup. At `d798f4f`, native Windows environment observation rejects the missing-SystemRoot hypothesis; cold restricted Node still fails at `ncrypto::CSPRNG`. [Receipt](evidence/windows-environment-native-summary.json).

The backend now prepares an exact editor target only from an acknowledged load on its original live owner. Fresh socket/alias/process checks refuse a replaced endpoint even when the old metadata bridge survives. Four groups / 75 checks pass with cleanup and typecheck. This grants no terminal authority or IDE attachment; the read-only signed editor metadata consumer now passes six groups / 63 checks. Command wiring, terminal creation and native attachment acknowledgement remain unfinished. [Contract](coding-task-owners.md#prepare-an-exact-editor-target).

## Current executable state

Use `mise exec node@24.14.0 -- …`. Reuse `.tools/dotnet-8.0.424`; do not download
another SDK, runtime or voice model onto the workstation. Private verification
receipts live under `~/.local/state/strathex-switchyard/runtime-verification/`.
Keep small receipts and source; retire exact owned staging after exit verifies.

| Source | Accepted evidence | Limit |
| --- | --- | --- |
| Linux `2eeb2f9` | Complete 243-group run: 1,548 passed tests, eleven declared skips; all child/tree and owned checkout/dependency/build cleanup verifies. [Receipt](evidence/linux-2eeb-complete-summary.json). | Later changes have focused evidence. Its full-run marker and checkout are removed. Inspect `/tmp/switchyard-full-linux-path.json` before starting any later full run. |
| Native Windows `ce5be6a` | Eighteen lease tests and one declared skip; Supply Chain scenario and 23 policy-output tests pass. Digests and child/tree cleanup verify. [Receipts](evidence/native-state-lease-ce5-summary.json). | The restricted primary-child journey still fails; its latest detached run exits 134. Earlier PowerShell startup failures remain recorded. |
| Installed Linux `4b5e3cc` | Six update/seven owner metadata/seven existing metadata checks, original 54 workspace identities, selected sealed bytes and frozen Home preserved. Dated launcher backup hashes verify; owned bundle removed. [Receipt](evidence/installed-task-owner-summary.json). | Metadata/refusal acceptance only. No native provider starts, task loads or model turns; IDE handoff remains unfinished. Prior c5d2d28 scanner journeys remain source-specific. |
| Owned Codex Unix task adapter | Actual installed CLI: two read-only account operations, verifier permission revocation and exact listener/bridge/socket retirement. [Evidence](evidence/codex-unix-task-adapter-summary.json). | Separate owned task routes now compose this adapter; existing creation/text APIs remain stdio. IDE attachment remains unfinished. No native thread, prompt or account change is authorized in the current backend work. |

The next Windows candidate observes only bounded cold-child environment flags:
SystemRoot/WINDIR presence and comparison with the native system directory, plus
OpenSSL/Node override presence. Values and paths are never exported; the child
environment is unchanged. Both managed builds, 1,856 portable checks, twelve
projection tests and typecheck pass with cleanup. Native execution is pending.
This tests an upstream missing-SystemRoot lead without claiming this fixture has
the same cause. [Source evidence](evidence/windows-environment-source-summary.json).

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
Native execution at `a9cefaf` captures success for both CNG API forms under both tokens, yet the cold restricted Node child still fails. This parent-process observation is not a startup repair. [Native receipt](evidence/windows-random-access-native-summary.json). No weaker entropy or token relaxation is introduced.
[Probe and final owner-retirement guard](evidence/random-access-owner-retirement-summary.json). [Native evidence](evidence/windows-random-assertion-native-summary.json).

The earlier complete `370c21e` run passed 241/241 groups. The newer `359a825`
run passes all 242 groups, as recorded below; its marker is removed.
Inspect `/tmp/switchyard-full-linux-path.json` before starting or cleaning a run. The preceding `efbaa52` full run
remains failed; its concurrency assertion and shutdown lifecycle corrections are
included in the accepted source.

The subsequent complete **`359a825` run passes 242/242 groups**, 1,534 tests
and eleven declared skips. Its private temporary parent uses available storage
without changing mount rules, quota settings, deadlines or assertions. Every
child/tree and exact temporary parent, checkout, alias, build and marker cleanup
verifies. [Complete acceptance](evidence/linux-2eeb-complete-summary.json). Later
Studio owner-route composition has separate 91-test and forty-case evidence.

The complete `a9cefaf` run is **failed: 236/242 groups**, 1,508 passed tests,
thirteen failed tests and eleven declared skips. All six failing groups report
Linux `EDQUOT` during fixture writes/copies; `/tmp` has per-user quotas. Every
child/tree and the exact owned checkout, dependency aliases, builds and marker
were removed after exit verification. No broad cleanup or quota change occurred.
Use a fresh explicitly owned temporary root on available storage for the next
complete run. [Failed receipt](evidence/linux-a9c-quota-failure-summary.json).

Normal Studio now composes the owner/load service through authenticated routes
with exact request fields and active-workspace checks. Selection, keyboard-only
mode, individual stop and application close retire original owners and join loads.
Private owner/load records are omitted from generic snapshots. Six files pass
91 tests; the final HTTP/privacy cohort passes forty, with cleanup and typecheck.
The provider is controlled; real loading, installed acceptance, frontend wiring
and authenticated IDE/terminal handoff remain open. [Routed evidence](evidence/routed-task-load-summary.json).

Reviewed loading on the original owned task connection is now implemented as an
explicit backend operation. One-use policy-bound review, durable no-replay
reservation, idle-state checks, repeated effect boundaries and joined shutdown
pass 62 tests across five files. An actual Unix listener/bridge loads a synthetic
task with a controlled provider; no real task or model turn is requested.
The separate owner/load routes are now connected; installed acceptance and IDE attachment remain unfinished.
[Load contract](coding-task-owners.md), [evidence](evidence/reviewed-owned-task-load-summary.json).

The explicit `createCodingTaskOwners` service now persists original owner stages
and task/account/repository binding under real private leases. Five files pass 76
tests; final eight registry and five packaging checks pass with exact cleanup and
typecheck. Actual Unix listener/bridge composition uses a controlled provider double.
The manifest now has 244 Linux groups after CVSS 2 support; the latest `2eeb2f9` complete run passes its original 243 groups. The later signed editor metadata consumer has six-group/63-check evidence.
Existing creation/text APIs still use stdio; the separate owner/load routes have
composition evidence above and grant no IDE attachment. [Contract](coding-task-owners.md).

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
2. Connect the reviewed task-loading service to supported
   authenticated IDE/terminal attachment and the eventual frontend controls. Recheck compartment, account, repository
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
