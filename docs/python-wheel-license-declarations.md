# Check a Python wheel's declared license

Supply Chain and Release Shield can apply a reviewed SPDX policy to the
`License-Expression` inside a selected wheel. It requires a matching outer
SHA-256, matching embedded name/version and verified RECORD member hashes.
A disallowed declaration produces a failed license finding tied to the exact
requirements file, archive, metadata and RECORD digests.

PyPA introduced `License-Expression` and repeatable `License-File` in metadata
2.4. The expression applies to the containing distribution archive, and the
older free-text `License` field is mutually exclusive with it.
[Core metadata specification](https://packaging.python.org/en/latest/specifications/core-metadata/#license-expression).

| Header observation | Result |
| --- | --- |
| Supported canonical SPDX expression in metadata 2.4–2.6 | Declared expression; policy is assessed only after all three checks above. |
| Folded expression | Unfolded under the existing header and declaration bounds. |
| Duplicate expression headers, including case aliases | Manifest refused. |
| Only nonempty license-file references | `file-only`, without exported paths. |
| Legacy free text, conflicting fields, private identifiers or invalid expression | `unsupported`, without raw text. |
| No license fields, or an expression only in the description body | `missing`. |

The existing [bounded SPDX parser and catalog](npm-license-declarations.md)
retain AND obligations, exact WITH pairs and unselected OR alternatives. An
unconfigured policy stays unconfigured. Unmatched or unsupported byte, identity
or RECORD evidence cannot gain assessed license policy.

Typed artifact observations and CycloneDX properties preserve the declaration
source. Host admission rejects changed projections, removed required findings,
invalid status combinations and missing coverage gaps. Finding fingerprints
distinguish requirements files; the original 512-finding ceiling remains.

All results remain incomplete. This checks a publisher's declaration, not the
actual license text, publisher identity, package behavior or legal approval.
The scanner never extracts, imports or installs the wheel. Environment markers,
extras, dependency resolution and package source remain unverified. The original
ZIP, header, component, input-size and shared expansion bounds remain in force.

The fixed [17-case fixture](../scripts/fixtures/pypi-wheel-license-oracle.json)
records independent Python email/ZIP facts, while expected license statuses
describe Switchyard's supported subset. Regenerate it with the existing Python:

```sh
python3 -I -B scripts/generate-pypi-wheel-license-oracle.py
```

The generator reads and writes archives only in memory and saves the fixture JSON.
Frontend activation and actual Windows acceptance remain separate.

Twenty focused groups cover 167 distinct passing tests without skips. The initial
20-group cohort passed 166 tests; a separate regression then reproduced an early
budget refund on duplicate-header refusal. After correction, all six affected
groups pass 28 tests, including eight actual Linux wheel journeys and eight
Windows guest doubles. Original commands, deadlines, skip inventory, package
bounds and every child/tree cleanup verify; the empty test parent is removed.
Type checking passes. [Source evidence](evidence/pypi-wheel-license-source-summary.json).
Installed metadata acceptance remains pending.
