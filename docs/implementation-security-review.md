# Post-PR #5 implementation structural and security review

> **Historical point-in-time record:** this review records the PR #5/follow-up
> branch boundary. Later hardware-independent adapter, sandbox, transport,
> provisioning, and release work is documented in
> [`software-only-completion-audit.md`](software-only-completion-audit.md).
> “No unresolved material finding” below applies only to that reviewed revision
> and is not a current production or acceptance claim.

> **Correction:** the original review said there was no unresolved material
> finding. The final adversarial audit found an asynchronous review-approval
> bypass, incomplete dirty/untracked snapshot manifests, staged-diff Shield
> blind spot, ambient-environment inheritance in the local test runner, and a
> truncated VS Code control picker. These are corrected in the follow-up audit
> branch; the remaining explicit residuals are still not acceptance evidence.

**Scope:** local companion, local IPC, Git/filesystem/test/sandbox brokers, VS
Code companion client, and package manifests on this branch.

| Dimension | Result | Evidence / corrective action |
| --- | --- | --- |
| Security | Corrected material findings; residuals remain | IPC is token-authenticated and local-socket only; command execution uses argument vectors rather than a shell; filesystem paths resolve against canonical allowlists; review approvals bind action and snapshot. The corrected review awaits the stale check before validating approval, excludes ambient credential-like environment values from local test recipes, and scans staged as well as unstaged diffs. |
| Correctness | Corrected material findings; residuals remain | Tests exercise stale target rejection for clean, dirty, and untracked content; duplicate dispatch; denied review; denied production-like test configuration; IPC token rejection; full manifest delivery; and sandbox release. Restarted sessions deliberately downgrade from `running` to `stale`. |
| Reliability | No unresolved material finding | Protected receipts remain atomic/hash-chained; IPC removes a stale Unix socket on start/stop; sessions persist as conservative stale records. |
| Maintainability | Acceptable | The concrete local adapters are isolated in `local-runtime.ts`; setup, limitations, and exact residuals are documented. |

The review does not convert unavailable proprietary-provider, physical HID,
live-GitHub, cloud credential, scanner-feed, VM/container, or end-user Windows
acceptance into passed evidence. Those boundaries remain explicitly unavailable
or activation-gated.
