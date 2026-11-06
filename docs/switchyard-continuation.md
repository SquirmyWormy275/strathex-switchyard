# Continue the full Switchyard suite

The October 29 Rev2 assignment is incomplete. Continue independently executable
implementation and validation; a passing subset is not completion. Start with
[current status](switchyard-status.md), the [requirement ledger](switchyard-requirements.md)
and [verification](verification.md). Source-specific receipts distinguish software
checks, installed demonstrations, native failures and unavailable environments.

Use the existing `feat/switchyard-configuration-loop` checkout and keep
[draft PR 20](https://github.com/SquirmyWormy275/strathex-switchyard/pull/20)
updated. Inspect `git status` and `git log`; checkpoint hashes below identify
evidence, not instructions to reset. Publish regular commits. Do not merge or release.

## Decisions to preserve

- The Home/catalog frontend is frozen for owner review. No asset/UI changes,
  browser automation or reloads during backend work.
- Claude Code is a contingency for actual token exhaustion. Continue normally;
  do not delegate. Compaction is not exhaustion.
- Use cached F77 readouts and pinned source. No new HID, unlock, write, reset,
  flash, bootloader, solenoid or electrical operation. Preserve firmware Dvorak
  and US host input. The audit verifies 26 files across two builds without
  establishing electrical limits. [Audit](solenoid-capability-audit.md).
- No live login/logout/account switching, model requests or real native task
  creation/resume in these backend checks. Use controlled provider doubles.
  Read-only account metadata has separate existing acceptance.
- Preserve native ChatGPT main-window voice, its hidden desktop overlay, saved
  pet artwork and workstation click guard. No Seagate or game changes.
- No new local SDK, runtime or model downloads. Use `mise exec node@24.14.0 -- …`
  and the existing `.tools/dotnet-8.0.424` when a managed build is needed.

## Current implementation and evidence

Selected Python wheels now receive bounded ZIP/metadata identity checks alongside
their declared byte hash. A different embedded package name/version produces a
failed provenance finding even when the byte hash matches. Eight focused groups
plus a final unit follow-up pass 101 distinct checks, including six actual Linux
scanner journeys and six Windows guest doubles. Fifteen independent Python ZIP
fixtures, malformed inputs, expansion limits, protected receipts and exact cleanup
verify; typecheck and the original package budget pass. No extraction or execution
occurs. RECORD hashes, compatibility tags, license/code contents and publisher
provenance remain unverified. The installed aa98c91 baseline predates this change;
installed and native Windows wheel acceptance are pending.
[Wheel contract](python-wheel-identity.md),
[source evidence](evidence/pypi-wheel-identity-source-summary.json).

Complete Windows source cadbccd now passes its separate full verification packet:
**416 test/build groups, 2,443 passing tests, 204 declared skips and no failures**.
The source/merge trees, artifact/receipt digests, original source group inventory,
child deadlines and cleanup all verify. The overall workflow nevertheless failed
at final enforcement because preliminary backend shard 3 was cancelled without
a receipt. That shard remains unaccepted; the passing complete packet does not
turn the workflow green. This checkpoint includes credential/revocation/outcome
work and predates stopped-agent, helper, SDK, automatic-review and marker changes.
[Native complete evidence](evidence/windows-complete-cadbccd-summary.json).

The supervised Linux retry at 49a5053 finished **306/311 groups**, with 1,889
passing tests, sixteen declared skips, four failed build groups and one failed
test. It is not a complete pass. The temporary job inherited mise shims for nested
builds; no trust settings were changed. Its UMask=0077 also made a deliberately
public permission fixture private, unlike the normal shell's 0022 mask. All child
and process-tree cleanup verified; the owned checkout, nine aliases, empty test
parent and marker were removed. The last complete Linux pass remains 68bcc76.
Future supervised launches must put the existing pinned Node binary directory
first on PATH and preserve the deliberate permission fixture's intended mode.
[Failed run and cleanup](evidence/linux-49a5053-failed-summary.json).

Conditional Python pins now retain a private marker digest and sorted environment
variable names. Conditions are parsed without evaluation; matching declared-pin
advisories and selected artifact comparisons remain visible, with mandatory
unevaluated/unresolved gaps. Eight focused groups pass 115 checks, including
two new actual Linux scanner journeys, two Windows guest doubles and six artifact
combinations. An independent 87-case pip/PyPA fixture covers the grammar and
preprocessing. Typecheck, original package budget and owned scratch cleanup pass.
Installed metadata checks now pass separately; native Windows marker acceptance remains pending.
[Contract](python-supply-chain.md#conditional-pins),
[source evidence](evidence/pypi-markers-source-summary.json).

Automatic scanner review now gathers bounded current files, includes recognized
ignored secrets and proposes explicit generated-directory exclusions. It captures
file hashes before returning the existing one-use review; unknown ignored paths,
missing files and file/revision/account drift refuse. The new path grants nothing
and performs no scan until the separate established confirmations. Twenty-five
groups pass 100 checks, followed by five composed review cases (102 distinct
checks), including one actual Linux scanner exit and one Windows guest double.
All sixteen installation scenarios and the original package budget pass.
Installed exact-module/preflight verification now passes within 34 metadata
checks; live task/scanner use and native Windows acceptance remain separate.
[Guide](scanner-input-inventory.md), [evidence](evidence/scanner-review-source-summary.json).

Custom-agent SDKs now complete sequence persistence before transmission. Node
awaits asynchronous saves; Python accepts a synchronous persistence hook, rejects
awaitables/nested sends and keeps its validated enrollment immutable. A failed
save sends nothing and consumes its local counter; restart resumes above saved
state. Two regressions reproduce before correction. Four focused groups pass
66 distinct checks, and a final 15-check integration pass includes two actual
Python processes against controlled loopback servers. Typecheck, original
package bounds and exact cleanup pass. Installed exact-module/preflight verification passes; live-agent and native
Windows acceptance remain separate.
[SDK contract](../integrations/README.md), [source evidence](evidence/sdk-persistence-source-summary.json).

Latest source work fixes shortcut-helper retirement, shared hydration and stale
owner readback/rollback. Uncertain registrations are retained for Restore and
never automatically hydrated; IDs remain reserved. Eight groups/89 checks include
six regressions and two controlled real child exits. Typecheck/package/cleanup
pass. Installed synthetic ownership checks now pass within the 33-check update;
actual Windows interaction remains separate.
[Contract](windows-shortcut-helper-lifecycle.md).

Windows preliminary batches now use measured scheduling costs from all 198
accepted native `9f35961` groups, while retaining every current group/scenario
and original child/job bound. Fixed progress identifies the active group without
being accepted as a complete receipt. Four groups/40 checks and typecheck pass;
the exact temporary root is removed. Native correction acceptance remains pending.
[Contract](windows-backend-scheduling.md).

Latest source work preserves foreground-helper ownership after uncertain exit,
blocks replacement and propagates uncertainty through Suite shutdown. Ten groups/
87 checks plus an eleven-check foreground follow-up pass with two real controlled
Node child exits. Typecheck/catalog verification and exact cleanup pass. Lossless
provenance JSON compaction keeps the full test bundle below the original 5 MiB
limit. Installed synthetic ownership/provenance checks now pass; actual native
Windows interaction remains separate.
[Contract](foreground-helper-lifecycle.md).

The latest source correction retires commands when an adapter publishes stopped,
preserves uncertain claims and rejects active status under the same stopped
identity. Three regressions fail before the fix and pass within eight groups/94
checks afterward. Typecheck/package bounds and owned cleanup pass. Installed
pure stop/recovery checks now pass; live agent operation and native Windows
acceptance of this correction remain separate.
[Evidence](evidence/agent-stop-retirement-source-summary.json).

Custom-agent uncertain claims now support separately reviewed local recovery.
Five new cases pass within eight groups/91 checks: original uncertainty is retained,
no command is retried, late authenticated acknowledgements win and only deliberately
reviewed records become eligible for bounded history retention. Source HTTP,
privacy, rollback, typecheck/package bounds and owned cleanup pass. Installed
pure recovery checks now pass; live recovery and native Windows remain separate. [Contract](custom-agent-revocation.md#review-an-uncertain-claim).

The custom-agent backend now supports reviewed revocation, credential replacement
and enrollment-generation fences for messages, claims and roles. Eight groups/86
checks pass, including encrypted-state failures and an actual authenticated HTTP
revoke/reenroll/rebind journey with two verified Node child exits. Installed pure
synthetic checks pass within the 27-check metadata update. Native Windows, live
installed revocation and frontend acceptance remain separate. [Contract](custom-agent-revocation.md).

Credential workers now join exact-child retirement on timeout/error, reject
signal-only status and block concurrent replacement while exit is uncertain.
Six groups/69 checks pass, including two real controlled children, without using
live credentials. Typecheck, package bounds and owned cleanup pass. Installed pure
synthetic checks now pass; native Windows and live failure injection remain separate. [Contract](credential-worker-lifecycle.md).
Native shortcut diagnostics at `80601e9` pass all sixteen original installation
scenarios and twelve writer cases with cleanup. The intermittent ten-second
timeout did not reproduce; its cause remains open. [Evidence](evidence/shortcut-stage-diagnostics-native-summary.json).

Read [current status](switchyard-status.md) first. It separates complete Linux
checks, native Windows results, focused source checks and installed acceptance.
The [verification record](verification.md) retains historical receipts and failed
attempts; do not infer current status from an older passing checkpoint.

The latest complete Linux source is `68bcc76d031e06a8a655f39311f8f0eafdbe7645`.
All 310 groups pass: 1,875 tests, sixteen declared skips, zero failures. This
includes stopped-agent recovery, foreground-helper ownership, lossless provenance
compaction and measured Windows scheduling. Every child/tree exits; the exact
owned checkout, nine dependency aliases, 782 generated files, temporary parent
and marker are removed. All three other worktrees remain unchanged. Later
shortcut-helper source `f06674d` has its separate 89-check focused and 33-check
installed acceptance.
[Receipt](evidence/linux-68bcc76-complete-summary.json).

The installed baseline is `aa98c91f11be1d41e67a7d5e043359c7114423d1`,
release `e1355f25ecea493fc47fae4aa544021ed285629f6305e39555d09cbc322df851`.
Normal installed aa98c91 passes **41 metadata/synthetic checks**: 13 task-owner,
seven Copilot-journal, fourteen agent/helper/SDK and seven Python-inventory checks.
Fourteen tested module hashes and both verifier hashes bind the running build.
The Python checks use 87 marker and 39 original reference cases plus fixed
in-memory reports/artifact comparisons; they evaluate no condition and start
no scanner process. All 54 semantic workspaces, selected state, pending
keyboard-only conversation and frozen frontend remain preserved; 53 sealed files
are byte-identical and one changes only audit metadata. Dated backup/readback
and current plus one rollback verify. The exact 533-file, 5,221,413-byte prepared
bundle is removed. [Installed evidence](evidence/installed-python-markers-summary.json).

The repeatable `scripts/verify-agent-security-host.mjs --read-only-metadata`
proof verifies exact installed hashes and uses only synthetic in-memory state;
its fourteen current installed checks pass. The unchanged flags retain their earlier
28-check focused guard/package acceptance.
[Verifier evidence](evidence/installed-agent-security-verifier-summary.json).
Earlier installed `4b2daed` and `5a8d159` retain separate lifecycle/archive/extras evidence.

Latest source work closes the bundled-example uncertain-stop/replacement/shutdown
gap. Seven focused groups/72 checks pass, including real authenticated Node
readiness, restart identity and keyboard-only exits; typecheck and package bounds
pass. The exact focused temporary root is removed. Normal installed metadata/module verification now passes; native Windows and
live installed bundled-example execution remain separate. [Contract](bundled-agent-lifecycle.md).
The four Windows backend batches at `9f35961` are now digest-verified: 198 groups,
1,022 passes, 142 declared skips, no failures and all cleanup verified. Its combined
release run 42281533502 now passes 414 test/build groups, 2,398 tests and 202
declared skips. Archive/receipt digests, source/merge tree equality, original
bounds and all cleanup verify. This accepts `9f35961`, excluding later agent
security changes. [Complete receipt](evidence/windows-complete-9f35961-summary.json). [Receipt](evidence/windows-backend-9f35961-native-summary.json).

Latest addition: custom-agent command history now retains only opted-in
queue/claim/retirement/acknowledgement metadata. Seven groups/92 checks pass with
real encrypted HTTP/bundled-agent execution, explicit provider doubles, source/
interval/exclusion/pause fences, rollback and exact cleanup. Typecheck/package
bounds pass. Keep actual completion and measured savings false. Installed pure
metadata acceptance now passes six checks within the 26-check update. Native
Windows and live installed command execution remain separate.
[Contract](agent-lifecycle-observation.md#custom-agent-command-history),
[evidence](evidence/custom-agent-command-observation-summary.json).

The Windows first installation scenario times out again at `9193471` and `4b2daed`,
with 24/25 tests passing and all child/tree cleanup verified in both packets.
The original ten-second shortcut deadline remains. Its cause is unresolved; the
earlier `9f35961` pass does not establish stability. Fixed stage diagnostics now
pass 19 groups/36 source checks (all original sixteen installation scenarios,
twelve writer cases and existing release/direct-child checks). Native follow-up
must inspect the fixed last-stage label without extending deadlines or changing
permissions. [Failure packets](evidence/windows-shortcut-recurring-timeout-summary.json),
[diagnostic evidence](evidence/shortcut-stage-diagnostics-source-summary.json).

## Continue independently

1. Complete Linux `6e967a3` passes all 306 groups: 1,793 passing tests, sixteen
   declared skips and no failures. Its owned checkout, nine dependency aliases,
   782 generated files, temporary parent and run marker were removed; other
   worktrees were preserved. [Receipt](evidence/linux-6e967a3-complete-summary.json).
   Do not repeat a complete run without relevant changes or unresolved concerns.
   Future runs use an exact owned home-directory temporary root; this machine's
   `/tmp` user quota was exhausted. Do not alter mounts or delete unrelated data.
2. Native `6e967a3` passes all eight original restricted-owner checks. Exactly
   68 descendants (17 guardians, 17 workers, 34 status helpers) verify QUERY
   mask 8. Native tree/token/desktop readback and inner/outer fixture, service
   and file retirement pass. All six actual GUI setup checks pass separately.
   This closes the restricted startup/retirement defect in controlled CI.
   [Owner receipt](evidence/windows-restricted-owner-accepted-summary.json),
   [setup](evidence/setup-final-native-summary.json).
   Preserve the 68-request bound, status-only slots 65–68, original eight
   assertions, ninety-second deadline and exact QUERY mask 8. No broader
   token/process/default-DACL/SID/privilege/account rights or runtime fallback.
   Interactive ordinary-user/UAC/guest acceptance remains separate.
3. Verify the corrected Windows backend scheduling and full release separately.
   All 26 task-owner cases now have independent children with the original
   45-second bound; the original test assertions and two Linux-only skips remain.
   A dedicated task-owner Windows job avoids waiting for the long release
   lane. The older complete `dbbcce8` release has now finished failed: 385/386
   groups, 2,336 accepted tests and 195 declared skips, with only that original
   task-owner timeout. [Receipt](evidence/windows-complete-dbbc-failed-summary.json). Native `9fde0a3` now completes all 26 cases: 24 passes and the original
   two Linux-only skips, with exact cleanup and no extended deadlines. The earlier
   four-job run remains failed evidence; complete release acceptance is separate.
   [Task-owner receipt](evidence/task-owner-native-summary.json).
   The previously reported lease case also passes.
   [Native batches](evidence/windows-backend-dbbc-native-summary.json),
   [case scheduling](evidence/task-owner-scenarios-source-summary.json).
4. Complete Linux `6e967a3` and its exact owned cleanup are finished. The run
   marker, checkout, nine dependency aliases, 782 generated files and temporary
   parent are removed; all three other worktrees are preserved. Native Windows
   advisory source checks pass 23 tests. Composed scanner checks pass seven
   tests with eight declared Linux-only skips and guest execution doubled.
   [Scanner receipt](evidence/osv-boundaries-native-scanner-summary.json).
   The installed SPDX/OSV metadata checks now pass through the normal update.
   Selected npm archive identity now passes six isolated groups/78 checks and
   one additional alias/version case, including actual Linux execution and
   Windows guest doubles. The parser never extracts or executes members; real
   offline npm output also passes after its portable omitted-owner fields were
   accounted for. Initial failed source/zero-plan receipts remain recorded.
   [Archive evidence](evidence/npm-archive-identity-summary.json). Reconcile the
   complete Linux 7e45654 failure separately: 305/306 groups, 1,783 accepted tests,
   sixteen declared skips and the original combined artifact deadline. Exact owned
   cleanup removed its checkout, nine aliases, 782 generated files and run marker.
   [Failed receipt](evidence/linux-7e45654-timeout-summary.json). The corrected
   complete 55515d1 run passes all 307 groups, 1,805 tests and sixteen declared
   skips. Exact owned cleanup removes its checkout, nine aliases, 782 generated
   files, temporary parent and marker; all three other worktrees remain.
   [Complete receipt](evidence/linux-55515d1-complete-summary.json). Native
   Windows 7e45654 times out the combined artifact file at its original 300-second
   bound; all other 65 boundary jobs pass. The correction separates byte/identity
   cases into independent files and CI lanes, preserving original assertions
   and deadlines. Five distinct groups/53 checks pass across the initial scanner
   groups and corrected harness inventory; four report-bound cases also pass.
   [Scheduling evidence](evidence/npm-archive-scheduling-summary.json). Reconcile
   its native follow-up evidence. Corrected `55515d1` archive-scanner now passes
   ten native Windows tests and two declared Linux-only skips, with guest
   execution doubled and exact cleanup. [Receipt](evidence/npm-archive-native-summary.json).
   The separate installation lane fails one of sixteen scenarios during native
   shortcut creation. The original ten-second shortcut deadline remains; its
   underlying cause is not established. [Failure](evidence/windows-shortcut-timeout-summary.json).
   Its unchanged-source retry was cancelled (job 128110089870) without an accepted
   native result. The original byte-comparison file also passes
   eight native tests and two declared Linux-only skips at 55515d1.
   [Byte receipt](evidence/npm-artifact-split-native-summary.json).
   A confirmed cleanup race is now corrected without extending the original
   ten-second execution bound: failure joins direct-child retirement and only
   then removes temporary output; unconfirmed exit preserves owned staging.
   Twenty-three focused groups/69 distinct checks pass, including two actual
   controlled Node writers. Native Windows 9f35961 now passes all sixteen original
   installation/recovery scenarios plus nine writer tests: 25 passes, no skips,
   original execution deadline and verified child/tree cleanup. The older failure
   and cancelled retry remain historical; their cause is not established.
   [Native receipt](evidence/shortcut-writer-native-summary.json).
   [Source evidence](evidence/shortcut-writer-retirement-source-summary.json).
   Historical installed source 5a8d159 passes 31 permitted metadata checks.
   Native NTFS index/history staging now each pass six original checks and
   three independent guardian exits at 6b4089c. Their Windows scanner files
   separately pass two cases each with guest doubles; leases pass 24 cases and
   one Linux-only skip. Packet Git witnesses are synthetic and no actual guest,
   installed Windows or ordinary-user journey is accepted by those receipts.
   [Native evidence](evidence/native-history-index-leases-summary.json).
   Continue other independently executable ledger requirements, including Shield
   coverage, ecosystems, publisher provenance, verified local vulnerability
   context and workflow observation. These are unfinished implementation,
   separate from unavailable hardware, accounts or interactive environments.
   Exact Python extras and corrected continuation/comment processing now pass
   ten focused groups/106 checks and a 39-case pip/PyPA oracle. Two new actual
   Linux scans and two Windows guest-double journeys retain original state,
   receipt/replay and cleanup guarantees. Typecheck/package bounds pass. Five
   installed extras metadata checks now pass inside the 31-check update; native
   Windows `9193471` passes four composed scanner and ten artifact tests, with two
   declared Linux-only skips and guest execution doubled. [Native receipt](evidence/pypi-extras-native-summary.json).
   The complete immutable Linux run at
   `5a8d159` now passes all 308 groups: 1,823 tests, sixteen declared skips and
   zero failures. Exact cleanup removed its checkout, nine aliases, 782 generated
   files, temporary parent and marker; all three other worktrees remain.
   [Complete receipt](evidence/linux-5a8d159-complete-summary.json).
   [Evidence](evidence/pypi-extras-source-summary.json).
5. Keep frontend and editor command activation frozen. The protected editor
   journal, signed routes, restricted upstream and retained Terminal compose
   through actual Linux carriers with provider/editor doubles. Native TUI,
   account and IDE acknowledgement remain unaccepted. Installed Codex 0.167.0
   is outside the reviewed 0.166.0 gate; static schemas do not justify changing it.
   [Terminal proof](evidence/editor-terminal-connection-summary.json),
   [retirement](evidence/editor-retired-stop-summary.json).
6. Use the normal versioned update for coherent backend checkpoints and only
   permitted installed checks. Metadata verifiers require `--read-only-metadata`.
   Do not run older live task/scanner verifiers blindly: `verify-shield-host.mjs`
   creates a real Codex task and is outside current scope.

## Keep evidence small and accurate

Private receipts live under `~/.local/state/strathex-switchyard/runtime-verification/`.
Retain small summaries in `docs/evidence`; remove successful exact owned bundles,
build output and test checkouts after exit verification. Preserve existing review
artifacts and all unrelated checkouts. Failed native fixtures retain their original
ownership evidence. Do not install another SDK to inspect them locally.

Separate unaccepted environments: no approved Microsoft work tenant; B122 hardware
and all 27 physical gates unavailable; F77 physical operations not authorized;
Windows guest/UAC/ordinary-user journeys not established by headless CI. The real
Claude/tmux attempt stopped at workspace trust and restored focus/workspace while
retiring owned processes; no trust bypass is authorized.

Historical milestones and original failures remain in
[verification](verification.md) and [status history](switchyard-status-history-7.md).


Windows `cadbccd` preliminary backend shard 3 is cancelled after 20 minutes
3 seconds, with no final receipt and a failed empty artifact upload. Its elapsed
time matches the configured twenty-minute job bound; the runner log supplies no
more specific cause. No tests from that incomplete shard or exact cleanup are
accepted. The separate complete release remains active. This is a CI acceptance
gap, not a hardware/account blocker; native `9f35961` and complete local Linux
`cadbccd` keep their separate accepted results. Inspect scheduling without
extending any child/job bounds. [Evidence](evidence/windows-cad-cancelled-backend-summary.json).

The first complete 49a5053 attempt ended with exec status 143 before a final
receipt. Its cause is unknown and zero groups/tests from that attempt are
accepted. The runner is absent; a scan found no processes referencing its owned
paths. Ten known scratch directories and two empty configuration files were
removed. The unchanged checkout was reused by the supervised retry above, then removed
with all nine aliases after that retry failed. Original child bounds remained unchanged.
Progress is not a final receipt. The marker changes above are later than this
immutable full-run source. [Interruption](evidence/linux-49a5053-interrupted-summary.json).
