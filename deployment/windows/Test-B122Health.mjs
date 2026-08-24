import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader } = require(join(root, "extension", "dist", "named-pipe-transport.js"));
const args = process.argv.slice(2);
let configurationPath;
if (args.length === 2 && args[0] === "--configuration" && isAbsolute(args[1]) && !/[\r\n\0]/.test(args[1])) configurationPath = args[1];
else if (args.length !== 0) throw new Error("Health accepts only an exact absolute --configuration path.");
const transport = new ProvisionedNamedPipeJsonLineTransport(configurationPath, new WindowsDpapiSecretReader(), 10_000);
const id = `install-health-${process.pid}`;
const response = JSON.parse(await transport.request(JSON.stringify({ version: 1, id, method: "ping" })));
if (!response || response.version !== 1 || response.id !== id || response.ok !== true || response.result?.state !== "ready") throw new Error("The installed companion did not return an exact authenticated ready response.");
process.stdout.write(`${JSON.stringify({ schema: "sxsy-b122.install-health", version: 1, status: "ready", checkedAt: new Date().toISOString() })}\n`);
