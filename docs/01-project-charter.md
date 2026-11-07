# Project Charter

> **Status:** This foundation charter records the project's enduring mission and
> governance. The accepted [complete 22-key / 65-chord specification](SXSY-B122-complete-key-specification-and-audit.md)
> governs current control behavior; this document guides future revisions and
> physical-release work.

## Mission

Design, build, test, and document a Model F Labs B122-based operator station that improves the human control loop for agentic software development while keeping consequential authority legible and reachable.

## Problem statement

Agentic development fragments work across multiple sessions, projects, tools, windows, terminals, worktrees, and approval boundaries. Conventional keyboard layouts and generic macro pads expose application shortcuts, but they rarely represent the supervisory actions that dominate this workflow: route attention, start or resume a session, interrupt execution, redirect work, inspect changes, approve within a known boundary, and return to code.

## Objectives

- Maintain and revise the settled 22-key control vocabulary only from observed
  work and explicit safety evidence rather than intuition.
- Make session and project routing faster without hiding context.
- Provide reliable, context-aware interruption through the settled Re-anchor
  lifecycle and managed Run Stop behavior. There is no standalone `HALT` key in
  the accepted 22-control map.
- Reduce repeated mouse trips and awkward chords.
- Preserve explicit confirmation for destructive or authority-expanding actions.
- Publish reproducible Vial, host-automation, legend, test, and installation artifacts.
- Credit upstream hardware, controller, firmware, template, software, and historical contributors at file and project level.

## Non-objectives

- Replacing the B122's normal typing layout.
- Creating unattended authority escalation or automatic approval.
- Pretending one operator's final layout is universal.
- Shipping modified firmware without its complete corresponding source and required notices.
- Representing the project as an official Model F Labs or IBM product.
- Freezing the command map before physical testing.

## Deliverables

1. Workflow observation protocol and anonymized event schema.
2. Versioned control taxonomy with a decision record for every key.
3. Vial configuration and hardware-signal map.
4. Context-aware Windows dispatcher and safe-action policy.
5. Exact-scale printable legends and installation map.
6. Automated tests plus a physical acceptance checklist.
7. Baseline and trial measurements.
8. Build guide, troubleshooting guide, attribution register, and reproducible release bundle.

## Success criteria

The first stable release must demonstrate:

- all 22 physical controls are uniquely identifiable;
- no destructive action can fire from an unrecognized context;
- Re-anchor safe-stop/report behavior and managed Run Stop behavior are tested
  in each claimed agent/terminal context, without implying rollback or a global
  kill switch;
- mappings and legends agree mechanically and semantically;
- every distributed third-party artifact has a recorded source and permission basis;
- install and rollback instructions work on a clean supported Windows environment;
- trial evidence reports command use, errors, time effects, and removed controls, including negative results.

## Constraints

- Primary agent environment: the owner's Omarchy Linux workstation with native ChatGPT/Codex, Claude, VS Code, Foot, Git, and multiple task surfaces. An exact provider signal is required before Switchyard reports a task as blocked or finished.
- Portable typing environment: a Windows work laptop or another Windows PC must accept the commissioned B122 as an ordinary USB keyboard without installing Switchyard software or configuring an account. Agent controls are optional, per-user host capabilities and remain unavailable until that host is explicitly provisioned.
- Preserve the current 22-control, 65-assignment chord contract while collecting workflow and physical evidence. Reassessment may change implementation priority and presentation without silently remapping a chord.
- Hardware: Model F Labs B122 with programmable RP2040 Leyden Jar controller and relegendable keys.
- The B122 may expose signals beyond what every application accepts consistently; host-level interpretation is therefore part of the design.
- Safety and attribution take precedence over convenience and visual polish.

## Governance

Alex Kaper is the founding maintainer and final authority for Unit 001. Major interface changes require a design-journal entry explaining the observation, proposed intent, safety consequences, and test result. Upstream license or attribution corrections are handled as priority defects.
