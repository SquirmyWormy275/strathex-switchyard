# Candidate evidence — authenticated transport, mediated Git, and containment

> **Branch-local evidence, 2026-08-23.** This record covers the candidate
> remediation only. It does not merge, accept, or supersede the 27 B122
> acceptance gates.

## Scope closed in this candidate

| Finding | Candidate mechanism | Evidence |
| --- | --- | --- |
| Plain or user-configured companion connection | The standalone companion uses only a B122 local named pipe and a companion-created endpoint record containing a DPAPI CurrentUser-sealed token. The extension reads that canonical record only; it has no endpoint/token setting or TCP fallback. | [authenticated-pipe.ts](../apps/windows-companion/src/authenticated-pipe.ts), [windows-secret.ts](../apps/windows-companion/src/windows-secret.ts), [named-pipe-transport.ts](../apps/vscode-extension/src/named-pipe-transport.ts). |
| Unverified DPAPI startup | Both companion and extension explicitly load the Windows `System.Security` assembly before invoking `ProtectedData`. The suite performs CurrentUser companion sealing and extension opening with non-secret test values. | [authenticated-pipe.test.ts](../apps/windows-companion/test/authenticated-pipe.test.ts), [named-pipe-transport.test.ts](../apps/vscode-extension/test/named-pipe-transport.test.ts). |
| Direct or broad local commit | `local_commit` needs an exact one-time confirmation, a task-owned path set, a host-owned final target guard, a clean shared index, and a non-default branch. The handler stages only those paths in a private index, disables hooks, verifies the committed tree, and reconciles the shared index through Git's index lock. | [command-catalog.ts](../packages/control-plane/src/command-catalog.ts), [brokers.ts](../packages/control-plane/src/brokers.ts), [mediated-git.ts](../apps/windows-companion/src/mediated-git.ts), [mediated-git.test.ts](../apps/windows-companion/test/mediated-git.test.ts). |
| Containment bypass through an attached handler | The effectful execution, Git, credential, network, test-environment, automation, isolation, Council, and managed-adapter routes perform a containment check before calling their registered handler. Consequential routes receive a final `EffectGuard`; a revalidation failure returns `incomplete` before handler invocation. | [containment.ts](../packages/control-plane/src/containment.ts), [brokers.ts](../packages/control-plane/src/brokers.ts), [adapters.ts](../packages/control-plane/src/adapters.ts), [runtime.ts](../packages/control-plane/src/runtime.ts), [brokers.test.ts](../packages/control-plane/test/brokers.test.ts), [adapters.test.ts](../packages/control-plane/test/adapters.test.ts), [dispatch.test.ts](../packages/control-plane/test/dispatch.test.ts). |
| Published package starting the wrong module | The companion package command now targets the authenticated standalone `main` entry point rather than the legacy service module. | [package.json](../apps/windows-companion/package.json). |

## Verification run

On Windows, against isolated temporary repositories and test state:

```text
npm test                         143 passed, 0 failed
npm run typecheck                passed
npm run build:companion          passed
npm run build:vscode             passed
npm run package:companion:dry-run passed
npm run package:vscode:dry-run   passed
git diff --check                 passed
```

The test suite uses temporary Git repositories, temporary files, fakes, and a
non-secret DPAPI smoke value. It does not use production data, production
credentials, a production database, or a real remote mutation.

## Deliberate non-claims

- CurrentUser DPAPI is not an independently reviewed named-pipe ACL, service
  account, same-user adversary, or OS-hardening boundary.
- The standalone host has no trusted mutation factory, so a pipe request cannot
  invent a commit message or path set. Push, PR upsert, merge, Direct Main,
  provider automation, and all listed high-consequence paths remain disabled or
  unavailable.
- The Git test proves the local handler against an isolated Git repository. It
  is not GitHub, branch-protection, credential-vault, provider, hardware, or
  acceptance-gate evidence.
- Containment covers the brokered/adapter routes listed above only. Raw shells,
  other applications, and already-running remote work remain visibly outside
  that boundary.

See [local-companion.md](local-companion.md) for operator setup and
[software-only-completion-audit.md](software-only-completion-audit.md) for the
full evidence boundary.
