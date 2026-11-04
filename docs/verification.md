# What has actually been verified

Switchyard is an integrated development suite. The F77 is its pilot device;
passing software checks does not establish physical or enterprise acceptance.
Use this page for the current evidence, the [requirement ledger](switchyard-requirements.md)
for coverage, and the [continuation record](switchyard-status.md) for details.

| Path | Accepted evidence | Practical limit |
| --- | --- | --- |
| Bounded Windows backend mapping | Trusted native volume capability, both consumer leases, exact binding receipts, unchanged generic directory rules and native-owner-only retirement are connected in the backend and isolation wrapper. Backend/worker/installation/lifecycle/release checks pass 43/44 with one declared platform skip; type checking passes. | Explicit volume/VM doubles, no actual VM launch. The Studio Windows Run adapter and privileged personal-host setup remain unfinished. [Contract](windows-reviewed-guest-mapping.md). |
| Native Windows mapping admission | Original private image/mount identities, footer, attached VHD, exact volume GUID/extent/capacity and closed configuration are pinned through startup. Fifty focused checks, four packaged-import checks, type checking and a zero-warning/error helper build pass; six Linux native guards pass. Scratch removed, receipt `windows-bounded-mapping-build-20261104.json`. | Native read-only validation and substitution/detached refusals are pending CI. Guest startup and the Studio Windows Run adapter remain separate. |
| Writable Windows host lifecycle | `a8690328`: native filesystem workflow [41896980735](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41896980735) passes storage fault tests and actual host-service creation, one-time handoff, consumer fencing and changed-body cleanup. Local ownership/suite/runner checks pass 53/53. | No VM or workstation disk was opened. Guest mapping integration, privileged setup and Studio Run remain unfinished. |
| Complete Windows worker/runtime checkpoint | `72c5f96`, [run 41883054390](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41883054390): 261/261 groups, 1,738 tests, 1,690 passed and 48 declared skips. Archive SHA-256 verified; only receipt `d2b0aa0e-67a1-4f55-bf55-d21daf5fab91` retained. | Predates image/volume ownership. Native filesystem and interactive Sandbox checks are separate. |
| Native Windows volume transition | Exact attach/inspect/detach code builds without warnings/errors; six Linux mode guards and four packaged-import checks pass. Original image/folder identities, exact extent/capacity, private ACLs and fresh detached state are required. Build scratch removed; receipt `windows-bounded-volume-build-20261104.json`. | Actual native attach, kernel disk-full and detach pass all 23 checks at `f4c0f9a`, run 41892941320; digest-verified receipt `windows-volume-f4c0f9a-native.json` retained. No local disk was attached. Guest mapping, privileged setup and Studio Run remain unfinished. |
| Integrated image ownership checkpoint | `e589c4f`: 156/156 Linux groups, 1,004 tests, 994 passed and ten declared skips; receipt `71ff7517-e62b-4fbc-87c6-be7aa3d3deac`, with child cleanup verified and checkout removed. Actual native filesystem/owned-image service [run 41889645807](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41889645807) passes all 19 checks. | Detached image/command/consumer boundaries only; predates the new native volume transition. |
| Detached Windows image ownership | Eight fault cases and the combined 43-case ownership/snapshot/runner check pass; four packaged-import checks and type checking pass. Real descriptor hashing, exact identities, protected readiness, one-image quota, no replay, consumer/command exit fences and late/lost-state recovery are exercised. | Explicit native/VHD doubles with sparse owned files. The actual host-service Windows journey is now in CI, pending. Writable volume handoff/mount/disk-full/detach and Studio Run remain unfinished. |
| Corrected native Windows image boundary | `899c78e`, [run 41887718377](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41887718377), passes all 16 actual native filesystem checks. The small archive was downloaded and digest-verified; only `windows-filesystem-899c78e-native.json` was retained. | Creates and inspects detached images only; no volume mount, VM, account or HID. The initial `332aa8a` and diagnostic `f5dd3be` image failures remain failures, with the UUID byte-order comparison subsequently corrected. |
| Current installed Linux execution | Normal installed `f5dd3be` passes all ten Run checks with one actual empty native Codex task and zero prompts: isolated output, reviewed exact stop, duplicate prevention, fresh Run, three independently exited guardians, cleanup and restored workspace state. Receipt `installed-repository-execution-1793816998155.json`. Six normal update checks preserve the complete frozen frontend, definitions, modes and private link; receipt `assignment-legends-1793816639962.json`. | Current/rollback occupy about 12 MiB; package staging was removed. This does not establish Windows guest or physical keyboard acceptance. |
| First native worker/Node/image lane | `332aa8a` passes 11 actual Windows input, embedded-worker and Node identity/version/sharing/cleanup checks. Its small receipt was downloaded and digest-verified. | The overall job failed at the image's native header validation; `windows-filesystem-332aa8a-failed.json` remains failed. Closed diagnostics and a separate read-only image inspector are implemented; native rerun pending. Five Linux mode guards and 16 staging/package cases pass with a zero-warning/error build. |
| Fixed Windows exchange image format | Fourteen actual compiled construction/corruption checks pass. Independent `fsck.fat -n -v` accepts the generated FAT16 partition, with unchanged hash. Helper build has zero warnings/errors; native-only modes refuse Linux. Scratch removed; source/assembly hashes in `windows-bounded-image-build-20261104.json`. | Windows VHD metadata, creation and immutable inspection pass the 16-check 899c78e native lane; the newer host ownership service has separate pending native acceptance. This creates a detached image only: ownership, mount/exit/recovery, disk-full validation and the Studio Windows adapter remain unfinished. [Contract](windows-bounded-exchange.md). |
| Complete corrected Windows release | `c5059dd`, [run 41872535770](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41872535770): 259/259 groups, 1,720 tests, 1,672 passed and 48 declared skips. Backend, native inputs/guardians, fresh optional runtime, suite packaging and full release verification pass. Both bounded archives were downloaded and digest-verified; only JSON receipts were retained, including `c4e345be-cb3f-4188-8542-3ce9fbc63ec3` and seven native input/metadata checks. | Predates the new managed coordinator and worker/Node/image changes. Interactive VM/account/HID acceptance remains separate. |
| Complete embedded-worker Linux checkpoint | `d20e4c9` passes 155/155 groups: 993 tests, 983 passed and ten declared platform skips. Receipt `8afbd215-43f8-4da9-befb-7f767829de83`; all child cleanup verified and disposable checkout removed. | Subsequent Node/image changes have separate focused evidence. GitHub Linux release and client-platform lanes also pass at `72c5f96`. |
| Windows recipe Node staging | 47 focused worker/runtime/input/snapshot/runner cases pass; updated C# build has zero warnings/errors and three Linux mode guards pass. Exact runtime identity/hash, forbidden overrides, changed/aliased inputs and interrupted two-link cleanup are covered. Scratch removed; receipt `windows-node-tools-build-20261104.json`. | Native Windows version, sharing and hard-link acceptance is pending CI. The host supplies the fixed runtime; the Studio adapter and bounded writable exchange remain unfinished. [Contract](windows-guest-tools.md). |
| Embedded Windows guest worker | 44 tool/input/snapshot/runner cases and six actual compiled entry/guard checks pass; helper build has zero warnings/errors. Same-assembly worker, fixed native mode and private one-file hard-link staging are implemented. Build/probe scratch removed; hashes retained in `windows-embedded-worker-build-20261104.json`. | Actual NTFS hard-link and renamed-entry checks are now in native Windows CI, pending. No VM, account or keyboard was opened. Recipe runtime staging, bounded writable exchange and Studio Windows Run remain unfinished. [Contract](windows-guest-tools.md). |
| Corrected complete Linux source | `e9dd9ae`: 154/154 groups; 988 tests, 978 passed and ten declared skips. Receipt `0dfaddc5-3caf-4538-8ff4-3d4d563f6ad8`; all child cleanup verified and disposable checkout removed. | Includes the corrected authenticated application-stop ESRCH/ENOENT race. Subsequent worker staging has its own focused evidence above. |
| Reviewed task execution API | Actual installed `0aeae75` passes ten checks with one empty native Codex task, zero prompts, denied host files/credentials/network, terminal receipt, exact stop and its distinct receipt, duplicates, a fresh Run afterward, three independently exited guardians, cleanup and restored state. Receipt `installed-repository-execution-1793810385256.json`. Complete local `0aeae75` passes 152/152 groups: 973 tests, 963 passed, ten declared platform skips; receipt `ca301375-e244-4718-b78a-4b514094d07d`. Ubuntu release CI at `0aeae75` passes. | Frontend remains frozen. Windows stop admission was corrected to one atomic encrypted transaction after a pre-effect deadline failure; native backend acceptance passes at `dbe62bb`. Windows guest execution, writable outputs and other action connections remain unfinished. [Contract](reviewed-task-execution.md). |
| Native Windows reviewed inputs | Four software staging boundaries, shared input validation, release closure and zero-warning/error C# build pass. Linux invocation refuses the Windows-only mode before filesystem effects; build receipt `windows-reviewed-inputs-build-20261104.json`. | Six actual NTFS sharing, DACL readback, junction, identity and cleanup checks pass at `dbe62bb`, run 41866977914; the small artifact was SHA-256 verified and imported as `windows-reviewed-inputs-dbe62bb-native.json`. Thirty-three mapping/staging/installation cases pass; exact guest IDs are persisted before recipe acknowledgement and unknown VM exit preserves inputs/exchange. The staging lease grants no runtime protections; seven managed lifecycle cases and five compiled worker-parser checks pass; the Studio Windows adapter, worker/tool staging and bounded writable exchange remain unfinished. Six fixed native command-transport faults and zero-warning/error C# build pass; its no-VM native metadata acceptance is pending. [Input contract](reviewed-execution-inputs.md). |
| Integrated Linux source | 147/147 groups; 944 tests, 934 passed and ten declared platform skips, including the native Windows metadata probe. Receipt `11e1038b-73dd-4bdf-9493-549a792fb586`. | Synthetic boundary checks plus native Linux subprocesses; Windows cases are separate. |
| Installed configuration designer | Seven checks: two validated native replies in the same conversation, distinct independently stopped guardians, protected account/ownership records, authentication, keyboard-only cleanup and preserved definitions. | Synthetic supplied context only; tools/hooks/MCP disabled, untrusted proposals independently checked. No keyboard mutation or coding-task completion claim. |
| Installed host lock indicators | Four checks: authenticated route, independent Linux kernel readback, rejection without credentials and preserved workspace state. | No physical keyboard association or LED change; Windows reports only its calling-thread toggle snapshot. |
| Consented matrix backend | Ten fault tests plus six installed rejection checks: explicit one-use consent, policy, physical unlock, scope, capture bounds, stop, late responses and relock. | No HID opened by the installed demonstration. Physical typing/unlock/relock acceptance and frontend controls remain open. |
| Original 0.9 controller | Seven direct protocol tests and 82 focused device/configuration checks: expansion readout, rotating keymap, strict framing, persistent key setter, recovery and protection of calibration/expansion keycodes. | Fault transports backed by the pinned vendor source; no physical legacy controller or solenoid acceptance. Expansion control remains unavailable. |
| Task authority boundary | Eight real-repository scenarios and seven installed checks with an actual empty native Codex task. Eight retained native guardian identities independently verified exited; zero model prompts. | Native permissions remain unchanged. Authority is separate from the exact local commit approval; task UI controls remain unfinished. |
| Companion repository effects | Twenty-one actual Git scenarios cover exact binary blobs/modes, private indexes, expected-HEAD transactions, repository-script suppression and descriptor-bound ownership. Six suite tests include a native Linux commit through durable policy, checkpoints, budgets and operations. | Native Windows acceptance of the updated descriptor/ownership paths remains pending. Unknown or different files fail closed. |
| Normal installed reviewed commit | Seven checks at `713f439`: actual empty native task/account/root binding, two separate approvals, exact binary bytes and author, unowned-edit preservation, reconciled index, same operation/receipt on replay, read-only recovery observation, and restored selection/keyboard-only mode. All 38 Git guardians and eight retained inspection guardians independently verified stopped. Receipt `installed-repository-commit-1793784076954.json`. | One new disposable repository only; no model prompt, coding-task completion, push or merge. Successful staging removed; native empty-task history retained. Recovery application remains unfinished. |
| Repository metadata recovery | Eight source cases include a native post-reference failure: one commit, exact index reconciliation, independent guardian exit, unchanged original receipts, scoped saga/budget settlement, stop/deadline checks and retained unfamiliar files. | Normal installed recovery at `5aa4713` passed eight checks with an actual empty Codex task and a source-only post-reference fault. All 36 Git guardians and 13 retained inspection guardians independently verified exit; zero prompts. Receipt `installed-repository-recovery-1793787873360.json`. Complete native Windows acceptance remains pending. Separate operator approval and receipt cover owned metadata only; no reference replay or worktree restoration. Controls remain API-only. |
| Distinct client launch recipes | Exact documented provider/target boundaries, authenticated HTTP gates and eight ownership/lifecycle faults pass. Five real Python/Gio private-bus cases cover acceptance/cancel/reject, early Response and Close on shutdown; receipt `client-portal-private-bus-1793789449865.json`. | Normal installed Linux request at `1ecffbb` passed six checks with one actual fixed GitHub Copilot homepage request, successful OpenURI Response, independently stopped helper, duplicate/scope rejection and restored keyboard-only validation state. Receipt `installed-client-launch-1793789674617.json`. Browser/account/session control is not inferred. Windows request transport is implemented with exact target witnesses and no script-policy override; native WinRT metadata and 41 platform checks pass at `ea96ffe` ([run 41820186124](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41820186124)), with its bounded artifact downloaded and digest-verified. Interactive Windows URI/account/window acceptance remains pending. Exact native client binding and frontend controls remain unfinished. |
| Normal installed Codex task | Seven checks rerun after the shared recovery changes: one reviewed native reply, exact turn acknowledgement, durable duplicates, replay rejection and keyboard-only cleanup. | Read-only/restricted text task; provider completion is not verified coding-task completion. |
| Normal installed Claude task | Thirteen checks: exact creation/continuation, three separately reviewed prompts, distinct recorded/stopped guardians and explicit resume-only recovery after a synthetic lost-acceptance fault. | Original account and UUID retained; no tools or invented native turn IDs. This fault injection is not a claimed physical crash. |
| Native Claude command supervision | Eight real metadata checks verified nine distinct guardians exited, including shared designer/task probes. Installed empty-task creation stayed observable, then passed separately reviewed exact stop and replay rejection under the new supervision. The 13-check installed text journey passed again after the shared-probe change. | Metadata/empty-task checks send no model prompt; text regression sends three tiny approved prompts. No account fallback or external-session stop; native background-service ownership remains distinct from the CLI guardian. |
| Native Windows release tests | [250 complete test/build groups at PR head `cda0327`](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41807554404): 1,657 tests, 1,615 passed and 42 reviewed skips. Receipt `6fa0410b-85ba-4dd5-a7f9-69b7b112767f`; bounded artifact `13313323640` downloaded and SHA-256 verified. | Includes the corrected startup race, authority-group bound, descriptor replacement and complete packaged release. Newer retained-ownership/recovery application changes still await their own complete native Windows result. Interactive accounts, microphone and HID remain separate. |
| Fresh native Windows optional runtime | [Acceptance at `222dfca`](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41097396455): Python 3.12.14, 49 exact distributions, no extras, offline CPU model load, independent same-release recheck and disposable-runtime removal. Bounded artifact `12998575101` was downloaded and its digest verified. | No Windows microphone, configuration HID or signed-in native agent was exercised by this job. |
| Canonical B122 print kit | All six PDF pages and 22 actual-scale SVG inserts rendered and inspected; 27 documentation tests pass. Literal source faces/flaps and clip cuts, reproducible output, 4.75 pt minimum text. | Printer calibration, cap fit, final branded artwork and physical commissioning remain open. |
| Other installed pilot paths | Actual local CPU speech, authenticated Node/Python SDK exchanges, scoped Omarchy callback/restoration, profile migration and managed application/runtime lifecycle checks. | Each path has its own scope in the ledger; an SDK acknowledgement is self-reported. |

Earlier Windows runs exposed skip-inventory, checkout line-ending and generated
text/manifest failures. Those were software failures and were corrected before
the complete `2e64ff6` run passed. A masked or partial earlier step is not
retroactively accepted. The latest task-authority work has its own pending full
source/native acceptance; the Windows checkpoint above predates it. The later `0bf079b` Windows backend
run rejected one bundled-example startup race before release packaging. The
mode decision now invalidates pending starts synchronously, and its test holds
shutdown open deterministically. Full corrected Windows acceptance remains
pending. The next `8ced95d` run passed the backend, native helper, documentation, fresh optional runtime and suite packaging, then rejected two final-lane checks: the authority group's old 45-second timeout and a Linux-only assumption about renaming a directory with an open child file. Authority now has an explicit four-minute native Windows group budget; the filesystem test verifies either native prevention with original bytes intact or detection of an actual replacement. Complete corrected Windows acceptance remains pending. These are software checks, not hardware/account blockers.

## Follow a result into the code

1. Start the [keyboard/workflow experience](../README.md#try-the-starting-experience).
   A reference preset is useful offline; actual readout establishes typing evidence.
2. Follow the [native task journey](native-coding-tasks.md) to see how account,
   directory, exact native identity, approval and duplicate prevention work together.
3. Inspect the [device transaction contract](device-configuration-contract.md)
   and [runtime lifecycle](runtime-lifecycle.md) for partial failures and recovery.
4. Read the [custom-agent contract and examples](../integrations/README.md) before
   adding another integration. Discovery, observation, focus and execution are
   different capabilities.

The standard source checks use the pinned runtime:

```sh
mise exec node@24.14.0 -- npm test
mise exec node@24.14.0 -- npm run typecheck
```

Documentation verification uses the pinned
[Python dependencies](../scripts/b122-docs-requirements.txt), with Node 24 also on
the process path. Native account journeys are explicit synthetic checks: the
Codex script sends one tiny prompt; the Claude script sends three and injects a
fault only into its own validation task. Read their usage headers before running
them. Private pilot receipts retain the detailed local evidence; access links,
account details, session IDs and recovery snapshots stay outside Git.

## Work still required

Unfinished implementation includes the accumulated frontend controls, broader
terminal/client attachment and provider lifecycle containment, execution-authority
integration and remaining controller controls. The frontend is frozen for review;
its served hash has been verified, but current browser visual acceptance is open.

Device discovery again returned zero configuration interfaces at 2026-11-04T09:24:06Z. F77/B122 typing,
unlock, hot-plug and hardware transaction acceptance need their actual devices.
Approved Microsoft tenant tests, interactive Windows account/window tests,
microphone capture and physical print fit also remain separate. No flash/reset,
bootloader operation, solenoid change, public release or employer approval is
established by these results.

Client-role integration passes all 147 Linux groups (947 tests: 937 passed, ten
declared platform skips), receipt `1b505309-6e94-421c-bdac-0de08b075a38`, plus type
checking. Five bounded client groups pass 46/47 with the declared native Windows
metadata skip, receipt `f0d42bbb-0858-4b23-9ae0-bcc08b1409c0`. Six physical-gateway
cases cover authenticated role dispatch, actual HTTP/CLI invocation correlation,
content/session injection, scoped duplicates, pre-acknowledgement/late rebinding,
and active Work routing. Native client responses in those tests are fixtures.

The changed Windows hotkey C# sources compile in an isolated directory. The
actual sender method sent two authenticated closed role requests with distinct
UUIDs and matching acknowledgement events on Linux/.NET 8.0.30; receipt
`native-hotkey-dispatch-20261104-034142.json`. Its first build invocation included
old generated files after moving the intermediate directory; copying only the
three exact tracked source/project files corrected the verification setup. All
temporary build/probe files were removed. Interactive Windows hotkey/URI/account
acceptance remains unverified.

Normal installed source `15cd19b` passed six update checks with the exact frozen
frontend/private link preserved (assignment-legends-1793792770918.json), followed
by seven client role checks (installed-client-launch-1793792795748.json). One real
GitHub Copilot homepage request entered through a temporary workflow role and the
actual CLI physical-intent gateway, with exact invocation/receipt correlation,
no duplicate helper, zero prompts and independently verified native exit. The
validation definitions/selection/mode were restored; its successful launch record
and bundle staging were removed. Current plus one rollback remain about 11 MiB.
No physical keyboard event, visual/account acceptance or frontend review is
inferred.

Published role source `15cd19b` also passed all 47 tests in five native Windows
client groups, run [41823579833](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41823579833),
job 126552524573, receipt `9097bbd9-ec2b-4dc3-ae9d-8619c6fc4993`. The tested merge
commit f4c37b25af49dd6ac2df4e2872d4fe19e5205388 has the exact same tree
03359ee3c81ba75993a09f921e96e182948d4c06. Artifact 13317249676 (1,424-byte ZIP)
was downloaded in memory and verified against SHA-256
`385df68b68c02154927599498a1c170cde37a532d47540e5b994adeacd9e10f4`; only the
private complete JSON receipt was retained. No interactive Windows keyboard,
URI, account or window acceptance is inferred.

Reviewed disposable inputs pass 19 focused Linux/runtime checks and type
checking, including changed bytes/sizes, unselected credentials, unsafe paths,
symlinked source directories/files, elapsed staging deadlines and replacement
directory preservation. The real Linux Bubblewrap proof passed three checks
again after deadline enforcement (repository-inputs-native-1793793697536.json).
Only one exact synthetic file was staged; host home, host `/etc/passwd`,
unselected credentials, ambient credential variables and a live host loopback
listener were inaccessible. Original synthetic files were unchanged and all
staging was removed. This accepts the Linux input/namespace boundary, not the
remaining Studio execution connection, Windows guest staging or output quotas.

Final reviewed-input source passes all 147 Linux groups: 950 tests, 940 passed,
ten declared platform skips, zero failed/cancelled/todo; receipt
`99c53747-2954-4709-ba97-b646bf07d43f`. Type checking and all 19 focused
Linux/runtime tests pass. Six bounded client/runtime groups also pass 59/60 with
the declared native Windows metadata skip (a26dfada-d1e3-47ef-bcda-697ee43f2c58).
The previous complete Linux run passed before adding the explicit negative
staging-deadline case; the final run above accepts that additional change.

Fresh installed device enumeration returned zero configuration interfaces
(device-enumeration-1793793796030.json). It opened no HID device and wrote no
keyboard configuration. F77/B122 physical checks remain unavailable, separate
from unfinished general execution, Windows guest input staging and frontend
implementation.

Installed source `7012333` passed six normal update checks
(assignment-legends-1793793990974.json), preserving the exact frozen frontend,
private link, definitions and modes. The package is 468 files/4,417,965 bytes;
current plus rollback remain about 11 MiB and bundle staging is empty. The new
Linux companion input provider was exercised through its explicit source/native
proof; the Studio general execution route remains unfinished.

Current source `7012333` passes all 60 tests in six native Windows boundary groups,
run [41826311362](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41826311362),
job 126561818571, receipt `c04c5387-af12-480c-87f3-84015b127275`. The tested merge
7074fdf93fd1f26c6c32c9e49973f8fc3630f40e has the exact source tree
8a1a6cabd02cdaad84ae846a7daa384cc3356008. Artifact 13319542094 (1,573 bytes) was
downloaded in memory and verified against SHA-256
`96da326f683a19a586a7f69cd3fd0501461dec175849f5204586cd4978706be5`. Only its
private JSON receipt remains. This accepts portable reviewed-input parsing and
client/role/native metadata boundaries; Windows guest staging, interactive
hotkeys, URI/account/window behavior and the complete newer Windows bundle
remain separate. The complete release at 38eb56d (run 41823818569) has passed
backend/native helper/owner-loss/optional-runtime/package steps and remains in
complete bundle verification; its source predates the reviewed-input change.
