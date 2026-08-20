# Control Taxonomy Requirements

The control map is deliberately **not final**.

## Candidate functional families

These families guide observation; they do not reserve keys:

| Family | Examples of intent |
|---|---|
| Routing | next session, previous session, project channel, terminal/editor focus |
| Lifecycle | start, resume, checkpoint, interrupt, redirect |
| Review | inspect diff, open changed files, review agent result, run verification |
| Context | send selected context, copy path/reference, open task instructions |
| Repository | status, worktree selection, branch/PR navigation |
| Authority | bounded approve, deny, guarded consequential action |
| Recovery | halt, retry safely, reopen lost session, restore known layout |

## Admission criteria

A permanent control must have:

1. a durable verb or noun phrase suitable for a physical legend;
2. evidence of repeated use;
3. at least one precisely specified supported context;
4. defined behavior for unsupported or ambiguous contexts;
5. a visible success/failure signal;
6. rollback or recovery behavior where applicable; and
7. a testable acceptance criterion.

## Legend rules

- Main face: durable intent (`HALT`, `REVIEW`, `RESUME`).
- Front face: optional native shortcut, signal identifier, or mode cue.
- No fabricated command language solely to make the board look thematic.
- Avoid tool brand names unless the key truly remains dedicated to that tool.
- Danger styling is reserved for meaningfully guarded actions.

## Version history

### V1 - physical and visual prototype

The exact-scale insert pipeline worked. The control map did not represent real agentic work well enough. Conventional IDE actions were overrepresented; concurrent session control, worktree navigation, interruption, redirection, permission handling, and review were underrepresented.

### V2 - pending workflow study

V2 will be produced only after the structured interview and baseline observation identify the actual control loop.
