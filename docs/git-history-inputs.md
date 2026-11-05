# Witness selected Git history bytes

A secret removed from a working file can remain in earlier commits. The authenticated
`coding/authority/history-inputs` endpoint witnesses explicitly selected paths in
bounded first-parent history for one verified native task in the active Personal
compartment. It returns object identities, sizes and hashes, never source text,
author identities, email addresses or commit messages. This operation grants no
authority, performs no scan and issues no security receipt.

```json
{"taskId":"BOUND_TASK_UUID","paths":["src/app.js"],"depth":4}
```

Only 1–8 literal repository paths and a depth of 1–6 are accepted. Callers cannot
provide revisions, commands, object IDs or filters. The host derives commits from
[Git's first-parent traversal](https://git-scm.com/docs/git-rev-list), obtains raw
commit bytes through the fixed [batch reader](https://git-scm.com/docs/git-cat-file),
and verifies their Git object hashes and actual parent headers. A traversal that
contradicts those immutable headers is refused.

For each selected commit, the host obtains the entire bounded recursive
[NUL-delimited tree listing](https://git-scm.com/docs/git-ls-tree). It reconstructs
all listed binary tree objects and checks their Git hashes against the commit's
actual tree identity and parent tree entries. Source bytes are fetched only for
selected regular blobs; duplicate blob objects are read once. Every selected blob
must match its original SHA-1 or SHA-256 Git identity and a separate SHA-256 hash.
Missing/deleted versions remain explicit; renames are not followed. Selected links,
submodules, directories and ambiguous paths are refused.

The initial bounds are 4,096 tree entries and 256 KiB of tree metadata per commit,
32 KiB per commit/128 KiB total raw commit bytes, 256 KiB per selected blob and
448 KiB of distinct blob content. Unsupported non-UTF-8 transport refuses rather
than replacing bytes. Git replacement objects, lazy fetching, interactive
credentials and network protocols are disabled. Repository configuration and
metadata are still consulted. HEAD, shallow state, task/account/root identity and
native ownership are rechecked; each query has at most ten seconds inside the
original 45-second aggregate inspection budget. Every owned guardian must exit
before scratch removal.

The response retains `scanPerformed:false`, `sourceBytesReturned:false`,
`authorityGranted:false`, `gateEligible:false` and `completeness:"incomplete"`.
Depth/shallow boundaries, other refs, non-first-parent branches, messages, renames,
index/worktree and unverified repository scope are explicit gaps. Historical
scanner integration remains unfinished; successful byte witnessing is not a
historical security scan.

Four parser/hash/boundary tests and eight task/HTTP/native checks pass. They cover
actual removed historical source, full-tree hash reconstruction, duplicate blobs,
shallow/depth boundaries, account/HEAD/tree substitution and the exact original
deadline. Eleven real Linux guardians independently exit without changing the
original index, working file or HEAD. Four isolated history/index/runner groups
pass all 38 checks with child cleanup
(`isolated-test-e5445075-0749-41a5-a947-13458f79eab7.json`). Windows CI selects both
history groups; its real-Git software contract doubles guardians and explicitly
skips the separate Linux-native check. Native Windows acceptance is separate.

The installed synthetic verifier now supports:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_codebase_audit --history-inputs
```

It creates and then removes a synthetic secret in committed history, verifies
metadata and all query exits, and separately reviews the existing current-file
scanner. Installed acceptance of this new mode is pending. It submits no model
prompt and does not open a keyboard.
