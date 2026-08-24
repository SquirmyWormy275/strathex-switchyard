/**
 * Canonical, transport-neutral B122 manifest.  A missing assignment is
 * intentionally unassigned; callers must not invent behaviour for it.
 */
export const protocolVersion = 1 as const;

export const controls = [
  "REANCHOR", "PROOF", "OPTION_PROVIDER", "PLAN_EXPANDER", "PLAN_APPROVAL",
  "HANDOFF", "FIND_BLOCKED_AGENT", "FIND_FINISHED_AGENT", "AUTHORITY_REFRESH", "COUNCIL",
  "CLAUDE", "CHATGPT", "VSCODE", "TERMINAL", "COMMIT", "GITHUB", "COMPOUND",
  "RUN", "VOICE", "PIPELINE", "SHIELD", "SANDBOX"
] as const;

export type Control = (typeof controls)[number];
export type Modifier = "normal" | "shift" | "alt" | "shift_alt" | "ctrl" | "ctrl_shift" | "ctrl_alt" | "ctrl_shift_alt";
export type Capability = "route_only" | "requires_mediation" | "disabled_pending_gates";
export type Chord = `${Control}:${Modifier}`;
/** A stable, typed handler identity.  A chord never falls through a generic route. */
export type HandlerName = `b122.${Chord}`;

export interface Assignment {
  readonly control: Control;
  readonly modifier: Modifier;
  readonly summary: string;
  readonly capability: Capability;
  readonly handler: HandlerName;
}

export const handlerFor = (control: Control, modifier: Modifier): HandlerName => `b122.${control}:${modifier}`;
const route = (control: Control, modifier: Modifier, summary: string): Assignment => ({ control, modifier, summary, capability: "route_only", handler: handlerFor(control, modifier) });
const mediated = (control: Control, modifier: Modifier, summary: string): Assignment => ({ control, modifier, summary, capability: "requires_mediation", handler: handlerFor(control, modifier) });
const disabled = (control: Control, modifier: Modifier, summary: string): Assignment => ({ control, modifier, summary, capability: "disabled_pending_gates", handler: handlerFor(control, modifier) });

// These are the 65 settled chord assignments. Gesture-only behaviours are
// documented separately and never broaden this protocol's chord surface.
export const assignments: readonly Assignment[] = [
  mediated("REANCHOR", "normal", "Safely re-anchor the active agent to scoped authority and evidence."),
  mediated("PROOF", "normal", "Request evidence-based self-verification."),
  mediated("PROOF", "shift", "Request a cross-backend adversarial review."),
  mediated("OPTION_PROVIDER", "normal", "Request five options and one recommendation."),
  mediated("OPTION_PROVIDER", "shift", "Request one numbered packet for pending decisions."),
  mediated("PLAN_EXPANDER", "normal", "Request fifteen ranked creative alternatives."),
  mediated("PLAN_APPROVAL", "normal", "Route an already-approved plan to the selected session."),
  mediated("HANDOFF", "normal", "Prepare a planner-to-coding-agent context transfer."),
  mediated("HANDOFF", "shift", "Queue a blocker or decision packet."),
  route("HANDOFF", "alt", "Focus the planner with the packet."),
  route("HANDOFF", "shift_alt", "Toggle queued versus immediate-focus handoff."),
  mediated("FIND_BLOCKED_AGENT", "normal", "Focus the next verified blocked managed agent."),
  route("FIND_BLOCKED_AGENT", "shift", "Open the blocker queue."),
  mediated("FIND_FINISHED_AGENT", "normal", "Focus the next verified finished managed agent."),
  route("FIND_FINISHED_AGENT", "shift", "Open the done queue."),
  mediated("AUTHORITY_REFRESH", "normal", "Replay existing scoped authority to the active agent."),
  mediated("AUTHORITY_REFRESH", "shift", "Prepare a reviewed individualized broadcast."),
  mediated("COUNCIL", "normal", "Report verified cross-agent conflicts and dependencies."),
  disabled("COUNCIL", "shift", "Automatic partitioning and isolation (Council automatic mode)."),
  mediated("COUNCIL", "alt", "Propose one coordinated plan for explicit approval."),

  route("CLAUDE", "normal", "Open or focus Claude Desktop."),
  route("CLAUDE", "shift", "Open a fresh Claude surface."),
  mediated("CLAUDE", "alt", "Open a managed Claude Code terminal in VS Code."),
  route("CHATGPT", "normal", "Open or focus ChatGPT Desktop."),
  route("CHATGPT", "shift", "Open a fresh ChatGPT surface."),
  mediated("CHATGPT", "alt", "Open a managed Codex terminal in VS Code."),
  route("VSCODE", "normal", "Focus the last-used VS Code window."),
  route("VSCODE", "shift", "Open a new VS Code window."),
  route("TERMINAL", "normal", "Open or focus an external terminal."),
  route("TERMINAL", "shift", "Open or focus the VS Code integrated terminal."),
  mediated("COMMIT", "normal", "Preview the Compound local-commit workflow."),
  mediated("COMMIT", "shift", "Preview PR upsert after explicit review."),
  disabled("COMMIT", "alt", "Broker-enforced exact-head PR merge."),
  disabled("COMMIT", "shift_alt", "Broker-enforced guarded Direct Main."),
  route("GITHUB", "normal", "Open the repository home."),
  route("GITHUB", "shift", "Open the current-branch PR or PR list."),
  route("GITHUB", "alt", "Open repository issues."),
  route("GITHUB", "shift_alt", "Open the current-branch Actions run or list."),
  mediated("COMPOUND", "normal", "Capture one durable learning."),
  mediated("COMPOUND", "shift", "Preview learning-store refresh scope."),
  route("COMPOUND", "alt", "Open the Compound workflow palette."),
  disabled("COMPOUND", "shift_alt", "Guarded full lfg loop."),
  mediated("RUN", "normal", "Run the selected configured target."),
  mediated("RUN", "shift", "Debug the selected configured target."),
  mediated("RUN", "alt", "Stop a managed run process."),
  mediated("RUN", "shift_alt", "Start a managed web app and offer its verified local URL."),
  route("VOICE", "normal", "Open the two-way voice center."),
  route("VOICE", "shift", "Choose the Claude or ChatGPT provider."),
  mediated("VOICE", "alt", "Bind voice only to a selected managed VS Code agent."),
  route("VOICE", "shift_alt", "Open the voice session picker."),
  route("PIPELINE", "normal", "Show non-mutating pipeline status."),
  mediated("PIPELINE", "shift", "Run a local gate through the test-environment broker."),
  mediated("PIPELINE", "alt", "Diagnose the selected failure."),
  mediated("PIPELINE", "shift_alt", "Reproduce cleanly through the test-environment broker."),
  disabled("PIPELINE", "ctrl_shift_alt", "Isolated Repair Mission."),
  mediated("SHIELD", "normal", "Scan current changes using configured coverage."),
  mediated("SHIELD", "shift", "Run a deeper codebase and history audit."),
  mediated("SHIELD", "alt", "Run configured supply-chain audit coverage."),
  mediated("SHIELD", "shift_alt", "Prepare an exact-revision Release Shield receipt."),
  disabled("SHIELD", "ctrl_shift_alt", "Containment release or emergency containment workflow."),
  mediated("SANDBOX", "normal", "Create or enter a repository-local virtual environment."),
  mediated("SANDBOX", "shift", "Preview safe virtual-environment rebuild scope."),
  disabled("SANDBOX", "alt", "Create or enter a Full Sandbox."),
  disabled("SANDBOX", "shift_alt", "Rebuild a Full Sandbox."),
  disabled("SANDBOX", "ctrl_shift_alt", "Quarantine.")
];

export const specialGestures: Readonly<Record<Control, readonly string[]>> = {
  REANCHOR: [], PROOF: [], OPTION_PROVIDER: [], PLAN_EXPANDER: [], PLAN_APPROVAL: [], HANDOFF: [],
  FIND_BLOCKED_AGENT: ["Repeated normal presses cycle verified blocked agents."],
  FIND_FINISHED_AGENT: ["Repeated normal presses cycle verified finished agents."],
  AUTHORITY_REFRESH: [], COUNCIL: [], CLAUDE: ["Window cycling remains unresolved."],
  CHATGPT: ["Window cycling remains unresolved."], VSCODE: ["Repeated normal presses cycle VS Code windows."],
  TERMINAL: [], COMMIT: [], GITHUB: [], COMPOUND: [], RUN: [],
  VOICE: ["Repeat or long press handles mute/end; exact split is unresolved."],
  PIPELINE: ["Repeated normal presses cycle failing gates."],
  SHIELD: ["Status lighting is hardware-dependent."], SANDBOX: []
};

export function assignmentFor(control: Control, modifier: Modifier): Assignment | undefined {
  return assignments.find((assignment) => assignment.control === control && assignment.modifier === modifier);
}

export const controlId = (control: Control): number => controls.indexOf(control) + 1;
export const controlFromId = (id: number): Control | undefined => controls[id - 1];

export interface B122Signal {
  readonly version: number;
  readonly control: Control;
  readonly modifier: Modifier;
  readonly sequence: number;
}

const modifiers: readonly Modifier[] = ["normal", "shift", "alt", "shift_alt", "ctrl", "ctrl_shift", "ctrl_alt", "ctrl_shift_alt"];
export const modifierFromMask = (mask: number): Modifier | undefined => modifiers[mask];
export const modifierMask = (modifier: Modifier): number => modifiers.indexOf(modifier);

/** Raw HID packet: B1, version, control-id, modifier-mask, sequence-low, sequence-high, XOR checksum, 0. */
export function encodeSignal(signal: B122Signal): Uint8Array {
  const packet = new Uint8Array(8);
  packet[0] = 0xb1; packet[1] = signal.version; packet[2] = controlId(signal.control); packet[3] = modifierMask(signal.modifier);
  packet[4] = signal.sequence & 0xff; packet[5] = (signal.sequence >> 8) & 0xff;
  packet[6] = packet.slice(0, 6).reduce((checksum, byte) => checksum ^ byte, 0);
  return packet;
}

export function decodeSignal(packet: Uint8Array): B122Signal | undefined {
  if (packet.length !== 8 || packet[0] !== 0xb1 || packet[1] !== protocolVersion) return undefined;
  if (packet.slice(7).some((byte) => byte !== 0)) return undefined;
  const checksum = packet.slice(0, 6).reduce((value, byte) => value ^ byte, 0);
  const control = controlFromId(packet[2]);
  const modifier = modifierFromMask(packet[3]);
  if (!control || !modifier || packet[6] !== checksum) return undefined;
  return { version: packet[1], control, modifier, sequence: packet[4] | (packet[5] << 8) };
}
