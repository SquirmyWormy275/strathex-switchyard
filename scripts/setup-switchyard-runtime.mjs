#!/usr/bin/env node
import { setupRuntime } from "../tools/layout-studio/runtime-setup.mjs";
const args = process.argv.slice(2);
if (args.length !== 1 || !["--check", "--install"].includes(args[0])) throw new Error("Usage: npm run runtime:check or npm run runtime:install");
const result = await setupRuntime({ install: args[0] === "--install" });
console.log(JSON.stringify({ status: result.status, python: result.python, packages: Object.keys(result.packages).length, modelRevision: result.modelRevision, modelLoaded: result.modelLoaded, reusedExisting: result.reusedExisting ?? null, installedComponents: result.installedComponents ?? [], extraDistributions: result.extraDistributions, hidOpened: false, providerContacted: false }, null, 2));
