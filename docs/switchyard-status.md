# Switchyard implementation and acceptance

Switchyard remains a partial implementation of the full October 29 Rev2 handover.
The F77 is the connected pilot, not a scope limit. The [requirement ledger](switchyard-requirements.md)
separates unfinished software from checks requiring an exact device, account or
host. [Verification](verification.md) retains accepted and failed checkpoints.

## Installed application

Installed source `9a73479`, release
`af1b58752f76e021e2a790a8052a0439407dce9b548fd0a462d32bbf399959c8`,
passes six update and eleven actual Supply Chain API checks after the shared
strict report parser/Windows source integration. Known-vulnerable and clean
incomplete versions retain report-bound BOMs, exact failed/incomplete receipts,
replay, two independent native exits and restored original state. Receipts
`assignment-legends-1793855902184.json` and
`installed-shield-baseline-1793856071289.json` retained; owned source/packages/
staging/signing/bundle/proof checkout removed. One empty task, zero prompts.
The frontend remains frozen; no native Windows guest is claimed by this Linux proof.

Earlier installed `8e83371` passes its separate six update/eleven Supply Chain
checks (`assignment-legends-1793854523011.json`,
`installed-shield-baseline-1793854727077.json`); owned scratch is removed.

Earlier installed `b6dca0a` exercises all four Shield actions and a clean case
through thirteen actual checks. `326a9f3` passes eleven narrower checks, including
refusal of exact engine bytes under a Node-option filename before execution.
`50dd23d` passes ten actual bounded writable-copy Run/stop checks. Their separate
receipts and cleanup facts remain in verification and history; no model prompts.

## Backend capabilities

| Area | Implemented behavior and evidence | Practical limit |
| --- | --- | --- |
| Linux execution | Exact task grants, reviews, checkpoints, budgets, native guardians and replay. Run and both pipelines use read-only snapshots or explicitly approved writable copies sharing a 64 MiB overlay/temporary filesystem quota. Actual build, ENOSPC, input preservation and stop/exit checks pass. [Contract](bounded-build-workspace.md). | Filesystem bound, not a process-memory claim. Generated files are ephemeral; no new artifact write-back. |
| Windows execution | Run and both pipelines connect exact catalogs, the protected LocalSystem storage broker, reviewed operator setup, result/ownership validation and non-upgrading recovery. [Storage](windows-storage-broker.md), [pipelines](windows-pipelines.md). | Complete interactive app/guest/UAC journey remains unaccepted; the latest service-removal correction still needs native verification. |
| Shield baseline | Fixed heuristic scanner, signed public rule/advisory inputs, exact npm advisories/licenses, redacted findings and non-passing coverage. All four Linux actions pass actual namespace checks. The new Windows connection passes task/Git/crypto/receipt/recovery software checks with an explicit guest double. [Linux/shared scanner](shield-baseline-scanner.md), [Windows](windows-shield.md). | Full repository/ignored-secret/history scope, broader ecosystems, publisher provenance and audited expiring exceptions remain unfinished. No baseline result passes complete Shield. |
| SBOM | Supply Chain/Release produce CycloneDX 1.6 inventories, exact lockfile hashes, stable component references and real npm alias names. Four generated examples conform to the official schema; temporary validation tooling is removed. [Example and limits](evidence/README.md). | Workspace links unsupported; scope and dependency graph/provenance explicitly unverified. |
| Signed feeds | Operator-selected public trust, exact package approvals, AEAD journals, guarded receipts, 64 MiB/32-allocation aggregate reservations and separately reviewed exact removal. Unknown/revoked allocations retain quota; unfamiliar contents and original uncertain outcomes remain preserved. [Contract](signed-fixtures.md). | Provenance alone never establishes scanner coverage or a security result. |
| Native agents | Exact account/directory/session bindings, reviewed text, cancellation, uncertain-outcome recovery and owned command guardians. Claude 2.1.308/2.1.317 designer/text approval binds the exact version; actual 2.1.317 metadata passes without prompts. [Bindings](claude-task-bindings.md). | Current-version real model execution remains unaccepted. Claude Code is only an implementation contingency; no coding job was delegated. |
| Direct terminal focus | Foot/Alacritty fixed ancestry, current user, foreground CLI, PID birth/TTY/group checks and one exact compositor window with readback. Hidden/unmapped sibling windows refuse focus. Thirty-two surrounding cases pass (31 passed, one declared skip); five package checks and type checking pass. | Alacritty is absent, so its native check remains unaccepted. Tabbed/multiplexed, IDE, stopped-task and Windows attachments remain unfinished. No terminal or desktop config is installed. |

Signed feed facts now expire at the earliest content, signed freshness-SLA or
trust deadline. Nineteen real registry/HMAC checks cover each source and exact
boundaries; 36 contract/package and 19 controller/pipeline/Windows Shield
integration checks pass, with type checking. The later deadline correction has
pending installed acceptance. [Contract](signed-fixtures.md).

The new Windows Shield source connects separate policy/recovery/evidence CI
jobs. Its shared report parser refuses changed request/feed/source identities,
findings, counts, gaps and BOM completeness. Fifteen focused negative attestation
cases pass. Windows policy/recovery and the actual Linux scanner pass five cases
in three independently exited groups; every child cleanup verifies. Existing
Run/authority files pass 35, pipeline/evidence five and final package/inventory/
evidence 27. These tests do not launch a VM, create an account or touch a keyboard.

## Complete and native checkpoints

Immutable `8e83371` passes all 177 required Linux groups: 1,153 tests,
1,143 passed and ten declared skips. Receipt
`e62a9f97-1739-46e2-ace5-c806b79262da` is retained with every child cleanup
verified; owned fixture parent and checkout are removed. It includes bounded
builds, baseline Shield, entrypoint closure, direct-terminal checks and CycloneDX.
The newer Windows Shield source has 180 Linux groups; its complete run is pending.

Native Windows `5d398d2`, workflow
[41960677205](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41960677205),
passes all sixteen jobs. The six pipeline contract cases have verified archive
digests and child cleanup. Guest execution is explicitly doubled. Registry,
maintenance/removal and the 34-case backend contract also pass at their recorded
sources. Current native CI remains queued; no newer pass is inferred.

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
