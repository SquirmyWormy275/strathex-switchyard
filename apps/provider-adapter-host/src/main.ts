#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../../../packages/control-plane/src/store.ts";
import { CodexProviderAdapterBackend, FixtureProviderRuntimePort } from "./backends.ts";
import { loadProviderBackendRuntime, loadProviderHostConfiguration } from "./config.ts";
import { startProviderAdapterHttpsServer } from "./server.ts";
import { ProviderAdapterHostService } from "./service.ts";
import { createProviderHostStore } from "./state.ts";

export async function runProviderAdapterHost(argv: readonly string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === "--self-test") return selfTest();
  if (argv.length !== 4 || argv[0] !== "--config" || argv[2] !== "--lifecycle-nonce" || !/^[a-f0-9]{64}$/.test(argv[3]!)) throw new Error("Usage: sxsy-b122-provider-adapter-host --config <absolute-config.json> --lifecycle-nonce <64-lowercase-hex> | --self-test");
  const configuration = await loadProviderHostConfiguration(argv[1]!);
  let runtime: Awaited<ReturnType<typeof loadProviderBackendRuntime>> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  try {
    runtime = await loadProviderBackendRuntime(configuration);
    let requestShutdown = (): void => {};
    const service = new ProviderAdapterHostService({
      authenticationToken: configuration.authenticationTokenText,
      store: createProviderHostStore(configuration.stateFile, configuration.journalAuthenticationKeyText),
      backends: runtime.backends,
      lifecycle: { nonce: argv[3]!, processId: process.pid, configurationSha256: configuration.configurationSha256, requestShutdown: () => requestShutdown() }
    });
    const reconciliation = await service.reconcile();
    const running = await startProviderAdapterHttpsServer({
      service, host: configuration.listen.host, port: configuration.listen.port,
      certificate: configuration.tls.certificate, privateKey: configuration.tls.privateKey
    });
    configuration.tls.privateKey.fill(0);
    configuration.authenticationToken.fill(0);
    configuration.journalAuthenticationKey.fill(0);
    process.stdout.write(`${JSON.stringify({ schema: "sxsy-b122.provider-host-started", version: 1, host: running.host, port: running.port, providers: configuration.providers.map((entry) => entry.provider), processId: process.pid, lifecycleNonceSha256: sha256(argv[3]!), configurationSha256: configuration.configurationSha256, reconciliation })}\n`);
    const shutdown = (): Promise<void> => shutdownPromise ??= (async () => {
      const results = await Promise.allSettled([running.close(), runtime!.close()]);
      if (results.some((result) => result.status === "rejected")) throw new Error("Provider host shutdown failed closed.");
      process.exitCode = 0;
    })();
    requestShutdown = () => { void shutdown().catch(() => { process.exitCode = 1; }); };
    process.once("SIGINT", requestShutdown);
    process.once("SIGTERM", requestShutdown);
    return 0;
  } catch (error) {
    await runtime?.close().catch(() => undefined);
    configuration.authenticationToken.fill(0);
    configuration.journalAuthenticationKey.fill(0);
    configuration.tls.privateKey.fill(0);
    for (const provider of configuration.providers) if (provider.kind === "module") { provider.credential.fill(0); provider.moduleSource.fill(0); }
    throw error;
  }
}

async function selfTest(): Promise<number> {
  const root = await mkdtemp(join(tmpdir(), "sxsy-b122-provider-host-self-test-"));
  const token = sha256("sxsy-b122-provider-host-self-test-token");
  try {
    const port = new FixtureProviderRuntimePort("codex");
    const service = new ProviderAdapterHostService({ authenticationToken: token, store: createProviderHostStore(join(root, "state.jsonl"), token), backends: [new CodexProviderAdapterBackend(port)] });
    const result = await service.handle({ method: "GET", path: "/v1/b122/health", headers: { authorization: `Bearer ${token}` } });
    if (result.status !== 200) throw new Error("Provider host self-test health check failed.");
    process.stdout.write(`${JSON.stringify({ schema: "sxsy-b122.provider-host-self-test", version: 1, status: "ok", authenticatedState: true, fixtureBackend: true, networkAccessed: false, proprietaryCredentialAccessed: false })}\n`);
    return 0;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProviderAdapterHost(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    // A digest-pinned provider module can still be hostile and has seen its
    // credential. Never persist its exception text in the lifecycle stderr log.
    void error;
    process.stderr.write("Provider adapter host startup failed closed. Run the configuration validator for a bounded diagnostic.\n");
    process.exitCode = 1;
  });
}
