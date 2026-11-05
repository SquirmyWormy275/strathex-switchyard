# Switchyard implementation and acceptance

Switchyard remains a partial implementation of the full October 29 Rev2 handover.
The F77 is the connected pilot, not a scope limit. The [requirement ledger](switchyard-requirements.md)
separates unfinished software from checks requiring an exact device, account or
host. [Verification](verification.md) retains accepted and failed checkpoints.

## Installed application

Latest installed source `4a6627a`, release
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
Installed staged-scan acceptance and Windows index staging remain unfinished.


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
