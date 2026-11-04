# Manage one reviewed Windows guest

`createWindowsSandboxSessions` connects the fixed native Sandbox commands to the
reviewed backend's process-runner contract. It creates an exact VM, acknowledges
its identity before the worker, establishes its login session, dispatches the
worker once, and verifies VM stop independently of the short CLI processes.
The coordinator is implemented and software-tested. The Studio Windows Run
adapter and bounded exchange-volume implementation
remain work to finish; actual VM acceptance also needs a supported Windows host.

The [embedded worker staging contract](windows-guest-tools.md) now reuses the
existing helper image through one exact private hard link. One host-pinned
Node runtime can join it as a second exact link; no runtime is copied.

The trusted host supplies a compartment, operation ID, protected review digest,
provider and fresh authority callback. The coordinator accepts only the exact
backend configuration file/digest and catalog path. A current-user kernel lease
serializes guest lifecycles across processes. Its encrypted ownership record
exists before native startup. Neither the viewer's PID nor another listed guest
can stand in for its opaque VM identity.

After native creation is verified, the backend records the exact VM identity
and acknowledges it. Only then can the coordinator request the viewer/login and
the fixed worker. The reviewed configuration has no logon command. The worker's
new optional `hostOwnsGuestShutdown: true` flag lets its exit result return before
the host stops the VM. Legacy requests retain guest self-shutdown. A strict
boolean is required; unknown request fields and incompatible older helpers fail
closed. The exact helper/catalog digests and existing Job Object limits remain.

A deadline or mode change cancels the owned native command and enters exact VM
cleanup. Revocation cannot discard observed creation facts that cleanup needs.
Cleanup is permitted to inspect and stop that original guest after provider mode
changes; it cannot authorize another worker. Unknown command exit blocks further
native effects. Unknown VM exit preserves its exchange and selected input copy.

An interrupted start can be observed only through the unguessable ID in its
durably acknowledged native request, with that command independently stopped.
A foreign singleton is never adopted. An empty inventory cannot prove a pending
unconfirmed creation will never appear. The coordinator keeps that case unknown;
if the exact nonce later appears, it can stop only that guest without replaying
creation or the worker. An explicit native no-effect result permits not-started
cleanup.

Backend restart reconciliation can consume exact recovered VM-exit evidence.
It preserves the earlier failed/unconfirmed program result, cleans only the
stopped owned exchange and never extracts unconfirmed output or replays a worker.
Input staging has its own `consumerStopped` fence, independent of native reader
exit. No provider task-completion claim follows from worker or VM exit.

The coordinator reports `exchangeQuotaEnforced: false`. Output collection limits
do not impose a filesystem quota on a writable mapped exchange. The Studio
Windows execution action remains disabled while its adapter and bounded writable
workspace are unfinished. No hardware/account limitation is used to hide that
remaining implementation.

The focused command, lifecycle, backend/worker-contract and runner inventory checks
pass 57 cases; four packaged-import cases and type checking pass separately.
Seven lifecycle cases use explicit native/VM doubles, including startup ambiguity,
revocation, failed acknowledgement, lost final state, cancellation and late exact
exit observation. Five checks invoke the actual compiled C# request parser and
verify legacy defaults, explicit host ownership and malformed-field rejection.
Build/probe scratch was removed after retaining
`windows-guest-worker-lifecycle-build-20261104.json`; no runtime was copied.

Use the [native command contract](windows-sandbox-native-commands.md) and
[reviewed mapping contract](windows-reviewed-guest-mapping.md) for the underlying
boundaries. Native Windows guest startup/login/worker/stop/restart acceptance is
still unverified; the earlier real NTFS checks establish input staging only.
