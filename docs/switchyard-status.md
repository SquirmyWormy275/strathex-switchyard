# Switchyard implementation and acceptance

Switchyard remains a partial implementation of the full October 29 Rev2 handover.
The F77 is the connected pilot, not a scope limit. The [requirement ledger](switchyard-requirements.md)
separates unfinished software from checks requiring an exact device, account or
host. [Verification](verification.md) retains accepted and failed checkpoints.

The latest accepted complete Linux checkpoint is immutable `d4128e6`: 238/238
groups, 1,471 passed tests and ten declared skips. Every child/process-tree exit
and owned fixture/dependency-alias/worktree removal verifies. Later source changes
have separate focused evidence. [Exact complete checkpoint](evidence/linux-d412-complete-summary.json).

Native Windows `4911642` passes thirty filesystem checks and both six-check
service/setup lifecycles, including thirteen restricted metadata checks in each.
The later `842416e` run identifies the intermittent removal failure as a disabled
start type after acknowledged deletion; its restricted primary child still exits
with `STATUS_DLL_INIT_FAILED`. The source correction keeps every strict pre-delete
check, allowing disabled only while observing an acknowledged pending deletion.
Actual SCM absence and original process/ownership guards remain mandatory.
Both managed targets compile, all 1,764 portable checks and five backend files/
fifty tests pass. Native `fdb0559` now passes thirty filesystem checks and both
six-check service/setup lifecycles, including thirteen restricted metadata checks
each and the complete 1,541-case service header guard. All 55 other workflow jobs
succeed; the restricted primary-child failure keeps the workflow unaccepted. Fixture
invalidation separately passes all five native tests at `842416e`. Neither
failure is blocked by absent hardware/accounts.
[Exact failure and source candidate](evidence/windows-service-deletion-state-summary.json),
[corrected native followup](evidence/windows-fdb-native-summary.json).

The next restricted-child diagnostic reads only bounded existing Application
Error events matching both the exact PID and native creation time. Fixed module/
exception fields omit raw XML, paths, account data and IDs. Both managed targets
compile; 1,776 portable checks and five backend files/fifty-one tests pass. Native
query now completes at `6f7e595` with closed handles but no retained exact match;
the actual DLL-initialization repair remains unfinished.
[Native query evidence](evidence/windows-restricted-child-events-native-summary.json).
[Source evidence](evidence/windows-restricted-child-events-source-summary.json).

The complete Windows isolated run at `6f7e595` remains failed: 343/344 groups,
2,169 passed tests, one failure and 82 declared skips. The device group's first
failure was lost outside the old diagnostic tail. The corrected runner retains
that block plus totals within the same bound. A separate nonisolated storage
failure exposed DOS short-path aliases rejected by string equality; the image
pin now checks filesystem identity and rejects linked parent directories.
Four local files pass all 56 tests and typecheck. Focused complete Windows
device/storage jobs await native results; other full-run failures remain open.
[Exact failed receipt and followup](evidence/windows-full-followup-summary.json).

Windows keyless workers pass both complete native lease files at `0740791`:
sixteen tests plus one declared platform skip. Fresh encrypted state and keys
remain independently read for every transaction; each kernel handle is acquired
and released separately. New fixed timeout diagnostics distinguish startup,
acquisition and release without retaining raw stderr or changing deadlines.
Three Linux files pass 23 checks; native diagnostic retesting remains open.
[Lock contract](private-state-locking.md).

CVSS 3.0/3.1 temporal and environmental calculations match 899,880 independent
reference cases. Installed Supply Chain and Release demonstrations each pass
fifteen checks with actual scanner exits, signed provenance, retained critical
base severity and exact cleanup. Other CVSS versions and verified local context
remain unfinished. [Calculation contract](cvss-severity.md).

The owned private Codex Unix listener passes four actual native checks: exact
socket/process identity, effective restricted configuration, two matching
read-only account snapshots and containment after abrupt parent loss. Exact
socket/alias/directory/marker retirement passes; two software files pass eighteen
tests. The first alias-cleanup failure remains failed with its separate recovery
receipt. The new pinned streaming bridge additionally verifies kernel peer credentials,
exact birth/executable bytes and socket device/inode before provider traffic.
Seven related software files pass 95 tests, the final bridge file passes seven
tests, and the installed CLI passes four checks on one persistent connection
with effective configuration, bounded startup account settling, pinned account
revalidation, peer exit and exact owned cleanup. Account-event fencing is
implemented and tested with provider doubles; live account switching remains
unaccepted. The owned lifetime controller now reserves neutral private startup,
pins executable bytes through a descriptor, rechecks admission before native
acknowledgement, and preserves unknown entries during exact retirement. Eight
related files pass 104 tests; the installed CLI passes four checks across two
lifetimes/three persistent clients with normal stop and parent-loss recovery.
No thread, model turn or account change is requested; all owned stages retire.
[Lifetime evidence](evidence/codex-owned-lifetime-summary.json). Production stays
stdio; complete Studio/task/IDE wiring remains unfinished software.
[Pinned stream evidence](evidence/codex-pinned-unix-summary.json). The unproven
native CLI proxy is not exposed. [Guardian contract and evidence](codex-owned-transport.md).

The later immutable `82eb764` full run remains failed at interrupted-install
recovery: 213/214 groups pass, 1,266 tests pass, one fails and ten skips. Recovery
now shares the existing release file ceiling plus its manifest; a maximum-size
crash/recovery regression and all 38 isolated package/installation/runner checks
pass. Duplicate browser-only backend copies are omitted while frozen assets stay
intact, keeping the package below its unchanged 5 MiB test budget. Failed receipts
and exact owned cleanup are retained. Later immutable `13635bb` passes the full 217 groups and installed six update/
thirteen actual history-scan checks; the earlier failure remains failed. [Contract](suite-release-recovery.md).

Selected first-parent history witnessing passes 38 isolated history/index/runner
checks and installed `40bb3eb` passes six update/fourteen actual witness and
separate current-file scanner checks. All eleven query probes/two scanners exit,
full restoration and owned scratch removal pass, with zero prompts or keyboard
access. Linux historical scanner integration now separately passes five focused
cases and sixty isolated scanner/history/index/runner checks; installed historical
scan acceptance passes at `4901cc8`. Windows historical transport passes portable/
staging contracts, and its normal scanner connection passes 57 isolated checks
with the guest doubled. Native NTFS packet staging now passes six checks per transport with three
independently stopped guardians each; actual guest acceptance remains pending. Automatic scope
and broader history remain unfinished software. [Witness](git-history-inputs.md),
[scanner connection](historical-shield-inputs.md).

## Installed application

Current installed source is `c5d2d28`, release
`1d037efe0d0c6a56f5bfc7d6657ac3eec2ea3b57ac8c9c49c119bc5d31b822f5`.
Six normal update/seven privacy checks and fifteen checks each for Supply Chain
and Release verify actual offline CVSS-context findings, duplicate refusal,
source retirement and four independent scanner exits. Two new proof workspaces
were reversibly archived after verified app stop; all original 54 workspace IDs,
private endpoint, selection and frozen Home were restored. Owned signing, quota,
package and checkout staging was removed. Zero prompts/public advisory queries,
HID, microphone or account changes. [Installed evidence](evidence/installed-cvss-context-summary.json).

Earlier installed source `c2fe4d8` reaches native Claude workspace trust without
submitting a prompt. Account availability verifies, but registered tmux session
navigation remains unaccepted. Latest refusal restores exact workspace/focus
and retires all four owned processes, socket and cache. Earlier failed cleanup
and manual recovery's unprovable original selection remain recorded.
[Installed trust boundary](evidence/installed-tmux-trust-boundary-summary.json).

Earlier installed native source `dd0cad1` passes six update/five VS Code/five
repaired ChatGPT checks with restoration and exact owned editor/profile
retirement; no user editor or settings are changed.
[Native focus evidence](evidence/native-vscode-focus-summary.json).

Earlier installed source `b82f056`, release
`a6c095ec81436d03fc136e7f6da73977c842e9cabb57ceb33f15a202daa11416`,
passes six update/five actual native main-window focus/API/restoration checks.
One repaired main window and zero floating overlays verify; original selection,
Personal definitions/mode, private endpoint and frozen Home restore. The package
and proof checkout are removed; no prompt, task, keyboard or microphone access.
Receipt `installed-native-main-window-1793881005201.json`. The initial verifier
mode-precondition failure remains failed with exact cleanup; correction checks
actual active work instead of changing original mode. [Contract](native-client-focus.md).

Earlier installed source `bd77ec4`, release
`34a37d55e05f9f75a185f170c801c357e26506883362d24d49dedf332b4e5bf8`,
passes six update/sixteen CLI/API and separate current-file scan checks. All four
inspector commands run through the normal stable launcher in the actual selected
workspace. Twenty-four CLI query guardians, eleven direct history queries and two
scanners independently exit; restoration and owned scratch removal verify.
Receipts `assignment-legends-1793877445888.json` and
`installed-shield-baseline-1793877607788.json`; zero prompts and no keyboard access.
This mode witnesses historical inputs, then separately scans current files.

Earlier installed source `13635bb`, release
`81367973a693738830be3a97cbc3edc165329ca4fc8a4c33f748586d809e1539`,
passes six update/thirteen actual historical-scan/API compatibility checks after
the Windows connection and package/recovery changes. Both scanner exits, original
Git provenance, replay/feed retirement and full restoration pass. Receipts
`assignment-legends-1793875875539.json` and
`installed-shield-baseline-1793876047390.json`; owned source/signing/packages/
staging/bundle/proof checkout removed. One empty task, zero prompts, no keyboard
access, exact frozen frontend. Corrected complete Linux run passes all 217 groups with child cleanup and owned scratch removed.

Earlier installed source `4901cc8`, release
`ffd440981ebb02b4ffb887c94a8f7951a47608244a5bd5e9f3553de86cf7c471`,
passes six update/thirteen actual historical-scan/API checks. The scanner detects
a secret removed from current source, authenticates original commit/blob identity,
and retains partial coverage. Both scanner exits, replay/feed retirement and full
restoration pass. Receipts `assignment-legends-1793874653637.json` and
`installed-shield-baseline-1793874824975.json`; owned source/signing/packages/
staging/bundle/proof checkout removed, one empty task/zero prompts/no keyboard
access. Earlier installed verifier failure and exact cleanup remain recorded.

Earlier installed source `40bb3eb`, release
`cb74c174ae8fa881d9be19bdb2d735bbf6bb845c910630da18c9facdf8645c3c`,
passes six update/fourteen actual history-witness and separate current-file scan
checks. Receipts `assignment-legends-1793873715840.json` and
`installed-shield-baseline-1793873865290.json` retain three immutable commits,
two versions, eleven independently stopped query probes, two scanner exits and
full restoration. Owned repository/signing/packages/staging/bundle/proof checkout
removed; one empty task, zero prompts, no keyboard access. This witness journey
does not claim historical scanner acceptance.

Earlier installed source `112efdc`, release
`408086bab7911cc60170fed4576414ad04356aaca45f735fe49591377dc10462`,
passes six normal update/thirteen actual Linux staged/worktree compatibility
checks after connecting the Windows host path. Both scanner exits, authenticated
Git provenance, replay/feed retirement and full restoration pass. Receipts
`assignment-legends-1793871636105.json` and
`installed-shield-baseline-1793871799715.json` retained; owned source/signing/packages/staging/
bundle/proof checkout removed. One empty task, zero prompts, no keyboard access.
Native Windows acceptance remains separate.

Earlier installed source `11d8cc7`, release
`1f5e9a2c6e90991850030ac7d316b35c90ed14ef12e7012c179e34697e20f522`,
passes six update/thirteen actual staged and worktree scanner API checks. The
real pinned scanner finds a secret only in the index, retains original Git
provenance in authenticated incomplete evidence, and never writes its reserved
alias into the repository. Both scanner exits, replay/feed retirement and full
restoration verify. Receipts `assignment-legends-1793868587004.json` and
`installed-shield-baseline-1793868749979.json` retained; owned source/signing/packages/
staging/bundle/proof checkout removed. One empty task, zero prompts and no
keyboard access. Later Windows source connection passes software contracts;
actual NTFS/guest and installed Windows acceptance remain separate.

Earlier installed source `4a6627a`, release
`1a5c80ec8c7b9e6626c7ea2867edc1b295a5432c7aecb2bea135d094793d32cf`,
passes six update/fourteen actual index API and separately reviewed worktree-scan
checks. Staged bytes differ from the worktree; no source is returned, no grant or
scan is claimed by the witness, and all six query probes independently exit. Two
scanner exits, unchanged original index/worktree, replay, retirement and full
restoration verify. Receipts `assignment-legends-1793867452227.json` and
`installed-shield-baseline-1793867608531.json` retained; all owned repository/
signing/packages/staging/bundle/proof checkout removed. One empty task, zero
prompts and no keyboard access.

Earlier installed source `adbd10a`, release
`04ea52b98e1081f56db0405fc7eec69e7030b3c8094c22245828629ab1046008`,
passes six update/fourteen actual OSV source and Supply Chain checks. Fresh exact
public package/version queries, original collection freshness, separate operator
trust, authenticated failed unknown-severity findings, incomplete clean comparison,
two independently verified scanner exits, replay, retirement and full restoration
pass. Receipts `assignment-legends-1793866214773.json` and
`installed-shield-baseline-1793866400136.json` retained; owned source/signing/
packages/staging/bundle/proof checkout removed. One empty task, zero prompts;
no keyboard access. See the [source contract and limits](osv-advisory-source.md).

Earlier installed source `03710e9`, release
`043592fe7c3987cb7b161ce047fb3c2e8b41e5b0da0b717937c50904018efdd8`,
passes six update/eighteen actual inventory, generated-tree policy and ignored-
secret scan checks. The 80 MiB tree stays present during scanning; generated
churn preserves policy and root replacement refuses another admission. Two
scanner exits, all preview probes, exact replay/feed retirement and full
restoration pass. Receipts `assignment-legends-1793864731589.json` and
`installed-shield-baseline-1793864938308.json` retained; all owned source/signing/
sparse build/packages/staging/bundle/proof checkout removed. One empty task,
zero prompts.

Earlier installed source `bfb7f1d`, release
`ed8745bae60c75c3b82487eaf2cc6e9300a1b0988e6df1ad99bc6a5701d9fa25`,
passes six update and sixteen actual inventory/ignored-secret scan checks. The
preview groups an 80 MiB sparse build fixture, exposes no source bytes, creates
no grant or receipt, and leaves prior maintenance evidence unchanged. Every
preview probe exits before separate exact scan review; two scanner exits and
original-state restoration pass. Receipts `assignment-legends-1793863080369.json`
and `installed-shield-baseline-1793863236319.json` retained; all owned source/
signing/package/staging/bundle/proof checkout removed. One empty task, zero prompts.
The earlier failed verifier and exact cleanup are retained separately.

Earlier installed source `7dc9196`, release
`413aaebca22a4f4336af2202481386376802dd390f524d660708823839297014`,
passes six update and fourteen actual workspace Supply Chain API checks. Known
vulnerable and clean versions retain non-passing report-bound BOMs, exact replay,
feed retirement, two verified native exits and full restoration. Receipts
`assignment-legends-1793862128657.json` and
`installed-shield-baseline-1793862282934.json` retained; owned repository/signing/
package/staging/bundle/proof checkout removed. One empty task, zero prompts.

Earlier installed source `6a45643`, release
`3772efc151709ab0069527753a3f9c33c50b1706455ea60e1b5aaa3a86f1df07`,
passes six update and three actual cached F77 source-capability API checks.
No HID transactions or control authority; original state is preserved, and owned
bundle/proof checkout removed. Receipts `assignment-legends-1793861120925.json`
and `installed-haptic-source-1793861121084.json` retained; zero prompts.

Earlier installed source `0f04adc`, release
`1d8c3ce421672a4516b86cf8fe18d286a3b60e2f0e070f5b1acc49c9dd0ce25c`,
passes six update and seventeen actual exception API checks with the receipt-time
local authority guard. Raw findings, exact exception expiry/withdrawal/replay,
three native exits, original-state restoration and owned scratch removal pass.
Receipts `assignment-legends-1793860291500.json` and
`installed-shield-baseline-1793860601561.json` retained; zero prompts.

Earlier installed `0423f23` passes six normal update checks after the outcome/
budget correction (`assignment-legends-1793859695968.json`); owned bundle and
proof checkout removed.

Installed source `82bd9b3`, release
`4175121a117a6cdbb72eac3e685158e01b9d0b594b53a1493853ea896677ec96`,
passes six normal update and seventeen actual exception/Change Scan API checks.
A protected failed finding gets one exact audited approval; a real repeat scan
retains raw findings and authenticates the exception while remaining incomplete.
Withdrawal, original expiry, duplicate handling, prior-receipt retirement, three
native exits and full original-state restoration pass. Receipts
`assignment-legends-1793859246213.json` and
`installed-shield-baseline-1793859581132.json` retained; owned source/packages/
signing/staging/bundle/proof checkout removed. One empty task, zero prompts.

Earlier installed `1a5cd43` passes six update/sixteen ignored-secret/expiry checks:
`assignment-legends-1793857942421.json`,
`installed-shield-baseline-1793858153322.json`; owned scratch removed.

Earlier installed `9f3024e` passes six update/fourteen expiry/retirement checks:
`assignment-legends-1793857471815.json`,
`installed-shield-baseline-1793857655461.json`; owned scratch removed.

Earlier installed `0cd785f` passes six update/thirteen deadline checks:
`assignment-legends-1793856754649.json`,
`installed-shield-baseline-1793856930607.json`; owned scratch removed.

Earlier installed `9a73479`, release
`af1b58752f76e021e2a790a8052a0439407dce9b548fd0a462d32bbf399959c8`,
passes six update and eleven actual Supply Chain checks after the shared strict
parser/Windows source integration (`assignment-legends-1793855902184.json`,
`installed-shield-baseline-1793856071289.json`); owned scratch removed.
The frontend remains frozen; no Windows guest is claimed by these Linux proofs.

Earlier installed `8e83371` passes its separate six update/eleven Supply Chain
checks (`assignment-legends-1793854523011.json`,
`installed-shield-baseline-1793854727077.json`); owned scratch is removed.

Earlier installed `b6dca0a` exercises all four Shield actions and a clean case
through thirteen actual checks. `326a9f3` passes eleven narrower checks, including
refusal of exact engine bytes under a Node-option filename before execution.
`50dd23d` passes ten actual bounded writable-copy Run/stop checks. Their separate
receipts and cleanup facts remain in verification and history; no model prompts.

## Backend capabilities

The task-bound [index byte witness](git-index-inputs.md) now verifies selected
staged blobs against original Git object identities and SHA-256 without returning
source, granting authority or claiming a scan. Four isolated groups pass all 25
checks, including task/account/index/HEAD drift and real Linux guardian exits.
Installed witness acceptance passes at `4a6627a`. A separate
[explicit Linux staged scan](staged-shield-inputs.md) now connects the reader to
private disposable copies, preserves both staged/worktree provenance and
authenticates its index witness. Six focused cases, four isolated groups/26
scanner and exception checks, four groups/37 task/runner/stager checks and eight
groups/fourteen ordinary host scanner checks pass; every child cleanup verifies.
Index drift during preparation removes owned copies and starts no scanner.
Installed Linux staged-scan acceptance passes at `11d8cc7`; Windows index staging
remains unfinished.


| Area | Implemented behavior and evidence | Practical limit |
| --- | --- | --- |
| Linux execution | Exact task grants, reviews, checkpoints, budgets, native guardians and replay. Run and both pipelines use read-only snapshots or explicitly approved writable copies sharing a 64 MiB overlay/temporary filesystem quota. Actual build, ENOSPC, input preservation and stop/exit checks pass. [Contract](bounded-build-workspace.md). | Filesystem bound, not a process-memory claim. Generated files are ephemeral; no new artifact write-back. |
| Windows execution | Run and both pipelines connect exact catalogs, the protected LocalSystem storage broker, reviewed operator setup, result/ownership validation and non-upgrading recovery. [Storage](windows-storage-broker.md), [pipelines](windows-pipelines.md). | Complete interactive app/guest/UAC journey remains unaccepted; the latest service-removal correction still needs native verification. |
| Shield baseline | Fixed heuristic scanner, signed public rule/advisory inputs, exact npm advisories/licenses, redacted findings and non-passing coverage. All four Linux actions pass actual namespace checks. The new Windows connection passes task/Git/crypto/receipt/recovery software checks with an explicit guest double. [Linux/shared scanner](shield-baseline-scanner.md), [Windows](windows-shield.md). | Full repository/ignored-secret/history scope, broader ecosystems, publisher provenance and automatic scope inventory remain unfinished. No baseline result passes complete Shield. |
| SBOM | Supply Chain/Release produce CycloneDX 1.6 inventories, exact lockfile hashes, stable component references and real npm alias names. Four generated examples conform to the official schema; temporary validation tooling is removed. [Example and limits](evidence/README.md). | Workspace links unsupported; scope and dependency graph/provenance explicitly unverified. |
| Signed feeds | Operator-selected public trust, exact package approvals, AEAD journals, guarded receipts, 64 MiB/32-allocation aggregate reservations and separately reviewed exact removal. Unknown/revoked allocations retain quota; unfamiliar contents and original uncertain outcomes remain preserved. [Contract](signed-fixtures.md). | Provenance alone never establishes scanner coverage or a security result. |
| Native agents | Exact account/directory/session bindings, reviewed text, cancellation, uncertain-outcome recovery and owned command guardians. Claude 2.1.308/2.1.317 designer/text approval binds the exact version; actual 2.1.317 metadata passes without prompts. [Bindings](claude-task-bindings.md). | Current-version real model execution remains unaccepted. Claude Code is only an implementation contingency; no coding job was delegated. |
| Direct terminal focus | Foot/Alacritty fixed ancestry, current user, foreground CLI, PID birth/TTY/group checks and one exact compositor window with readback. Hidden/unmapped sibling windows refuse focus. Thirty-two surrounding cases pass (31 passed, one declared skip); five package checks and type checking pass. | Alacritty is absent, so its native check remains unaccepted. Tabbed/multiplexed, IDE, stopped-task and Windows attachments remain unfinished. No terminal or desktop config is installed. |

Signed feed facts now expire at the earliest content, signed freshness-SLA or
trust deadline. Nineteen real registry/HMAC checks cover each source and exact
boundaries; 36 contract/package and 19 controller/pipeline/Windows Shield
integration checks pass, with type checking. Normal installed deadline acceptance
passes at `0cd785f`. [Contract](signed-fixtures.md).

The new Windows Shield source connects separate policy/recovery/evidence CI
jobs. Its shared report parser refuses changed request/feed/source identities,
findings, counts, gaps and BOM completeness. Fifteen focused negative attestation
cases pass. Windows policy/recovery and the actual Linux scanner pass five cases
in three independently exited groups; every child cleanup verifies. Existing
Run/authority files pass 35, pipeline/evidence five and final package/inventory/
evidence 27. These tests do not launch a VM, create an account or touch a keyboard.

Version 2 feed maintenance reviews include prior validation-receipt invalidation.
Both execution hosts bind policy at review/admission and protect receipt commit
against policy drift; status separates historical outcomes from invalidation and
expiry. [Contract](validation-receipt-invalidation.md). Thirty-five core/package cases, ten final package/recovery cases, four existing
feed-bound pipeline cases, both receipt-race cases, twenty maintenance/Shield
cases, fifteen Run/recovery/output cases and type checking pass. Normal installed retirement acceptance passes at `9f3024e` (six update/fourteen
API checks; zero prompts and owned scratch removed).

Explicit ignored inputs are now restricted to pinned Shield actions at grant and
execution admission. Five focused authority/Linux/Windows guest-double cases pass:
redacted findings from an ignored `.env`, unchanged original bytes/index and later
source-drift refusal. Whole-repository/automatic ignored-secret/history inventory
is still unfinished. [Contract](ignored-scanner-inputs.md). Normal installed ignored-input acceptance passes at `1a5cd43` (six update/sixteen
actual checks). Six existing pipeline/race regressions also pass.

Reviewed expiring exceptions now connect exact current protected findings to
Personal-only one-use operator approvals, atomic audit/budget/receipt retirement,
immutable raw reports and separately authenticated decisions on both hosts.
Twenty-nine core/HTTP/inventory checks and two host journeys pass. All findings
excepted stays incomplete; withdrawal restores failure on the next scan.
A later outcome correction settles verified policy rollback as failed/not-started
and recovers only an exact committed receipt/effect after lost acknowledgement;
thirteen controller/ledger cases pass, including late-budget rollback. [Contract](shield-exceptions.md). Normal installed exception acceptance passes at `82bd9b3` (six update/seventeen
API checks). Native Windows remains separate; frontend controls are unfinished.

Both execution hosts now verify the exact protected task/account/mode and grant
ledger at validation receipt commit. Three focused state/host cases pass,
including post-validation account change and grant revocation, with independent
zero native exits and no replay. Six existing pipeline/policy races and twenty-nine
contract/maintenance cases pass; type checking passes. Installed acceptance passes at `0f04adc` (six update/seventeen actual API checks).
Native Windows remains separate. [Contract](receipt-authority-commit.md).

Device identification now reports source-only haptic declarations for two audited
F77 builds. UID, complete definition, protocol and revision must match; live
state, fitted hardware and electrical/timing limits remain unverified, with no
allowed operations. Seven capability/catalog cases, twenty-five inventory/readout contracts and
twenty-three package/Suite checks pass, including zero-HID, protected typing
controls and cross-compartment checks. [Audit](solenoid-capability-audit.md). Normal installed `6a45643` passes six update/three cached-readout checks without
HID transactions; runtime control is still unfinished.

The npm lock inventory now includes strict root-contained workspace metadata and
aliases without reading local source directories or running lifecycle scripts.
Twelve scanner cases and six real-Linux/Windows-guest-double integration cases
pass. The regenerated seven-component development BOM passes the official schema;
source bytes, graph, whole-repository scope and provenance remain unverified.
[Contract and regeneration](shield-baseline-scanner.md).

A new task-bound [scanner input preview](scanner-input-inventory.md) lists
tracked/new paths, relevant ignored secret-file names and grouped build trees.
It hashes no source bytes, grants no authority and remains incomplete; unknown
ignored paths/build-tree contents stay uninspected. Four focused parser/real-Git/
HTTP/drift/cleanup cases and thirty-four surrounding contracts pass, with type
checking. Normal installed `bfb7f1d` passes six update/sixteen inventory/scan checks. Consequential snapshot
limits and separate scanner reviews remain unchanged.

An explicit [ignored generated-tree policy](ignored-build-tree-policy.md) now
binds named whole ignored directories to Shield-only authority using distinct
directory-policy fingerprints. Selected secret bytes remain exact; excluded
contents are uninspected. Three policy/filesystem, three authority and two actual
Linux/Windows-guest-double execution cases pass; ten surrounding input checks,
thirty-one authority/runner/package cases and type checking pass. Normal installed `03710e9` passes six update/eighteen real checks; native Windows
policy acceptance remains pending.

The [OSV source collector](osv-advisory-source.md) now normalizes exact stable npm
queries through a fixed bounded public transport, with full pagination, independent
affected-version checks and public response hashes. Severity remains unassessed;
matched vulnerabilities fail with an explicit gap. Five collector cases, two
real-Linux/Windows-guest-double host journeys and surrounding package/attestation
checks pass; the four-group isolated source subset passes 21 checks. The real
CLI collects two public versions without source files or credentials; owned
scratch is removed. Installed `adbd10a` passes six update/fourteen source and
scan checks with two verified scanner exits, full restoration and owned scratch
removed; zero prompts.

## Complete and native checkpoints

Immutable `3cb0897` passes all 200 required Linux groups: 1,207 tests,
1,197 passed and ten declared skips. Receipt
`isolated-test-1d343e79-2220-4a01-85e4-2ff4a5f5cf78.json` is retained with every
child cleanup verified; owned fixture parent and checkout are removed. It covers
connected exceptions, receipt-time authority, cached source-only haptic facts and
workspace lock inventory, metadata preview and all eight independent Windows
scenarios on the Linux host. Later generated-tree exclusions and OSV integration
are verified separately. Earlier `18e6185` passes 192 groups (1,187 passed/ten
skips), receipt `isolated-test-2ff9aeb6-bbc7-471c-9a6b-c50aea14fe8a.json`. Earlier `6a45643` passes 191 groups (1,182 passed/ten skips),
receipt `isolated-test-b0474209-3e04-4603-8ef6-441f439fb5d6.json`.
The later workspace inventory separately passes fourteen checks in two isolated
groups (`isolated-test-54ad40b5-a325-4130-9d63-93d5e307d1d6.json`), with child cleanup. Earlier `ace2d22` passes
185 groups (1,166 passed/ten skips), receipt
`isolated-test-3f42aecd-3967-4c0c-bda3-67b9b7d268ef.json`, with owned scratch removed.
The earlier `82bd9b3` complete checkpoint remains retained: 188 groups,
1,175 passed/ten skips, receipt `isolated-test-028adfa5-e6df-40ae-8931-85c79fd9c6ab.json`.

The GitHub Linux release run at `6a45643` [failed](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41982439206)
when Ubuntu 24.04's Bubblewrap refused `--overlay-src`; its failed result is
retained. CI now builds upstream 0.13.1 from the official SHA-256-pinned archive
on its disposable worker, preserving the fixed path, scoped AppArmor policy,
namespace restrictions and unchanged bounded-build tests. Source checksum
verification passes locally. Later run [41984665699](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41984665699)
builds the pinned helper and passes the outer namespace probe, but the actual
two-level build fails with a namespace permission refusal. The distribution
profile denies capabilities to every bwrap child; nested trusted setup needs
further scoped integration. CI now adds one exact `/usr/bin/bwrap` inheritance
rule only to the trusted setup profile. Ordinary children retain the capability-
denying stack and the final sandbox disables user namespaces; native acceptance
is pending. Both failures remain failed. No sysctl, workstation profile or test
assertion is changed; bounded kernel diagnostics are retained on the next failure. No host
package, executable, policy or sysctl was changed on this workstation.

Native Windows `5d398d2`, workflow
[41960677205](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41960677205),
passes all sixteen jobs. The six pipeline contract cases have verified archive
digests and child cleanup. Guest execution is explicitly doubled. Registry,
maintenance/removal and the 34-case backend contract also pass at their recorded
sources. Newer `6a45643` passes eight digest-verified contract groups: 23 tests passed and
three platform skips, with child cleanup. These cover exceptions, ignored inputs,
receipt-time authority and policy invalidation; the guest is doubled. Its full
filesystem workflow fails service-removal configuration readback, and Shield
policy/stop files hit their 300-second group deadlines. All three failures are
retained. Five Shield and three stop scenarios now run independently under their
original child deadlines, with a complete closed selection check. Nineteen runner/
selector cases and all eight isolated scenarios pass locally; native rerun is
pending. Removal adds only bounded fixed phase labels; both C# targets compile
without warnings and 112 portable checks pass with the existing SDK.
[Exact artifact evidence](evidence/windows6a-validation-summary.json).

Later service-removal failures remain failed. The `238592b` receipt identifies
`service-absence-query-configuration`. The correction preserves Win32 errors,
allows only recognized deletion-pending metadata during bounded polling and
still requires a fresh OpenService error 1060 before file removal. Both actual
C# targets compile warning-free and 112 portable checks pass using the existing
SDK; fresh native lifecycle acceptance remains pending. Stopped SCM PIDs are not
used as exit proof; the original captured process handle is.

## F77 and remaining acceptance

The F77 passes guarded read-only discovery and full definition/keymap/macro/
settings readout: VIA 9, Vial 4, three 8 × 11 layers and pinned `wcass:f77`
source definition. Installed readout at `e1a1f30` matches the independent 90-query
capture. Source identity does not authenticate hardware or select a physical case.
No unlock, configuration write, reset, flash or electrical command was sent.

The frozen UI still needs owner visual review and remaining omakase/role/device
controls. Remaining software also includes full Shield scope/coverage and exact
additional client/IDE attachments. Continue independently executable requirements.

Actual Windows Sandbox/UAC, approved Microsoft tenant/account behavior, microphone
UI and device/focus checks need their exact environments. No work laptop or tenant
is probed. Alacritty is not installed. F77 typing/hotplug and separately authorized
physical transactions, B122 hardware/all 27 physical gates, print/cap fit and
independent assessment remain unaccepted. No public release, merge, licensing
change or firmware operation is authorized by these checkpoints.

Keep source and small JSON receipts, remove successful scratch and publish regular
GitHub checkpoints. Preserve the Dvorak/Omarchy setup and frozen frontend.
Detailed history: [5](switchyard-status-history-5.md), [4](switchyard-status-history-4.md),
[3](switchyard-status-history-3.md), [2](switchyard-status-history-2.md),
[1](switchyard-status-history-1.md).

Complete immutable Linux `adbd10a` now passes all 205 required groups: 1,212
passed tests and ten declared skips, every child cleanup verified. Receipt
`isolated-test-c4c0c525-33d5-4ed8-9ebf-8784cee9e487.json` retained; owned fixture
parent and detached checkout removed. Later index work is separately tested.

Later immutable `4a6627a` retains a failed 207-group checkpoint: 206 groups and
1,223 tests pass, one deadline-inventory guard fails and ten declared skips.
Receipt `isolated-test-72711a93-699d-4602-b263-91b5055f79e7.json` stays failed.
The guard now declares exactly the new group bounds and passes in the 37-check
subset; no deadlines or assertions were waived. Every child cleanup verifies,
and failed-checkpoint owned fixtures/checkout are removed with separate cleanup
receipt `failed-full-index-inventory-cleanup-1793868621389.json`. Later immutable `11d8cc7` passes the complete
208-group checkpoint: 1,231 tests pass and ten declared skips. Every child
cleanup verifies; receipt `isolated-test-10ea941c-1736-4c0a-8e11-c83a4bd24a3d.json`
retained, owned fixtures and checkout removed. Later immutable `112efdc` passes
all 211 required groups, 1,246 tests and ten declared skips with child cleanup
and owned fixtures/checkout removed (`isolated-test-be48daaa-a8c9-4e7d-9772-9977e8201458.json`).
Native Windows acceptance remains separate.

The [Windows index transport foundation](windows-index-staging.md) now builds
with zero warnings/errors and passes 49 new portable parser/hash/boundary checks
alongside all 112 previous checks, using the existing offline SDK. Four isolated
JS transport/runner/selector/package groups pass all 27 checks; child cleanup and
type checking pass. Owned build scratch is removed. The 320 KiB raw subset keeps
the original complete 512 KiB stdin bound. The Windows host connection is now
implemented and passes five isolated groups/52 focused checks plus ten ordinary
scanner/pipeline/Run/input/package groups/29 checks, with every child cleanup
verified. Review and staging bind fresh Git bytes and packet/witness digests;
late validation precedes guest preparation. Actual NTFS packet staging has an
independent CI verifier before service lifecycle checks, with a scoped receipt
and native fault injection; acceptance remains pending. Native Windows guest,
interactive and installed acceptance remain separate unaccepted checks.

The Windows reviewed historical scanner connection now passes six isolated
groups/57 checks with child cleanup, including real Git bytes for both Codebase
Audit and Release Shield, private consumption before tools/storage/guest, late
refusal cleanup, exact provenance, replay and unchanged original inputs. Its
normal host/runner/receipt connection is implemented; native NTFS, guest and
installed Windows acceptance remain pending, separate from the software contract.
[Contract](windows-history-staging.md).

The closed [installed inspector](inspect-cli.md) now exposes bound task metadata
and existing inventory/index/history readers without authority, prompts, scans or
endpoint disclosure. Ten CLI/gateway/privacy tests and three isolated groups/32
checks pass with child cleanup and type checking; the stable-launcher installed
journey is implemented with acceptance pending. UI remains frozen.

The first installed inspector at `44221bf` remains failed because an omitted
compartment used the API Personal default. Native grants/scans had not started;
all eleven query exits, original-state restoration and exact synthetic fixture/
trust/source/signing/packages/staging/proof-checkout cleanup verify. The source
fix reads and explicitly binds the selected workspace, rejects changed selection
before output and passes non-Personal real API/Git coverage in the 50-check
inspector/history/index/Suite subset. Corrected installed acceptance is pending.
[Contract and retained outcomes](inspect-cli.md).
