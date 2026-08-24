# Local Windows companion and VS Code connection

> **Candidate scope:** this is a local, current-Windows-user companion
> connection. It is not a Windows service installation, a pipe-ACL review, an
> OS mediation boundary, or acceptance evidence for any B122 gate.

`@strathex/switchyard-companion` is a manually started local Node companion.
It owns the protected journal, its endpoint record, and its local named pipe.
It never listens on TCP and the VS Code extension cannot select a host, port,
workspace path, or cleartext token.

## Start a candidate companion

Use a current Node.js runtime on Windows. From the repository root:

```powershell
npm run build:companion
node apps/windows-companion/dist/apps/windows-companion/src/main.js
```

For source-only development, `npm run start:companion` starts the same entry
point with Node's TypeScript stripping support. The companion is deliberately
not installed as a Scheduled Task or login item. Starting it is a user-local
choice; the repository never changes startup settings silently.

At first start, the companion creates these host-owned files under
`%LOCALAPPDATA%\STRATHEX\switchyard`:

- `protected-audit.jsonl` — append-only protected control-plane records;
- `authenticated-pipe.json` — a version, a B122-only named-pipe path, and an
  opaque DPAPI CurrentUser-sealed token.

The endpoint record never contains a clear token. The companion decrypts the
token only for the local pipe check and clears the buffer after use. Journal
record tags use the same DPAPI CurrentUser protector; a hash-chain-only store
is rejected by standalone startup.

## VS Code extension behavior

The extension reads only the companion-created canonical endpoint record from
the host-owned state location. It opens the sealed token with DPAPI CurrentUser
and uses one bounded JSON-line request per named-pipe connection. It rejects
TCP-like paths, endpoint overrides, malformed records, oversized frames,
trailing response data, mismatched response IDs, and unavailable pipes.

There is intentionally no **Configure Local Companion** command and no
workspace or VS Code setting for an endpoint or token. If the canonical record
is missing, malformed, owned by another user, or the companion is stopped, the
extension reports the companion as unavailable. It does not fall back to a
stdio server, a TCP listener, a shell command, or another extension.

## What the connection does not authorize

An authenticated named-pipe request is still only input to the durable control
plane. It cannot self-grant mediation, authority, a confirmation, acceptance
evidence, a credential, a target, or a successful outcome. Missing mutation
factories and adapters remain unavailable; high-consequence controls remain
disabled by policy and gate evidence.

The sealed token provides current-user protection at rest. It is not a claim
that a malicious process running as the same Windows user cannot invoke DPAPI,
that a named-pipe ACL has been independently reviewed, or that unmediated
applications are contained. Those are separate acceptance and deployment
concerns.

## Local evidence

The isolated tests cover a fake-protector transport round trip, token/frame/
endpoint rejection, unauthenticated-frame rejection, canonical endpoint
loading, and Windows CurrentUser DPAPI companion-to-extension interoperability.
See [authenticated-pipe.test.ts](../apps/windows-companion/test/authenticated-pipe.test.ts)
and [named-pipe-transport.test.ts](../apps/vscode-extension/test/named-pipe-transport.test.ts).

For the broader policy, Git, and containment boundary, see the
[software-only completion audit](software-only-completion-audit.md) and
[operational safety model](operational-safety-model.md).
