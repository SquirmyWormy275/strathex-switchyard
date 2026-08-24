# Windows companion

This package is the local, software-only SXSY-B122 control-plane boundary. It
accepts only versioned, canonical bridge requests; a keyboard packet, VS Code
command, repository string, or provider response is never authority.

## What is implemented

- Packet routing maintains per-device connection-epoch replay state and rejects
  stale, repeated, malformed, ambiguous, and intentionally unassigned input.
- Standalone Windows startup exposes only a bounded one-request named-pipe
  bridge; it never opens a network listener. Its endpoint record holds an
  opaque DPAPI CurrentUser-sealed token, never a clear token.
- `DurableCompanionEndpoint` hydrates protected session lifecycle records,
  awaits no-replay recovery before serving requests, persists every lifecycle
  mutation, and fails closed after a persistence or recovery failure.
- `createDurableWindowsCompanion` composes the protected session registry,
  target resolver, durable executor, receipts, checkpoints, budgets,
  confirmations, and startup reconciliation. It requires a host-owned journal
  authenticator unless an isolated test harness explicitly opts out. The
  standalone entry point supplies a DPAPI CurrentUser journal authenticator.
- The durable executor has typed seams for Git, execution, credential, network,
  test-data, automation, containment, cancellation, and reconciliation. Missing
  real integrations are unavailable; in-memory implementations are test-only.

## Deliberate limits

There is no installed Raw HID driver, Windows service, service-account/NCrypt
key policy, named-pipe ACL acceptance, credential vault, provider adapter,
process supervisor, GitHub client, or OS isolation backend in this repository.
`npm run start:companion` starts the DPAPI-protected local candidate; it does
not invent a plaintext key or fall back to hash-chain-only persistence.

The package command `sxsy-b122-companion` starts the authenticated named-pipe
entry point. It does not supply a mutation factory, so a bridge request cannot
invent a local commit message or path set.

No control silently commits, pushes, merges, force-pushes, approves a
permission, submits a prompt, or kills an inferred process. High-consequence
actions remain disabled until the mediated host, concrete adapters, and the
required real acceptance evidence exist. See
[`../../docs/software-only-completion-audit.md`](../../docs/software-only-completion-audit.md)
for the evidence boundary.
