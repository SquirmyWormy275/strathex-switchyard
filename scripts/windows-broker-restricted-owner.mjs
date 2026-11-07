/** Fixed test-only child entrypoint. The parent inspects its actual primary token. */
import { readFile, lstat } from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { verifyWindowsBrokerOwner } from "./windows-broker-owner-proof.mjs";
import { createWindowsDescendantQuery } from "./windows-descendant-query.mjs";

export function validateRestrictedHostContext(value) {
  const keys = ["schema", "helper", "installationId", "serviceImageSha256", "node", "nodeSha256", "nonce", "coldRandom", "coldRandomSha256"];
  const path = value => typeof value === "string" && win32.isAbsolute(value) && win32.normalize(value) === value && !/[\0\r\n]/.test(value);
  const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join() || value.schema !== "switchyard-restricted-host-context/v1" || !path(value.helper) || win32.basename(value.helper) !== "Switchyard.Hotkeys.exe" || !path(value.node) || win32.basename(value.node).toLowerCase() !== "node.exe" || !sha(value.serviceImageSha256) || !sha(value.nodeSha256) || !path(value.coldRandom) || win32.basename(value.coldRandom) !== "Switchyard.ColdRandom.exe" || !sha(value.coldRandomSha256) || typeof value.installationId !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.installationId) || value.installationId === "00000000-0000-0000-0000-000000000000" || typeof value.nonce !== "string" || !/^[a-f0-9]{32}$/.test(value.nonce)) throw Error("Use only the exact restricted-host fixture context.");
  return structuredClone(value);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Windows" || process.argv.length !== 3) throw Error("Use only the fixed disposable Windows restricted-host child.");
  const contextPath = process.argv[2], stat = await lstat(contextPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16384) throw Error("The original restricted-host context is unavailable.");
  const bytes = await readFile(contextPath);
  if (bytes.length !== stat.size) throw Error("The restricted-host context changed.");
  const context = validateRestrictedHostContext(JSON.parse(bytes.toString("utf8")));
  if (context.node.toLowerCase() !== process.execPath.toLowerCase() || context.installationId !== process.env.SWITCHYARD_TEST_BROKER_INSTALLATION_ID || contextPath !== process.env.SWITCHYARD_TEST_RESTRICTED_HOST_CONTEXT) throw Error("The original restricted-host process binding changed.");
  let owner, failure;
  try { owner = await verifyWindowsBrokerOwner({ ...context, nativeControl: createWindowsDescendantQuery(context, contextPath) }); }
  catch (error) { failure = error; owner = error.hostExchangeProof ?? { success: false }; }
  const current = await lstat(contextPath);
  if (current.dev !== stat.dev || current.ino !== stat.ino || !(await readFile(contextPath)).equals(bytes)) throw Error("The original restricted-host context changed before reporting.");
  await privateWrite(join(dirname(contextPath), "result.json"), JSON.stringify({ schema: "switchyard-restricted-host-result/v1", nonce: context.nonce, success: !failure, owner }));
  if (failure) process.exitCode = 2;
}
