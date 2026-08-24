# Local Windows companion and VS Code setup

`@strathex/switchyard-companion` is a local-only Node companion. It owns the
protected state directory, authenticated named-pipe (Windows) or Unix-socket
IPC endpoint, receipt store, and broker configuration. It never listens on TCP.

1. Build it with `npm run build:companion`.
2. Start `apps/windows-companion/dist/apps/windows-companion/src/service.js`.
   Its initial state is `%USERPROFILE%/.strathex-switchyard`; the configuration
   file contains a random local IPC token and must not be committed or shared.
3. In VS Code run **SXSY-B122: Configure Local Companion** and enter the IPC
   path/token. Then use **Show Companion Health**, register/select a session,
   and invoke controls from **Invoke Control**.

The companion starts manually by default. A login startup registration is a
user-local installation choice, not a repository action; the code intentionally
does not create a Scheduled Task or alter startup settings silently. Failed IPC
connections, unavailable adapters, stale sessions, missing authorities, and
missing isolated-test recipes are displayed as unavailable/blocked. Reconnects
require the local token again and do not upgrade a session's capability. The
configuration and persisted sessions are per-user state files (mode `0600` where
the OS honors POSIX modes); they are not portable encrypted credential stores.

## Concrete local brokers

- `captureLiveTargetSnapshot` gathers branch, HEAD, index tree, dirty tracked
  state, untracked files, submodules, remote, tool and environment fingerprints
  from Git immediately before a brokered action.
- `LocalRepositoryBroker` uses argument-vector Git child processes, canonical
  workspace allowlists, exact-snapshot revalidation, and target-bound expiring
  review approvals. Direct-main is denied and push defaults to reviewed.
- `LocalTestEnvironmentBroker` executes only a declared recipe, injects test
  mode/network-deny values, and rejects configured production-like endpoints.
- `LocalSandboxBroker` creates a recoverable copied sandbox/quarantine lease;
  release needs a target-bound review approval.
- `LocalProcessProviderAdapter` is the functional local simulator for managed
  session discovery, focus, pause, and target-bound context acknowledgement.
  Claude/Codex proprietary adapters remain unavailable until their owners
  authorize a versioned integration.

The local companion does not fabricate a Raw HID connection, provider API,
GitHub API, cloud credential, scanner advisory feed, browser automation, or
hardware acceptance result.
