import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { computeRepositoryRuntimeManifestDigest } from "./repository-runtime.ts";
import {
  DurableRepositoryRuntimeRegistry,
  type RepositoryRuntimePin
} from "./runtime-registry.ts";
import type { WindowsUserPresenceRunner } from "./windows-user-presence.ts";

const maximumManifestBytes = 256 * 1024;

export interface RuntimePinInstallRequest {
  readonly repositoryRoot: string;
  readonly manifestPath: string;
}

export interface RuntimePinCoordinator {
  install(request: RuntimePinInstallRequest): Promise<RepositoryRuntimePin>;
  revoke(repositoryRoot: string): Promise<RepositoryRuntimePin>;
  list(): Promise<readonly RepositoryRuntimePin[]>;
}

/**
 * Host-owned provisioning boundary for repository runtime manifests. The
 * client selects paths only: the companion reads and hashes the manifest,
 * obtains current-user presence, and journals the exact digest itself.
 */
export class AttestedRuntimePinCoordinator implements RuntimePinCoordinator {
  private readonly registry: DurableRepositoryRuntimeRegistry;
  private readonly presence: WindowsUserPresenceRunner;
  private readonly now: () => Date;

  constructor(registry: DurableRepositoryRuntimeRegistry, presence: WindowsUserPresenceRunner, now: () => Date = () => new Date()) {
    this.registry = registry;
    this.presence = presence;
    this.now = now;
  }

  async install(request: RuntimePinInstallRequest): Promise<RepositoryRuntimePin> {
    const repositoryRoot = boundedAbsolutePath(request.repositoryRoot, "repository root");
    const manifestPath = boundedAbsolutePath(request.manifestPath, "runtime manifest");
    const metadata = await stat(manifestPath);
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumManifestBytes) {
      throw new Error("The selected repository runtime manifest is not a bounded regular file.");
    }
    const digest = computeRepositoryRuntimeManifestDigest(await readFile(manifestPath));
    const result = await this.presence.verify("Approve this exact SXSY-B122 repository runtime manifest digest for the selected Git root.");
    if (!result.verified || !result.operator?.trim()) throw new Error("Current-user presence did not approve the repository runtime pin.");
    return this.registry.install({
      repositoryRoot,
      manifestPath,
      expectedSha256: digest,
      attestation: { method: "windows-user-presence", at: this.now().toISOString() }
    });
  }

  async revoke(repositoryRootInput: string): Promise<RepositoryRuntimePin> {
    const repositoryRoot = boundedAbsolutePath(repositoryRootInput, "repository root");
    const result = await this.presence.verify("Revoke the active SXSY-B122 repository runtime manifest for the selected Git root.");
    if (!result.verified || !result.operator?.trim()) throw new Error("Current-user presence did not approve repository runtime revocation.");
    return this.registry.revoke(repositoryRoot, { method: "windows-user-presence", at: this.now().toISOString() });
  }

  list(): Promise<readonly RepositoryRuntimePin[]> { return this.registry.list(); }
}

function boundedAbsolutePath(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096 || value.includes("\0") || !isAbsolute(value)) {
    throw new Error(`The ${label} must be a bounded absolute host path.`);
  }
  return resolve(value);
}
