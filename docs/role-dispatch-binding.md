# Keep a command with its original role binding

Reassigning a workflow role invalidates a custom-agent request that has not yet
entered the queue. The enqueue transaction checks the exact binding and role
definition under the same state lease as the command write. Changing the target,
removing or editing the role, or deliberately rebinding it to the same agent all
invalidate the earlier request. Each new binding receives a fresh local identity;
existing bindings remain usable until deliberately replaced.

A command that was already queued stays with its original authenticated session.
If the role changes before the result is recorded, dispatch reports uncertainty
and does not attribute that result to the replacement role. It does not cancel,
redirect or automatically repeat the original command. Inspect that agent's
command record before issuing another deliberate request.

Seven regression and demonstration cases use encrypted temporary workspaces and
authenticated agent messages. They cover four changes before enqueue, a change
after enqueue, one-time polling and acknowledgement by the replacement session,
and legacy compatibility. Five cases reproduced the original bug. The corrected
six-group check passes 88 tests with one declared Windows-only skip; both
TypeScript checks pass. Original process bounds and cleanup verify.
[Source evidence](evidence/role-dispatch-binding-source-summary.json).

A physical shortcut also captures the active workspace's selection generation.
Starting a departure invalidates the request even if the departure fails or the
user returns to the same workspace. The custom-agent enqueue checks the saved
selection and the active generation under its state lease; shutdown refuses the
pending command. The existing native-focus and fixed-client-launch callbacks
receive the same workspace guard. A fresh request after deliberately returning
works normally. Commands already queued keep their original session.

Five additional cases reproduced the earlier workspace race. The expanded check
passes seven groups, 106 tests and one declared platform skip, with both
TypeScript checks. It includes authenticated HTTP native-focus doubles, round-trip
workspace changes and a failed departure. The generation belongs to the running
Suite; a separate process rewriting selection away and back entirely between
reads is outside this generation check.
[Workspace lifecycle evidence](evidence/physical-workspace-lifecycle-source-summary.json).

These are source-level corrections; the installed application remains `738c1f7`.
Other provider adapters still need equivalent checks immediately before their
native effects. The shared final history check prevents stale attribution, but
does not prevent an earlier native effect. No live account, model, installed
agent, keyboard or frontend operation was used for this verification.
