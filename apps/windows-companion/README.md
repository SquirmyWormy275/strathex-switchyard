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
- The verified Windows bundle composes a digest-pinned native voice helper with
  a single serialized conversation runtime. Voice startup requires fresh exact
  consent and one explicit managed-session binding; provider switches preserve
  canonical context, interruption cancels the in-flight turn, and missing or
  changed provider routes fail closed without a browser or cross-provider
  fallback. The VS Code surface is a native Voice Center rather than a provider
  web page; repeated Normal presses toggle mute/resume and ending remains an
  explicit reviewed Center action until physical long-press timing is accepted.
- Retained redacted transcripts are not written to the append-only authority
  journal. Production uses independent AES-GCM entry keys wrapped by the
  CurrentUser protector. Expiry and explicit deletion destroy the entry keys
  before ciphertext and before a durable deletion tombstone is recorded.

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

The package commands `sxsy-b122-companion` and
`sxsy-b122-hid-simulator --self-test` respectively start the authenticated
named-pipe entry point and exercise all 176 logical chord combinations without
opening hardware or the network. The simulator is product protocol evidence,
not physical keyboard acceptance. A bridge request still
cannot invent a commit message or path set: the extension collects exact
operator-reviewed input, and the companion binds it to the current target,
authority, confirmation, and final effect guard.

The npm workspace package is deliberately the JavaScript companion and its
hardware-independent Raw-HID simulator only. It does not contain the native
Sandbox guest worker or host lifecycle helper, repository-runtime, Raw-HID,
provider-desktop, or voice helpers and is not eligible release evidence or a
complete Windows installation. `deployment/windows/Build-B122Release.ps1` is the sole
packager for the verified Windows bundle; that bundle builds or accepts
digest-pinned native helpers, includes them beside the compiled companion, and
validates their provenance and self-tests.

The installed voice route is administered only by
`deployment/windows/Manage-B122VoiceRoute.ps1`. It asks for an exact typed
current-user confirmation and hidden provider secret; no command request may
choose a helper executable, route identity, authorization reference, or
alternate provider. The native helper's self-test proves only its protocol,
DPAPI, and hardware-independent boundary. A real microphone permission grant,
provider authorization/parity, provider-side transcript deletion, and
single-target/no-leakage behavior remain acceptance evidence rather than source
claims.

No control silently commits, pushes, merges, force-pushes, approves a
permission, submits a prompt, or kills an inferred process. High-consequence
actions remain disabled until the mediated host and required real acceptance
evidence satisfy their gates. Configured adapters do not bypass those gates. See
[`../../docs/software-only-completion-audit.md`](../../docs/software-only-completion-audit.md)
for the evidence boundary.
