# What has actually been verified

Switchyard is a partial implementation of the full Rev2 suite. The F77 is its
pilot device. Software checks, installed Linux demonstrations, native Windows
filesystem tests and physical/account acceptance are separate evidence.

| Path | Accepted evidence | Practical limit |
| --- | --- | --- |
| Normal Windows task-authority entry | The normal suite factory now advertises `run_target` on Linux and Windows and passes its platform to the execution factory. A route-level check issues a real separately approved Run grant through that factory, rejects another action/approval and rejects Work routing. Authority/suite/physical-intent files pass 33/33 locally. | Native identity and VM ports remain explicit doubles in this entry check. Windows CI rerun is pending. The earlier native client startup rerun passed at `1a0fa33`, workflow `41916179119`. |
| Windows Run prerequisite observation | Thirty transport/session/runner contracts pass locally, including unavailable-before-staging, exact reservation/non-replay and malformed observation refusal. Native helper builds with zero warnings/errors; six Linux guards and type checking pass. Build scratch removed; `windows-storage-preflight-build-20261104.json` retained. | Actual Windows token query is pending native CI. It uses query-only access and checks unchanged privilege bytes. Normal-user privileged setup/broker is still unfinished; no setup, elevation or VM acceptance is inferred. |
| Verified Windows output status | Thirteen policy/stop/output cases pass using actual grants, encrypted ledgers, descriptor reads and explicit guest doubles. Combined policy/inventory/backend/package group passes 66/66. All four native Windows policy jobs pass at `cdd86cb`, workflow [41914612230](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41914612230). Changed files/substituted roots cannot replace the original outcome; stdout/stderr are redacted and signed exit codes survive replay. | Guest execution is explicitly doubled. The first whole-file lane hit its time bound; verified failed receipt `windows-policy-63cb-failed.json` retained with cleanup. No test or production deadline was waived. |
| Windows workspace startup without Run tools | Eleven host-runner contracts and the complete suite/physical-intent files pass 35/35 locally. Empty recovery does not pin or start an optional helper; retained Run/guest/native-command ownership still requires native reconciliation. | Fixes the missing-helper failure in Windows client workflow `41914612132`; native client rerun remains pending. |
| Windows failure diagnostics | Backend/helper/installation/lifecycle/release group passes 46/47 with one declared platform skip. Four actual compiled formatter cases preserve success/failure shapes and signed exit codes; warning-free helper build, six Linux mode guards and type checking pass. Scratch removed; receipt `windows-failure-results-build-20261104.json`. | Explicit guest/volume doubles in backend checks. Failed results retain only verified bounded stdout/stderr after exact VM exit, stay failed and cannot become successful artifacts. Native VM/Job acceptance remains separate. |
| Studio Windows Run and exact stop | Eleven policy/admission/stop/recovery cases pass through the normal platform factory, using real task grants, Git inspection, encrypted checkpoints, budgets and distinct receipts. A separate 41-check platform/package group passes, including the existing actual Linux host broker. | The Windows runner in these policy tests is an explicit double. Actual supported-host VM startup/login/worker/stop is not demonstrated. Personal-host privileged setup remains unfinished software. [Contract](windows-reviewed-run.md). |
| Complete Linux runner checkpoint | `45e9eb6`: 159/159 groups, 1,045 tests, 1,035 passed and ten declared skips. Receipt `3424729b-c961-45aa-ad4d-f3c5359a5982`; every child cleanup verified and disposable worktree removed. GitHub Linux release and client lanes also pass. | Includes the Studio Windows admission and stop route. Subsequent failed-program diagnostics have separate focused evidence above. |
| Native Windows filesystem and mapping | All 30 native checks pass at `9cfb922`, workflow [41904474050](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41904474050): exact inputs, embedded worker/pinned Node links, fixed image, host-owned writable handoff, kernel disk-full, exact detach and bounded mapping validation/refusals. Archive digest verified; only `windows-runner-9cfb-native.json` retained. | The workflow opens only new synthetic files/volumes on its disposable Windows worker. No VM, account or keyboard is opened. |
| Windows host runner and cancellation | Combined inventory/runner/manifest/lock/privacy checks pass 57/57 locally. Ten orchestration cases cover cross-process preparation/execution fences, durable cancellation, native exit checks, non-replay and separate storage retirement. Windows short workflow also passes at `6e82937`, including its real kernel probes and runner doubles. | Native services/VM are explicit doubles in orchestration cases; native filesystem acceptance is the row above. |
| Current installed Linux application | Normal installed `45e9eb6` passes ten actual Run checks: one empty native Codex task, zero prompts, denied host files/credentials/network, read-only inputs, 64 MiB temporary storage, terminal and exact-stop receipts, duplicate refusal, fresh Run and three independently exited guardians. Six update checks preserve the frozen frontend, definitions, modes and private link. | Current/rollback occupy about 12 MiB, and bundle staging was removed. Windows-specific source tests do not establish Windows desktop or physical-device acceptance. Receipts `installed-repository-execution-1793824944140.json` and `assignment-legends-1793824727363.json`. |
| Complete Windows worker/runtime checkpoint | `72c5f96`, workflow [41883054390](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41883054390): 261/261 groups, 1,738 tests, 1,690 passed and 48 declared skips. Digest-verified receipt `d2b0aa0e-67a1-4f55-bf55-d21daf5fab91` retained. | Predates image/volume ownership and the Studio Windows adapter. Newer full Windows release checks remain in CI. |

The four passing Windows policy artifacts were digest-verified and imported as
`windows-policy-cdd-{policy,recovery,stop,output}.json`; every child cleanup
verified. They contain thirteen distinct policy cases and the repeated inventory
contract, with no platform skips.

The Windows platform factory now connects separately reviewed Run and exact-stop
requests to the shared policy, checkpoint, budget and receipt ledgers. General
workspace snapshots omit execution records. A recorded stop receipt can recover
a lost final write; independent exit alone cannot turn an unrecorded stop into a
passing result. Program exit never marks a provider's coding task complete.

The frontend remains frozen for review. No browser reload, firmware operation,
workstation mount change or account/tenant session is part of these backend
checks. F77/B122 physical typing, configuration unlock, hotplug and print-fit
acceptance remain open. The B122 acceptance gates remain **NOT ACCEPTED**.
Supported interactive Windows Sandbox, approved Microsoft tenant/account and
microphone checks remain separate. Privileged Windows setup, broader action
connections and remaining device/attachment controls are unfinished software.

Follow the [requirement ledger](switchyard-requirements.md) for suite coverage,
the [continuation record](switchyard-status.md) for current work, and the
[checkpoint archive](verification-checkpoints.md) for earlier accepted and failed
runs. Small private JSON receipts are retained; disposable checkouts, archives
and build scratch are removed after independent child cleanup verifies.

For the defined Linux source lane, use `runVerification({ groups: linuxGroups })`
from [the isolated runner](../scripts/run-isolated-tests.mjs). The complete
`requiredGroups` inventory includes Windows-specific cases and is not the Linux
acceptance lane. The explicit inventory refuses missing, stale or silently
skipped tests.
