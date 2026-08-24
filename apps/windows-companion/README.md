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
- The durable executor has concrete, fail-closed composition for reviewed local
  and remote Git, repository execution, DPAPI credential references,
  exact-route HTTPS, test data, configured provider/CI automation, Windows
  Sandbox, containment, cancellation, Council, and reconciliation. In-memory
  implementations remain test-only. Concrete routes are unavailable until
  their exact host-attested configuration and authorization are installed.

## Deliberate limits

The repository includes the Raw-HID Windows helper transport, durable process
and repository-runtime supervision, a DPAPI credential-reference vault,
configured provider/GitHub/CI adapters, and an attested Windows Sandbox backend
with a fixed guest helper. Their presence in source is not evidence that a
device, Windows feature, provider, account, credential, route, or scanner feed
has been installed or accepted on a particular host. Missing prerequisites
remain unavailable with no weaker fallback.

The companion remains a per-user process, not a Windows service or a
service-account/NCrypt boundary. Independent named-pipe ACL and same-user
adversary acceptance are not claimed. `npm run start:companion` starts the
DPAPI-protected local host; it does not invent a plaintext key or fall back to
hash-chain-only persistence.

The package command `sxsy-b122-companion` starts the authenticated named-pipe
entry point with a durable reviewed-mutation queue. A bridge request still
cannot invent a commit message or path set: the extension collects exact
operator-reviewed input, and the companion binds it to the current target,
authority, confirmation, and final effect guard.

No control silently commits, pushes, merges, force-pushes, approves a
permission, submits a prompt, or kills an inferred process. High-consequence
actions remain disabled until the mediated host and required real acceptance
evidence satisfy their gates. Configured adapters do not bypass those gates. See
[`../../docs/software-only-completion-audit.md`](../../docs/software-only-completion-audit.md)
for the evidence boundary.
