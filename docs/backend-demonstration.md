# Try the connected backend

This walkthrough exercises Switchyard's normal authenticated API and encrypted
store without an account, keyboard connection or installed application. It uses
an explicit synthetic agent and two separate private stores to demonstrate the
product loop in one command.

From the repository with the pinned dependencies already present:

```sh
mise exec node@24.14.0 -- node scripts/demo-switchyard-backend.mjs --synthetic
```

A successful command prints a JSON report containing seven passing stages and
confirmed cleanup. Any failed assertion or incomplete cleanup returns a failure.

| Step | What the running application demonstrates |
| --- | --- |
| Start with a preset | Load the F77 Classic Dvorak reference and its four controls in keyboard-only mode. A reference cannot authorize a host shortcut. |
| Connect a role | List a named saved agent connection, bind its supported status intent, and reject reuse of the stale choice. |
| Use and observe | Send the stable role intent through the authenticated API, claim/acknowledge it through the signed Node SDK, and review deliberate marks and agent metadata together. |
| Refine the workflow | Omit reports while paused, resume recording, stop it, and save a corrected workflow name. Suggestions remain questions, not measured savings. |
| Save and reopen | Export a portable profile without enrollment or session identities, delete the observation, and verify the saved workflow and deletion through a new store instance. |
| Simulate another host | Review/import into a second private store. Preserve the four controls and revised workflow, with no transferred agents or role connections and keyboard-only mode. |
| Check Work policy | Refuse a personal custom agent, recording and profile export in a managed Work compartment. |

The synthetic agent acknowledges only the demo's status command. It performs no
model or external task. Both stores run on the same machine; this is a simulated
second-host import. The original F77 and its typing configuration are untouched.
The demo opens only ephemeral loopback servers, uses temporary encryption keys,
and removes its own private state after its servers retire. It does not change
the installed application, frontend, desktop bindings or account configuration.

[Executed demonstration and focused checks](evidence/backend-connected-demo-summary.json)
record exact source hashes. The [requirement ledger](switchyard-requirements.md)
separately tracks the rest of the suite, native platform checks and physical
acceptance. [Read the product introduction](../README.md) to start with the UI.

The same public CLI and argument-refusal checks also pass on native Windows at
`864fe0d`: two tests, no skips, within the original 45-second group limit, with
original process-tree and temporary-state cleanup. This accepts the named demo,
not the complete Windows release. [Native evidence](evidence/backend-connected-demo-native-summary.json).

