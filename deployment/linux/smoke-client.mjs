import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const [releaseRoot, stateRoot] = process.argv.slice(2);
if (!releaseRoot || !stateRoot) throw new Error("release and state roots are required");
const app = resolve(releaseRoot, "app", "dist");
const [{ LinuxLibsecretCurrentUserProtector }, { AuthenticatedPipeClient }] = await Promise.all([
  import(pathToFileURL(join(app, "apps", "linux-companion", "src", "linux-secret.js")).href),
  import(pathToFileURL(join(app, "apps", "windows-companion", "src", "authenticated-pipe.js")).href)
]);
const configuration = JSON.parse(await readFile(join(stateRoot, "STRATHEX", "switchyard", "authenticated-pipe.json"), "utf8"));
const protector = new LinuxLibsecretCurrentUserProtector();
try {
  const response = await new AuthenticatedPipeClient(configuration, protector).request({ version: 1, id: "linux-release-smoke", method: "ping" });
  if (!response.ok || response.id !== "linux-release-smoke") throw new Error("companion ping was not successful");
  process.stdout.write("Authenticated packaged Linux companion smoke passed.\n");
} finally { await protector.dispose(); }
