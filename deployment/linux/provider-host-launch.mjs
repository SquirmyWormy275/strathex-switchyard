import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { runProviderAdapterHost } from "../app/dist/apps/provider-adapter-host/src/main.js";

const stateHome = process.env.XDG_STATE_HOME ?? (process.env.HOME ? resolve(process.env.HOME, ".local", "state") : undefined);
if (!stateHome) throw new Error("The Linux provider host has no current-user state root.");
const configuration = resolve(stateHome, "STRATHEX", "switchyard", "provider-host", "provider-host.json");
const nonce = randomBytes(32).toString("hex");
await runProviderAdapterHost(["--config", configuration, "--lifecycle-nonce", nonce]);
