# SXSY-B122 Complete Key Specification and Adversarial Review

**Status:** The 22 key names, bank allocation, and interview-approved behaviors are captured. Derived safety constraints, architecture proposals, and prototype assumptions remain pending approval and validation.
**Date:** 2026-08-22
**Scope:** All 22 re-legendable B122 specialty keys, their settled modifiers, host architecture, safety contract, feasibility assessment, rejected concepts, gaps, and implementation gates
**Authority hierarchy:** User interview decisions govern product intent. Derived safeguards in this report are proposed requirements. Installed workflow behavior and external documentation are capability evidence only; they cannot add user authority. The sources reconciled were the complete workflow interview, `SXSY-B122-key-decisions.md`, the installed Compound Engineering workflows, and current first-party platform documentation.

## 1. Executive decision

The interview produced a complete **logical allocation of all 22 specialty keys**:

- **10-key left bank — Agent Control Plane:** controls how agents recover, verify, decide, transfer context, remember authority, and coordinate.
- **12-key upper row — Workspace Command Bar:** controls applications, Git/GitHub, Compound Engineering, execution, voice, CI, security, and environments.

The 22 concepts are settled. The following are **not** settled:

- exact position-by-position placement within either bank;
- firmware transport for all 22 signals;
- most physical legends for the left bank and several upper-row keys;
- the implementation technology for the Windows companion, desktop/browser adapters, full sandbox, and voice bridge;
- behavior for deliberately unassigned modifier combinations;
- proof that prototype-gated features work reliably on the user's exact hardware and installed app versions.

This distinction matters: the keyboard map is conceptually full, but the product is not implementation-ready and must not be described as built, validated, or fully feasible yet. This document should become implementation authority only after the user approves the derived trust, safety, and architecture requirements as well as the interview-settled controls.

## 2. Settled mental model

The organizing rule is:

> **If the command tells an agent how to work, it belongs on the left. If it tells the computer where to go, what to run, or what system to operate, it belongs on top.**

### 2.1 Agent Control Plane — 10 left-bank keys

1. Re-anchor
2. Proof
3. Option Provider
4. Plan Expander
5. Plan Approval
6. Handoff
7. Find Blocked Agent
8. Find Finished Agent
9. Authority Refresh
10. Council

### 2.2 Workspace Command Bar — 12 upper-row keys

1. Claude
2. ChatGPT
3. VS Code
4. Terminal
5. Commit
6. GitHub
7. Compound
8. Run
9. Voice
10. Pipeline
11. Shield
12. Sandbox

The numbering above is for documentation only. It is **not** the physical order.

## 3. Status language and modifier policy

### 3.1 Feasibility labels

- **Direct:** Built from stable operating-system, VS Code, Git, GitHub, or installed CLI capabilities; still requires integration and testing.
- **Host-integrated:** Feasible only through the proposed Windows companion and/or VS Code extension.
- **Prototype-gated:** Plausible, but reliability depends on an adapter, undocumented UI behavior, provider support, or an isolation backend that has not been proven.
- **Unavailable on an unmanaged surface:** The command must report that it cannot verify the target. It must not guess.

### 3.2 Modifier meanings

- **Normal:** primary, high-frequency behavior.
- **Shift:** a closely related expansion, fresh variant, queue, or deeper check.
- **Alt:** a lower-frequency contextual alternative.
- **Shift+Alt:** advanced combined behavior.
- **Ctrl+Shift+Alt:** exceptional mode with unusually high consequence or containment. It is assigned only to Pipeline, Shield, and Sandbox.
- **Repeat or long press:** reserved for a small number of stateful controls such as window cycling or voice call control.

**Proposed implementation requirements, pending hardware testing:** treat left and right Shift, Alt, and Ctrl equivalently unless testing reveals a conflict; trigger a chord once on a defined key event; use debouncing and an action lock; and avoid Windows shortcuts already claimed by other applications. These are safety recommendations, not interview-settled key assignments.

### 3.3 Deliberately unassigned combinations

No key has a settled **Ctrl**, **Ctrl+Shift**, or **Ctrl+Alt** behavior. These are reserved, not missing requirements. The design must not invent functions simply to fill them.

Across the eight documented chord classes—Normal, Shift, Alt, Shift+Alt, Ctrl, Ctrl+Shift, Ctrl+Alt, and Ctrl+Shift+Alt—the interview settled **65 behaviors out of 176 possible chord slots**. The other **111 slots remain intentionally unassigned**.

## 4. Complete modifier matrices

In these tables, **Unassigned** means no behavior was approved. It does not mean “do nothing forever,” and it does not authorize an implementer to choose a behavior.

### 4.1 Left bank — Agent Control Plane

| Key | Normal | Shift | Alt | Shift+Alt | Ctrl | Ctrl+Shift | Ctrl+Alt | Ctrl+Shift+Alt | Repeat / long press |
|---|---|---|---|---|---|---|---|---|---|
| Re-anchor | Stop safely if needed, reread authority/context/docs, inspect work, return with discrepancies/questions | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Proof | Evidence-based self-verification | Cross-backend adversarial review | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Option Provider | Five options and one recommendation for the current decision | One numbered packet for all pending decisions, with options and a recommendation for each | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Plan Expander | Fifteen ranked creative alternatives | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Plan Approval | Execute the approved plan in the already-selected agent session | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Handoff | Planner-to-coding-agent context transfer | Queue a blocker/decision packet | Jump to planner with the packet now | Toggle queue versus immediate-focus default | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Find Blocked Agent | Focus the next verified blocked agent | Open Blocker Queue | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Repeated normal presses cycle verified blocked agents |
| Find Finished Agent | Focus the next verified finished agent | Open Done Queue | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Repeated normal presses cycle verified finished agents |
| Authority Refresh | Replay existing scoped authority to the active agent | Reviewed individualized broadcast to selected agents | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Council | Report cross-agent conflicts and dependencies | Auto-partition and isolate only clearly independent work | Propose one coordinated plan and await one approval | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |

### 4.2 Upper row — Workspace Command Bar

| Key | Normal | Shift | Alt | Shift+Alt | Ctrl | Ctrl+Shift | Ctrl+Alt | Ctrl+Shift+Alt | Repeat / long press |
|---|---|---|---|---|---|---|---|---|---|
| Claude | Open/focus Claude Desktop | Fresh Claude surface | In VS Code, open a managed Claude Code terminal | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Claude window cycling unresolved |
| ChatGPT | Open/focus ChatGPT Desktop | Fresh ChatGPT surface | In VS Code, open a managed Codex terminal | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | ChatGPT window cycling unresolved |
| VS Code | Focus last-used VS Code window | Open a new VS Code window | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Repeated normal presses cycle VS Code windows |
| Terminal | Open/focus external terminal | Open/focus VS Code integrated terminal | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Commit | Compound local commit workflow | PR Upsert | Verified PR merge | Guarded Direct Main | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| GitHub | Repository home | Current-branch PR or PR list | Issues | Current-branch Actions run/list | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Compound | Capture one durable learning | Refresh the learning store | Compound workflow palette | Guarded full `lfg` loop | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Run | Run active file or configured target | Debug | Stop the managed Run process | Start web app, detect URL, open browser | Unassigned | Unassigned | Unassigned | Unassigned | Unassigned |
| Voice | Start/focus two-way voice center | Switch Claude/ChatGPT provider | Bind focused managed VS Code agent | Voice Session Picker | Unassigned | Unassigned | Unassigned | Unassigned | Repeat/long press handles mute/end; exact split unresolved |
| Pipeline | Status scan | Run local gate | Diagnose selected failure | Reproduce cleanly | Unassigned | Unassigned | Unassigned | Isolated Repair Mission | Repeated normal presses cycle failing gates |
| Shield | Scan current changes | Deep codebase/history audit | Supply-chain audit | Exact-revision Release Shield | Unassigned | Unassigned | Unassigned | Emergency Containment | Status lighting if hardware supports it |
| Sandbox | Create/enter repo `.venv` | Safely rebuild `.venv` | Create/enter full sandbox | Rebuild full sandbox | Unassigned | Unassigned | Unassigned | Quarantine | Unassigned |

## 5. Detailed Agent Control Plane contracts

### 5.1 Re-anchor

**Feasibility:** Host-integrated.

**Normal behavior**

1. Resolve the active managed agent and its exact task.
2. If it is running, request a cooperative stop at the earliest safe boundary.
3. Make it reread the original instructions, approved brief, relevant project documentation, current authority, and current work state.
4. Make it inspect what it has already changed.
5. Return with discrepancies, risks, questions, and the result of the re-anchor check.

Manual stopping must remain available when the user wants to type a correction before re-anchoring.

**Boundary:** Re-anchor repairs broad context or task drift. It ends with the agent's report; it does not silently resume execution. It does not grant new authority and does not roll files back. “Undo the Drift” was absorbed conceptually, but no destructive automatic undo was approved.

**Unresolved:** Shift, Alt, Shift+Alt, all Ctrl combinations, legend, color, and lighting.

### 5.2 Proof

**Feasibility:** Host-integrated; Shift is prototype-gated across providers.

**Normal — evidence-based self-verification**

The active agent must demonstrate completion against:

- the approved brief and requirements;
- required project documentation;
- repository, branch, worktree, and target snapshot, including exact revision and dirty state;
- implementation and current diff;
- changed and relevant unchanged files;
- exact tests and results;
- unresolved risks, assumptions, and checks not run.

Passed, failed, unavailable, incomplete, assumed, and not run must remain distinct.

**Shift — cross-backend adversarial review**

The coordinator assembles the original plan, instructions, documentation, repository identity, implementation, diff, files, test evidence, and the first agent's self-audit. It then launches the other configured backend—Claude reviewing Codex or Codex reviewing Claude—to challenge correctness, intent, and evidence.

**Boundary:** Proof evaluates evidence. It does not silently fix, commit, push, merge, or deploy. Requirements Check and Ship Readiness were rejected as separate controls because they belong here; Failure Hunt was rejected because Shift-Proof is stronger.

**Unresolved:** Alt, Shift+Alt, all Ctrl combinations, reviewer tie-breaking when several candidates exist, legend, color, and lighting.

### 5.3 Option Provider

**Feasibility:** Host-integrated.

- **Normal:** for the one decision currently blocking progress, give exactly five concise options and one clear recommendation.
- **Shift:** collect all pending decisions into one numbered packet, with options and a recommendation for each, so the user can answer them together.

**Boundary:** A recommendation is not approval. The control cannot choose an option or resume consequential work without the user's answer. The five-option requirement was settled for Normal; the exact number per item in the Shift packet was not separately settled.

**Unresolved:** Alt, Shift+Alt, all Ctrl combinations, legend, color, and lighting.

### 5.4 Plan Expander

**Feasibility:** Host-integrated.

- **Normal:** when the overall approach is weak, obvious, or unimaginative, use verified project context to generate fifteen additional creative approaches and rank them.

**Boundary:** Option Provider solves one concrete decision with five concise choices. Plan Expander challenges the overall approach with fifteen broader alternatives. It does not approve, replace, or execute a plan.

**Unresolved:** Shift, Alt, Shift+Alt, all Ctrl combinations, repeat/long press, legend, color, and lighting.

### 5.5 Plan Approval

**Feasibility:** Host-integrated.

- **Normal:** execute the approved, exact plan revision immediately in the already-selected Claude Code or Codex executor session in VS Code that received or reviewed the plan. The backend is selected before approval; there is no routine executor chooser and no routine second confirmation.

The binding must include the originating session, repository, branch/worktree, task, plan revision, decisions, and authority. If it is missing or stale, stop or show an ambiguity picker.

**Boundary:** Approval authorizes the settled plan, not unrelated actions or broader authority. The decision tree owns identifying independent branches; Plan Approval starts approved execution; Handoff supplies scoped context; Council supplies coordination and isolation. Dispatch was rejected because it duplicated this chain.

If execution may mutate files, Git, credentials, or external systems through an agent, the selected executor must be Mediated. An unmediated session may receive the approved plan but cannot be represented as policy-enforced execution.

**Unresolved:** Multi-agent spawn policy; Shift, Alt, Shift+Alt, all Ctrl combinations, repeat/long press, legend, color, and lighting. A stale or missing binding may require a failure picker, but the key press itself is the settled plan approval.

### 5.6 Handoff

**Feasibility:** Host-integrated; cross-app delivery is adapter-dependent.

- **Normal — planner to coder:** create a durable package whose settled minimum is the plan, decisions, existing authority, relevant documentation, and references/links. Bind it to the verified repository and task, then open or focus the selected managed coding session. Constraints, open questions, and next-action order are recommended schema fields pending final schema approval.
- **Shift — queue:** capture a coding-agent blocker or major decision as a compact planning packet and queue it for later review.
- **Alt — immediate:** capture the same packet and jump to the bound planner now.
- **Shift+Alt — routing default:** toggle future decision returns between queue and immediate focus. The state should be visible through an LED if available or through the companion UI.

**Boundary:** Handoff transfers context; it does not approve, execute, commit, push, merge, or deploy. Park/Resume was dropped because working agents can remain running, blocked and finished agents have queues, and Handoff already preserves decisions.

**Unresolved:** Whether the durable packet retains the entire raw planning conversation; exact queue UI; LED color; all Ctrl combinations; legend.

### 5.7 Find Blocked Agent

**Feasibility:** Host-integrated for managed sessions; prototype-gated or unavailable for arbitrary desktop windows.

- **Normal:** focus the next **verified blocked** managed agent. Repeated presses cycle the verified blocked set across supported surfaces.
- **Shift:** open the Blocker Queue with every verified blocked agent and the reason it is waiting.

**Boundary:** This key navigates and triages; it does not solve the block. Approval amnesia routes to Authority Refresh, a real decision routes to the decision controls, and cross-agent collisions route to Council.

An unmanaged, idle, or merely visible Claude/ChatGPT window cannot be labeled blocked without an explicit status signal.

**Unresolved:** Queue overlay versus VS Code panel; Alt, Shift+Alt, all Ctrl combinations, legend, color, and lighting.

### 5.8 Find Finished Agent

**Feasibility:** Host-integrated for managed sessions; prototype-gated or unavailable for arbitrary desktop windows.

- **Normal:** focus the next **verified finished** managed agent. Repeated presses cycle the verified finished set.
- **Shift:** open the Done Queue for triage.

**Boundary:** It does not accept the work, start another task, merge, close the session, or otherwise act on completion. Finished must be a verified session state, not an inference from window appearance or silence.

**Unresolved:** Queue presentation; Alt, Shift+Alt, all Ctrl combinations, legend, color, and lighting.

### 5.9 Authority Refresh

**Feasibility:** Host-integrated.

- **Normal:** replay to the active agent its existing session-specific authority packet: approved plan, already-authorized actions, constraints, prohibitions, and decisions still requiring the user. Before resuming, compare the agent's current pending request, target snapshot, plan revision, and requested action with the stored authority. Require acknowledgement and continue only on an exact authorized match; any mismatch, new decision, or unrelated blocker reports and stops.
- **Shift — Scoped Authority Broadcast:** prepare a different, task-specific reauthorization packet for each selected agent. Show recipients and summaries for review/editing before sending.

Authority must be versioned and scoped by repository, task, session, plan revision, allowed actions, prohibitions, expiry, and revocation.

**Boundary:** Authority Refresh cures approval amnesia. Re-anchor cures broad context drift. Refresh never creates authority, broadens scope, or bypasses mandatory operating-system, product, API, or safety prompts.

**Unresolved:** Selection defaults for a broadcast; Alt, Shift+Alt, all Ctrl combinations, legend, color, and lighting.

### 5.10 Council

**Feasibility:** Prototype-gated.

- **Normal — Conflict Report:** query all Observable agents in the verified repository; collect tasks, planned files, current diffs, dependencies, branches/worktrees, shared runtime resources, and status; report collisions and dependencies. Unless every participant also accepts a Controllable pause, label the report non-atomic and include its collection timestamps.
- **Shift — Guarded Automatic:** begin a coordination epoch and obtain a cooperative write pause from every participant. Auto-partition and isolate only clearly independent work. Create worktrees or equivalent isolation behind the scenes when needed. Deliver an individualized, scoped assignment and path/task ownership lease to every affected agent; require acknowledgement before resuming the epoch or claiming coordination succeeded. A new diff, lost heartbeat, lease conflict, missing participant, overlap, dependency, ambiguity, or stale state invalidates the epoch and stops automatic coordination. Council never stashes, moves, or rewrites dirty work automatically.
- **Alt — Recommend and Approve:** propose one coordinated plan from the fresh collected state, then wait for one user approval.

The final Shift/Alt mapping above supersedes an earlier reversed version.

Inside VS Code, a focused managed Claude or Codex terminal selects its adapter. If editor focus or multiple candidates make that ambiguous, show a session picker. Manually created terminals require one-time adoption.

**Boundary:** Council does not make random terminals “talk.” It coordinates sessions only to the level of capability they have proved through the host coordinator. Find Blocked locates an agent; Council coordinates several agents. Plan Approval and Handoff own initial execution/context; Council owns collision detection, partitioning, isolation, and ongoing coordination. The Worktree key was rejected because worktrees should be invisible machinery here. Worktrees isolate working copies, not ports, databases, caches, generated artifacts, credentials, or remote branch names; those resources need Sandbox/resource leases or Council must stop.

**Unresolved:** Shift+Alt, all Ctrl combinations, legend, color, lighting, exact cross-provider protocol, acknowledgement presentation, and the multi-session prototype. Per-agent acknowledgement itself is required; only its UI remains open.

## 6. Detailed Workspace Command Bar contracts

### 6.1 Claude

**Feasibility:** Normal is Direct; Shift and Alt are adapter-dependent, with Shift prototype-gated.

**Legend:** current official Claude logo and brand-color treatment, verified from current source artwork before production.

- **Normal:** open or focus Claude Desktop.
- **Shift:** create a fresh Claude work surface. The desired behavior is a new desktop window; if the installed app cannot reliably do that, the accepted fallback is a fresh Claude chat.
- **Alt, while VS Code is active:** open a new integrated terminal running Claude Code and register it as a managed session.

**Unresolved:** Alt outside VS Code, Claude multi-window cycling, Shift+Alt, all Ctrl combinations, and reliable separate-window behavior.

### 6.2 ChatGPT

**Feasibility:** Direct plus host integration.

**Legend:** current official ChatGPT logo and brand-color treatment, verified before production.

- **Normal:** open or focus ChatGPT Desktop.
- **Shift:** create a fresh ChatGPT desktop or companion surface.
- **Alt, while VS Code is active:** open a new integrated terminal running Codex and register it as a managed session.

The ChatGPT Windows app currently documents a configurable companion-window hotkey, which makes the fresh-surface path plausible; app and shortcut conflicts still require testing.

**Unresolved:** Alt outside VS Code, ChatGPT multi-window cycling, Shift+Alt, and all Ctrl combinations.

### 6.3 VS Code

**Feasibility:** Direct.

**Legend:** current official Visual Studio Code logo and official blue treatment.

- **Normal:** focus the last-used VS Code window.
- **Repeated Normal:** cycle through open VS Code windows.
- **Shift:** open a new VS Code window.

**Unresolved:** what the new window opens—blank window, repository picker, or inherited workspace; Alt, Shift+Alt, and all Ctrl combinations.

### 6.4 Terminal

**Feasibility:** Direct.

- **Normal:** open or focus the preferred external Windows terminal.
- **Shift:** open or focus the integrated terminal in the verified VS Code window.

**Unresolved:** Windows Terminal versus direct PowerShell, default profile, shell, working directory, environment, multi-window routing, all other modifiers, legend, and color.

### 6.5 Commit

**Feasibility:** Host-integrated, using stable Git and Compound primitives plus host-enforced routing and safety gates.

**Legend:** a distinctive Git commit glyph or short Git phrasing. No Compound/Every branding.

- **Normal — Local Commit:** run the installed Compound Engineering local commit workflow in the verified active repository. “Local” means no push or PR. With changes on the default branch or a detached HEAD, the current workflow creates and switches to a feature branch before committing; a clean tree stops. It may split clearly separate changes into two or three logical commits. Commit only task-owned, named paths. This requires an isolated task worktree with a clean index or a broker-owned temporary index whose resulting tree is verified before commit. If unrelated staged work exists and neither isolation method is available, stop and show it; never invoke the workflow against a shared dirty index.
- **Shift — PR Upsert:** if no matching PR exists, push and create one; if it exists, push new commits, update its description when needed, and open its status; if nothing changed, open it. Never create duplicates. The Compound wrapper must use `babysit:off` or an equivalent hard stop: Shift-Commit does **not** hand the PR to automated feedback resolution, CI repair, additional commits/pushes, or CI reruns.
- **Alt — Merge PR:** merge only after immediately re-verifying repository, remote, branch, exact PR head, required checks, approvals, and mergeability.
- **Shift+Alt — Direct Main:** direct push to the default branch only for explicitly authorized repositories, with an immediate fetch, exact-target verification, declared validation, no force push, and a final confirmation.

Release Shield is necessary but not sufficient. A current green receipt bound to the complete target snapshot permits the action to proceed to the remaining authorization, exact-head, branch-protection, CI, and mergeability gates. A red, stale, or incomplete receipt blocks Merge and Direct Main. Emergency Containment blocks every brokered outbound Commit-key mode but leaves local commits available for remediation.

**Unresolved:** final color, all Ctrl combinations, exact merge method, and the repository allowlist/authority UI for Direct Main.

### 6.6 GitHub

**Feasibility:** Direct.

**Legend:** GitHub logo; final color treatment unresolved.

- **Normal:** open the verified workspace repository home.
- **Shift:** open the current branch's PR; if none exists, open the PR list.
- **Alt:** open Issues.
- **Shift+Alt:** open the current branch's latest GitHub Actions run, or the branch-filtered list when several workflows apply. If none exist, open Actions and clearly report that state.

Target identity is the GitHub host plus owner/repository, canonical remote, head owner/branch, and base branch. Forks, multiple remotes, several matching PRs, and GitHub Enterprise require verified resolution or a picker. A non-GitHub remote must never silently fall back to the public GitHub dashboard.

**Boundary:** Navigation only. It never commits, pushes, edits a PR, merges, reruns, or cancels a workflow. Pipeline owns diagnosis and repair.

**Unresolved:** all Ctrl combinations and behavior when the workspace has no GitHub remote beyond a picker/dashboard fallback.

### 6.7 Compound

**Feasibility:** Host-integrated; unavailable when the selected managed environment lacks Compound Engineering.

**Legend:** official Compound Engineering/Every script **E** and current brand treatment, visually distinct from Commit.

- **Normal — Capture:** run `ce-compound` for one solved, verified, non-trivial problem, creating or updating durable project learning.
- **Shift — Refresh:** run `ce-compound-refresh` to audit the repository's captured learnings for drift, overlap, supersession, and contradiction. Because the installed workflow may update, consolidate, replace, delete, and commit documents, show the affected scope and mutation preview; destructive scope requires explicit authorization rather than being hidden behind the word “Refresh.”
- **Alt — Workflow Palette:** open the context-aware Compound Engineering workflow palette for the verified repository.
- **Shift+Alt — Full Loop:** after one wrapper-level confirmation showing repository, requirements source, scope, and authorized actions, run `lfg` end to end.

Current installed-workflow details matter:

- `ce-compound` writes project documentation and maintains project vocabulary. It may edit an **existing** project instruction file only in interactive Full mode and only after explicit consent; it never creates a new instruction file for discoverability.
- `ce-compound-refresh` can update/consolidate/replace/delete stale learning documents and commits its changes when successful. It is not a read-only “refresh.”
- `lfg` is a hands-off plan → implement → simplify → review → test → commit/push/PR → CI-watch pipeline. It can push and open a PR, but it does not authorize deployment. Full Loop is disabled for an unmediated session; in mediated mode every credential use and external mutation must pass through the execution broker and approved operation manifest.

**Boundary:** The wrapper confirmation cannot bypass Emergency Containment, Release Shield requirements, provider permission prompts, or repository authority. Normal Compound captures learning; it is not the same as Normal Commit. Capture and Refresh require a Mediated agent session or a direct broker implementation for every file/Git mutation; an unmediated session may only preview the proposed documentation work.

**Unresolved:** all Ctrl combinations, remote/container/profile availability, and whether the palette is an overlay or VS Code view.

### 6.8 Run

**Feasibility:** Direct through VS Code configuration and a managed-process registry.

- **Normal — Run:** execute the active file with the configured runtime, terminal, and environment. For Python, use the selected `.venv`; a declared workspace run target may take precedence for an application.
- **Shift — Debug:** start the active file or named workspace configuration in the VS Code debugger and honor breakpoints.
- **Alt — Stop:** stop only the process tree previously launched by Run for the active workspace. Store an operating-system job/process-tree identity rather than trusting a reusable PID; request graceful termination first, then offer bounded forced termination of that exact tree.
- **Shift+Alt — Launch Web App:** start the configured web application if needed, discover its actual local URL from trusted configuration or server output, wait until it responds, and open it. Never guess a port or IP address. Open only `http`/`https` loopback URLs by default or an explicitly repository-allowlisted development host. Treat server output as untrusted and validate the URL against the run recipe and, where possible, the managed process's listening socket.

**Boundary:** Run executes; Sandbox selects or builds isolation. Alt-Run cannot kill arbitrary terminals or unrelated processes.

**Unresolved:** precedence between active file and workspace run configuration, response when no URL is discoverable, every Ctrl combination, legend, and color.

### 6.9 Voice

**Feasibility:** Native ChatGPT and Claude desktop Voice are established; global activation, cross-provider context preservation, and VS Code agent binding are host-integrated and prototype-gated.

- **Normal:** start or focus a genuine two-way voice command center, not dictation or microphone toggle.
- **Shift:** switch between Claude and ChatGPT providers without changing the coordinator-owned work context.
- **Alt:** bind the voice conversation to the currently focused managed Claude or Codex session in VS Code.
- **Shift+Alt:** open a Voice Session Picker for all bindable managed agents.
- **Repeat/long press:** mute and end; the exact gesture assignment is unresolved.

The host coordinator owns the canonical context packet, session discovery, binding, transcript routing, spoken responses, and handoffs. Provider-specific adapters may differ internally, but missing Claude support may not silently route to Codex. “Switch providers without changing context” is desired coordinator behavior, not a native-provider guarantee.

Current first-party documentation establishes Voice in ChatGPT desktop Work/Codex and full conversational Voice on Claude Desktop and the web. The remaining asymmetry is launch and binding: a documented Windows-global Claude Voice shortcut or deep link was not established, and neither provider documents the coordinator-owned binding to a specific managed Claude Code or Codex session in VS Code. Those behaviors remain explicit prototype gates.

**Unresolved:** preferred provider, exact mute/end gestures, native-extension support, all Ctrl combinations, legend, and color. The Voice prototype must explicitly choose native-app automation, a custom voice gateway, or a hybrid; acceptance requires context injection, response routing, interruption, microphone consent, single-active-conversation handling, transcript retention/deletion, and target isolation.

### 6.10 Pipeline

**Feasibility:** Host-integrated; clean reproduction and Repair Mission are prototype-gated per repository.

- **Normal — Status Scan:** show the active branch's latest CI/CD state and last known local test, lint, type-check, and build receipts. Repeated presses cycle failures.
- **Shift — Local Gate:** through the test-environment broker, run the repository-declared tests, lint, typing, build, and configured project checks with isolated test data. A repository manifest defines the concrete commands. If no verified isolation recipe exists, report unavailable and do not run.
- **Alt — Failure Trace:** read the selected local or hosted logs and report a diagnosis without editing files.
- **Shift+Alt — Clean Reproduction:** reproduce the selected failure in a disposable environment and preserve the exact command, environment fingerprint, logs, and relevant diff.
- **Ctrl+Shift+Alt — Repair Mission:** launch a mediated, isolated Claude or Codex worker bound to the exact target snapshot and failing gate. Reproduce first, modify only the approved scope, run affected and full declared checks, and return the diff, exact results, risks, and proposed next action.

**Boundary:** The execution and test-environment brokers—not a standing prompt—enforce the repair contract. A merely registered or observable terminal cannot run Repair Mission. The broker removes production credentials, rejects configured production hosts/DSNs, allocates disposable databases/storage/temp paths, and applies declared egress policy. Repair Mission cannot push, merge, rerun a costly hosted job, deploy, or use production data without separate authority. GitHub Shift+Alt opens the provider UI; Pipeline interprets, reproduces, validates, and optionally repairs.

**Unresolved:** repair-provider selection, hosted-service credential policy, what constitutes the repository-declared gate, Ctrl/Ctrl+Shift/Ctrl+Alt, legend, and color.

### 6.11 Shield

**Feasibility:** Host-integrated and scanner-dependent; complete coverage is prototype-gated.

- **Normal — Change Scan:** inspect staged, unstaged, and new files for credentials, PII, dangerous configuration, and security defects introduced by the current changes.
- **Shift — Codebase Audit:** inspect tracked code and relevant Git history for secret exposure, insecure paths, permission errors, and unsafe infrastructure configuration.
- **Alt — Supply Chain:** audit locked dependencies, known vulnerabilities, licenses, provenance, and SBOM.
- **Shift+Alt — Release Shield:** run every declared security check in a clean disposable environment against the complete target snapshot and issue a security receipt.
- **Ctrl+Shift+Alt — Emergency Containment:** block outbound actions made through the companion for the repository, preserve local work, identify the exposure without revealing values, determine whether it entered history or a remote, and open the containment/credential-rotation workflow.

Results are **passed, failed, unavailable, incomplete, or not run**. Shield publishes a coverage matrix by ecosystem and scanner; unsupported provenance, license, PII, history, or vulnerability checks remain unavailable/incomplete. Stale advisory data and partial scanner coverage are incomplete, never green. Changes to target inputs, security policy, scanner/tool versions, trust roots, advisory data, or receipt expiry invalidate the result. A configured policy must distinguish relevant ignored secret-bearing files such as `.env` from enormous ignored build trees. Overrides require a reason, expiry, and audit entry. Shield never deletes work or rotates credentials automatically.

If supported, lighting is blue while scanning, green when declared checks pass, amber for incomplete/override, and red when blocked. The companion must show the same state because per-key RGB has not been established on this hardware.

**Boundary:** Emergency Containment governs brokered actions. It cannot truthfully stop a user, raw shell, unrelated tool, or remote service that bypasses the mediated boundary.

**Unresolved:** scanner suite, advisory sources and freshness SLA, history depth, PII policy, SBOM format, override authority, printed legend, and all other Ctrl combinations.

### 6.12 Sandbox

**Feasibility:** `.venv` modes are Direct; Full Sandbox and Quarantine are prototype-gated.

**Legend:** a bold cartoon mound of beach sand with a small bright plastic shovel, simplified for keycap readability and distinct from branded launchers and Git symbols.

- **Normal — `.venv`:** in the verified active Python repository, create repo-local `.venv` if missing, select it as VS Code's interpreter, open a new activated terminal, and bind later Run commands to it.
- **Shift — Fresh `.venv`:** rebuild the verified repo-local environment from pinned dependencies in a sibling temporary path, validate it, close/detach using terminals, rename the existing `.venv` to a recovery name, and swap in the replacement. Delete the old environment only after success. Windows file-lock or rename failure must preserve both copies and report exact recovery steps. Never remove an unverified or external path.
- **Alt — Full Sandbox:** create or enter a fully isolated runtime covering dependencies, processes, ports, disposable data, credentials, and network policy.
- **Shift+Alt — Fresh Full Sandbox:** rebuild only the coordinator-owned sandbox while preserving explicitly approved persistent volumes or exports.
- **Ctrl+Shift+Alt — Quarantine:** execute unknown or risky code with no host credentials or production data, read-only source, denied or allowlisted networking, and CPU, memory, and time limits.

**Boundary:** `.venv` isolates Python packages only. It does not isolate the filesystem, processes, data, credentials, or network. Tests must never use a production database.

**Unresolved:** non-Python Normal behavior, container versus WSL/VM isolation backend, Windows filesystem/network enforcement, persistent-volume UI, Ctrl/Ctrl+Shift/Ctrl+Alt, and exact color palette.

## 7. Cross-key responsibility boundaries

| Need | Owning control | What nearby controls do instead |
|---|---|---|
| Agent forgot the task, documents, or current state | Re-anchor | Authority Refresh only replays permission; Proof verifies work |
| Agent forgot already granted permission | Authority Refresh | Re-anchor is broader; Plan Approval authorizes the approved plan once |
| Demonstrate that work meets intent | Proof | Pipeline executes correctness gates; Shield executes security gates |
| Run tests/build/lint and diagnose failures | Pipeline | Proof evaluates the resulting evidence; GitHub only opens the Actions UI |
| Decide among concrete choices | Option Provider | Plan Expander challenges the overall approach; Plan Approval executes the chosen plan |
| Move context between planner and coding agent | Handoff | Voice binds a live conversation; neither one grants new authority |
| Find an agent waiting or done | Find Blocked / Find Finished | Council coordinates several agents and resolves ownership/isolation |
| Prevent parallel working-copy collisions | Council | Worktrees are hidden machinery, not a user-facing key |
| Perform a surgical Git lifecycle action | Commit | Compound `lfg` owns the entire autonomous engineering loop |
| Capture or maintain engineering learnings | Compound | Commit stores code history; Handoff stores task context |
| Execute/debug/stop an application | Run | Sandbox chooses and enforces its environment |
| Inspect current security posture | Shield | Pipeline covers correctness; Emergency Containment covers brokered egress |

## 8. Required system architecture

The physical keyboard cannot inspect a repository, know whether an agent is blocked, select a PR, or enforce authority. QMK firmware sends keycodes/scancodes, and QMK Raw HID can provide bidirectional host communication, but complex behavior requires a host program.

```text
B122 + Vial/QMK
        |
        | unique key/chord event; optional Raw HID state
        v
Windows Companion / Policy Engine
        |
        +-- Canonical target, capability, and session registry
        +-- Task, plan, queue, and durable operation coordinator
        +-- Protected authority, receipt, policy, and audit stores
        +-- Picker/overlay and hardware-feedback service
        +-- Redaction, containment, reconciliation, and budget service
        |
        +--> VS Code extension --> Git roots, windows, terminals, Run/Debug, Claude Code, Codex
        +--> Desktop adapters --> Claude, ChatGPT, VS Code, Windows Terminal
        +--> Browser adapter  --> supported Claude/ChatGPT/GitHub browser surfaces
        +--> Structured tool adapters --> Git, GitHub API/CLI, Compound, CI, scanners
        +--> Execution + credential brokers --> mediated processes and outbound mutations
        +--> Test-environment broker --> disposable databases, storage, temp paths, egress policy
        +--> Isolation runtime --> containers, WSL/VM, resource limits, quarantine
```

### 8.1 Firmware and transport

- The twelve upper keys may emit F13–F24 because QMK defines them as standard HID keycodes.
- F13–F24 are transport identities, not the printed semantic legends.
- The other ten keys require distinct harmless HID codes or a custom Raw HID event protocol.
- Raw HID is attractive because it is bidirectional and can support device state, but it requires custom firmware and a host listener.
- The user's exact Leyden Jar firmware must be inspected and tested. Upstream documentation establishes Vial-QMK, a custom Raw HID monitoring protocol, and three status LEDs; it does not establish the exact B122 mapping or per-key RGB.
- Existing Raw HID is a diagnostic protocol, not automatically an unused application channel. The prototype needs a compatibility check, protocol/firmware version handshake, device identity and mapping checksum, sequence numbers and acknowledgements, and defined behavior for hot-plug, sleep/resume, multiple keyboards, and Vial remapping.
- The design must decide whether ordinary HID events are suppressed, passed through, or combined with Raw HID. Synthetic HID input must be tested.
- A rare chord or Raw HID event expresses user intent and reduces accidental activation; neither one is authentication on a compromised host.

### 8.2 Capability and session registry

“Managed” must not be treated as synonymous with “enforced.” Sessions expose independent capability flags, not an ordinal ladder:

- **Registered:** the companion can identify and focus the surface.
- **Observable:** the provider supplies structured state, heartbeat, and completion/blocking signals.
- **Controllable:** the provider supports verified pause, context injection, and resume.
- **Mediated:** filesystem writes, Git operations, credentials, process execution, and network egress pass through an enforceable broker or operating-system isolation boundary.

Elsewhere in this document, **managed** is only an umbrella term for a registered session with an explicitly recorded capability set. It never implies mediation by itself. A broker can mediate a specific command even when it cannot pause a provider conversation, and a controllable conversation can still have unrestricted filesystem/network bypass.

Adopting an arbitrary terminal records only capabilities proven through shell integration and a provider handshake. It does not upgrade the terminal to observable, controllable, or mediated. Missing capabilities remain unknown.

Find Blocked/Finished and Council Normal require Observable. Re-anchor requires Controllable. Council Shift requires Observable + Controllable + Mediated for every participant. Any key invoking agent-driven file, Git, credential, or external mutation requires a Mediated session; a direct broker implementation may operate from a Registered context only when the agent itself cannot bypass the broker. Repair Mission, `lfg`, Shield-gated Merge/Direct Main, and enforceable Containment require Mediated execution. Unmediated sessions may be focused, observed to their proven level, or given previews/advisory instructions, but the product cannot claim to enforce their scope.

Each registry record needs at least:

- provider and adapter version;
- app surface, window, and terminal identity;
- Git root, remote, branch, worktree, and target snapshot identity;
- task, plan revision, ownership, and planned files;
- authority version, allowed actions, prohibitions, expiry, and revocation;
- current state and last heartbeat;
- process/run identity and relevant receipts.

Minimum state model:

- running;
- verified blocked;
- verified finished;
- unreachable;
- stale;
- unknown.

Unknown, idle, or stale must never be relabeled as blocked or finished merely to make a queue look complete.

### 8.3 TargetSnapshot

“Exact revision” is insufficient when the working copy is dirty. Every consequential operation and gate-bearing receipt binds to a complete `TargetSnapshot` containing:

- canonical Git root and canonical remote;
- branch, upstream, and HEAD object ID;
- index tree hash;
- relevant tracked worktree content manifest and relevant untracked-file manifest;
- submodule revisions;
- repository policy and run/gate configuration versions;
- tool, scanner, dependency, and environment fingerprints needed by the action.

If required state cannot be hashed, an untracked file cannot be classified, or dirty state exceeds policy, the result is incomplete or blocked. Release Shield requires either a clean committed target or a complete dirty-state snapshot.

### 8.4 VS Code extension

The extension must register Git roots, workspaces, VS Code windows, branches/worktrees, terminals, run/debug configurations, and managed processes. It must create tagged Claude/Codex terminals and support one-time registration of manually opened sessions. VS Code's extension API provides terminal creation, terminal events, workspace identity, and debug start/stop primitives, but shell integration and provider handshakes determine whether a terminal is actually observable or controllable. Agent meaning, authority, and mediation remain outside VS Code's basic terminal API.

### 8.5 Execution, credentials, testing, and isolation

The companion is not an enforcement boundary by itself. A normal Claude/Codex terminal can bypass it with raw Git, direct filesystem access, inherited credentials, or arbitrary networking. Enforceable features therefore use:

- an **Execution Broker** for approved commands, files, Git mutations, process trees, and external side effects;
- a **Credential Broker** that supplies only short-lived, repository/action-scoped credentials;
- a **Test-Environment Broker** that strips production credentials, rejects configured production hosts/DSNs, allocates disposable databases/storage/temp paths, and applies declared egress policy;
- an **Isolation Runtime** for read-only mounts, network rules, resource caps, and quarantine.

If no verified test-isolation recipe exists, Pipeline and Repair report unavailable rather than inheriting an ordinary shell's `.env` or credentials. Desktop/browser UI automation may focus, navigate, or activate a voice control; consequential repository, GitHub, credential, security, or deployment mutations require a structured API/CLI through the broker or remain unavailable.

### 8.6 Durable command transaction and receipts

Every command follows the same transaction:

1. Decode the physical key and modifiers.
2. Resolve the foreground surface and verified target.
3. Construct or refresh the `TargetSnapshot` and capability state if the action is consequential.
4. Stop or show a concise picker when identity remains ambiguous.
5. Validate authenticated authority, safety gates, mediation level, budgets, and action preconditions.
6. Allocate a durable operation ID and lease from the single logical writer.
7. Advance a durable state machine: `Prepared → Executing → External-Committed → Recorded`, with `Failed`, `Cancelling`, and `Compensating` states as needed. Composite commands are parent sagas: every commit, push, PR mutation, CI action, Council isolation step, or other external side effect receives its own child operation ID and reconciliation state.
8. Execute through the appropriate structured adapter or broker.
9. Capture a typed receipt and sanitized audit entry in the protected store.
10. Return visible queued, running, awaiting-input, cancelling, completed, failed, timed-out, unavailable, incomplete, or blocked status.

Debouncing and an in-memory lock reduce accidental repetition but are not idempotency. After a crash, timeout, or lost response, the coordinator reconciles actual provider state before retrying. It never retries an entire parent saga after an ambiguous child result; it reconciles and resumes each child independently. Duplicate-PR prevention is scoped by host, repository, remote, base branch, head owner/branch, and operation ID.

Gate-bearing receipts live outside agent-writable repositories in a protected append-only store. Each receipt records operation ID, actor, authority version, complete target snapshot, policy/tool/scanner/advisory versions, timestamps, evidence digests, result/completeness, expiry, and invalidation lineage. Receipts are authenticated or hash-chained and are never accepted from an agent-authored file.

Every mutation needs partial-failure reconciliation, including branch pushed but PR creation failed, PR merged but receipt recording failed, Council isolation created before a crash, `.venv` swap interrupted, sandbox persistence failure, and repair edits made before validation failed.

### 8.7 Authority and untrusted-content boundary

Repository content, docs, diffs, CI logs, terminal output, PR comments, browser content, dependency output, and provider responses are untrusted data. They may inform diagnosis but cannot grant authority, change target identity, select recipients, disable gates, or issue executable instructions. Authority comes only from the authenticated authority ledger and current authenticated user action.

High-consequence chords express intent; they are not authentication. Merge, Direct Main, `lfg`, Repair Mission, containment release, destructive rebuild, and override still require policy validation and whatever confirmation or reauthentication is configured for that operation. No destructive action is authorized solely by receipt of a keyboard event.

### 8.8 Durable containment

Containment is a durable repository-policy state that survives companion and machine restart and is checked before every brokered credential, Git, network, or deployment action. Activation advances a repository fence epoch, revokes outstanding credential leases, cancels queued and not-yet-externally-committed broker operations, and marks already externally committed or genuinely uncontrolled work separately. Activation is idempotent. Release is never a keyboard toggle: it requires companion-UI review, reauthentication, reason, exact repository confirmation, and incident/credential-rotation status. Already-running external jobs and bypass paths remain visible as uncontrolled.

### 8.9 Operational requirements

- Long-running actions expose queued, running, awaiting-input, cancelling, completed, failed, and timed-out states plus user-visible cancellation.
- Pressing a key whose identical operation is already active focuses its status instead of starting another operation.
- Timeouts, retry budgets, concurrency limits, model/hosted-job cost limits, and cancellation semantics are configured per command class.
- The product needs targets for companion startup/recovery time, routing latency, offline degradation, queue limits, receipt/log retention, adapter health, telemetry, and resource use.
- The provider capability matrix is versioned. Mixed Claude/Codex Council is a separate acceptance scenario; externally visible behavior must match even when adapters differ internally.

### 8.10 Global safety invariants

- Never guess repository, remote, branch, worktree, PR, provider, session, process, environment, URL, or broadcast recipient.
- Revalidate the complete target snapshot and preconditions immediately before consequential actions.
- Durable operation reconciliation—not merely a local mutex—prevents repeated presses or restarts from duplicating PRs, merges, repair missions, sandbox rebuilds, or authority broadcasts.
- Tests and reproductions run through the test-environment broker, use disposable data, and never see a production database or production DSN.
- Secrets and PII are redacted from overlays, logs, voice transcripts, receipts, and audit records.
- Missing credentials, tools, network, advisory freshness, session heartbeat, or validation cannot appear green.
- Consequential actions remain auditable, including authority changes, Council assignments, overrides, containment, merge, Direct Main, sandbox destruction, and repair missions.
- A green Shield receipt is necessary but never sufficient for merge or Direct Main.
- Claude/Codex parity is an acceptance gate wherever the key claims provider-neutral behavior.
- A merely registered or observable session never receives guarantees that require mediation.

## 9. Extreme adversarial review

### 9.1 The good

1. **The two-bank model is coherent.** Agent behavior is separated from direct workspace commands, which substantially reduces cognitive ambiguity.
2. **The design maps the user's actual friction.** Handoff addresses copy/paste context loss; Authority Refresh addresses approval amnesia; Find Blocked/Finished addresses multi-agent attention; Council addresses collisions; launchers address app/window switching; Run restores ordinary development control; Pipeline, Shield, and Sandbox add deterministic validation and isolation.
3. **The best controls are active routines, not standing prompts.** Re-anchor, Proof, Council, and Repair Mission require fresh state and receipts instead of trusting agents to remember instructions.
4. **The plan preserves empty modifier space.** It does not fill Ctrl layers merely because they exist.
5. **Rare chords reduce accidental activation.** Direct Main, Repair Mission, Emergency Containment, and Quarantine are harder to trigger casually. This is an ergonomic safeguard only, not security or informed consent.
6. **Worktrees are hidden machinery.** This is the correct outcome: the coordinator should create isolation, not make the user memorize a Git-worktree sequence.
7. **The architecture recognizes ambiguity.** Picker-or-stop is the only honest default in a multi-repository, multi-window workflow.
8. **Provider parity is explicit.** A convenient Codex implementation cannot masquerade as a complete Claude-and-Codex feature.

### 9.2 The bad

1. **Several keys are semantically dense.** Commit, Compound, Pipeline, Shield, Sandbox, Handoff, and Voice each encode four or five behaviors. They will need excellent legends, on-screen previews, and a quick-reference overlay.
2. **Modifier ergonomics are untested.** Shift+Alt and Ctrl+Shift+Alt may be awkward on a B122, may trigger operating-system shortcuts, and may be difficult for one-handed use. A hardware usability test is mandatory.
3. **The visual system is incomplete.** Most left-bank legends and several upper-row legends/colors do not exist yet. The map cannot go to keycap production.
4. **Normal Commit is more than a plain commit.** With changes on the default branch or a detached HEAD, the installed workflow creates a feature branch and may split changes into logical commits. That is defensible, but a commit glyph alone understates the behavior.
5. **Shift-Compound is mutating.** The current `ce-compound-refresh` workflow can rewrite, consolidate, delete, and commit learning documents. Calling it “Refresh” can sound read-only. The UI must preview scope and report changes.
6. **Plan Approval and Compound `lfg` can both start substantial execution.** The boundary is settled—Plan Approval executes an already approved plan in the existing session; `lfg` creates and runs a full autonomous pipeline—but the UI must show which lifecycle is being entered.
7. **Receipts can become stale between check and action.** A complete `TargetSnapshot` reduces the risk but does not eliminate time-of-check/time-of-use errors; consequential commands must revalidate atomically and protect receipts from agent writes.
8. **The full system is much larger than a keyboard firmware project.** The keyboard is the smallest part. The companion, extension, adapters, registry, security model, and test harness are the product.
9. **The safety requirements are partly derived, not yet user-approved.** The interview settled the control intent; mediation, snapshots, receipt protection, durable leases, and broker policy are necessary engineering conclusions that still need explicit approval.
10. **Operational policy is a product surface.** Timeout, cancellation, budget, concurrency, retention, offline behavior, and recovery cannot be left as internal implementation details for commands that can run for minutes or spend credits.

### 9.3 The ugly

1. **Arbitrary agents cannot coordinate.** Independently opened Claude/Codex terminals do not magically share awareness. Council is truthful only to the level of capability each session proves, and automatic coordination needs controllable/mediated participants plus a coordination epoch.
2. **Desktop blocked/done detection is not dependable by default.** Focusing windows is straightforward; classifying an arbitrary Claude or ChatGPT desktop window as blocked or finished without a supported signal is brittle UI automation. Such windows must remain unknown.
3. **Native Claude Desktop Voice exists, but VS Code binding parity is not established.** Current Anthropic documentation establishes conversational Voice on Claude Desktop and web. It does not establish a Windows-global Voice shortcut, a deep link into Voice, or the required binding to a managed Claude Code session in VS Code. That bridge remains a custom-integration research project.
4. **`.venv` is not security isolation.** Full Sandbox and Quarantine need a real container, WSL, VM, or equivalent enforcement layer. Without it, credential/network/resource claims are false.
5. **A clean local CI reproduction is not universally possible.** Hosted secrets, SaaS dependencies, operating-system differences, unavailable services, or costly hardware can make reproduction incomplete. The key must report incomplete rather than manufacture confidence.
6. **Emergency Containment is not a universal kill switch.** It blocks brokered egress only. It cannot stop raw Git from an unmediated terminal, another application, an already-running remote job, or actions outside its control plane.
7. **Security breadth is undefined.** “Secrets, PII, vulnerabilities, licenses, provenance, SBOM, history” is a program, not one scanner. Until the scanner manifest and freshness policy are declared, Shield cannot honestly claim completeness.
8. **The transport is unfinished.** F13–F24 cover twelve identities, but the ten left keys and bidirectional feedback still need a collision-free protocol on the exact firmware.
9. **Per-key RGB may not exist.** Upstream Leyden Jar information documents three status LEDs, not per-key lighting. Every state must have a companion-UI fallback.
10. **Direct Main is inherently dangerous.** Even guarded, it bypasses the collaboration and review affordances of a PR. It should remain disabled by default per repository and require explicit allowlisting plus final confirmation.
11. **Stopping an agent is not time travel.** Re-anchor can request a safe interruption, but it cannot undo a consequential action already sent to an external system.
12. **Provider and app APIs will drift.** Desktop window behavior, voice entry points, agent session interfaces, and extension surfaces need capability discovery and versioned adapters rather than hard-coded assumptions.
13. **The companion cannot enforce an ordinary terminal.** Without mediated execution, Council, Repair Mission, `lfg`, Direct Main, and Quarantine may route instructions but cannot prevent raw filesystem, Git, credential, or network bypass.
14. **A commit hash does not capture dirty state.** Staged, unstaged, untracked, submodule, policy, scanner, and environment changes can invalidate a result without changing HEAD.
15. **Repository and CI content are prompt-injection surfaces.** Logs, README instructions, PR comments, dependency output, and browser text must never become authority or disable gates.
16. **External side effects survive crashes.** A PR can be created, a branch pushed, or a merge completed before the companion records success. Without durable operation IDs and provider reconciliation, retrying can duplicate or misreport work.
17. **Containment must survive restart.** A volatile in-memory block that disappears on crash or reboot would be worse than no containment because it creates false confidence.

## 10. Overlap audit and required boundaries

| Apparent overlap | Risk if left vague | Required boundary |
|---|---|---|
| Re-anchor vs Authority Refresh | Both look like “remind the agent” | Re-anchor restores full task/context/doc alignment; Authority Refresh replays existing permission only |
| Proof vs Pipeline | Both look like “check the work” | Pipeline executes deterministic gates; Proof evaluates whether evidence satisfies the brief and exposes what is unverified |
| Proof vs Shield | Security findings could be counted twice | Shield creates security evidence; Proof interprets that evidence against requirements |
| Shift-Proof vs `lfg` review | Two reviewers may repeat work | Shift-Proof is an independent cross-backend adversarial review on demand; `lfg` review is an internal stage of a shipping pipeline |
| Option Provider vs Plan Expander | Both generate alternatives | Option Provider: five concise choices for one decision; Plan Expander: fifteen ranked alternatives to the overall approach |
| Plan Approval vs Compound `lfg` | Both can launch implementation | Plan Approval resumes the settled plan in its existing session; `lfg` starts the full autonomous planning-to-PR pipeline |
| Handoff vs Voice binding | Both move context | Handoff creates a durable task packet; Voice provides live conversational routing using the canonical packet |
| Find Blocked vs Council | Both inspect agents | Find Blocked navigates/triages one waiting agent; Council coordinates ownership and isolation across a repository |
| GitHub Actions vs Pipeline | Both expose CI | GitHub opens the provider UI; Pipeline normalizes status and owns diagnosis/reproduction/repair |
| Commit PR Upsert vs Compound `lfg` | Both may push and open PRs | Commit advances an existing local workstream; `lfg` owns an end-to-end autonomous engineering run |
| Run vs Sandbox | Both affect execution environment | Sandbox creates/selects isolation; Run executes and tracks the process inside it |
| Pipeline vs Shield | Both produce clean-environment receipts | Pipeline proves declared correctness gates; Shield proves declared security gates; neither implies the other |

## 11. Feasibility verdict by group

### 11.1 Strong first implementation candidates

- Claude, ChatGPT, VS Code, and Terminal focus/launch behavior.
- VS Code terminal creation and run/debug integration.
- GitHub navigation.
- Basic `.venv` creation/selection.
- Read-only Pipeline status.

These are not “already built,” but they rest mostly on stable platform primitives and do not require pretending an ordinary agent terminal is enforceable.

### 11.2 Feasible after the core coordinator exists

- Re-anchor, Proof Normal, Option Provider, Plan Expander, Plan Approval.
- Durable Handoff packages and decision queues.
- Authority ledger and Authority Refresh.
- Managed Run process stopping.
- Commit and Compound wrappers pinned to an approved workflow version and verified target.
- Test-brokered local Pipeline gates.
- Git safety gates, protected receipts, durable operation reconciliation, and audit records.
- Shield when its scanner manifest is explicitly configured.

### 11.3 Prototype-gated

- Shift-Proof automatic cross-provider review.
- Find Blocked/Finished across desktop and browser surfaces.
- Council across multiple Claude and Codex sessions.
- Fresh Claude/ChatGPT desktop windows on all installed versions.
- Seamless provider-neutral Voice and VS Code agent binding.
- Clean CI reproduction when hosted dependencies exist.
- Isolated Repair Mission.
- Full Sandbox, rebuild, and Quarantine on Windows.
- Raw HID status feedback on the exact B122/Leyden Jar build.

### 11.4 Claims the product must never make

- “All open Claude and Codex windows can see and coordinate with each other.”
- “An idle window is blocked” or “a quiet window is finished.”
- “A `.venv` safely sandboxes untrusted code.”
- “Emergency Containment stops every possible outbound action.”
- “Local reproduction proves hosted CI when required services were unavailable.”
- “A green security scan proves the application is secure.”
- “All 22 physical positions, legends, and firmware signals are finalized.”
- “A registered terminal is mediated or policy-enforced.”
- “A keyboard chord authenticates a high-consequence action.”
- “A commit hash alone identifies staged, unstaged, and untracked work.”
- “Desktop UI automation is safe for consequential mutations.”

## 12. Missed-workflow and general developer-control audit

No change to the settled 22-key allocation is recommended yet. The following gaps are real, but most belong in the backend or require evidence of repeated use before consuming a key or modifier.

### 12.1 Important backend behavior that should not require another key

- **Automatic checkpoints before risky mutations.** This is safer than a manual Undo key and should precede Council repartitioning, Repair Mission edits, environment rebuilds, and consequential Git operations.
- **Global status and notifications.** Find Blocked/Finished should be fed by background notifications; the user should not have to poll constantly.
- **Capability discovery.** Every adapter should advertise what it can actually do on the installed version so unsupported actions appear unavailable before a press.
- **Quick-reference overlay.** Because several keys are dense, the companion should show the active bank, modifiers, target, and consequence before advanced actions.
- **Recipe/configuration files per repository.** Run, Pipeline, Shield, and Sandbox need declared commands and policies rather than guesses.
- **Recovery receipts.** Every destructive rebuild or automatic isolation step needs a recovery path and a record of what was preserved.

### 12.2 Potential future controls, not approved assignments

- **Pause All Managed Agents:** potentially valuable when several agents are drifting or an external incident begins. This is not currently covered by Re-anchor, which targets one active agent. Do not assign it until the user confirms a repeated need and the safe-stop semantics are proven.
- **Deploy/Rollback:** the current map opens local web apps and GitHub CI but does not operate production deployment. The earlier Live key was rejected as overlapping and premature. Revisit only around a real deployment provider and authority model.
- **Performance/Profile:** Pipeline validates correctness but does not profile CPU, memory, I/O, or performance regressions. Profile was discussed but not selected. Revisit only if performance work becomes frequent.
- **Database lifecycle:** migrations, seed/reset, and snapshots are not dedicated controls. Because these can destroy data and vary by project, they should remain declared project workflows unless lived use justifies a key.
- **Dependency upgrades:** Shield audits supply-chain state but does not update dependencies. This belongs in the Compound palette or a guarded project workflow unless it becomes frequent.
- **Non-Python environment bootstrap:** Sandbox Normal is Python-specific. Node, Rust, Java, and polyglot setup remain undefined.

### 12.3 Controls correctly left to the ordinary keyboard or software UI

Save, search, navigation, copy/paste, ordinary browser control, file switching, and standard VS Code commands do not need B122 specialty keys unless future evidence shows exceptional friction. Capture was rejected because an active Claude/ChatGPT window does not reveal what the user intends to capture without a brittle picker.

## 13. Rejected and superseded concepts

These ideas should not be reintroduced without new workflow evidence:

| Rejected concept | Reason |
|---|---|
| Workspace Lock | Merely displaying context did not change behavior; verified targeting belongs in architecture |
| Requirements Check | Absorbed by Proof |
| Failure Hunt | Superseded by Shift-Proof adversarial review |
| Next Move | Overlapped Option Provider |
| Undo the Drift | Broad recovery belongs in Re-anchor; destructive rollback was never approved |
| Ship Readiness | Absorbed by Proof, Pipeline, and Shield evidence |
| Park / Resume | Scrollback, queues, Handoff, Find Blocked, and Find Finished cover the actual flow |
| Dedicated Worktree | Makes the user perform Council's isolation work |
| Project | Duplicated existing launcher/focus and ambiguity handling |
| Capture | Could not infer intent reliably across desktop agent apps |
| Browser | Local app launch is already covered by Shift+Alt-Run; ordinary browsing remains ordinary keyboard work |
| Stack | Overlapped Run and Sandbox |
| Live | Overlapped local web launch and lacked a real deployment provider contract |
| Dispatch | Duplicated decision tree, Plan Approval, Handoff, and Council |
| Repo-adaptive filler keys | Added configuration burden without a demonstrated missing operation |
| Profile | Genuinely distinct, but not selected for the final slot |
| Generic dashboards, notebooks, logs, status, doc sweep | Low-specificity ideas or already covered elsewhere |

## 14. Open decisions

### 14.1 Physical product

- Exact key coordinates and ordering in each bank.
- Signal assignment for all 22 keys.
- Whether to use ordinary HID, Raw HID, or a hybrid.
- Key-down/key-up semantics, chord window, repeat timing, and long-press threshold.
- Exact legends for all ten left-bank keys, Terminal, Run, Voice, Pipeline, and Shield.
- Final Commit symbol and all unchosen colors.
- Printing/manufacturing method, color limits, trademark review, and keycap-size proof.
- Whether the exact board exposes usable status LEDs and whether any per-key lighting exists.

### 14.2 Interaction design

- One common picker/overlay design and where queues live.
- Handoff packet schema and raw-conversation retention.
- Voice architecture—native-app automation, custom gateway, or hybrid—plus default provider and mute/end gestures.
- VS Code Shift behavior: blank, picker, or inherited workspace.
- External terminal/profile/cwd policy.
- Run target precedence and no-URL failure behavior.
- Council's exact approval and acknowledgement UI.

### 14.3 Safety and policy

- Capability-set handshake and the exact boundaries among Registered, Observable, Controllable, and Mediated sessions.
- `TargetSnapshot` schema and dirty/untracked-file policy.
- Authority ledger schema, expiry, revocation, and repository allowlists.
- Protected receipt/audit store, authentication/hash-chain method, and invalidation lineage.
- Durable operation/lease state machine, single-writer design, crash reconciliation, and partial-failure compensation.
- Exact confirmation policy for `lfg`, Merge, Direct Main, repair, rebuild, override, and containment release.
- Shield scanner manifest and freshness policy.
- Pipeline gate manifest, test-environment broker, production-host/DSN deny policy, and hosted-resource/cost policy.
- Execution and credential brokers; sandbox backend; data, egress, and resource-limit policy.
- Durable containment persistence and authenticated release workflow.
- Audit retention, encryption, redaction, and voice-transcript policy.

## 15. Recommended implementation order

### Phase 0 — Approve intent and derived safety contract

- Approve the interview-settled key behaviors separately from the derived architecture and safety requirements; only then promote this document to implementation authority.
- Decide physical order and the remaining legends.
- Settle the trust/enforcement boundary, capability flags, `TargetSnapshot`, protected receipt and authority schemas, durable command state machine, broker policy, containment release, and Voice architecture.
- Keep Direct Main, Council automatic mode, Repair Mission, Emergency Containment release, and Quarantine disabled.

### Phase 1 — Hardware and read-only routing spike

- Inspect the exact B122/Leyden Jar firmware and Vial map.
- Prove 22 unique collision-free events plus modifier timing on Windows.
- Choose HID versus Raw HID and prove protocol coexistence, device/version handshake, mapping checksum, sequence/acknowledgement, hot-plug, sleep/resume, multiple-keyboard behavior, synthetic-event handling, and a visible companion response.
- Implement target display and picker-or-stop with no mutations.

### Phase 2 — Verified workspace foundation

- Build the VS Code extension and capability/session registry.
- Register Git roots, remotes, branches/worktrees, windows, terminals, run/debug configurations, and process identities.
- Build the execution, credential, and test-environment brokers plus the first isolation runtime.
- Add audit logging, redaction, durable leases/operation IDs, crash reconciliation, checkpointing, protected typed receipts, budgets, cancellation, and timeouts.
- Prove two VS Code windows and multiple repositories cannot be confused.
- Prove production credentials, production DSNs, and untrusted repository/log instructions cannot cross the authority boundary.

### Phase 3 — Low-risk Workspace Command Bar

- Claude, ChatGPT, VS Code, Terminal, and GitHub.
- Run/Debug/managed Stop.
- Basic `.venv` creation and selection.
- Compound palette and read-only Pipeline status.

### Phase 4 — Agent Control Plane

- Re-anchor, Proof Normal, Option Provider, Plan Expander, and Plan Approval.
- Durable Handoff and decision queues.
- Authority ledger/Refresh.
- Find Blocked/Finished for managed VS Code sessions first.

### Phase 5 — Consequential Git, validation, and security

- Commit Normal and PR Upsert.
- Pipeline Local Gate/Trace/Reproduction.
- Configured Shield coverage matrices and complete-target-snapshot receipts.
- Merge only after exact-head and receipt gates pass.
- Direct Main remains last and disabled by default.

### Phase 6 — High-risk prototypes

- Cross-backend Shift-Proof.
- Council with coordination epochs, ownership/resource leases, worktree isolation, and failure injection.
- Desktop/browser blocked and finished adapters.
- Provider-neutral Voice bridge.
- Repair Mission.
- Full Sandbox and Quarantine.
- Bidirectional hardware status.

## 16. Acceptance gates

The product is not complete until all applicable gates pass:

1. **Hardware identity:** every physical key and approved chord produces exactly one intended event with no Windows collision.
2. **Target integrity:** multi-repo and multi-window tests prove no action reaches the wrong target; ambiguity always stops or opens a picker.
3. **State honesty:** unknown, stale, unavailable, incomplete, failed, and passed remain distinguishable in every UI and receipt.
4. **Idempotency:** durable parent/child operation IDs and provider reconciliation prove that repeated presses, ambiguous child results, crashes, and restarts cannot duplicate PRs, merges, commits, broadcasts, repairs, or rebuilds.
5. **Test isolation:** brokered validation and reproduction cannot access production credentials, hosts/DSNs, databases, or production data.
6. **Authority:** previously granted scoped authority prevents pointless re-prompts without broadening permission or bypassing required platform approvals.
7. **Target-snapshot safety:** Merge, Direct Main, and release receipts revalidate the complete target snapshot immediately before action.
8. **Containment honesty:** tests demonstrate which outbound paths are blocked and clearly disclose paths outside companion control.
9. **Provider parity:** the versioned capability matrix proves equivalent external behavior for Claude, Codex, and mixed-provider scenarios; unavailable surfaces say so explicitly.
10. **Council failure cases:** missing agents, stale state, overlapping files, dependent tasks, dirty worktrees, and adapter failure all stop automatic partitioning.
11. **Voice binding:** transcripts and commands demonstrably reach only the selected task/session and honor redaction/retention policy.
12. **Isolation:** Quarantine enforcement is proven at filesystem, credentials, data, network, CPU, memory, and time boundaries—not inferred from `.venv`.
13. **Recoverability:** checkpoints and preservation rules are tested before any rebuild, repartition, or automated repair.
14. **Physical usability:** keycap legends remain readable and advanced chords are usable on the actual keyboard.
15. **Mediation:** every agent-driven file, Git, credential, or external mutation requires a Mediated session; bypass attempts are denied in mediated sessions and disclosed in unmediated ones. Direct broker implementations prove the agent has no bypass.
16. **Crash reconciliation:** terminate the companion after every child side effect in composite workflows and prove restart reconciles each child without duplicating or losing the parent operation.
17. **Snapshot integrity:** alter staged, unstaged, untracked, submodule, tool-policy, scanner, and advisory inputs after a receipt and prove it becomes stale.
18. **Prompt-injection resistance:** malicious instructions in project docs, CI logs, terminal output, dependency output, browser content, and PR comments cannot alter authority, targets, recipients, or gates.
19. **Credential isolation:** production credentials and production DSNs are unavailable to Pipeline, Repair Mission, Full Sandbox, and Quarantine.
20. **Containment persistence and release:** activate containment, prove queued operations and credential leases are fenced, restart the companion and machine, prove brokered egress remains blocked, distinguish already external/uncontrolled work, and test the authenticated release workflow.
21. **Council epoch safety:** introduce edits, resource conflicts, and heartbeat loss during coordination and prove automatic mode aborts without moving or rewriting dirty work.
22. **Transport lifecycle:** test hot-plug, sleep/resume, multiple keyboards, Vial remapping, synthetic HID input, and diagnostic Raw HID coexistence.
23. **Adapter degradation:** remove shell integration or change an app/provider version and prove capabilities downgrade to unknown/unavailable rather than being inferred.
24. **Partial-failure recovery:** inject failure after every mutation stage and verify deterministic reconciliation or preserved recovery artifacts.
25. **Voice privacy and routing:** prove microphone consent, single-target routing, provider-switch behavior, interruption, transcript retention/deletion, and no cross-task leakage.
26. **Untrusted URL defense:** malicious server output cannot cause a remote or unsafe URL to open.
27. **Budget and cancellation:** long agent, CI, scan, and sandbox operations obey time, cost, concurrency, retry, and cancellation limits.

## 17. Bottom line — good, bad, and ugly

**Good:** The logical map is a coherent requirements inventory grounded in actual workflow pain. The Agent Control Plane versus Workspace Command Bar split is strong, and the specification is explicit about unknown, unavailable, stale, and unassigned states.

**Bad:** Most valuable keys are host applications, distributed state machines, or security workflows rather than macros. Several controls are semantically dense, many legends are missing, and the derived trust model, durable transaction model, protected receipt store, broker policies, and provider capability contracts still require user approval and prototypes.

**Ugly:** Without mediated execution, the companion can route and advise but cannot enforce agent scope, Git restrictions, credential policy, containment, or test isolation. Council automatic mode, Repair Mission, `lfg`, broker-enforced Merge/Direct Main, Full Sandbox, and Quarantine must remain disabled until that boundary exists and survives adversarial testing.

The right next move is **not more brainstorming and not filling modifiers**. First approve the derived enforcement boundary, `TargetSnapshot` and receipt schemas, durable command state machine, test/sandbox brokers, capability model, and containment-release workflow. Then settle physical order/legends and build a read-only hardware-plus-companion prototype that proves target identity and truthful capability degradation before any high-consequence automation is enabled.

## 18. Reference notes

- [QMK Basic Keycodes](https://docs.qmk.fm/keycodes_basic) documents F13–F24 as standard keycodes.
- [QMK Raw HID](https://docs.qmk.fm/features/rawhid) documents bidirectional keyboard/host reports and the need for a host program.
- [Leyden Jar upstream documentation](https://github.com/mymakercorner/Leyden_Jar/blob/main/README.md) documents Vial-QMK, custom Raw HID monitoring support, and three status LEDs; the user's exact firmware still requires inspection.
- [VS Code Extension API](https://code.visualstudio.com/api/references/vscode-api) documents workspace, terminal, and debug primitives used by the proposed extension.
- [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex) documents desktop Voice and a configurable shortcut; [ChatGPT Windows app](https://help.openai.com/en/articles/9982051-using-the-chatgpt-windows-app) documents the companion window.
- [Claude Voice](https://support.claude.com/en/articles/11101966-use-voice-mode) documents conversational Voice on Claude Desktop, web, and mobile, but not the required Windows-global activation or VS Code agent-binding bridge.
- [GitHub Actions run history](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history) documents workflow status, jobs, steps, and logs.
