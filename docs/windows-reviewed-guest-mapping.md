# Map reviewed Windows inputs into an owned guest

The Windows Sandbox backend can consume the native
[reviewed-input lease](reviewed-execution-inputs.md). It maps the selected copy
read-only instead of exposing the live repository, binds it to the exact
operation and catalog, and preserves it when guest exit is unknown. This path
is software-tested; the native guest-session controller and the Studio Windows
Run connection remain unfinished implementation.

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
Its guest controller must implement those actual ownership/stop boundaries;
closing the remote viewer is insufficient. No Windows guest was launched by
the tests below.

```sh
mise exec node@24.14.0 -- node --experimental-transform-types --test apps/windows-companion/test/windows-sandbox.test.ts apps/windows-companion/test/sandbox-installation.test.ts tools/layout-studio/windows-reviewed-inputs.test.mjs
```

All 33 cases pass, including explicit guest doubles for selected-only mapping,
duplicates, missing/deserialized/wrong-operation leases, late revocation, unknown
guest exit, lost identity writes and mismatched VM/configuration exit evidence.
Native NTFS staging acceptance is a separate Windows CI journey. Actual guest
execution, VM stop/restart acceptance and interactive account/device checks have
not been established by these results.
