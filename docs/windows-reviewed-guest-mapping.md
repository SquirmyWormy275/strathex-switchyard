# Map reviewed Windows inputs into an owned guest

The Windows Sandbox backend can consume the native
[reviewed-input lease](reviewed-execution-inputs.md). It maps the selected copy
read-only instead of exposing the live repository, binds it to the exact
operation and catalog, and preserves it when guest exit is unknown. This path
is software-tested. The [managed guest lifecycle](windows-managed-guest-lifecycle.md)
is implemented and software-tested. Native worker/runtime staging and durable
bounded-volume ownership are implemented and accepted in the Windows filesystem
lane. The Studio Windows adapter is now connected; normal personal-host privileged
setup remains unfinished implementation. [Run contract](windows-reviewed-run.md).

Construct the trusted backend with `requireReviewedInputs: true`. Its request
must carry the native staging capability and matching `operationId`. JSON
cannot reconstruct the capability's validation and kernel-lease methods. The
capability contains the original source root, owned copy root, exact selected
file manifest and its SHA-256. The pinned guest catalog must itself be selected.
The copy must be disjoint from the source, tools and result destination.

The input port holds a cross-process consumer lease through preparation and the
guest result. It verifies the owned tree again at the launch boundary. A
duplicate operation returns its retained result and cannot launch another guest.
Concurrent preparation on the same backend is refused. A reviewed execution
cannot adopt or rebuild an earlier interactive guest. Existing separately
attested companion pins retain their legacy mapping behavior; they do not
satisfy this new reviewed-input contract.

Before allowing a guest recipe, the runner must supply `onGuestReady` with the
new guest ID, operation ID and exact configuration digest. The backend persists
that binding before acknowledging it. The runner's independent guest-stop
evidence must match the same ID, operation and configuration. A closed viewer,
host PID, successful guest manifest or arbitrary replacement ID cannot supply
that proof. Failed readiness writes prevent recipe acknowledgement.

An unknown guest exit preserves its exchange, configuration, input copy and
ownership record, refuses extraction and blocks replacement after restart. The
backend never releases the native input copy: that port separately requires its
trusted consumer-exit fence. The old process-only runner supplies no guest-stop
proof and therefore cannot complete this reviewed mode.

Microsoft documents a separate Sandbox session ID and stop operation in its
[Windows Sandbox CLI reference](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli).
The [native command transport](windows-sandbox-native-commands.md) implements
the fixed CLI verbs. The lifecycle coordinator connects their exact
ownership/stop boundaries and is software-tested;
closing the remote viewer is insufficient. No Windows guest was launched by
the tests below.

```sh
mise exec node@24.14.0 -- node --experimental-transform-types --test apps/windows-companion/test/windows-sandbox.test.ts apps/windows-companion/test/sandbox-installation.test.ts tools/layout-studio/windows-reviewed-inputs.test.mjs
```

All 34 backend/staging/installation cases pass, including explicit guest doubles for selected-only mapping,
duplicates, missing/deserialized/wrong-operation leases, late revocation, unknown
guest exit, lost identity writes and mismatched VM/configuration exit evidence.
Native NTFS staging acceptance is a separate Windows CI journey. Actual guest
execution, VM stop/restart acceptance and interactive account/device checks have
not been established by these results.

## Trusted bounded exchange

Connected Windows execution can now require `requireBoundedExchange: true` in
addition to exact reviewed inputs. Its request must carry the original native
volume capability, bound to the same operation, fixed 64 MiB capacity and native
mapping proof. Both cross-process consumer leases remain held through guest
preparation, acknowledgement, independent exit and output validation. The
control-plane isolation wrapper can obtain this lease only from its trusted
host provider; request JSON cannot reconstruct its methods.

Only this capability can admit the owned FAT mount as an exchange root. Ordinary
source/tool/destination directory validation is unchanged. Output descendants
are individually checked for plain file/directory kinds and forbidden links;
manifest sizes, paths, hashes, exact request bindings and resource-enforcement
proofs still apply. Resolving a Windows volume mount to its GUID is not used as
a way to relax the ordinary task allowlist.

Receipts bind the original exchange root and native-binding digest. Duplicates
cannot substitute another volume. Unknown VM exit preserves both the mapped
volume and its inputs, blocks extraction and cannot replay the worker. Generic
backend cleanup removes only its control records; the original native volume
service exclusively owns detach and backing-file removal. Its separate cleanup
state must be checked before declaring storage retired.

The backend/worker/installation/lifecycle/release group passes 43 checks with one
declared platform skip (44 total), and type checking passes. Four new backend
cases cover exact mapping/output validation, malformed or overlapping leases,
unknown guest exit and linked output/revoked volumes. They use explicit volume
and VM doubles and ordinary owned temporary folders. The native mapping lane
is separate; this is not an actual VM demonstration. The Studio Windows Run
connection is implemented and software-tested; actual VM acceptance is separate.
