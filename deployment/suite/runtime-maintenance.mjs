/** Quiesce the verified installed owner while optional generated software changes. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createInstallation, installationRoot } from "./installation.mjs";
import { verifySuiteRelease } from "./release.mjs";
import { applicationStateRoot, applicationStatus, stopApplication, launchApplication } from "./application.mjs";
import { privateRead, privateWrite } from "../../tools/layout-studio/private-fs.mjs";
import { withStateLock } from "../../tools/layout-studio/state-lock.mjs";
import { otherRuntimeOwners } from "./instance-owners.mjs";
export { otherRuntimeOwners } from "./instance-owners.mjs";

export function runtimeMaintenanceCoordinator({ root = installationRoot(), stateRoot = applicationStateRoot(), runtimeRoot, installed = () => createInstallation({ root, stateRoot }).inspect(), verifyBuild = bundle => verifySuiteRelease(bundle, { platform: process.platform, checkRuntime: true }), application, otherOwners = otherRuntimeOwners } = {}) {
  if (!runtimeRoot) throw new Error("The optional runtime maintenance directory is required.");
  application ??= { status: () => applicationStatus({ stateRoot }), stop: (expected = {}) => stopApplication({ stateRoot, ...expected }), launch: (bundleRoot, port) => launchApplication({ bundleRoot, stateRoot, port, installationRoot: root }) };
  const journal = join(runtimeRoot, ".maintenance/application-resume.json");
  return fn => withStateLock(join(stateRoot, "installation"), "installation", async installationLease => {
    const record = await installed();
    if (!record?.current || !/^[a-f0-9]{64}$/.test(record.current)) throw new Error("Install the normal Switchyard application before managing its shared optional runtime.");
    const bundle = join(root, "versions", record.current), manifest = await verifyBuild(bundle);
    if (manifest.id !== record.current) throw new Error("The installed application version did not verify; optional software was preserved.");
    let prior; try { prior = JSON.parse(await privateRead(journal)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (prior && (prior.schema !== "switchyard-runtime-resume/v1" || prior.root !== root || prior.build !== record.current || typeof prior.wasRunning !== "boolean" || !Number.isSafeInteger(prior.port) || prior.port < 1024 || prior.port > 65535)) throw new Error("The saved runtime/application recovery scope changed. Its journal was preserved.");
    let resume = prior?.wasRunning ?? false, port = prior?.port ?? 43177, value, failure;
    await withStateLock(stateRoot, "application-start", async startLease => {
      const status = await application.status(), running = ["ready", "stopping"].includes(status.status);
      if (running && status.build !== record.current) throw new Error("A different Switchyard build is active. Stop it before changing the shared optional runtime.");
      if ((await otherOwners(running ? status.pid : null)).length) throw new Error("Another Switchyard instance uses the shared runtime. Close that instance before maintenance; it was not displaced.");
      resume ||= running;
      if (running && status.origin) port = Number(new URL(status.origin).port);
      await privateWrite(journal, JSON.stringify({ schema: "switchyard-runtime-resume/v1", root, build: record.current, wasRunning: resume, port, at: new Date().toISOString(), reason: "Quiesce the exact installed owner for optional runtime maintenance; restore its previous running state afterwards." }));
      if (running && !(await application.stop({ expectedBuild: status.build, expectedInstanceId: status.instanceId })).stopped) throw new Error("The installed application did not verify exit. Runtime software was preserved.");
      await withStateLock(stateRoot, "application-owner", async ownerLease => {
        installationLease.assert(); startLease.assert(); ownerLease.assert();
        try { value = await fn(); } catch (error) { failure = error; }
        ownerLease.assert(); startLease.assert(); installationLease.assert();
      });
    });
    // Release application-start before the ordinary launcher reacquires it;
    // installation ownership remains held across both maintenance and restart.
    try {
      if (resume) { const ready = await application.launch(bundle, port); if (ready.status !== "ready" || ready.build !== record.current) throw new Error("The previous application running state was not restored. Keep the recovery journal and run switchyard runtime recover."); }
      installationLease.assert(); await rm(journal);
    } catch (error) { if (failure) throw new AggregateError([failure, error], "Runtime maintenance and application restart require recovery; their journals were preserved."); throw error; }
    if (failure) throw failure; return value;
  });
}
