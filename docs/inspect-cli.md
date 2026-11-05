# Inspect a bound task without running it

The installed inspector makes the existing task-bound Git readers available from
the terminal. Use it to see which inputs were observed, compare staged and current
versions, or identify a historical version without printing its source. It creates
no task, grant, prompt, scanner run or keyboard transaction.

Start Switchyard normally, select the intended Personal workspace and bind a
native coding task through the existing task workflow. Then list that workspace's
bound task IDs:

```sh
switchyard inspect tasks
switchyard inspect tasks --provider claude-code
```

The default provider is Codex. The explicit Claude command only lists saved
metadata; it does not invoke a model or delegate implementation. Empty output
does not trigger task creation or a provider login. Account fingerprints, native
runtime secrets and conversation contents are omitted.

Choose the exact returned ID and inspect its inputs:

```sh
switchyard inspect inventory --task TASK_UUID
switchyard inspect index --task TASK_UUID -- src/app.js
switchyard inspect history --task TASK_UUID --depth 4 -- src/app.js
```

Replace `TASK_UUID` with the bound task ID. Paths after `--` are literal repository
paths; quote a path containing spaces in the shell. Index selection permits 1–64
paths. History permits 1–8 paths and a first-parent depth of 1–6, default four.
The [inventory](scanner-input-inventory.md), [index](git-index-inputs.md) and
[history](git-history-inputs.md) contracts describe their exact bounds and gaps.
`switchyard inspect --help` works without opening the application.

Output is JSON metadata. Inventory returns names and recommendations without
reading source contents. Index/history witness selected bytes but return only
identities, sizes and hashes. History verifies raw commit parents, reconstructed
trees and selected blob objects; it omits messages and author details. Every
observation retains incomplete scope, `sourceBytesReturned:false`,
`scanPerformed:false`, `authorityGranted:false` and `gateEligible:false`. A successful
command is not a security scan or a passing Shield gate. The separately reviewed
[historical scanner](historical-shield-inputs.md) is a different operation.

The client reads the private saved endpoint and uses the existing mutually signed
instance challenge before disclosing its bearer token. Only fixed local POST
routes are available; no URL, arbitrary command, compartment switch, launch or
execution option exists. It rejects redirects, changed endpoints, unavailable
owners, invalid metadata, source-return claims and responses over 1 MiB. It
rechecks the authenticated instance before printing and never prints its access
URL or token. Work restrictions and task/account/root checks remain server-side.
If the application is not running, the inspector refuses without launching it.

Ten CLI/HTTP/privacy/boundary tests and three isolated inspector/package/runner
groups pass all 32 checks with child cleanup
(`isolated-test-d308577e-bb57-494c-b66d-8f69d890b1ef.json`). The normal CLI uses the
actual signed local gateway and Git-backed task APIs in an owned software fixture;
it preserves original index/worktree/HEAD and creates no authority or execution
journal entries. Native guardian identity is doubled in that fixture; separate
reader tests and installed proofs cover actual guardians. A replacement listener
never receives the bearer; a verified redirect never reaches its second destination.
Native Windows selects the same contract group without claiming account/device
or NTFS/guest acceptance. Type checking passes.

The installed synthetic verifier can exercise all four commands through the
normal stable launcher with:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_codebase_audit --history-inputs --inspect-cli
```

It creates one empty native task in an owned repository, observes and independently
settles each command's query guardians, then separately performs the existing
current-file scanner review. It submits no model prompt and opens no keyboard.
Installed CLI acceptance is pending.
