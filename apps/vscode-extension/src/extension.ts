import * as vscode from "vscode";
import { JsonLineCompanionBridge, UnavailableExtensionCompanionBridge, type ExtensionCompanionBridge } from "./companion-bridge.ts";
import { ManagedSessionController, type GitRootRegistration } from "./controller.ts";
import { ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader } from "./named-pipe-transport.ts";
import type { ExtensionContextLike, VscodeLike } from "./vscode-like.ts";

export { JsonLineCompanionBridge, UnavailableExtensionCompanionBridge, type ExtensionCompanionBridge, type JsonLineTransport } from "./companion-bridge.ts";
export { NamedPipeJsonLineTransport, ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader, type ExtensionSecretReader, type StoredCompanionPipeConfiguration } from "./named-pipe-transport.ts";
export { ManagedSessionController, type ManagedSessionControllerOptions } from "./controller.ts";

let controller: ManagedSessionController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  controller = new ManagedSessionController(
    vscode as unknown as VscodeLike,
    context as unknown as ExtensionContextLike,
    configuredCompanionBridge(),
    { resolveGitRoots: createVscodeGitRootResolver(vscode) }
  );
  void controller.start().catch(async () => {
    await vscode.window.showWarningMessage("SXSY-B122 could not initialize its local session registry.");
  });
}

/**
 * The companion creates the opaque configuration under its host-owned local
 * state directory. Missing, malformed, or DPAPI-unreadable configuration stays
 * unavailable; neither workspace settings nor an extension command selects an
 * endpoint.
 */
export function configuredCompanionBridge(): ExtensionCompanionBridge {
  if (process.platform !== "win32") return new UnavailableExtensionCompanionBridge("The SXSY-B122 companion is available only on Windows.");
  try {
    return new JsonLineCompanionBridge(new ProvisionedNamedPipeJsonLineTransport(undefined, new WindowsDpapiSecretReader()));
  } catch {
    return new UnavailableExtensionCompanionBridge("The authenticated SXSY-B122 local companion pipe configuration is invalid.");
  }
}

export function deactivate(): void {
  controller?.stop();
  // The extension owns no process, broker, terminal hook, or external action.
  controller = undefined;
}

/**
 * The built-in VS Code Git extension is optional. Its structured repository
 * API gives us real roots/branches when present; unavailable or ambiguous
 * remotes remain unknown instead of falling back to a guessed workspace path.
 */
function createVscodeGitRootResolver(host: unknown): () => Promise<readonly GitRootRegistration[]> {
  return async () => {
    const gitExtension = (host as GitExtensionHost).extensions?.getExtension("vscode.git");
    if (!gitExtension) return [];
    try {
      if (!gitExtension.isActive) await gitExtension.activate?.();
      const api = gitExtension.exports?.getAPI?.(1);
      const repositories = Array.isArray(api?.repositories) ? api.repositories : [];
      return repositories.flatMap((repository) => {
        const gitRoot = repository.rootUri?.fsPath;
        if (typeof gitRoot !== "string" || !gitRoot) return [];
        const remotes = Array.isArray(repository.state?.remotes) ? repository.state.remotes : [];
        const remote = remotes.length === 1
          ? firstString(remotes[0]?.fetchUrl, remotes[0]?.pushUrl)
          : undefined;
        return [{
          gitRoot,
          worktree: gitRoot,
          branch: typeof repository.state?.HEAD?.name === "string" ? repository.state.HEAD.name : undefined,
          canonicalRemote: remote
        }];
      });
    } catch {
      return [];
    }
  };
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

interface GitExtensionHost {
  readonly extensions?: {
    getExtension(id: string): {
      readonly isActive?: boolean;
      readonly exports?: { getAPI?(version: number): GitApiLike };
      activate?(): PromiseLike<unknown>;
    } | undefined;
  };
}

interface GitApiLike { readonly repositories?: readonly GitRepositoryLike[]; }
interface GitRepositoryLike {
  readonly rootUri?: { readonly fsPath?: string };
  readonly state?: {
    readonly HEAD?: { readonly name?: string };
    readonly remotes?: readonly { readonly fetchUrl?: string; readonly pushUrl?: string }[];
  };
}
