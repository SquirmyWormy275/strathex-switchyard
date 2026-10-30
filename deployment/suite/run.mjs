#!/usr/bin/env node
/** Foreground owner used by the installed launcher and development diagnostics. */
import { fileURLToPath } from "node:url";
import { serveApplication } from "./application.mjs";
import { writeSync } from "node:fs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]) || +args[1] !== 0 && (+args[1] < 1024 || +args[1] > 65535))) throw new Error("Usage: node /absolute/bundle/deployment/suite/run.mjs [--port 43177]");
const bundleRoot = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
await serveApplication({ bundleRoot, port: args.length ? +args[1] : 43177, onStage: (stage) => { if (process.env.SWITCHYARD_STARTUP_TRACE === "1") try { writeSync(3, `SWITCHYARD_STARTUP_STAGE=${stage}\n`); } catch { /* The short-lived launcher may already have exited. */ } }, onReady: ({ url, instance, manifest }) => { console.log(`Switchyard: ${url}\nPrivate bundle ${instance.build.slice(0, 12)} · frozen frontend ${manifest.frontend.digest.slice(0, 12)}.`); } });
