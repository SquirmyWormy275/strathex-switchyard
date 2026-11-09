# Manage a connected agent

Open **Your tools → Manage connected agents** to inspect a saved custom-agent
connection and its recent commands. The panel shows the original session, report
time and provenance. Loading or refreshing it does not contact an agent. An
adapter's completion report remains a self-report, not independent verification.

Select **Review access revocation** to see the exact connection, roles removed,
queued commands cancelled locally and claimed commands retained as uncertain.
The separate confirmation revokes that connection's authority. Other agents keep
their permissions; reconnecting requires deliberate enrollment and new bindings.
Use the existing [SDK enrollment guide](../integrations/README.md) for new agents.

For an uncertain command from a retired session, **Review this uncertainty**
shows the original command, session and retained handoff. Confirming records that
you reviewed the uncertainty. It sends no command and proves no external outcome.
The review explains that this record becomes eligible for the existing bounded
history retention. A late authenticated acknowledgement from the original adapter
takes precedence over a stale local review.

The bundled Custom and LangChain examples also expose **Review owned example stop**.
This can retire only the exact child still owned by this host; a missing owner is
reported as not observed. It neither revokes enrollment nor certifies external
task completion. Owned retirement remains available in a Personal keyboard-only
workspace. Revocation and uncertain-outcome changes require Personal companion
mode.

Workspace, connection and command changes discard an open review. Lost replies
refresh saved state without replaying an action or its consumed confirmation.
Handoff text is rendered as text and cleared when changing workspaces.

Eight interaction cases use real authenticated HTTP, encrypted storage, one-use
reviews and isolated signed SDK sessions. The broader eight-group run passes 115
tests; four complete-page interaction groups pass 33 tests with overlap. Thirteen
checks pass against the running synthetic demonstration. No installed agent was
enrolled, revoked or commanded. Browser rendering and live agent acceptance remain
separate. [Exact source evidence](evidence/agent-maintenance-ui-source-summary.json),
[backend contract](custom-agent-revocation.md).
