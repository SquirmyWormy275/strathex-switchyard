#!/usr/bin/env node
import { runRuntimeCli } from "../deployment/suite/runtime.mjs";
const args = process.argv.slice(2);
if (args.length !== 1 || !["--check", "--install"].includes(args[0])) throw new Error("Usage: npm run runtime:check or npm run runtime:install");
await runRuntimeCli([args[0].slice(2)]);
