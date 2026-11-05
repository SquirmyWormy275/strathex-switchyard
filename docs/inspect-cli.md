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

The client resolves the active workspace through a separate read-only status
route, explicitly sends that workspace with every observation, and checks it
again before printing. It refuses saved selection drift rather than using the
API Personal default. Status reads trigger no provider discovery or workspace
switching.

The client reads the private saved endpoint and uses the existing mutually signed
instance challenge before disclosing its bearer token. Only fixed local POST
routes are available; no URL, arbitrary command, compartment switch, launch or
execution option exists. It rejects redirects, changed endpoints, unavailable
owners, invalid metadata, source-return claims and responses over 1 MiB. It
rechecks the authenticated instance before printing and never prints its access
URL or token. Work restrictions and task/account/root checks remain server-side.
If the application is not running, the inspector refuses without launching it.

The original ten CLI/HTTP/privacy/boundary tests and three isolated inspector/package/runner
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
The first installed `44221bf` journey retains failed receipt
`installed-shield-baseline-1793876624890.json`: the client omitted its compartment,
so the API used Personal and returned an empty task list instead of the selected
synthetic workspace. No grant or scanner had started. Eleven query exits and
full restoration passed. Exact synthetic fixture/trust retirement and owned
source/signing/packages/staging/proof-checkout removal verify in
`failed-inspect-scope-proof-cleanup-1793877136442.json`; the failure remains failed.
The source correction resolves and pins the actual selected workspace, refuses
mid-request changes and tests real Git/API reads in a non-Personal workspace.
Four isolated inspector/history/index/Suite groups pass 50 checks with child
cleanup (`isolated-test-06aa9e22-f57f-4464-98d0-85d44973f003.json`); corrected
installed acceptance is pending. A subsequent edge-test prototype expected cache
drift refusal before priming that cache; it remains failed in
`isolated-test-25d4150d-a893-40c2-95df-7f92c39431b1.json`. The corrected edge first
observes the active workspace, then changes the saved selection and requires
refusal without changing either selection. The subsequent inspector/package
subset passes all 16 checks with child cleanup
(`isolated-test-2becc2ff-4f23-4c3a-97da-3ad7c3d20fd8.json`), including the
primed-cache, unauthenticated-status and forbidden-selection-input cases.
