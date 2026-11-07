/** Read-only authenticated inventory of registered local owners. */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runtimeDirectory } from "../../tools/layout-studio/physical-intent.mjs";
import { requestInstance, endpointIdentity } from "../../tools/layout-studio/instance.mjs";
import { privateRead } from "../../tools/layout-studio/private-fs.mjs";
export async function otherRuntimeOwners(exceptPid, directory = runtimeDirectory()) {
  let names; try { names = await readdir(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (names.length > 128) throw new Error("The local endpoint inventory exceeds its inspection bound. Preserve the existing application state.");
  const active = [];
  for (const name of names.filter(name => /^\d{1,5}\.json$/.test(name))) {
    const endpoint = JSON.parse(await privateRead(join(directory, name))); endpointIdentity(endpoint);
    try { const proof = await requestInstance(endpoint); if (proof.pid !== exceptPid) active.push({ pid: proof.pid, build: proof.build }); }
    catch (error) { if (error.code !== "ECONNREFUSED") throw new Error("An existing local endpoint could not be verified. Runtime maintenance preserved it."); }
  }
  return active;
}
