import type { ExtensionManagedSession } from "./companion-bridge.ts";
import type { QuickPickItemLike } from "./vscode-like.ts";

export interface CodexLocalThreadObservation {
  readonly id: string;
  readonly observation: "not-observed" | "idle" | "error" | "active" | "waiting-on-approval" | "unknown";
}

/** Read-only presentation of the companion's latest authenticated registry. */
export function operatorSessionItems(sessions: readonly ExtensionManagedSession[]): readonly QuickPickItemLike[] {
  const order = { verified_blocked: 0, verified_finished: 1, running: 2, unreachable: 3, stale: 4, unknown: 5 } as const;
  return sessions.map((session) => {
    const status = session.capabilities.includes("observable") ? session.status : "unknown";
    const capability = session.capabilities.includes("mediated") ? "Mediated"
      : session.capabilities.includes("controllable") ? "Controllable"
        : session.capabilities.includes("observable") ? "Observable" : "Registered only";
    const parts = [
      `Session ${session.id}`,
      session.taskId ? `task ${session.taskId}` : "task unknown",
      session.planRevision ? `plan ${session.planRevision}` : "plan unknown",
      session.workspaceRoot ? `repository ${session.workspaceRoot}` : "repository unknown",
      session.targetSnapshotId ? `target ${session.targetSnapshotId}` : "target unknown",
      `${capability}; observed ${session.lastHeartbeat}`
    ];
    return {
      label: `${session.provider} · ${status.replaceAll("_", " ")}`,
      description: session.surface,
      detail: parts.join(" | "),
      rank: order[status],
      id: session.id
    };
  }).sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map(({ rank: _rank, id: _id, ...item }) => item);
}

/** Live daemon observations stay separate from authenticated managed sessions. */
export function codexLocalThreadItems(threads: readonly CodexLocalThreadObservation[]): readonly QuickPickItemLike[] {
  const order = { "waiting-on-approval": 0, active: 1, error: 2, idle: 3, unknown: 4, "not-observed": 5 } as const;
  return threads.filter((thread) => thread.observation !== "not-observed").sort((a, b) => order[a.observation] - order[b.observation] || a.id.localeCompare(b.id)).map((thread) => ({
    label: `Codex local · ${thread.observation} (unbound)`,
    description: "Local App Server runtime",
    detail: `Thread ${thread.id} | no Switchyard task, repository, or target binding; no verified session capability`
  }));
}
