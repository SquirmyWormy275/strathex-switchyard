# B122 software residual ledger — local companion implementation

**Revision:** post-PR #4 implementation branch.  “Implemented locally” means
there is executable code and an isolated test; it does not mean hardware or a
proprietary/cloud surface has been accepted.

| Control | Settled chords accounted for | Concrete local evidence | Honest residual |
| --- | --- | --- | --- |
| Re-anchor | normal | Local simulated-provider pause | Proprietary provider pause adapter |
| Proof | normal, shift | Target-bound context/review packet injection | Cross-provider reviewer launch |
| Option Provider | normal, shift | Target-bound decision packet injection | Provider response generation |
| Plan Expander | normal | Target-bound alternatives packet injection | Provider response generation |
| Plan Approval | normal | Authority/target checks in coordinator | Authenticated UI authority issuance |
| Handoff | normal, shift, alt, shift-alt | Context packet; extension focus/queue UI | Planner native adapter |
| Find Blocked | normal, shift | Observable discovery model; extension queue | Native provider status probe |
| Find Finished | normal, shift | Observable discovery model; extension queue | Native provider status probe |
| Authority Refresh | normal, shift | Scoped-authority validator and replay packet | Authenticated local authority UX |
| Council | normal, shift, alt | Conflict/lease machinery and provider acknowledgements | Automatic mode remains gate-disabled |
| Claude | normal, shift, alt | Managed-session records and unavailable truth | Claude Desktop/Code authorization |
| ChatGPT | normal, shift, alt | Managed-session records and unavailable truth | Codex/Desktop authorization |
| VS Code | normal, shift | Extension session registration/selection/status | Multiple-window live acceptance |
| Terminal | normal, shift | Managed terminal creation/adoption | External-terminal focus adapter |
| Commit | normal, shift, alt, shift-alt | Live Git status/diff, reviewed commit/push broker | Merge/direct-main stays gate-disabled |
| GitHub | normal, shift, alt, shift-alt | Explicit unavailable path | GitHub authorization/API adapter |
| Compound | normal, shift, alt, shift-alt | Authority/receipt path | Compound installation/authorization |
| Run | normal, shift, alt, shift-alt | Isolated recipe broker seam | Repository run/debug recipe |
| Voice | normal, shift, alt, shift-alt | Selected-session UI and unavailable truth | Voice provider/binding authorization |
| Pipeline | normal, shift, alt, shift-alt, ctrl-shift-alt | Local recipe runner, test isolation denial | Repository-specific recipe; Repair remains disabled |
| Shield | normal, shift, alt, shift-alt, ctrl-shift-alt | Local diff secret-pattern scan and receipt route | Scanner/advisory integrations; containment release disabled |
| Sandbox | normal, shift, alt, shift-alt, ctrl-shift-alt | Canonicalized filesystem and recoverable sandbox/quarantine leases | Full VM/container acceptance remains disabled |

All rows map to the canonical 65 entries in
`packages/protocol/src/b122.ts`; intentionally unassigned chords are rejected
there and in `ControlRouter`. Direct test evidence is
`apps/windows-companion/test/control-plane.test.ts`,
`apps/windows-companion/test/local-runtime.test.ts`, and
`apps/windows-companion/test/router.test.ts`.

## Acceptance status

No acceptance gate is newly marked passed by this branch. Automated evidence
now covers live temporary Git repositories, stale-target rejection, target-bound
review, filesystem allowlists, sandbox release approval, isolated recipe denial,
local IPC authentication, crash-safe receipt persistence, duplicate dispatch,
and simulated provider lifecycle. Hardware, installed-provider, GitHub/cloud
credential, real scanner-feed, and end-user Windows/VS Code acceptance require
separate observed evidence.
