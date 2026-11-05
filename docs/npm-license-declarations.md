# Declared npm license obligations and alternatives

Supply Chain and Release Shield now understand a bounded declaration syntax
with `AND`, `OR` and parentheses. `MIT AND GPL-3.0-only` fails an allowlist
containing only MIT and Apache-2.0. `MIT OR GPL-3.0-only` has a permitted
alternative, but reports `license_choice_not_selected`; Switchyard does not
choose a license or claim legal compliance. Every result still has incomplete
coverage.

This follows the operator precedence in [SPDX 2.3.1 Annex D](https://spdx.github.io/spdx-spec/v2.3.1/SPDX-license-expressions/):
AND binds more tightly than OR, grouping changes obligations, operators are
case sensitive, and identifier comparison is case insensitive.
[npm documents expressions for multiple-license declarations](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#license).
The scanner checks syntax and an explicitly signed literal-identifier allowlist.
It does not verify SPDX License List membership, inspect license texts, infer
compatibility, approve later versions or verify a publisher's declaration.
`GPL-2.0+` matches only that explicitly allowed identifier, not `GPL-2.0-only`.

The self-contained pinned engine accepts at most 512 ASCII characters, 128
tokens, 64 identifiers and sixteen nested groups. It normalizes spaces and
redundant grouping without changing precedence. It never evaluates source
code, expands a file reference, loads a dependency or makes a network request.
Unsupported WITH exceptions, LicenseRef/DocumentRef references, NONE/NOASSERTION,
malformed input and excess bounds remain `license_metadata` gaps. An apparently
permitted prefix cannot salvage an unsupported expression. Policy entries remain
unique literal identifiers; expression-shaped policies and case aliases refuse.

The typed inventory and CycloneDX 1.6 output retain normalized declared text
under `license.name`, not an asserted SPDX expression or a selected legal license.
Host admission requires canonical syntax and exact inventory/BOM equality.
Missing publisher, source, artifact and repository coverage remain incomplete.

Both Supply Chain and Release pass actual Linux namespace execution and the
Windows software path with guest execution doubled: exact signed feeds, one
license finding, alternatives/unsupported metadata gaps, authenticated failed/
incomplete evidence, duplicate receipt, original index/HEAD/lockfile preservation
and independently confirmed scanner exit/cleanup. Their first seven-group
check retained a runner inventory omission as failed
(`isolated-test-8f7edfdc-d48e-4a72-a1ab-20ad0b15b699.json`, 47/48 tests); all
scanner and integration groups passed and every cleanup verified. The fixed
runner, workflow, CLI guard and engine pass 42 checks in four isolated groups
(`isolated-test-a36853c4-cfd3-4110-a308-23c245b7955b.json`), with every cleanup
verified. Type checking and the deterministic development BOM check pass. Native
Windows execution of the new license worker remains a separate check.

The installed verifier accepts a standalone exact action:

```sh
node scripts/verify-shield-host.mjs --synthetic \
  --action=shield_supply_chain --license-expressions
```

`release_shield` is also supported. This mode installs no dependencies, submits
no prompt and opens no keyboard. It uses a new disposable synthetic repository
and separately approved signed fixture data, then verifies retirement and
restoration. Invalid or combined flags refuse before installed state access.


Normal installed source `402dd7e`, release `55d42108…`, now passes six update
checks, 14 Supply Chain and 14 Release checks. Four actual scanner exits verify
required-license failures, permitted but unselected alternatives, unsupported
exception gaps, authenticated incomplete coverage, signed-feed retirement and
original state/frozen Home restoration. All owned source/signing/packages/
staging/bundle/checkout are removed; zero prompts or keyboard access.
[Source-bound installed evidence](evidence/installed-license-summary.json).
