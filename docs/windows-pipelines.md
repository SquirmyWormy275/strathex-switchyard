# Reviewed Windows pipelines

The Suite connects `pipeline_local_gate` and `pipeline_clean_reproduction` to
its Windows task-authority, checkpoint, budget, guest ownership and authenticated
receipt path. A completed guest program becomes a passed pipeline only after
fresh host validation. This is implemented software with explicit guest doubles
in the tests; a supported interactive Windows guest journey remains unaccepted.

## Review and run

Use the existing authenticated repository execution review/apply/status routes.
Select the exact action in the task grant and execution request. The fixed
`switchyard-windows-reviewed-run/v1` manifest's `recipeId` and its sole catalog
recipe ID must match that action. The manifest, catalog and every selected
non-production input must belong to the same task-owned snapshot.

The catalog selects the pinned `C:\B122\tools\node.exe`, a script from the
reviewed read-only inputs, literal bounded arguments, `NODE_ENV=test`, a bounded
foreground lifetime and bounded output. It cannot select a host executable,
inline code, credentials or Node startup options. Review binds the exact
manifest/catalog/runtime digests and current task/account/workspace. A one-use
approval is required; imported task files cannot approve themselves.

Both actions use the existing independently owned input/tools, broker-backed
64 MiB exchange, full-sandbox profile, guest shutdown, native exit and retirement
path. Networking and clipboard are disabled. No host repository write,
persistent volume or provider permission is granted. Cancellation reaches the
original operation; storage uncertainty blocks its replacement.

## Typed result and evidence

The guest script writes one UTF-8 JSON report to standard output:

```json
{
  "schema": "sxsy-b122.windows-repository-recipe-result",
  "version": 1,
  "coverage": [
    { "dimension": "correctness", "status": "covered", "fixtureId": "approved:project-tests" },
    { "dimension": "isolation", "status": "covered", "fixtureId": "approved:project-tests" },
    { "dimension": "production_data", "status": "covered", "fixtureId": "approved:project-tests" },
    { "dimension": "ambient_credentials", "status": "covered", "fixtureId": "approved:project-tests" }
  ],
  "scannerFixtureIds": [],
  "advisoryFixtureIds": []
}
```

Clean reproduction additionally requires exactly one `reproduction` dimension.
Use `unavailable` for an unavailable dimension; it produces incomplete evidence.
Unknown/duplicate dimensions, extra fields, malformed UTF-8, truncated or changed
outputs cannot produce passing evidence.

After independently confirmed guest/native exit, the host verifies the original
operation/result, helper/catalog hashes, fixed extraction directory and validated
stdout hash/size. Named scanner/advisory IDs resolve through the current Personal
compartment's [signed registry](signed-fixtures.md), including fresh signature,
content, kind, revocation and expiry checks. The feed bytes/signing key are not
mapped into the guest. The host checks current task authority again and issues
HMAC evidence binding the target, action, manifest, helper, result and feed/tool
versions. This proves this reviewed program and its reported coverage; it does
not establish a completed vulnerability scan or general repository security.

A lost report/receipt acknowledgement preserves the original uncertain result.
Read-only status/recovery cannot infer a passed pipeline from guest exit or
resend its consumed admission. Provider task completion remains unverified.

## Verification

Two end-to-end policy cases use actual Git, task grants, AEAD state, installed
P-256 feeds and HMAC receipts with an explicit guest double. Separate evidence
checks exercise 24 valid/fault inputs; a lost protected-observation test confirms
that restart cannot upgrade native program success. Existing Run, parser,
checkpoint/budget, output, stop, recovery and package regressions remain required.
Twenty-seven existing recovery/stop/output/Suite regressions also pass.
Focused Windows CI jobs run complete evidence, policy and recovery files under
their declared isolated bounds. At `5d398d2`, native Windows workflow
[41960677205](https://github.com/SquirmyWormy275/strathex-switchyard/actions/runs/41960677205)
passes all sixteen jobs. Pipeline policy (two cases), evidence (three cases)
and recovery (one case) artifact digests and every child cleanup verify;
`windows-pipeline-{policy,evidence,recovery}-5d3.json` receipts are retained.
These native OS checks still use an explicit guest double. Actual guest/account
acceptance and frontend controls remain separate work. No work laptop or Microsoft tenant is probed.
