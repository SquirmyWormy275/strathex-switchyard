import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader } = require(join(root, "extension", "dist", "named-pipe-transport.js"));
const args = process.argv.slice(2);
let configurationPath;
let shutdown = false;
let probe = false;
for (let index = 0; index < args.length;) {
  const argument = args[index];
  if (argument === "--shutdown" && !shutdown) { shutdown = true; index += 1; continue; }
  if (argument === "--probe" && !probe) { probe = true; index += 1; continue; }
  if (argument === "--configuration" && configurationPath === undefined && typeof args[index + 1] === "string" && isAbsolute(args[index + 1]) && !/[\r\n\0]/.test(args[index + 1])) { configurationPath = args[index + 1]; index += 2; continue; }
  throw new Error("Health accepts only --shutdown, --probe, and one exact absolute --configuration path.");
}
if (shutdown && probe) throw new Error("Health probe mode cannot be combined with shutdown.");
const transport = new ProvisionedNamedPipeJsonLineTransport(configurationPath, new WindowsDpapiSecretReader(), 10_000);
const id = `install-health-${process.pid}`;
const request = shutdown
  ? { version: 1, id, method: "ping", payload: { lifecycle: "shutdown" } }
  : { version: 1, id, method: "ping" };
try {
  const response = JSON.parse(await transport.request(JSON.stringify(request)));
  const expectedState = shutdown ? "stopping" : "ready";
  if (!response || response.version !== 1 || response.id !== id || response.ok !== true || response.result?.state !== expectedState) throw new Error(`The installed companion did not return an exact authenticated ${expectedState} response.`);
  process.stdout.write(`${JSON.stringify(probe
    ? { schema: "sxsy-b122.install-health-probe", version: 1, status: "ready", retryable: false, reason: "authenticated_ready" }
    : { schema: shutdown ? "sxsy-b122.install-shutdown" : "sxsy-b122.install-health", version: 1, status: expectedState, checkedAt: new Date().toISOString() })}\n`);
} catch (error) {
  if (!probe) throw error;
  const message = error instanceof Error ? error.message : "";
  const unavailable = message === "The authenticated local companion pipe is not provisioned."
    || message === "The local companion pipe is unavailable.";
  process.stdout.write(`${JSON.stringify({
    schema: "sxsy-b122.install-health-probe",
    version: 1,
    status: unavailable ? "unavailable" : "rejected",
    retryable: unavailable,
    reason: unavailable ? "endpoint_unavailable" : "integrity_or_authentication_failure"
  })}\n`);
  process.exitCode = unavailable ? 2 : 3;
}
