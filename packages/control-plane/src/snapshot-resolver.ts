import type { CommandDefinition } from "./command-catalog.ts";
import type { ManagedSession, TargetSnapshot } from "./contracts.ts";
import type { TargetResolver } from "./runtime.ts";
import { TargetSnapshotFactory, type SnapshotEnvironment } from "./snapshot.ts";

export interface WorkspaceSnapshotResolverOptions {
  readonly policyVersion: string;
  readonly environmentFor?: (input: Readonly<{ definition: CommandDefinition; session: ManagedSession }>) => SnapshotEnvironment;
}

/**
 * Captures a fresh TargetSnapshot from the selected protected session's
 * workspace root. No active editor, cwd, terminal text, or command input is
 * used as a fallback. Absent environment evidence intentionally yields an
 * incomplete snapshot that consequential policy will block.
 */
export class WorkspaceSnapshotResolver implements TargetResolver {
  private readonly factory: TargetSnapshotFactory;
  private readonly options: WorkspaceSnapshotResolverOptions;

  constructor(factory: TargetSnapshotFactory, options: WorkspaceSnapshotResolverOptions) {
    this.factory = factory;
    this.options = options;
  }

  async resolve(input: Readonly<{ definition: CommandDefinition; session?: ManagedSession }>): Promise<TargetSnapshot | undefined> {
    const session = input.session;
    if (!session?.workspaceRoot) return undefined;
    // Containment must also work for a valid local repository with no remote.
    // Its dedicated remote child inventories the host Git configuration and
    // records an explicit zero-remote proof; other consequential actions keep
    // requiring a canonical remote.
    const containmentTarget = input.definition.action === "emergency_containment" || input.definition.action === "containment_release";
    return this.factory.capture({
      targetHint: session.workspaceRoot,
      policyVersion: this.options.policyVersion,
      environment: this.options.environmentFor?.({ definition: input.definition, session }) ?? {},
      requireCanonicalRemote: !containmentTarget,
      requireBranch: true
    });
  }
}
