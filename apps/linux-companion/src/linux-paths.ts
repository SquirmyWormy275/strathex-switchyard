import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export interface LinuxCompanionPaths { readonly stateDirectory: string; readonly runtimeDirectory: string; }

export async function provisionLinuxCompanionPaths(environment: Readonly<Record<string, string | undefined>> = process.env): Promise<LinuxCompanionPaths> {
  if (process.platform !== "linux") throw new Error("Linux companion paths are unavailable on this platform.");
  const stateBase = environment.XDG_STATE_HOME ?? join(environment.HOME ?? homedir(), ".local", "state");
  const runtimeBase = environment.XDG_RUNTIME_DIR;
  if (!runtimeBase || !safeAbsolute(stateBase) || !safeAbsolute(runtimeBase)) throw new Error("The Linux companion requires absolute XDG state and runtime directories.");
  await mkdir(resolve(stateBase), { recursive: true, mode: 0o700 });
  const canonicalStateBase = await realpath(resolve(stateBase));
  const canonicalRuntimeBase = await realpath(resolve(runtimeBase));
  const [stateMetadata, runtimeMetadata] = await Promise.all([stat(canonicalStateBase), stat(canonicalRuntimeBase)]);
  const uid = process.getuid?.();
  if (uid === undefined || !stateMetadata.isDirectory() || stateMetadata.uid !== uid || (stateMetadata.mode & 0o022) !== 0
    || !runtimeMetadata.isDirectory() || runtimeMetadata.uid !== uid || (runtimeMetadata.mode & 0o077) !== 0) {
    throw new Error("The XDG state or runtime base does not have safe private current-user ownership and permissions.");
  }
  const requestedState = resolve(canonicalStateBase, "STRATHEX", "switchyard");
  const requestedRuntime = resolve(canonicalRuntimeBase, "sxsy-b122");
  await mkdir(requestedState, { recursive: true, mode: 0o700 });
  await mkdir(requestedRuntime, { recursive: true, mode: 0o700 });
  const [stateDirectory, runtimeDirectory] = await Promise.all([realpath(requestedState), realpath(requestedRuntime)]);
  if (!inside(canonicalStateBase, stateDirectory) || !inside(canonicalRuntimeBase, runtimeDirectory)) throw new Error("A Linux companion directory escaped its XDG boundary.");
  for (const directory of [stateDirectory, runtimeDirectory]) {
    const metadata = await stat(directory);
    if (!metadata.isDirectory() || metadata.uid !== uid || (metadata.mode & 0o077) !== 0) throw new Error("A Linux companion directory is not private to the current user.");
  }
  return { stateDirectory, runtimeDirectory };
}

function safeAbsolute(value: string): boolean { return isAbsolute(value) && value.length <= 4096 && !/[\0\r\n]/.test(value); }
function inside(root: string, candidate: string): boolean { const suffix = relative(root, candidate); return suffix === "" || suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix); }
