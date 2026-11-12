/** Closed normal-installed runtime operations, never arbitrary executable arguments. */
import { createRuntimeLifecycle } from "../../tools/layout-studio/runtime-lifecycle.mjs";
import { runtimeRoot } from "../../tools/layout-studio/runtime-setup.mjs";
import { runtimeMaintenanceCoordinator } from "./runtime-maintenance.mjs";
export async function runRuntimeCli(args, { installationRoot, ...options } = {}) {
  if (args.length !== 1 || !["check", "install", "update", "rollback", "recover", "uninstall"].includes(args[0])) throw new Error("Usage: switchyard runtime check|install|update|rollback|recover|uninstall");
  const root = options.root ?? runtimeRoot(), coordinate = options.coordinate ?? runtimeMaintenanceCoordinator({ runtimeRoot: root, ...(installationRoot ? { root: installationRoot } : {}) });
  const result = await createRuntimeLifecycle({ ...options, root, coordinate })[args[0]]();
  console.log(JSON.stringify({ ...result, packages: result.packages ? Object.keys(result.packages).length : undefined }));
}
