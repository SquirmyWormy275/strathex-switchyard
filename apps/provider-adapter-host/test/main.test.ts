import assert from "node:assert/strict";
import test from "node:test";

import type { LoadedProviderBackendRuntime, LoadedProviderHostConfiguration } from "../src/config.ts";
import { loadInstalledProviderBackendRuntime } from "../src/main.ts";

function configuration(): LoadedProviderHostConfiguration {
  return {
    configurationPath: "C:\\state\\provider-host\\config.json",
    configurationSha256: "a".repeat(64),
    protectedStateRoot: "C:\\state\\provider-host",
    companionStateDirectory: "C:\\state",
    listen: { host: "127.0.0.1", port: 4747 },
    tls: {
      certificate: new Uint8Array(), privateKey: new Uint8Array(),
      certificateSha256: "b".repeat(64), privateKeySha256: "c".repeat(64), tlsSpkiSha256: "d".repeat(64)
    },
    authenticationToken: new Uint8Array(), authenticationTokenText: "e".repeat(64),
    journalAuthenticationKey: new Uint8Array(), journalAuthenticationKeyText: "f".repeat(64),
    dispatchLeaseAuthenticationKey: new Uint8Array(), dispatchLeaseAuthenticationKeyText: "1".repeat(64),
    stateFile: "C:\\state\\provider-host\\state.jsonl",
    providers: [{ provider: "codex", kind: "fixture" }], effectDrivers: []
  };
}

test("installed provider startup attaches only the canonical companion final-current client", async () => {
  const loaded = configuration();
  const finalCurrent = { async assertCurrent() { throw new Error("not called"); } };
  const expectedRuntime: LoadedProviderBackendRuntime = { backends: [], async close() {} };
  let observedDirectory: string | undefined;
  let observedFinalCurrent: unknown;

  const runtime = await loadInstalledProviderBackendRuntime(loaded, {
    async loadMediatedFinalCurrent(directory) {
      observedDirectory = directory;
      return finalCurrent;
    },
    async loadRuntime(_configuration, options) {
      observedFinalCurrent = options.mediatedFinalCurrent;
      return expectedRuntime;
    }
  });

  assert.equal(runtime, expectedRuntime);
  assert.equal(observedDirectory, loaded.companionStateDirectory);
  assert.equal(observedFinalCurrent, finalCurrent);
});

test("installed provider startup fails closed to no Mediated callback when the companion endpoint is unavailable", async () => {
  const loaded = configuration();
  let observedOptions: unknown;

  await loadInstalledProviderBackendRuntime(loaded, {
    async loadMediatedFinalCurrent() { throw new Error("sealed endpoint unavailable"); },
    async loadRuntime(_configuration, options) {
      observedOptions = options;
      return { backends: [], async close() {} };
    }
  });

  assert.deepEqual(observedOptions, {});
});

test("installed provider startup never retries or disguises a backend composition failure", async () => {
  const loaded = configuration();
  let attempts = 0;

  await assert.rejects(() => loadInstalledProviderBackendRuntime(loaded, {
    async loadMediatedFinalCurrent() { return { async assertCurrent() { throw new Error("not called"); } }; },
    async loadRuntime() {
      attempts += 1;
      throw new Error("backend module contract failed");
    }
  }), /backend module contract failed/);

  assert.equal(attempts, 1);
});
