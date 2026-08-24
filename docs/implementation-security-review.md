# Post-PR #4 implementation structural and security review

**Scope:** local companion, local IPC, Git/filesystem/test/sandbox brokers, VS
Code companion client, and package manifests on this branch.

| Dimension | Result | Evidence / corrective action |
| --- | --- | --- |
| Security | No unresolved material finding | IPC is token-authenticated and local-socket only; command execution uses argument vectors rather than a shell; filesystem paths resolve against canonical allowlists; review approvals bind action and snapshot. The review found a potential missing-path/symlink containment gap and corrected it by resolving the nearest existing ancestor before the allowlist check. |
| Correctness | No unresolved material finding | Tests exercise stale target rejection, duplicate dispatch, temporary Git state, denied review, denied production-like test configuration, IPC token rejection, and sandbox release. Restarted sessions deliberately downgrade from `running` to `stale`. |
| Reliability | No unresolved material finding | Protected receipts remain atomic/hash-chained; IPC removes a stale Unix socket on start/stop; sessions persist as conservative stale records. |
| Maintainability | Acceptable | The concrete local adapters are isolated in `local-runtime.ts`; setup, limitations, and exact residuals are documented. |

The review does not convert unavailable proprietary-provider, physical HID,
live-GitHub, cloud credential, scanner-feed, VM/container, or end-user Windows
acceptance into passed evidence. Those boundaries remain explicitly unavailable
or activation-gated.
