# Documentation provenance

Current workflow and platform guidance: [August 2026 reassessment](workflow-reassessment-2026-10.md), [Linux/Windows capability matrix](platform-capability-matrix.md), [local baseline workflow capture](workflow-capture.md), and [read-only Codex thread inventory](codex-thread-inventory.md). They preserve the canonical 65 assigned chords and keep uncommissioned physical behavior unaccepted.

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
