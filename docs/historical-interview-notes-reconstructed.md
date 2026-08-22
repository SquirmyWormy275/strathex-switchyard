# Historical B122 interview notes — reconstruction

> Provenance: this is a reconstruction from the accepted complete specification
> and historical decisions ledger. The original conversational transcript was
> not copied into this repository, so this document must not be read as a
> verbatim transcript.

## Settled workflow observations

- The working path is desktop planning, a Markdown brief, manual transfer to
  the active VS Code repository, then execution in an already-selected Codex or
  Claude Code session.
- Repeated failures worth addressing are instruction drift, approval amnesia,
  copy/paste handoff loss, repository/session confusion, unsupported completion
  claims, and difficulty locating blocked or finished agents.
- A visible workspace lock or context display alone was rejected as inadequate:
  the system must change routing or evidence behaviour, not merely show state.
- The left bank is the Agent Control Plane; the upper row is the Workspace
  Command Bar. This separates how an agent should work from what the computer
  should focus or operate.

## Controls that emerged from the interview

The initial control vocabulary included Re-anchor, Proof, Option Provider, Plan
Expander, Plan Approval, and Handoff. The complete design added Find Blocked
Agent, Find Finished Agent, Authority Refresh, Council, and the twelve
workspace commands. Shift-Proof and Shift-Option Provider are modifiers, not
separate physical keys.

## Safety conclusions carried into implementation

Firmware can emit a signal but cannot examine a repository, coordinate agents,
or enforce policy. A `Managed` session can be registered or routed, but it
cannot truthfully be described as filesystem-, Git-, credential-, network-, or
test-data-controlled. Those guarantees require a companion, VS Code integration,
and mediated brokers. Empty Ctrl layers are intentionally reserved; they are
not invitations to add behavior.

## Historical status

The original interview settled control intent. The durable-operation model,
broker rules, protected receipts, target snapshot, containment persistence, and
many enforcement details are derived architecture needing separate validation.
