# What has actually been verified

Switchyard is a partial implementation of the full Rev2 suite. The F77 is its
pilot device. Software checks, installed Linux demonstrations, native Windows
filesystem tests and physical/account acceptance are separate evidence.

| Path | Accepted evidence | Practical limit |
| --- | --- | --- |
| Studio Windows Run and exact stop | Eleven policy/admission/stop/recovery cases pass through the normal platform factory, using real task grants, Git inspection, encrypted checkpoints, budgets and distinct receipts. A separate 41-check platform/package group passes, including the existing actual Linux host broker. | The Windows runner in these policy tests is an explicit double. Actual supported-host VM startup/login/worker/stop is not demonstrated. Personal-host privileged setup remains unfinished software. [Contract](windows-reviewed-run.md). |
| Complete Linux runner checkpoint | `6e82937`: 158/158 groups, 1,034 tests, 1,024 passed and ten declared skips. Receipt `0b7c5d8e-711c-417a-ba9b-8e2cb7896ba8`; every child cleanup verified and disposable worktree removed. GitHub Linux release and client lanes also pass. | Predates the new Studio Windows admission route. Its focused checks are separate above. |
| Native Windows filesystem and mapping | All 30 native checks pass at `9cfb922`, workflow [41904474050](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41904474050): exact inputs, embedded worker/pinned Node links, fixed image, host-owned writable handoff, kernel disk-full, exact detach and bounded mapping validation/refusals. Archive digest verified; only `windows-runner-9cfb-native.json` retained. | The workflow opens only new synthetic files/volumes on its disposable Windows worker. No VM, account or keyboard is opened. |
| Windows host runner and cancellation | Combined inventory/runner/manifest/lock/privacy checks pass 57/57 locally. Ten orchestration cases cover cross-process preparation/execution fences, durable cancellation, native exit checks, non-replay and separate storage retirement. Windows short workflow also passes at `6e82937`, including its real kernel probes and runner doubles. | Native services/VM are explicit doubles in orchestration cases; native filesystem acceptance is the row above. |
| Current installed Linux application | Normal installed `f5dd3be` passes ten actual Run checks: one empty native Codex task, zero prompts, denied host files/credentials/network, read-only inputs, 64 MiB temporary storage, terminal and exact-stop receipts, duplicate refusal, fresh Run and three independently exited guardians. Six update checks preserve the frozen frontend, definitions, modes and private link. | Source has advanced since this installed checkpoint. Windows-specific source tests do not establish Windows desktop or physical-device acceptance. Receipts `installed-repository-execution-1793816998155.json` and `assignment-legends-1793816639962.json`. |
| Complete Windows worker/runtime checkpoint | `72c5f96`, workflow [41883054390](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41883054390): 261/261 groups, 1,738 tests, 1,690 passed and 48 declared skips. Digest-verified receipt `d2b0aa0e-67a1-4f55-bf55-d21daf5fab91` retained. | Predates image/volume ownership and the Studio Windows adapter. Newer full Windows release checks remain in CI. |

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
