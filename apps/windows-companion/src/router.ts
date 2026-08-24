import { assignmentFor, decodeSignal, type Assignment } from "../../../packages/protocol/src/b122.ts";

export type SessionState = "registered" | "observable" | "managed" | "mediated";
/** `connectionId` is a host-vetted, fresh ID per Raw HID connection epoch. */
export interface RouteContext { readonly deviceId: string; readonly connectionId: string; readonly sessionState: SessionState; }
export interface RoutedIntent {
  readonly status: "preview_only" | "requires_mediation" | "disabled_pending_acceptance_gates" | "unassigned" | "rejected";
  readonly reason: string;
  readonly assignment?: Assignment;
  readonly sequence?: number;
}

/**
 * Preview-only policy gate. This class intentionally has no process, shell,
 * filesystem, Git, network, credential, or prompt-submission dependency.
 */
export class ControlRouter {
  private readonly sequenceByDevice = new Map<string, number>();

  /** Called by the future Raw HID adapter when a physical device disconnects. */
  forgetDevice(deviceId: string): void {
    for (const key of this.sequenceByDevice.keys()) {
      if (key.startsWith(`${deviceId}:`)) this.sequenceByDevice.delete(key);
    }
  }

  route(packet: Uint8Array, context: RouteContext): RoutedIntent {
    const signal = decodeSignal(packet);
    if (!signal) return { status: "rejected", reason: "Invalid, unsupported, or corrupted B122 packet." };

    const connectionKey = `${context.deviceId}:${context.connectionId}`;
    const previous = this.sequenceByDevice.get(connectionKey);
    if (previous !== undefined && !isNewerSequence(previous, signal.sequence)) {
      return { status: "rejected", reason: "Replay or stale B122 packet rejected.", sequence: signal.sequence };
    }
    this.sequenceByDevice.set(connectionKey, signal.sequence);

    const assignment = assignmentFor(signal.control, signal.modifier);
    if (!assignment) return { status: "unassigned", reason: "This B122 chord is intentionally unassigned.", sequence: signal.sequence };
    if (assignment.capability === "disabled_pending_gates") {
      return { status: "disabled_pending_acceptance_gates", assignment, sequence: signal.sequence,
        reason: "This high-consequence control is disabled until mediated execution and adversarial acceptance gates pass." };
    }
    if (assignment.capability === "requires_mediation" && context.sessionState !== "mediated") {
      return { status: "requires_mediation", assignment, sequence: signal.sequence,
        reason: "Managed identification/routing cannot enforce this request; a mediated session is required." };
    }
    return { status: "preview_only", assignment, sequence: signal.sequence,
      reason: "Intent routed for visible review only; this baseline executes no external action." };
  }
}

function isNewerSequence(previous: number, candidate: number): boolean {
  const delta = (candidate - previous + 0x1_0000) & 0xffff;
  return delta > 0 && delta < 0x8000;
}
