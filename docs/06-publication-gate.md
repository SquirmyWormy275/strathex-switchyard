# Publication and Release Gate

Publishing source code does not constitute a hardware, provider, or production
release. This gate remains the checklist for a physical/public release
candidate; the present repository is a software-only implementation with all
27 acceptance gates **NOT ACCEPTED**.

## Minimum gate for a hardware/public release candidate

Before the maintainer represents SXSY-B122 as a hardware-capable or public
release candidate:

- [ ] The physical B122 has arrived and its exact hardware/controller configuration is documented.
- [ ] The factory configuration and firmware have recoverable backups.
- [ ] Unit 001 completes initial key, signal, solenoid, and rollback checks.
- [ ] The workflow interview and baseline observation are complete.
- [ ] The V2 control map is grounded in evidence and clearly labeled experimental.
- [ ] No secrets, private logs, proprietary code, or personal data are present in Git history.
- [ ] Every third-party file has a verified source, permission basis, and required notice.
- [ ] Root and file-class licensing decisions are complete.
- [ ] Installation, rollback, and safety limitations are documented.
- [ ] README screenshots and claims match the actual hardware and current behavior.
- [ ] Security reporting has a working private contact path.
- [ ] The maintainer explicitly authorizes the visibility change.

## Public-release states

| State | Meaning |
|---|---|
| Software-only source preview | Source-controlled mechanisms and local tests; no hardware, provider, or production acceptance claim |
| Private incubation | Research, scaffolding, discarded prototypes, and hardware-independent implementation |
| Private release candidate | Physical validation complete; history and licensing audit in progress |
| Public preview | Reproducible but experimental; limitations prominent |
| v1.0 | Stable documented control map, tested installer/rollback, and published evidence |

Publishing or changing visibility does not itself constitute a release. A tagged
hardware/production release should identify the exact Vial configuration,
dispatcher revision, legend set, documentation revision, supported hardware
assumptions, and accepted evidence.
