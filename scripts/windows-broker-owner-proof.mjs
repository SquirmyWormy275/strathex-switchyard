/** Disposable Windows CI only: actual host owner/native transport, no guest. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { createWindowsStorageNative } from "../tools/layout-studio/windows-storage-native.mjs";
import { createWindowsBrokerExchanges } from "../tools/layout-studio/windows-broker-exchanges.mjs";
import { directoryIdentity } from "../tools/layout-studio/private-fs.mjs";
import { runtimeGuardianStopped, runRuntimeCommand } from "../tools/layout-studio/runtime-command.mjs";
import { stateLockFailureEvidence } from "../tools/layout-studio/keyless-lease-pool.mjs";
import { createWindowsOwnerProbeObservation } from "./windows-owner-probe-observation.mjs";

/** Keep original exit assertions; report only a bounded ordinal and fixed phase. */
export async function verifyWindowsBrokerOwnerRetirement(owners, guardianStopped, setPhase) {
  setPhase("native-exit-owner-inventory");
  assert.ok(Array.isArray(owners) && owners.length > 0 && owners.length <= 64);
  for (const [index, owner] of owners.entries()) {
    setPhase(`native-exit-owner-${index + 1}-recorded`);
    assert.equal(owner.stoppedVerified, true);
    setPhase(`native-exit-owner-${index + 1}-guardian`);
    assert.equal(await guardianStopped(owner.ownedRuntime), true);
  }
}

export async function verifyWindowsBrokerOwner({ helper, installationId, serviceImageSha256, nativeControl }) {
  if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Windows") throw Error("The actual broker-owner proof requires the explicit disposable Windows worker.");
  const root = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), "sxbo-")), original = await directoryIdentity(root), keys = new Map(), checks = [];
  const store = createSuiteStore({ root, secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } } });
  const observation = createWindowsOwnerProbeObservation();
  const guardianStopped = nativeControl?.guardianStopped ?? (frame => runtimeGuardianStopped(frame, { windowsHelper: helper }));
  const native = observation.native(createWindowsStorageNative({ store, helperPath: helper, setupPath: join(dirname(helper), "Switchyard.Setup.exe"), command: observation.command(nativeControl?.command ?? runRuntimeCommand), guardianStopped }));
  let consumerExited = true, phase = "private-state-initialize";
  const service = createWindowsBrokerExchanges({ store, native, consumerStopped: async () => consumerExited }), context = { operationId: randomUUID(), scopeDigest: "a".repeat(64), provider: "codex" }, inputs = { inputManifestSha256: "e".repeat(64) }, authorize = async () => {};
  try {
    await store.initialize("personal"); phase = "private-state-mode-update";
    await store.update("personal", "synthetic-companion", state => { state.mode = "personal-companion"; });
    phase = "read-only-probe";
    assert.deepEqual(await service.probe("personal", context, authorize), { status: "available", effectStarted: false });
    assert.equal((await service.list("personal")).length, 0); checks.push("fresh authenticated native capability creates no exchange owner or disk");
    phase = "exact-create";
    const image = await service.prepare("personal", context, authorize, inputs), created = (await store.snapshot("personal")).repositoryWindowsBrokerExchanges[0];
    assert.equal(created.installation.installationId, installationId); assert.equal(created.installation.serviceImageSha256, serviceImageSha256); assert.equal(created.commands.create.status, "recorded");
    checks.push("actual native transport settles only the original durable create request");
    phase = "exact-mounted-mapping";
    const volume = await image.createVolume(); await volume.assertCurrent();
    assert.equal(volume.nativeBinding.broker.taskScopeSha256, context.scopeDigest); assert.equal(volume.nativeBinding.broker.inputManifestSha256, inputs.inputManifestSha256);
    const data = Buffer.from("synthetic host owner data\n"), file = join(volume.root, "synthetic.bin"); await writeFile(file, data, { flag: "wx" }); assert.deepEqual(await readFile(file), data);
    checks.push("original signed mapping and actual mounted filesystem write/readback verify exact task and input scope");
    phase = "kernel-consumer-lease";
    await volume.withConsumer(async () => { assert.equal((await service.cleanup("personal", context.operationId)).cleaned, false); });
    checks.push("actual consumer kernel lease excludes retirement before any VM exists");
    phase = "independent-consumer-exit"; consumerExited = false;
    await assert.rejects(volume.release(), /guest consumer exit/); assert.deepEqual(await readFile(file), data); consumerExited = true;
    checks.push("unconfirmed guest exit preserves the original mounted exchange");
    phase = "exact-retirement"; await volume.release();
    const retired = (await store.snapshot("personal")).repositoryWindowsBrokerExchanges[0];
    assert.equal(retired.cleanupPending, false); assert.deepEqual(Object.keys(retired.commands), ["create", "attach", "detach", "retire"]);
    for (const command of Object.values(retired.commands)) assert.equal(command.status, "recorded");
    checks.push("actual detach and retirement settle all four original effect requests");
    phase = "duplicate-refusal"; await assert.rejects(service.prepare("personal", context, authorize, inputs), /replay/);
    assert.equal((await store.snapshot("personal")).repositoryWindowsBrokerExchanges.length, 1); checks.push("retired operation cannot create or transfer another image");
    phase = "native-exit-and-fixture-retirement";
    const owners = (await store.snapshot("personal")).windowsStorageNative;
    await verifyWindowsBrokerOwnerRetirement(owners, guardianStopped, value => { phase = value; });
    phase = "native-exit-service-close"; await service.close();
    phase = "native-exit-directory-observe"; const current = await directoryIdentity(root);
    phase = "native-exit-directory-device"; assert.equal(current.dev, original.dev);
    phase = "native-exit-directory-inode"; assert.equal(current.ino, original.ino);
    phase = "native-exit-fixture-remove";
    await rm(root, { recursive: true }); checks.push("every retained native Job guardian independently exited and only the exact synthetic private fixture was removed");
    phase = "native-exit-check-inventory";
    assert.equal(checks.length, 8);
    return { schema: "switchyard-native-broker-owner-proof/v1", success: true, checks, nativeExitVerified: true, fixtureRemoved: true, guestLaunched: false, setupRequested: false, accountCreated: false, ordinaryUserToken: false };
  } catch (error) {
    // Keep original native ownership and AEAD facts. The enclosing coordinator
    // preserves the installation and never replays its failed action.
    error.hostExchangeProof = { schema: "switchyard-native-broker-owner-proof/v1", success: false, checks, failedPhase: phase === "read-only-probe" ? observation.failurePhase ?? phase : phase, failureCategory: ["Error", "AssertionError", "TypeError", "RangeError"].includes(error.name) ? error.name : "Error", stateLockFailure: stateLockFailureEvidence(error.stateLockFailure) ?? null, stateDirectory: root, fixtureRemoved: false, guestLaunched: false, setupRequested: false, accountCreated: false };
    throw error;
  }
}
