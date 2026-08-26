import { assignmentFor, assignments, type Assignment, type Control, type Modifier } from "../../protocol/src/b122.ts";
import type { Capability } from "./contracts.ts";

/**
 * These IDs are the host-side meanings of the 65 settled physical chords.
 * They are deliberately not free-form command strings: a broker or adapter
 * receives one of these audited actions and a typed request, never shell text
 * derived from a key press, repository file, log, or provider response.
 */
export const commandActionIds = [
  "reanchor", "proof", "proof_adversarial", "option_provider", "option_packet", "plan_expander", "plan_approval",
  "handoff", "handoff_queue", "handoff_immediate", "handoff_routing_default", "focus_blocked_agent", "blocker_queue",
  "focus_finished_agent", "done_queue", "authority_refresh", "authority_broadcast", "council_report", "council_automatic",
  "council_recommend", "open_claude", "fresh_claude", "open_managed_claude_terminal", "open_chatgpt", "fresh_chatgpt",
  "open_managed_codex_terminal", "focus_vscode", "new_vscode", "focus_terminal", "focus_vscode_terminal", "local_commit",
  "pr_upsert", "pr_merge", "direct_main", "github_home", "github_pr", "github_issues", "github_actions", "compound_capture",
  "compound_refresh", "compound_palette", "lfg", "run_target", "debug_target", "stop_managed_run", "launch_web_app",
  "open_voice", "switch_voice_provider", "bind_voice_session", "voice_session_picker", "pipeline_status", "pipeline_local_gate",
  "pipeline_failure_trace", "pipeline_clean_reproduction", "repair_mission", "shield_change_scan", "shield_codebase_audit",
  "shield_supply_chain", "release_shield", "emergency_containment", "venv", "rebuild_venv", "full_sandbox",
  "rebuild_full_sandbox", "quarantine", "containment_release"
] as const;

export type CommandAction = (typeof commandActionIds)[number];
export type AcceptanceGate =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
  | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27;
export type CommandExecutor = "adapter" | "agent" | "git" | "execution" | "test_environment" | "security" | "isolation" | "council" | "automation" | "containment";

export interface CommandDefinition {
  readonly action: CommandAction;
  /** Undefined only for companion-UI administrative operations. */
  readonly assignment?: Assignment;
  readonly title: string;
  readonly executor: CommandExecutor;
  readonly requiresCapabilities: readonly Capability[];
  readonly requiresAuthority: boolean;
  readonly requiresTarget: boolean;
  readonly requiresCompleteTargetSnapshot: boolean;
  readonly requiresConfirmation: boolean;
  readonly highConsequence: boolean;
  readonly acceptanceGates: readonly AcceptanceGate[];
  /** Whether containment must fence this action's external side effect. */
  readonly outbound: boolean;
}

type CommandOptions = Omit<CommandDefinition, "action" | "assignment" | "title"> & { readonly title: string };

const gates = {
  councilAutomatic: [4, 10, 15, 21, 24, 27] as const,
  merge: [4, 6, 7, 15, 16, 17, 24] as const,
  lfg: [4, 5, 6, 15, 16, 19, 24, 27] as const,
  repair: [4, 5, 15, 16, 19, 24, 27] as const,
  containment: [8, 20] as const,
  fullSandbox: [5, 12, 19, 27] as const,
  rebuildSandbox: [5, 12, 13, 19, 24, 27] as const
} satisfies Readonly<Record<string, readonly AcceptanceGate[]>>;

const direct = (action: CommandAction, control: Control, modifier: Modifier, options: CommandOptions): CommandDefinition => {
  const assignment = assignmentFor(control, modifier);
  if (!assignment) throw new Error(`Catalog attempted to assign an intentionally unassigned chord: ${control}:${modifier}`);
  return { action, assignment, ...options };
};

const definition = (
  action: CommandAction,
  control: Control,
  modifier: Modifier,
  title: string,
  executor: CommandExecutor,
  options: Partial<Omit<CommandOptions, "title" | "executor">> = {}
): CommandDefinition => direct(action, control, modifier, {
  title,
  executor,
  requiresCapabilities: options.requiresCapabilities ?? [],
  requiresAuthority: options.requiresAuthority ?? false,
  requiresTarget: options.requiresTarget ?? false,
  requiresCompleteTargetSnapshot: options.requiresCompleteTargetSnapshot ?? false,
  requiresConfirmation: options.requiresConfirmation ?? false,
  highConsequence: options.highConsequence ?? false,
  acceptanceGates: options.acceptanceGates ?? [],
  outbound: options.outbound ?? false
});

const mediated = ["mediated"] as const;
const observable = ["registered", "observable"] as const;
const controllable = ["registered", "controllable"] as const;
const coordinated = ["registered", "observable", "controllable", "mediated"] as const;
const scoped = { requiresAuthority: true, requiresTarget: true } as const;
/** Every provider-backed command crosses an external effect boundary. */
const providerScoped = { ...scoped, requiresCompleteTargetSnapshot: true } as const;
const consequential = { ...scoped, requiresCapabilities: mediated, requiresCompleteTargetSnapshot: true } as const;
const confirmed = { ...consequential, requiresConfirmation: true } as const;

/** The complete, closed catalog for the 65 interview-settled chord assignments. */
export const commandCatalog: readonly CommandDefinition[] = [
  definition("reanchor", "REANCHOR", "normal", "Re-anchor", "agent", { ...providerScoped, requiresCapabilities: controllable }),
  definition("proof", "PROOF", "normal", "Evidence-based proof", "agent", { ...providerScoped, requiresCapabilities: observable }),
  definition("proof_adversarial", "PROOF", "shift", "Cross-backend adversarial proof", "agent", { ...providerScoped, requiresCapabilities: observable, requiresConfirmation: true }),
  definition("option_provider", "OPTION_PROVIDER", "normal", "Five-option decision packet", "agent", { ...providerScoped, requiresCapabilities: controllable }),
  definition("option_packet", "OPTION_PROVIDER", "shift", "Pending decision packet", "agent", { ...providerScoped, requiresCapabilities: controllable }),
  definition("plan_expander", "PLAN_EXPANDER", "normal", "Ranked plan expansion", "agent", { ...providerScoped, requiresCapabilities: controllable }),
  definition("plan_approval", "PLAN_APPROVAL", "normal", "Execute approved plan", "agent", confirmed),
  definition("handoff", "HANDOFF", "normal", "Planner-to-coder handoff", "agent", { ...providerScoped, requiresCapabilities: ["registered"] }),
  definition("handoff_queue", "HANDOFF", "shift", "Queue a planning packet", "agent", { ...providerScoped, requiresCapabilities: ["registered"] }),
  definition("handoff_immediate", "HANDOFF", "alt", "Focus planner with packet", "agent", { ...providerScoped, requiresCapabilities: ["registered"] }),
  definition("handoff_routing_default", "HANDOFF", "shift_alt", "Toggle handoff routing default", "adapter", { requiresTarget: true, requiresConfirmation: true }),
  definition("focus_blocked_agent", "FIND_BLOCKED_AGENT", "normal", "Focus verified blocked agent", "agent", { ...providerScoped, requiresCapabilities: observable }),
  definition("blocker_queue", "FIND_BLOCKED_AGENT", "shift", "Open blocker queue", "adapter", { requiresTarget: true }),
  definition("focus_finished_agent", "FIND_FINISHED_AGENT", "normal", "Focus verified finished agent", "agent", { ...providerScoped, requiresCapabilities: observable }),
  definition("done_queue", "FIND_FINISHED_AGENT", "shift", "Open done queue", "adapter", { requiresTarget: true }),
  definition("authority_refresh", "AUTHORITY_REFRESH", "normal", "Replay scoped authority", "agent", { ...providerScoped, requiresCapabilities: controllable }),
  definition("authority_broadcast", "AUTHORITY_REFRESH", "shift", "Reviewed authority broadcast", "agent", { ...providerScoped, requiresCapabilities: controllable, requiresConfirmation: true }),
  definition("council_report", "COUNCIL", "normal", "Council conflict report", "council", { requiresTarget: true, requiresCapabilities: observable }),
  definition("council_automatic", "COUNCIL", "shift", "Guarded automatic Council", "council", { ...confirmed, requiresCapabilities: coordinated, highConsequence: true, acceptanceGates: gates.councilAutomatic }),
  definition("council_recommend", "COUNCIL", "alt", "Council coordinated recommendation", "council", { requiresTarget: true, requiresCapabilities: observable, requiresConfirmation: true }),

  definition("open_claude", "CLAUDE", "normal", "Open or focus Claude", "adapter", {}),
  definition("fresh_claude", "CLAUDE", "shift", "Fresh Claude surface", "adapter", { requiresConfirmation: true }),
  definition("open_managed_claude_terminal", "CLAUDE", "alt", "Managed Claude Code terminal", "adapter", { ...scoped, requiresCapabilities: ["registered"] }),
  definition("open_chatgpt", "CHATGPT", "normal", "Open or focus ChatGPT", "adapter", {}),
  definition("fresh_chatgpt", "CHATGPT", "shift", "Fresh ChatGPT surface", "adapter", { requiresConfirmation: true }),
  definition("open_managed_codex_terminal", "CHATGPT", "alt", "Managed Codex terminal", "adapter", { ...scoped, requiresCapabilities: ["registered"] }),
  definition("focus_vscode", "VSCODE", "normal", "Focus VS Code", "adapter", {}),
  definition("new_vscode", "VSCODE", "shift", "Open VS Code window", "adapter", { requiresConfirmation: true }),
  definition("focus_terminal", "TERMINAL", "normal", "Focus external terminal", "adapter", {}),
  definition("focus_vscode_terminal", "TERMINAL", "shift", "Focus VS Code terminal", "adapter", { requiresTarget: true }),
  // A local commit is an external Git mutation.  It is never a convenience
  // shortcut around the reviewed confirmation flow, even when the mutation
  // stays on a feature branch and never pushes.
  definition("local_commit", "COMMIT", "normal", "Scoped local commit", "git", confirmed),
  definition("pr_upsert", "COMMIT", "shift", "PR upsert", "git", { ...confirmed, outbound: true }),
  definition("pr_merge", "COMMIT", "alt", "Exact-head PR merge", "git", { ...confirmed, outbound: true, highConsequence: true, acceptanceGates: gates.merge }),
  definition("direct_main", "COMMIT", "shift_alt", "Guarded Direct Main", "git", { ...confirmed, outbound: true, highConsequence: true, acceptanceGates: gates.merge }),
  definition("github_home", "GITHUB", "normal", "Repository home", "adapter", { requiresTarget: true }),
  definition("github_pr", "GITHUB", "shift", "Current branch PR", "adapter", { requiresTarget: true }),
  definition("github_issues", "GITHUB", "alt", "Repository issues", "adapter", { requiresTarget: true }),
  definition("github_actions", "GITHUB", "shift_alt", "Current branch Actions", "adapter", { requiresTarget: true }),
  definition("compound_capture", "COMPOUND", "normal", "Capture durable learning", "automation", consequential),
  definition("compound_refresh", "COMPOUND", "shift", "Preview learning refresh", "automation", { ...confirmed }),
  definition("compound_palette", "COMPOUND", "alt", "Open Compound palette", "adapter", { requiresTarget: true }),
  definition("lfg", "COMPOUND", "shift_alt", "Guarded full lfg loop", "automation", { ...confirmed, outbound: true, highConsequence: true, acceptanceGates: gates.lfg }),
  definition("run_target", "RUN", "normal", "Run declared target", "execution", consequential),
  definition("debug_target", "RUN", "shift", "Debug declared target", "execution", consequential),
  definition("stop_managed_run", "RUN", "alt", "Stop managed Run process", "execution", { ...consequential, requiresConfirmation: true }),
  definition("launch_web_app", "RUN", "shift_alt", "Launch declared web app", "execution", { ...consequential, requiresConfirmation: true }),
  definition("open_voice", "VOICE", "normal", "Open voice center", "adapter", {}),
  definition("switch_voice_provider", "VOICE", "shift", "Switch voice provider", "adapter", { requiresConfirmation: true }),
  definition("bind_voice_session", "VOICE", "alt", "Bind voice session", "agent", { ...providerScoped, requiresCapabilities: ["registered"], requiresConfirmation: true }),
  definition("voice_session_picker", "VOICE", "shift_alt", "Voice session picker", "adapter", { requiresTarget: true }),
  definition("pipeline_status", "PIPELINE", "normal", "Pipeline status", "adapter", { requiresTarget: true }),
  definition("pipeline_local_gate", "PIPELINE", "shift", "Isolated local gate", "test_environment", consequential),
  definition("pipeline_failure_trace", "PIPELINE", "alt", "Failure trace", "adapter", { requiresTarget: true }),
  definition("pipeline_clean_reproduction", "PIPELINE", "shift_alt", "Clean reproduction", "test_environment", consequential),
  definition("repair_mission", "PIPELINE", "ctrl_shift_alt", "Isolated Repair Mission", "automation", { ...confirmed, highConsequence: true, acceptanceGates: gates.repair }),
  definition("shield_change_scan", "SHIELD", "normal", "Change security scan", "security", consequential),
  definition("shield_codebase_audit", "SHIELD", "shift", "Codebase security audit", "security", consequential),
  definition("shield_supply_chain", "SHIELD", "alt", "Supply-chain audit", "security", consequential),
  definition("release_shield", "SHIELD", "shift_alt", "Release Shield receipt", "security", consequential),
  definition("emergency_containment", "SHIELD", "ctrl_shift_alt", "Emergency Containment", "containment", { ...confirmed, highConsequence: true, acceptanceGates: gates.containment }),
  definition("venv", "SANDBOX", "normal", "Repository virtual environment", "execution", consequential),
  definition("rebuild_venv", "SANDBOX", "shift", "Rebuild repository virtual environment", "execution", { ...confirmed }),
  definition("full_sandbox", "SANDBOX", "alt", "Full Sandbox", "isolation", { ...confirmed, highConsequence: true, acceptanceGates: gates.fullSandbox }),
  definition("rebuild_full_sandbox", "SANDBOX", "shift_alt", "Rebuild Full Sandbox", "isolation", { ...confirmed, highConsequence: true, acceptanceGates: gates.rebuildSandbox }),
  definition("quarantine", "SANDBOX", "ctrl_shift_alt", "Quarantine", "isolation", { ...confirmed, highConsequence: true, acceptanceGates: gates.fullSandbox })
];

/** Companion-UI only operations are intentionally outside the physical chord map. */
export const administrativeCommands: readonly CommandDefinition[] = [{
  action: "containment_release",
  title: "Authenticated containment release",
  executor: "containment",
  requiresCapabilities: mediated,
  requiresAuthority: true,
  requiresTarget: true,
  requiresCompleteTargetSnapshot: true,
  requiresConfirmation: true,
  highConsequence: true,
  acceptanceGates: gates.containment,
  outbound: false
}];

const catalogByChord = new Map(commandCatalog.map((item) => [`${item.assignment?.control}:${item.assignment?.modifier}`, item]));
const catalogByAction = new Map([...commandCatalog, ...administrativeCommands].map((item) => [item.action, item]));

if (commandCatalog.length !== assignments.length) throw new Error("B122 command catalog must match the settled protocol assignment count.");
if (new Set(commandCatalog.map((item) => item.action)).size !== commandCatalog.length) throw new Error("B122 command action IDs must be unique.");
if (assignments.some((item) => catalogByChord.get(`${item.control}:${item.modifier}`)?.assignment !== item)) {
  throw new Error("B122 command catalog must preserve the canonical assignment identities.");
}

export function commandFor(control: Control, modifier: Modifier): CommandDefinition | undefined {
  return catalogByChord.get(`${control}:${modifier}`);
}

export function commandForAction(action: CommandAction): CommandDefinition {
  const found = catalogByAction.get(action);
  if (!found) throw new Error(`Unknown B122 action: ${action}`);
  return found;
}
