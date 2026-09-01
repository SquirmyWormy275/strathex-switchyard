import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, state] = process.argv.slice(2);
if (!dist || !state) throw new Error("usage: omarchy-health.mjs DIST_DIRECTORY STATE_DIRECTORY");
const { collectOmarchyHostEvidence } = await import(pathToFileURL(join(dist, "apps/linux-companion/src/omarchy-capabilities.js")));
const { loadFixedOmarchySurfaceIdentities } = await import(pathToFileURL(join(dist, "apps/linux-companion/src/omarchy-identity.js")));
const evidence = await collectOmarchyHostEvidence();
const identities = await loadFixedOmarchySurfaceIdentities(join(state, "omarchy-surfaces.json"));
const required = ["omarchy", "hyprland", "wayland"];
const missing = required.filter((id) => !evidence.capabilities.some((capability) => capability.id === id && capability.available));
if (missing.length || !identities) throw new Error(`Omarchy health is unavailable${missing.length ? `; missing ${missing.join(", ")}` : "; identities are not commissioned"}.`);
process.stdout.write(`${JSON.stringify({ status: "available", identities, capabilities: required }, null, 2)}\n`);
