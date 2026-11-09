# Switchyard documentation

Start with a usable configuration, then learn the boundaries behind it. The
[current implementation](switchyard-status.md) and
[requirement ledger](switchyard-requirements.md) distinguish working software,
unfinished implementation and acceptance that needs external access.

## A practical learning path

1. [Try the guided setup](guided-setup.md): choose a keyboard, preserve typing,
   connect one named control and review its result.
2. [Understand configuration and recovery](switchyard-configuration.md): follow
   proposal, preview, exact review, trial, keep and restore.
3. [Connect your tools](coding-task-controls.md): distinguish a saved task,
   reported status, reviewed message and actual task attachment.
4. [Move a profile](portable-profiles.md): transfer preferences while keeping
   local connections and credentials separate.
5. [Run the backend demonstration](backend-demonstration.md): exercise the
   connected path using disposable state before extending an adapter.

## Find a task

| Task | Guide |
| --- | --- |
| Choose a Model F or inspect the pilot | [Standard configurations](model-f-standard-configurations.md), [Alex's F77](../examples/alex-f77/README.md), [B122 reference](../examples/alex-b122/README.md) |
| Install, update or recover | [Suite installation](suite-installation.md), [release recovery](suite-release-recovery.md), [optional runtime](optional-runtime.md) |
| Design with a conversation | [Saved design conversations](saved-conversation-controls.md), [workflow observations](workflow-capture.md), [voice notes and transcript import](voice-note-controls.md), [Claude hooks](claude-hook-observation.md) |
| Work with a coding task | [Codex bindings](coding-task-bindings.md), [Claude Code bindings](claude-task-bindings.md), [reviewed native text](native-coding-tasks.md), [editor commands](editor-task-controls.md) |
| Open or return to an application | [Native app controls](native-app-controls.md), [Windows native focus](windows-native-focus.md), [approved Microsoft work accounts](copilot-account-controls.md) |
| Inspect and run repository work | [Read-only inspection CLI](inspect-cli.md), [task permissions](task-permission-controls.md), [reviewed execution](reviewed-execution-controls.md), [mediated Git effects](mediated-repository-effects.md) |
| Prepare a repository scan | [Scanner setup](scanner-setup-controls.md), [signed feeds](feed-maintenance-controls.md), [Shield coverage](shield-baseline-scanner.md), [example evidence](evidence/README.md) |
| Print control labels | [Assignment references and legends](assignment-legends.md) |
| Extend or review the engineering | [Integration contracts](../integrations/README.md), [architecture](02-system-architecture.md), [operational boundary](operational-safety-model.md), [verification](verification.md) |
| Resume implementation | [Current status](switchyard-status.md), [requirement ledger](switchyard-requirements.md), [continuation](switchyard-continuation.md) |

The earlier [Omarchy first-use guide](try-switchyard.md) and
[workflow reassessment](workflow-reassessment-2026-10.md) describe the separate
recorder and canonical B122 controls. They are historical context for the current
Suite, not substitutes for the guided setup.

## B122 source provenance and historical records

- `SXSY-B122-complete-key-specification-and-audit.md` is the accepted complete
  22-key specification and includes its full adversarial review and 27 gates.
  It was copied faithfully from the accepted local source artifact on 2026-08-22;
  only three trailing Markdown line-break spaces were normalized.
- `SXSY-B122-key-decisions-historical-ledger.md` is the historical incremental
  ledger, retained for traceability. It is superseded by the complete design.
- `historical-interview-notes-reconstructed.md` is a clearly labelled
  reconstruction from the accepted specification and ledger. It is not a
  verbatim transcript.
- `adversarial-review.md` is a source-backed, implementation-oriented index of
  the review in section 9 of the complete design. It is not a substitute for
  that complete source.
- `software-only-completion-audit.md` distinguishes the completed
  hardware-independent source boundary from the separate device,
  provider, and operational acceptance evidence unavailable in this checkout.
- `software-residual-ledger.md` maps all 22 controls and 65 settled chord
  assignments to their concrete local mechanisms and honest external edges.
- `software-completion-audit.md`, `post-merge-adversarial-audit.md`, and
  `candidate-transport-git-containment-evidence.md` are explicitly historical
  point-in-time records. They do not override the current audit or gate register.
- `acceptance-gates.md` is the authoritative 27-gate status register; every
  gate remains **NOT ACCEPTED** until its required real-world evidence exists.
- `provider-adapter-protocol.md` specifies exact capability, command,
  automatic-Council, Git smart-HTTP, and GitHub adapter contracts.
- `windows-release-and-installation.md` defines the content-verified Windows
  bundle, per-user state boundary, checksums, SBOM, transactional lifecycle,
  and the limits of local installation evidence.
- `linux-release-and-installation.md` defines the content-verified Linux x64
  bundle, Secret Service/Unix-socket boundary, Bubblewrap/process supervision,
  systemd user lifecycle, VSIX, and optional hidraw/provider prerequisites.
- `linux-software-completion-audit.md` maps the Linux implementation to its
  source, hosted verification, fail-closed configuration, and genuine external
  or hardware residuals.
- `SXSY-B122-operator-technical-manual.md` is the versioned first-install,
  daily-operation, recovery, and troubleshooting manual. Its embedded printable
  reference is mechanically generated from the canonical protocol and command
  catalog.
- `generated/SXSY-B122-65-chord-reference.md` and
  `generated/SXSY-B122-documentation-manifest.json` record the exact 22-control,
  65-assignment, 111-unassigned surface and source/output digests.
- `demo/` contains an offline deterministic fail-closed storyboard and playback.
  It is explicitly simulated and supplies no hardware, provider, or acceptance
  evidence.

The implementation follows the documented safety boundary: a keyboard signal
may route an intent, but only mediated execution can enforce policy.
