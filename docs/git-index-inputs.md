# Witness selected Git index bytes

A clean-looking working file can differ from the version staged in Git. The
authenticated `coding/authority/index-inputs` endpoint reads explicitly selected
index blobs for one verified native task in the active Personal compartment.
It returns paths, modes, object identities, byte lengths and SHA-256 hashes;
it never returns the source text, grants authority or issues a security receipt.

```json
{"taskId":"BOUND_TASK_UUID","paths":["src/app.ts","package-lock.json"]}
```

The host runs fixed [NUL-delimited index queries](https://git-scm.com/docs/git-ls-files)
and derives the object identifiers itself. Only these hexadecimal identifiers
reach the bounded stdin of [Git's blob batch reader](https://git-scm.com/docs/git-cat-file).
Callers cannot supply revisions, object IDs, commands, filters or paths outside
the repository. Stage-zero regular blobs are required; selected links, submodules,
missing paths, unmerged metadata and platform aliases are refused.

The reader checks each raw blob against its SHA-1 or SHA-256 Git object identity
and computes a separate SHA-256. It compares the whole listed index and HEAD
before/after, rechecks the task/account/repository binding, and independently
settles every native guardian before removing owned scratch. Global/system Git
configuration, fsmonitor, replacement objects, interactive credentials and network
protocols are disabled. [Lazy object fetching](https://git-scm.com/docs/git) is
disabled too; unavailable local objects do not trigger a network fallback.
Repository configuration and object metadata are still consulted.

The initial subset permits 1–64 literal paths, 4,096 index entries, 256 KiB per
blob and 448 KiB of selected content. Metadata and native output have independent
bounds. Queries retain ten-second deadlines inside the existing 45-second
inspection budget. The current shared native text transport refuses non-UTF-8
blobs rather than changing their bytes. NUL characters inside valid UTF-8 blobs
are supported. Borrowed byte buffers are cleared after use, including failures.

This is byte witnessing, not scanning. The response explicitly retains
`scanPerformed:false`, `authorityGranted:false`, `gateEligible:false` and
`completeness:"incomplete"`. Selected entries need not differ from HEAD. Working
files, new files, history and full repository scope remain outside this operation;
an index change after the response requires another observation. Connecting these
blobs to reviewed scanner staging on both execution hosts remains unfinished.

Four parser/hash/boundary cases and authenticated task/HTTP, five drift scenarios
and real Linux guardian checks pass. The real journey witnesses staged bytes
different from a clean worktree, preserves the original index and verifies every
guardian exit; invalid UTF-8 safely refuses. Twenty-five surrounding input and
authority tests, twenty-four runner/selection/package checks and type checking
pass. Four isolated groups pass all 25 checks with child cleanup
(`isolated-test-ae93b9fc-ed7d-42a2-b210-af874c191b08.json`). The first isolated
run retained a failed fixture teardown (`isolated-test-6ac353a1-4e8d-4b57-8251-b338a3d044a0.json`);
cleanup now stops ingress and shared owners sequentially before removing their
root. The failed outcome remains failed; the isolated runner verified child
cleanup in both runs. The Windows real-Git contract uses doubled guardians and explicitly skips
the separate Linux-native guardian test; native Windows acceptance is separate.

The installed synthetic verifier supports:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_change_scan --index-inputs
```

It adds a staged synthetic file with different worktree bytes, calls the bound
read-only API, independently verifies all six probe exits and unchanged index,
then performs the separately reviewed existing worktree scan. This does not claim
the staged file was scanned. Installed acceptance remains pending.
