import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { ProviderHostPathSecurity } from "./windows-path-security.ts";

/** Exact current-UID, non-symlink, mode-restricted provider secret boundary. */
export class LinuxCurrentUserProviderHostPathSecurity implements ProviderHostPathSecurity {
  async assertCurrentUserProtected(protectedRoot: string, existingPaths: readonly string[]): Promise<void> {
    if (process.platform !== "linux" || process.getuid === undefined) throw new Error("Provider-host protected storage requires a Linux current-user identity.");
    const uid = process.getuid();
    const root = resolve(protectedRoot);
    if (!isAbsolute(root) || !existingPaths.every((path) => inside(root, resolve(path)))) throw new Error("Provider-host secrets and state must remain beneath the protected current-user root.");
    const rootMetadata = await lstat(root);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || rootMetadata.uid !== uid || (rootMetadata.mode & 0o077) !== 0) {
      throw new Error("The Linux provider-host root is not a private current-user directory.");
    }
    if (await realpath(root) !== root) throw new Error("The Linux provider-host root is not canonical.");
    for (const path of existingPaths) {
      const canonical = await realpath(path);
      if (!inside(root, canonical) || canonical !== resolve(path)) throw new Error("A Linux provider-host protected path changed or escaped its root.");
      await assertChain(root, canonical, uid);
    }
  }
}

async function assertChain(root: string, path: string, uid: number): Promise<void> {
  let current = path;
  for (;;) {
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink() || metadata.uid !== uid || (!metadata.isFile() && !metadata.isDirectory()) || (metadata.mode & 0o077) !== 0) {
      throw new Error("A Linux provider-host protected path is linked, foreign, broad, or special.");
    }
    if (current === root) return;
    const parent = dirname(current);
    if (!inside(root, parent) || parent === current) throw new Error("A Linux provider-host protected path escaped its root.");
    current = parent;
  }
}

function inside(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix === "" || suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix);
}
