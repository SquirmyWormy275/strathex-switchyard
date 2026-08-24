# SXSY-B122 Key Decisions

> **Historical incremental ledger.** This file preserves interview-era notes but is incomplete and is no longer the authoritative specification. Use [`SXSY-B122-complete-key-specification-and-audit.md`](SXSY-B122-complete-key-specification-and-audit.md) for the reconciled 22-key map, full modifier matrices, architecture, feasibility gates, and adversarial review.

## Sandbox key

- Physical bank: upper row.
- Legend: a playful, readable beach-sandbox illustration—a cartoon mound of sand with a small plastic shovel sticking out of it. Use a bold simplified silhouette and strong color contrast so the image remains legible at keycap size; keep it visually distinct from the branded launcher keys and technical Git symbols.
- Normal — **`.venv`:** for the verified active Python repository, create the repository-local `.venv` if missing, select it as VS Code's Python interpreter, open a new integrated terminal with it activated, and bind subsequent Run commands to that interpreter.
- Shift — **Fresh `.venv`:** safely rebuild the verified repository-local `.venv` from the project's pinned dependencies. Preserve the old environment until the replacement is created successfully, and never remove an unverified or external path.
- Alt — **Full Sandbox:** create or enter the active repository's fully isolated runtime, covering processes, ports, disposable data, credentials, and networking in addition to dependencies.
- Shift+Alt — **Fresh Full Sandbox:** tear down and rebuild only the coordinator-owned full sandbox, preserving any explicitly approved persistent volumes or exports.
- Ctrl+Shift+Alt — **Quarantine:** run unknown or risky code with no host credentials or production data, read-only source, denied or explicitly allowlisted networking, and CPU, memory, and time limits.
- A `.venv` isolates Python packages only; it is not presented as filesystem, process, data, credential, or network isolation.
- Repository or environment ambiguity must open a concise picker or stop. No action may guess a target, delete an unverified path, inject production secrets, or connect tests to production data.

## Shield key

- Physical bank: upper row.
- Identity: a direct repository security, privacy, supply-chain, and containment control. It is not an agent-supervision action.
- Normal — **Change Scan:** scan staged, unstaged, and new files in the active repository for exposed credentials, PII, dangerous configuration, and security defects introduced by the current changes.
- Shift — **Codebase Audit:** deep-scan the tracked repository and relevant Git history for secrets, insecure code paths, permission mistakes, and unsafe infrastructure configuration.
- Alt — **Supply Chain:** audit locked dependencies, known vulnerabilities, licenses, package provenance, and the software bill of materials. Stale advisory data yields an incomplete result, never a false pass.
- Shift+Alt — **Release Shield:** run every declared security check in a clean disposable environment against the exact revision and produce a security receipt.
- Ctrl+Shift+Alt — **Emergency Containment:** block every outbound action for the active repository through the companion, including push, pull-request creation or update, merge, Direct Main, and deployment. Preserve all local work, identify the exposure without revealing secret values, determine whether it reached Git history or a remote, and open the containment and credential-rotation workflow. Never delete work or rotate credentials automatically.
- A green, exact-revision Release Shield receipt permits PR merge and Direct Main. A red or incomplete receipt blocks them. Any code, lockfile, or configuration change invalidates the receipt. Local commits remain available for remediation.
- Scans run locally by default and must distinguish passed, failed, unavailable, and not run. Partial coverage cannot appear green.
- Overrides require an explicit reason, expire, and remain in the audit record.
- If per-key lighting is available: blue means scanning, green means clean, amber means incomplete or overridden, and red means blocked. Otherwise, show the same state through the companion UI.

## Pipeline key

- Physical bank: upper row.
- Identity: a direct CI and validation command that escalates deliberately from observation to execution, diagnosis, reproduction, and finally isolated repair.
- Normal — **Status Scan:** show the active branch's latest CI/CD state plus the last known local test, lint, type-check, and build results. Repeated presses cycle failing gates.
- Shift — **Run Local Gate:** execute the repository-declared validation sequence with isolated test data: tests, lint, typing, build, and configured project checks.
- Alt — **Failure Trace:** read the selected failing local or hosted logs, trace the likely source, and report a diagnosis without changing files.
- Shift+Alt — **Clean Reproduction:** reproduce the selected failure in a disposable environment and preserve the exact command, environment fingerprint, logs, and relevant diff.
- Ctrl+Shift+Alt — **Repair Mission:** launch an isolated Claude or Codex repair worker bound to the exact failing repository, branch, revision, and gate. Require reproduction before modification, restrict scope, run affected and full declared checks, and return the diff, exact results, remaining risks, and proposed next action.
- Repair Mission may not push, merge, rerun costly hosted jobs, or deploy unless separately authorized.
- The backend enforces the repair contract, isolation, and evidence gates; reliability must not depend on an agent remembering a standing prompt.

## Voice key

- Purpose: start or focus a genuine two-way voice conversation and bind it to the relevant managed agent session.
- Normal: start or focus the preferred voice command center.
- Shift: switch voice providers, moving between Claude and ChatGPT without changing the bound work context.
- Alt: bind the active voice conversation to the currently focused managed Claude or Codex agent in VS Code.
- Shift+Alt: open the Voice Session Picker showing every managed agent available for binding.
- Repeated press or long press handles basic call control such as ending or muting; those actions do not consume a modifier assignment.
- The implementation must be backend-neutral. Claude and Codex are equal supported targets; an existing native Codex path is not permission to ship a Codex-only design.
- A host-side voice coordinator owns session discovery, focused-session binding, transcript routing, spoken responses, and handoff between desktop, browser, and VS Code surfaces.
- Backend adapters may differ internally, but the physical-key behavior and user experience must remain consistent across Claude and Codex.
- If the active target is ambiguous, show a concise session picker rather than guessing.
- If a backend lacks a reliable native voice entry point, use the coordinator bridge or mark that surface unavailable; never silently fall back to controlling only Codex.
- Acceptance gate: the key is not complete until equivalent end-to-end workflows are demonstrated for managed Claude and Codex sessions, including their VS Code integrations.

## Launcher key legends

- **ChatGPT:** use the current official ChatGPT logo and its official brand color treatment.
- **Claude:** use the current official Claude logo and its official brand color treatment.
- **VS Code:** use the current official Visual Studio Code logo and its official brand blue treatment.
- Verify current brand assets before producing the physical legends; do not approximate or redraw the logos from memory.

## Compound Engineering Commit key

- Physical bank: upper row.
- Legend: a distinctive Git-style commit symbol or short commit phrasing. Do not use Compound Engineering branding on this key; the separate Compound key owns that identity.
- Normal: run Compound Engineering's local commit workflow in the active managed Claude or Codex session.
- Shift: PR Upsert. Push the branch and create, update, or open its pull request without creating duplicates.
- Alt: merge the existing pull request after exact-head, required-check, approval, and mergeability verification.
- Shift+Alt: guarded **Direct Main** for explicitly authorized repositories only, with an immediate fetch, validation, no force push, and final confirmation.

## GitHub key

- Physical bank: upper row.
- Legend: GitHub logo.
- Normal: open the focused workspace's repository home page on GitHub; use the GitHub dashboard or a repository picker if the workspace is ambiguous.
- Shift: open the current branch's pull request; if none exists, open the repository's pull-request list.
- Alt: open the repository's Issues page.
- Shift+Alt: open the latest GitHub Actions run for the current branch, or the branch-filtered Actions list when there are multiple relevant workflows. If the repository has no Actions runs, open Actions and report that none are configured.
- Boundary: navigational only. This key does not commit, push, merge, rerun, or cancel workflows.

## Compound key

- Physical bank: upper row.
- Legend: use Compound Engineering's official script **E** mark and official brand-color treatment; distinguish it visually from the Compound Engineering Commit key during final legend design.
- Normal: identify the focused managed Claude or Codex session and run Compound Engineering's `ce-compound` workflow in its verified repository, capturing the solved problem as durable project knowledge.
- Shift: run `ce-compound-refresh` to review and refresh stale or drifting project learnings.
- Alt: open a context-aware Compound Engineering workflow palette for the verified active repository.
- Shift+Alt: run Compound Engineering's guarded `lfg` workflow after showing the repository, requirements source, intended scope, and authorized actions for confirmation.
- Routing: focused managed session wins; show a picker or stop when the session or repository is ambiguous.
