# Review ignored generated trees separately from secret inputs

An ignored dependency or build directory can contain gigabytes of generated
files. Shield-only task authority can now explicitly exclude a bounded set of
whole ignored generated directories while keeping selected secret-bearing files
under exact byte review. The exclusion is displayed in the one-use authority
review and remains part of that grant's protected policy and target identity.

For example, these fields belong to an otherwise complete authority proposal:

```json
{
  "actions": ["shield_change_scan"],
  "paths": [".env", "engine.mjs", "request.json", "rules.json", "shield.json"],
  "classifications": {
    "includedUntracked": ["engine.mjs", "request.json", "rules.json", "shield.json"],
    "includedIgnored": [".env"],
    "excludedIgnoredTrees": ["node_modules", "packages/api/dist"]
  }
}
```

Each root must be an existing, nonempty whole ignored directory in Git's grouped
listing. A missing, ordinary untracked, partly tracked or linked root is refused.
Roots are literal, distinct, non-overlapping paths, at most 32, with a supported
generated-directory name such as `node_modules`, `.venv`, `build`, `dist`, `target`
or `coverage`. The [inventory preview](scanner-input-inventory.md) exposes the
complete built-in name list. This policy cannot exclude arbitrary secret folders.

Every granted action must be Shield. Commit, Run, pipeline and mixed-action
authority are refused before native queries. No owned or individually classified
path may overlap an excluded root. To review a file inside a generated tree,
remove that tree exclusion and use the existing exact input path; nested
per-file exceptions to an exclusion are not implemented.

Fixed Git pathspecs omit approved ignored roots from individual file hashing.
The host checks their whole ignored-directory status before and after capture,
and witnesses every real parent/root directory's device, inode, ownership and
mode. It checks those identities again after inspection. Symlinks, redirection,
root replacement, changed classification and unsupported directory identity fail
closed. The native queries retain their existing guardians, scratch ownership,
output bounds and deadlines; no repository script or network route is enabled.

The target's policy version is `switchyard-task-shield-ignored-trees/v1`.
Exclusion manifest entries use `policy-excluded-directory-sha256:` fingerprints
to distinguish policy/metadata evidence from source-byte hashes. Generated-file
churn inside the same excluded directory does not change that policy witness.
Replacing the root or changing selected `.env` bytes invalidates current authority.
Ordinary grants with no tree exclusions keep their existing target format.

Selected scanner inputs still require exact file sizes/hashes, the pinned engine,
current signed feeds and a separate execution review. The Linux/Windows staging
allowlist never receives an excluded root. The source filesystem and Git index
remain unchanged. A complete policy-bound authority snapshot establishes only
the declared input/exclusion identity; it does not establish complete security
coverage. Excluded contents, including possible secrets inside generated trees,
are uninspected. Baseline clean results remain incomplete and findings remain
failed with incomplete receipts. Full repository/history/provenance acceptance is
still unfinished.

Three policy/real-filesystem cases and three real-Git authority cases pass.
The authority journey keeps an 80 MiB sparse generated file outside hashing,
binds an ignored secret, tolerates declared generated churn and refuses root
replacement. Real Linux and Windows guest-double execution cases find the exact
ignored secret, preserve source/index/HEAD, exclude the large tree from staging,
verify replay/exit/cleanup and refuse a replaced root before another scanner.
Ten authority/preview/ignored-input checks and thirty-one surrounding authority/
runner/package checks pass, with type checking. The policy/authority/execution/preview subset passes all twelve checks in four
independently exited groups, with verified child cleanup
(`isolated-test-7a148ac0-14d8-4a90-b18e-c65eab20fdbd.json`). The added tracked-data
refusal passes its complete three-case authority file separately. Three focused
native Windows jobs are connected; those and new installed tree-policy acceptance
remain separate pending checks.

The repeatable installed proof supports:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_change_scan --ignored-secret-input \
  --inventory-preview --ignored-build-tree
```

Its sparse generated fixture remains present during the separately reviewed scans
and is removed only after independent native exit and original-state restoration.
No source bytes are submitted to a model, and no model prompt is sent.
