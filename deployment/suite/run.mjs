#!/usr/bin/env node
/** Run a verified bundle from any directory, independently of the checkout. */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { verifySuiteRelease } from "./release.mjs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]) || +args[1] < 1024 || +args[1] > 65535)) throw new Error("Usage: node /absolute/bundle/deployment/suite/run.mjs [--port 43177]");
const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, ""), manifest = await verifySuiteRelease(root, { platform: process.platform, checkRuntime: true });
const { createStudioServer } = await import("../../tools/layout-studio/serve.mjs");
const { runtimeDirectory, reviewAccessToken, publishEndpoint } = await import("../../tools/layout-studio/physical-intent.mjs");
const port = args.length ? +args[1] : 0;
let token;
if (port) token = await reviewAccessToken({ root: runtimeDirectory(), port, review: manifest.frontend.digest });
const server = createStudioServer({ assetRoot: join(root, "frontend"), token });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { server.closeAllConnections(); server.close(); });
server.listen(port, "127.0.0.1", async () => {
  const url = await publishEndpoint(server, { review: manifest.frontend.digest });
  console.log(`Switchyard: ${url}\nPrivate ${manifest.platform} bundle ${manifest.id.slice(0, 12)} · frozen frontend ${manifest.frontend.digest.slice(0, 12)} · Node ${manifest.nodeVersion}.`);
});
