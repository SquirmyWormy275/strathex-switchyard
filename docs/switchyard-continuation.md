# Continue the full Switchyard suite

The full October 29 Rev2 assignment is incomplete. Continue all independently
executable implementation and validation; a passing subset is not completion.
The [requirement ledger](switchyard-requirements.md) is authoritative for scope,
and [verification](verification.md) distinguishes exact source passes and failures.

Work in the existing `feat/switchyard-configuration-loop` checkout and keep
[draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20)
updated. Source-audit implementation is published at `0cc9e76c30c541851b78685ec5f305592612526b`; use Git to read the newest checkpoint.
This checkpoint adds the F77 source protocol audit, omits redundant backend
HTML/CSS while preserving the frozen frontend, and records newer installed
metadata evidence. Keep commits on GitHub regularly; do not merge or release.

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
another SDK, runtime or voice model. The normal installed application uses its
existing versioned update and launcher path; do not print its private access URL
or token. Private verification receipts live outside Git under
`~/.local/state/strathex-switchyard/runtime-verification/`.

- Previous installed journal-metadata source `514bf68`, release `86bdffe016ceb5c021b3f30ce01197a4e5a3e5041419a955efd5d0b6f133f0a9`,
  passes six normal-update and six journal API/privacy checks. Selected sealed
  state and frozen frontend are preserved, with zero prompts, Microsoft requests,
  new workspaces or HID. Its owned bundle/checkout were removed. Exact receipts
  are in the [installed summary](evidence/installed-copilot-journal-summary.json).
- A fresh immutable **232-group Linux run at `514bf68` is active**. Its owned
  checkout/fixtures are recorded in the private temporary marker
  `/tmp/switchyard-broker-full-linux-path.json`; the small driver is
  `/tmp/switchyard-broker-full-linux.py`. Inspect process/receipt state before
  starting another full run. The driver removes owned scratch only after a pass.
- The prior `0cfe82c` run failed: 209/230 groups accepted and 21 deadline failures,
  with all child cleanup verified. Its owned checkout/fixtures are removed and
  its failed receipt retained. [Exact summary](evidence/linux-0cfe-timeout-summary.json).
- Linux locks now use a fixed pipe reader under the existing kernel lock.
  Twenty-eight Suite/commit/lock tests pass under original bounds, including
  owner loss; the previously timed-out commit file finishes in 43,621 ms.
  [Contract and receipts](private-state-locking.md). The latest complete accepted
  run is still the earlier 225-group `4700d9a` checkpoint.
- Copilot durable uncertainty/recovery has 90 surrounding software checks and
  later final-message handling passes 44 checks. Exact echoed requests and
  absent/non-text final messages remain unconfirmed, without automatic resend.
  [Account boundary](copilot-account-binding.md), [recovery](copilot-request-recovery.md).
- The Windows restricted-token decoder accepts only exact one-byte/four-byte
  historical results. Both managed targets compile without warnings; 223 portable
  and 25 report/runner/selector checks pass. Corrected native execution remains
  pending. All concrete SID, privilege, integrity, identity, Job and exit checks
  remain required. [Failure and correction](windows-storage-broker.md#actual-restrictions-and-historical-token-metadata).
- Native `a87f048` filesystem and setup lanes independently pass, with archive
  digests verified; the separate restricted-primary-process lane remains failed.
  [Artifacts](evidence/windows-a87-native-summary.json).
- The F77 source audit verifies hashes for 26 files across two exact builds.
  No direct haptic state/control route is exposed in their audited VIA/Vial
  handlers, setting tables or keyboard extensions. This does not authenticate
  running firmware or establish electrical limits. Five focused groups pass
  46 checks. Normal installed release `f49d611e…` passes six update/four cached
  checks, with no HID/control operation and all owned scratch removed.
  [Installed summary](evidence/installed-haptic-protocol-summary.json),
  [audit and limits](solenoid-capability-audit.md).
- Real Claude/tmux registered navigation remains blocked at the CLI's workspace
  trust dialog. Do not retry with an override or prompt. Latest refusal restores
  workspace/focus and retires its owned processes/socket/cache; earlier recovery
  limits remain recorded. [Evidence](evidence/installed-tmux-trust-boundary-summary.json).

## Next executable tasks

1. The source-audit installed cached-readout check now passes six update/four
   actual API checks at `0cc9e76c`; exact state/frontend preservation and owned
   bundle/checkout removal verify. Record its evidence while continuing the
   remaining exact IDE/task attachment implementation.
2. Collect the active 232-group result. Preserve failures honestly; verify exact
   owned child exit before removing task fixtures/aliases/checkouts. Diagnose
   failures without raising deadlines or affecting unrelated workstation jobs.
3. Collect the corrected native Windows token-width run and independent journal
   workers. Verify artifact SHA-256 and source/merge identities before accepting
   results. Continue fixing executable software failures and remaining ledger
   implementation while external hardware/account checks remain separately open.

Then continue the remaining ledger requirements, including full scanner scope,
additional input semantics and exact IDE/task attachments. These three tasks are
the immediate continuation sequence, not a limit on the full-suite assignment.
