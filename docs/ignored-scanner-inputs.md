# Explicit ignored files as scanner inputs

An ignored `.env` can contain the most important secret in a repository. Git
ignore status must not make it invisible to an operator-approved scan. Switchyard
now accepts literal ignored paths as read-only inputs to the pinned Shield
scanner, with the same file witnesses, namespace/guest boundary and redacted
findings as its other reviewed inputs.

## Review the exact files

A new [task-bound inventory preview](scanner-input-inventory.md) can first list
relevant ignored names and group build trees without hashing their contents or
granted scan authority. It remains incomplete and separate from the following
consequential review.

The task-authority proposal accepts `classifications.includedIgnored`. Each
listed path must also appear in the proposal's owned `paths`. It must actually
be ignored in the captured Git inventory; unknown, missing, incorrectly
classified or changed files cannot inherit the approval. The review displays the
classification and the complete target snapshot.

For example, a Change Scan proposal can include these fields alongside its task
identity, plan revision and other exact scanner/manifest/input paths:

```json
{
  "actions": ["shield_change_scan"],
  "paths": [".env", "engine.mjs", "request.json", "rules.json", "shield.json"],
  "classifications": {
    "includedUntracked": ["engine.mjs", "request.json", "rules.json", "shield.json"],
    "includedIgnored": [".env"]
  }
}
```

That is an authority proposal fragment, not an executable scanner configuration.
The scanner request must separately list the `.env` path, exact SHA-256 and byte
count; its reviewed recipe must stage precisely those same bytes. The supplied
engine must match the shipped scanner. Public feeds still need separately
approved signatures, current trust and freshness. [Scanner configuration](shield-baseline-scanner.md)
explains that second review.

## Scanner authority stays narrow

Ignored ownership is available only when every granted action is one of the four
Shield actions. Mixed commit, Run or pipeline grants are refused before any Git
query. These files never become general execution or local-commit inputs. The
Linux and Windows admission paths include only explicitly classified, exactly
owned ignored witnesses for Shield. A changed ignored file invalidates review,
issuance and subsequent target revalidation.

No ignore rules, index entries or source files are modified. The scanner reads a
reviewed copy with network and ambient credentials denied. Reports contain rule,
location and fingerprint metadata, with no matching secret bytes. File content
is not submitted to a model. The pilot verifier uses synthetic credentials in a
new disposable repository and creates only an empty native task.

## Evidence and remaining scope

Three authority cases pass: closed/overlapping classifications and mixed actions
fail before native queries; real Git/protected task scope binds changed
ignored bytes; incorrectly classified or other unknown ignored files stay
incomplete. Real Linux namespace execution finds a synthetic private-key marker
in an ignored `.env`, preserves the original bytes/index, rejects later source
drift and retains a failed receipt with incomplete coverage. The Windows host
passes the same software path with an explicit guest double. The seventeen existing authority/Run/Linux/Windows Shield cases, twenty-two
inventory/package cases and type checking also pass. Six existing pipeline/race regressions also pass. Native Windows remains
separate. Normal installed `1a5cd43` passes six update/sixteen actual Change Scan
checks: ignored secret detection without matched-byte disclosure or index/source
mutation, exact expiry/retirement/replay, two native exits and full restoration.
Receipts `assignment-legends-1793857942421.json` and
`installed-shield-baseline-1793858153322.json` are retained; owned scratch removed.
One empty task, zero prompts.

The repeatable installed verifier supports:

```sh
mise exec node@24.14.0 -- node scripts/verify-shield-host.mjs \
  --synthetic --action=shield_change_scan --ignored-secret-input \
  --bounded-feed-deadline
```

This adds an explicitly ignored synthetic secret to the known-failing request;
the clean request still declares only its own selected inputs. Both remain
incomplete for full repository coverage. Metadata-only relevant-name discovery and grouped build-tree hints are now
implemented as an incomplete preview. Automatic complete scan assembly, persisted
operator policy, scalable consequential build-tree snapshots and Git history are
still unfinished. Existing bounded inspection refuses unsupported or oversized
inputs rather than skipping them into a green result. [Current evidence](verification.md)
separates those implementation gaps from unavailable host/account checks.
