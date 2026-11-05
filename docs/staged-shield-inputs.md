# Scan the index and worktree separately

Linux Shield can now scan explicitly reviewed Git index blobs alongside the
working versions of the same files. A secret staged before the working file was
cleaned remains detectable. Each report records which input came from the index;
findings contain rule IDs and fingerprints, never matched values or source text.

The scanner request declares the original source and one reserved path inside
the disposable input copy:

```json
{
  "path": ".switchyard-index/src/app.ts",
  "sha256": "SHA256_FROM_THE_INDEX_WITNESS",
  "size": 123,
  "source": {
    "kind": "git-index",
    "path": "src/app.ts",
    "objectId": "GIT_OBJECT_ID_FROM_THE_INDEX_WITNESS",
    "mode": "100644"
  }
}
```

This is one entry in the existing closed Shield request's `files` array. Add a
normal `src/app.ts` entry with its worktree digest to inspect both versions. The
recipe's input allowlist includes both exact copies; task authority owns the real
source path and ordinary physical inputs. The reserved alias is derived from the
original path and is created only inside private disposable staging. It is never
written into the repository and cannot supply the scanner entrypoint or feeds.

Review, admission and staging re-witness selected blobs through the existing
[task-bound index reader](git-index-inputs.md). The host checks the exact Git
object ID, regular-file mode, SHA-256 and byte length against the request. It
binds the whole listed index and HEAD in the reviewed scope. The target snapshot
also retains its existing index tree and worktree manifests. Caller-supplied
object identities alone confer no access: each original path must belong to the
same current Shield grant, task/account and repository binding.

During staging, private borrowed bytes live only long enough to create the
exact reviewed copies. Index/HEAD and authority are checked again after the
consumer finishes, and buffers are cleared on success or failure. Drift removes
the owned copy and starts no scanner. The Linux stager independently checks bytes
and sizes, refuses general Run/pipeline injection and refuses a physical worktree
file as a substitute for a missing index buffer. Normal inputs keep their
descriptor-bound file reads. Both copies run under the existing read-only,
network-denied namespace and native ownership/checkpoint/budget rules.

The authenticated incomplete evidence adds a digest of the index witness to
`toolVersions.gitIndexInputs`. The strict report parser requires the original
source descriptor in the matching inventory row; deleting or changing provenance
refuses evidence. Exact replay returns the retained result. Changes to the
repository index require new authority rather than redirecting a previous grant.

The index-reader subset remains bounded to 64 paths, 256 KiB per blob and 448 KiB
combined valid UTF-8 content. Its metadata/output/deadline limits also apply.
This is explicit input assembly, not automatic coverage of every change or
relevant history. Unsupported data is refused, and clean results still remain
incomplete. No passing Release Shield gate is introduced.

The [Windows reviewed staged-input path](windows-index-staging.md) is now
implemented and contract tested. It uses a separate 320 KiB native transport
subset, verifies exact packet/witness hashes and completes index consumption
before guest preparation. A reviewed guest-double scan uses fresh Git bytes and
authenticates the same provenance; no physical worktree substitution is accepted.
Native NTFS packet staging is queued in Windows CI. Actual Windows guest,
interactive and installed acceptance remain separate unaccepted checks.

Six focused cases cover the closed declaration/provenance parser, exact host
binding, a real Linux scan of staged-only secrets alongside clean worktree bytes,
index drift during private staging with no scanner start, distinct fingerprints
for identical content in different origins, and stager refusals for
general execution, changed bytes and worktree substitution. Four isolated groups
pass 26 scanner/index/exception checks, including a real separately reviewed
exception journey (`isolated-test-21c607e3-b727-4b85-b44d-fe5020caad5e.json`).
Another four groups pass 37 task-input/runner/stager checks
(`isolated-test-12e025c2-e08b-42de-9f49-fc1d680df92f.json`); eight ordinary
Linux/Windows scanner/staging groups pass fourteen checks
(`isolated-test-be2f96fc-727a-40bb-942f-40efb4041e4d.json`). Every child cleanup
verifies. Type checking, packaged loading and the unchanged deterministic
development BOM pass. Installed `11d8cc7` passes six update and thirteen actual
staged/worktree API checks. Receipts `assignment-legends-1793868587004.json` and
`installed-shield-baseline-1793868749979.json` retain staged-only findings,
authenticated original Git provenance, both independently verified scanner exits,
exact replay/feed retirement and full restoration. Owned source/signing/packages/
staging/bundle/proof checkout were removed; one empty task, zero prompts and
no keyboard access. After updating to committed source:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_change_scan --staged-index
```

The distinct `--index-inputs` demonstration verifies read-only witnessing and a
separate worktree scan; it does not establish staged-scan acceptance.
