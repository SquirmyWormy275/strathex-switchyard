import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { homedir } from "node:os";
import { JsonLineCompanionBridge, UnavailableExtensionCompanionBridge, type ExtensionCompanionBridge } from "./companion-bridge.ts";
import { deactivateManagedExtension, exactExtensionPackageVersion, ManagedSessionController, type GitRootRegistration } from "./controller.ts";
import { ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader } from "./named-pipe-transport.ts";
import { LinuxLibsecretCurrentUserProtector } from "../../linux-companion/src/linux-secret.ts";
import type { ExtensionSecretReader } from "./named-pipe-transport.ts";
import type { ExtensionContextLike, VscodeLike } from "./vscode-like.ts";
import type { CodexLocalThreadBinding, CodexLocalThreadObservation } from "./operator-status.ts";

const { readCodexDaemonThreads, readExactCodexDaemonThread, startCodexDaemonThread, persistBoundCodexThread, readBoundCodexThreads } = require("./codex-daemon-status.cjs") as {
  readCodexDaemonThreads(socketPath: string): Promise<readonly CodexLocalThreadObservation[]>;
  readExactCodexDaemonThread(socketPath: string, threadId: string): Promise<CodexLocalThreadObservation>;
  startCodexDaemonThread(socketPath: string, repositoryRoot: string, taskId: string): Promise<Readonly<{ threadId: string }>>;
  persistBoundCodexThread(binding: CodexLocalThreadBinding): Promise<CodexLocalThreadBinding>;
  readBoundCodexThreads(): Promise<readonly CodexLocalThreadBinding[]>;
};
const codexSocket = join(homedir(), ".codex", "app-server-control", "app-server-control.sock");

export { JsonLineCompanionBridge, UnavailableExtensionCompanionBridge, type ExtensionCompanionBridge, type JsonLineTransport, type RawHidDeviceIdentity, type RawHidInstallationPin, type RawHidRuntimeStatus, type HardwareSignalClaim } from "./companion-bridge.ts";
export { NamedPipeJsonLineTransport, ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader, type ExtensionSecretReader, type StoredCompanionPipeConfiguration } from "./named-pipe-transport.ts";
export { ManagedSessionController, type ManagedSessionControllerOptions } from "./controller.ts";

let controller: ManagedSessionController | undefined;
interface HostSecretReader extends ExtensionSecretReader { seal(cleartext: Uint8Array): Promise<string>; dispose(): Promise<void>; }
let secretReader: HostSecretReader | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const secretProtector = hostSecretReader();
  secretReader = secretProtector;
  controller = new ManagedSessionController(
    vscode as unknown as VscodeLike,
    context as unknown as ExtensionContextLike,
    configuredCompanionBridge(secretProtector),
    {
      resolveGitRoots: createVscodeGitRootResolver(vscode),
      observeCodexThreads: async (boundThreadIds) => {
        if (process.platform !== "linux") return [];
        const recent = await readCodexDaemonThreads(codexSocket).catch(() => []);
        const exact = await Promise.allSettled([...new Set(boundThreadIds)].map((id) => readExactCodexDaemonThread(codexSocket, id)));
        const joined = new Map(recent.map((thread) => [thread.id, thread]));
        for (const result of exact) if (result.status === "fulfilled") joined.set(result.value.id, result.value);
        return [...joined.values()];
      },
      startCodexThread: (repositoryRoot, taskId) => startCodexDaemonThread(codexSocket, repositoryRoot, taskId),
      persistCodexBinding: (binding) => persistBoundCodexThread(binding),
      readCodexBindings: () => readBoundCodexThreads(),
      codexExecutable: installedCodexExecutable(),
      openExternal: async (url) => vscode.env.openExternal(vscode.Uri.parse(url, true)),
      executeCommand: async (command) => { await vscode.commands.executeCommand(command); },
      sealSecret: (cleartext) => secretProtector.seal(cleartext),
      extensionVersion: exactExtensionVersion(context)
    }
  );
  void controller.start().catch(async () => {
    await vscode.window.showWarningMessage("SXSY-B122 could not initialize its local session registry.");
  });
}

/** Fixed current-user/system locations; workspace settings never select an executable. */
function installedCodexExecutable(): string | undefined {
  return [
    join(homedir(), ".local", "share", "mise", "installs", "codex", "latest", "bin", "codex"),
    join(homedir(), ".local", "bin", "codex"),
    "/usr/local/bin/codex",
    "/usr/bin/codex"
  ].find((candidate) => existsSync(candidate));
}

/**
 * The companion creates the opaque configuration under its host-owned local
 * state directory. Missing, malformed, or DPAPI-unreadable configuration stays
 * unavailable; neither workspace settings nor an extension command selects an
 * endpoint.
 */
export function configuredCompanionBridge(secretReader: ExtensionSecretReader = hostSecretReader()): ExtensionCompanionBridge {
  if (process.platform !== "win32" && process.platform !== "linux") return new UnavailableExtensionCompanionBridge("The SXSY-B122 companion is available only on Windows and Linux.");
  try {
    return new JsonLineCompanionBridge(new ProvisionedNamedPipeJsonLineTransport(undefined, secretReader));
  } catch {
    return new UnavailableExtensionCompanionBridge("The authenticated SXSY-B122 local companion pipe configuration is invalid.");
  }
}

function hostSecretReader(): HostSecretReader {
  if (process.platform === "win32") return new WindowsDpapiSecretReader();
  if (process.platform === "linux") return new LinuxLibsecretCurrentUserProtector();
  throw new Error("No SXSY-B122 host secret protector exists for this platform.");
}

export async function deactivate(): Promise<void> {
  const activeController = controller;
  controller = undefined;
  const activeSecretReader = secretReader;
  secretReader = undefined;
  await deactivateManagedExtension(activeController, activeSecretReader);
  // The extension owns no process, broker, terminal hook, or external action.
}

export function exactExtensionVersion(context: vscode.ExtensionContext): string {
  const extensionPath = (context as unknown as { readonly extensionPath?: unknown }).extensionPath;
  return exactExtensionPackageVersion(extensionPath as string);
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
        const changedPaths = structuredGitChanges(repository.state, gitRoot);
        return [{
          gitRoot,
          worktree: gitRoot,
          branch: typeof repository.state?.HEAD?.name === "string" ? repository.state.HEAD.name : undefined,
          canonicalRemote: remote,
          changedPaths
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
    readonly workingTreeChanges?: readonly GitChangeLike[];
    readonly indexChanges?: readonly GitChangeLike[];
    readonly mergeChanges?: readonly GitChangeLike[];
    readonly untrackedChanges?: readonly GitChangeLike[];
  };
}

interface GitChangeLike { readonly uri?: { readonly fsPath?: string }; readonly originalUri?: { readonly fsPath?: string }; }

function structuredGitChanges(state: GitRepositoryLike["state"], root: string): readonly string[] {
  const changes = [...(state?.workingTreeChanges ?? []), ...(state?.indexChanges ?? []), ...(state?.mergeChanges ?? []), ...(state?.untrackedChanges ?? [])];
  const result = new Set<string>();
  for (const change of changes) {
    for (const candidate of [change.uri?.fsPath, change.originalUri?.fsPath]) {
      if (!candidate) continue;
      const path = relative(root, candidate).replaceAll("\\", "/");
      if (!path || isAbsolute(path) || path === ".." || path.startsWith("../") || path.split("/").includes(".git")) continue;
      result.add(path);
    }
  }
  return [...result].sort();
}
