# Authenticate a physical shortcut before dispatch

The installed CLI dispatches a closed shortcut intent through a signed local
instance exchange. It sends no browser access token, account, command, prompt,
content or caller-selected compartment. The same Suite route resolves the active
workspace and enforces its existing provider/role policy.

The request binds the saved instance, build and PID, a fresh nonce, the exact
invocation UUID and the closed intent. The server verifies these fields before
calling the route. The response binds the same coordinates and origin; an
unsigned, stale, substituted or mismatched reply cannot establish acceptance.
Older servers without this route refuse the new dispatcher. There is no alternate
bearer request, different target or automatic retry.

## Preserve uncertainty and avoid duplicate effects

A nonce is reserved before dispatch, including while its response is pending.
The original ten-second freshness window and a 1,024-entry ceiling bound replay
memory. Expired entries can be removed only as time advances; a backward clock
adjustment refuses dispatch until the previous observed time is reached. Restart
creates a different application identity, so an old signed request cannot carry
over to the new instance.

The request retains its 125-second total deadline and 256 KiB response ceiling.
A timeout, disconnection, failed policy/action response or substituted listener
records a `not-confirmed` private receipt. An effect may already have happened;
the caller must inspect the original target before another deliberate action.
Successful local dispatch still does not establish a physical keyboard event,
external application focus, resumed task, model prompt or task completion.

The pending source update also fences custom-agent enqueue and the existing
native-focus/client-launch callbacks with the original workspace generation.
Leaving and returning cannot revive an older shortcut. Commands already queued
stay with their original session. [Role and workspace boundaries](role-dispatch-binding.md).

## Verification and current availability

Twenty-seven focused groups pass 136 tests with one declared platform skip. A
subsequent actual CLI-child case adds one distinct pass. Both TypeScript checks
pass. The final protocol checks cover replay while pending, cache exhaustion,
expiry, clock rollback, substituted response fields, response/time bounds and
stop during delivery. Initial failures are retained with their original bounds
and verified cleanup.

The CLI demonstration uses actual HTTP, the signed gateway, encrypted Suite
state and a bounded native-launch double. Its child exits, and the invocation
receipt matches the protected launch record. All sixteen installation/recovery
scenarios and package bounds pass. Installed `738c1f7` now passes eight additional
metadata/refusal checks inside an 84-check update. All 54 workspaces, four profiles,
57 workflows and the private review link are preserved. The exact source now also
passes the native Windows client lane: 25 groups, 247 tests and no skips, with
original bounds and cleanup verified. Complete Windows release and physical-key
acceptance remain separate; the frontend and F77 mapping are unchanged.
[Source evidence](evidence/signed-physical-intent-source-summary.json).
[Native Windows evidence](evidence/signed-physical-intent-native-summary.json).

The repeatable installed check starts no provider, focus or keyboard operation:

```sh
mise exec node@24.14.0 -- node scripts/verify-signed-intent-host.mjs --read-only-metadata
```

Its unsupported live-effect flags refuse before reading installed state. Two
verifier/runner groups pass 31 tests with original bounds and process cleanup.
The prepared package is removed after verified update/readback; only current and
one rollback remain. [Installed evidence](evidence/installed-signed-physical-intent-summary.json).
