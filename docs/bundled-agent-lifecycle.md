# Bundled agents keep one exact owner

The bundled custom-agent and LangChain examples demonstrate Switchyard's
authenticated event/action contract. They are synthetic applications, owned by
the suite that launches them. They do not establish control of an arbitrary
external agent or permission to run a model task.

Stopping an example now retains its exact child until exit is confirmed. An
overlapping stop joins the same retirement; a start during retirement is refused.
If exit is unconfirmed or the stop helper throws, the child remains owned and
another start is refused. Returning to companion mode does not erase that
uncertainty. A later confirmed stop or the exact child's close event permits a
fresh start. No PID search, replacement process or broader kill target is used.

Startup failures also retire their owned child. The stop route joins pending
startup before reading the retained child. Its saved agent status is `unknown`
until retirement is confirmed, with no last-seen availability or task-completion
claim. Shutdown joins provider cleanup and reports an unconfirmed bundled-child
exit instead of silently succeeding. The existing direct-child stop deadlines
and synthetic examples' private-stdin parent-loss behavior are unchanged.

The defect was reproduced in four isolated cases before the production change.
The correction passes seven focused groups and 72 tests, including six new
regressions. A real bundled Node process authenticates readiness over the local
HTTP bridge, refuses a duplicate launch, exits under concurrent stop requests,
then restarts with a distinct authenticated session and exits when keyboard-only
mode is selected. Both exact process exits are checked. Existing abrupt-parent-loss,
provider, observation and package checks also pass. Type checking and the
original package budget pass; owned temporary staging was removed.

[Source receipts and limitations](evidence/bundled-example-lifecycle-source-summary.json)
distinguish this Linux demonstration from provider doubles. These checks do not
accept a new LangChain runtime execution, arbitrary descendant containment,
live installed bundled-example execution or native Windows execution. Frontend and extension
activation remain frozen; no real account, model task or hardware operation ran.

The normal installed update at `4b2daed` now passes 20 owner/journal metadata
checks and verifies the exact tested suite module hash. All 54 workspace semantic
snapshots remain unchanged, 53 sealed files remain byte-identical, and the
frozen frontend is unchanged. The prepared bundle is removed and only current
plus one rollback remain. No bundled example or provider is launched by these
installed checks. [Installed evidence](evidence/installed-bundled-examples-summary.json).
