# Control Taxonomy Requirements

> **Historical foundation:** The accepted
> [complete 22-key / 65-chord specification](SXSY-B122-complete-key-specification-and-audit.md)
> is the current control contract and supersedes this pre-specification
> placeholder. The criteria below remain applicable to a future, evidence-backed
> revision; they do not reopen a settled chord by implication.

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
| Recovery | re-anchor safely, reconcile before retry, reopen lost session, restore known layout |

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

- Main face: durable intent (`RE-ANCHOR`, `PROOF`, `HANDOFF`). The historical
  `HALT` example is superseded; no standalone HALT control was accepted.
- Front face: optional native shortcut, signal identifier, or mode cue.
- No fabricated command language solely to make the board look thematic.
- Avoid tool brand names unless the key truly remains dedicated to that tool.
- Danger styling is reserved for meaningfully guarded actions.

## Version history

### V1 - physical and visual prototype

The exact-scale insert pipeline worked. The control map did not represent real agentic work well enough. Conventional IDE actions were overrepresented; concurrent session control, worktree navigation, interruption, redirection, permission handling, and review were underrepresented.

### V2 - pre-specification placeholder

The historical V2 placeholder was superseded by the accepted complete
specification. Any future revision must use the workflow-study evidence and the
admission criteria above rather than treating this placeholder as an active map.
