/**
 * Extension-local mirror of the accepted 65 chord assignments. The extension
 * cannot import the workspace TypeScript source at packaging time, so this is
 * deliberately explicit and covered by a count/uniqueness test.
 */
export type B122Control =
  | "REANCHOR" | "PROOF" | "OPTION_PROVIDER" | "PLAN_EXPANDER" | "PLAN_APPROVAL"
  | "HANDOFF" | "FIND_BLOCKED_AGENT" | "FIND_FINISHED_AGENT" | "AUTHORITY_REFRESH" | "COUNCIL"
  | "CLAUDE" | "CHATGPT" | "VSCODE" | "TERMINAL" | "COMMIT" | "GITHUB" | "COMPOUND"
  | "RUN" | "VOICE" | "PIPELINE" | "SHIELD" | "SANDBOX";

export type B122Modifier = "normal" | "shift" | "alt" | "shift_alt" | "ctrl" | "ctrl_shift" | "ctrl_alt" | "ctrl_shift_alt";

export interface ChordCommand {
  readonly control: B122Control;
  readonly modifier: B122Modifier;
  readonly command: string;
  readonly title: string;
}

type ChordDefinition = readonly [B122Control, B122Modifier, string];

const definitions: readonly ChordDefinition[] = [
  ["REANCHOR", "normal", "Re-anchor"],
  ["PROOF", "normal", "Proof"], ["PROOF", "shift", "Shift Proof"],
  ["OPTION_PROVIDER", "normal", "Option Provider"], ["OPTION_PROVIDER", "shift", "Shift Option Provider"],
  ["PLAN_EXPANDER", "normal", "Plan Expander"],
  ["PLAN_APPROVAL", "normal", "Plan Approval"],
  ["HANDOFF", "normal", "Handoff"], ["HANDOFF", "shift", "Shift Handoff"], ["HANDOFF", "alt", "Alt Handoff"], ["HANDOFF", "shift_alt", "Shift Alt Handoff"],
  ["FIND_BLOCKED_AGENT", "normal", "Find Blocked Agent"], ["FIND_BLOCKED_AGENT", "shift", "Blocker Queue"],
  ["FIND_FINISHED_AGENT", "normal", "Find Finished Agent"], ["FIND_FINISHED_AGENT", "shift", "Done Queue"],
  ["AUTHORITY_REFRESH", "normal", "Authority Refresh"], ["AUTHORITY_REFRESH", "shift", "Authority Refresh Broadcast"],
  ["COUNCIL", "normal", "Council Conflict Report"], ["COUNCIL", "shift", "Council Guarded Automatic"], ["COUNCIL", "alt", "Council Recommendation Review"],

  ["CLAUDE", "normal", "Claude"], ["CLAUDE", "shift", "Fresh Claude"], ["CLAUDE", "alt", "Managed Claude Code Terminal"],
  ["CHATGPT", "normal", "ChatGPT"], ["CHATGPT", "shift", "Fresh ChatGPT"], ["CHATGPT", "alt", "Managed Codex Terminal"],
  ["VSCODE", "normal", "Focus VS Code"], ["VSCODE", "shift", "New VS Code Window"],
  ["TERMINAL", "normal", "External Terminal"], ["TERMINAL", "shift", "Integrated Terminal"],
  ["COMMIT", "normal", "Local Commit"], ["COMMIT", "shift", "PR Upsert"], ["COMMIT", "alt", "Merge PR"], ["COMMIT", "shift_alt", "Direct Main"],
  ["GITHUB", "normal", "GitHub Repository"], ["GITHUB", "shift", "GitHub Pull Request"], ["GITHUB", "alt", "GitHub Issues"], ["GITHUB", "shift_alt", "GitHub Actions"],
  ["COMPOUND", "normal", "Compound Capture"], ["COMPOUND", "shift", "Compound Refresh"], ["COMPOUND", "alt", "Compound Workflow Palette"], ["COMPOUND", "shift_alt", "Compound Full Loop"],
  ["RUN", "normal", "Run"], ["RUN", "shift", "Debug"], ["RUN", "alt", "Stop Managed Run"], ["RUN", "shift_alt", "Launch Web App"],
  ["VOICE", "normal", "Voice Center"], ["VOICE", "shift", "Voice Provider"], ["VOICE", "alt", "Bind Voice Session"], ["VOICE", "shift_alt", "Voice Session Picker"],
  ["PIPELINE", "normal", "Pipeline Status"], ["PIPELINE", "shift", "Pipeline Local Gate"], ["PIPELINE", "alt", "Pipeline Failure Trace"], ["PIPELINE", "shift_alt", "Pipeline Clean Reproduction"], ["PIPELINE", "ctrl_shift_alt", "Repair Mission"],
  ["SHIELD", "normal", "Shield Change Scan"], ["SHIELD", "shift", "Shield Codebase Audit"], ["SHIELD", "alt", "Shield Supply Chain"], ["SHIELD", "shift_alt", "Release Shield"], ["SHIELD", "ctrl_shift_alt", "Emergency Containment"],
  ["SANDBOX", "normal", "Sandbox Virtual Environment"], ["SANDBOX", "shift", "Fresh Virtual Environment"], ["SANDBOX", "alt", "Full Sandbox"], ["SANDBOX", "shift_alt", "Fresh Full Sandbox"], ["SANDBOX", "ctrl_shift_alt", "Quarantine"]
];

export const chordCommands: readonly ChordCommand[] = definitions.map(([control, modifier, label]) => ({
  control,
  modifier,
  command: `sxsy-b122.chord.${control.toLowerCase()}.${modifier}`,
  title: `SXSY-B122: ${label}`
}));

export function chordFor(control: B122Control, modifier: B122Modifier): ChordCommand | undefined {
  return chordCommands.find((command) => command.control === control && command.modifier === modifier);
}
