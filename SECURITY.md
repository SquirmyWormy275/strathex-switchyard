# Security Policy

## Supported versions

SXSY-B122 is pre-release. No version is currently supported for security updates or production use.

## Reporting a vulnerability

Do not open a public issue for a vulnerability that could execute commands unexpectedly, bypass confirmation, expose secrets, or interfere with interrupt/rollback behavior. Use GitHub's private vulnerability reporting feature when enabled, or contact the maintainer privately through the address later published in repository security settings.

Include:

- affected revision;
- operating system and tool context;
- minimum reproduction steps;
- expected and observed behavior;
- whether command execution occurred; and
- any safe mitigation.

Do not include real credentials, tokens, private source, or captured prompt content.

## Security invariants

- Unknown application context must fail closed.
- Physical controls must not silently broaden agent permissions.
- Destructive actions must not be reachable through an unguarded single tap.
- Secrets must not be embedded in Vial exports, scripts, logs, examples, or evidence bundles.
- External commands must use explicit argument handling rather than unsafe shell-string concatenation.
- HALT/interrupt behavior must be tested for every supported adapter.
- Configuration updates must be reversible.

## Scope boundary

The project can reduce operator-interface risk; it cannot guarantee the safety, correctness, or security of third-party agents, editors, terminals, firmware, repositories, or operating systems.
