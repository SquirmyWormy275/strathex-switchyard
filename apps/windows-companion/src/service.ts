/** Installable companion entry point. It intentionally exposes a small local IPC API only. */
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AuthorityLedger, OperationCoordinator, ProtectedStore, SessionRegistry, UnavailableAdapter } from "./control-plane.ts";
import { assignments } from "../../../packages/protocol/src/b122.ts";
import { captureLiveTargetSnapshot, CompanionIpcServer, createCompanionConfiguration, LocalControlExecutionBroker, LocalProcessProviderAdapter, LocalRepositoryBroker, LocalTestEnvironmentBroker } from "./local-runtime.ts";

export interface CompanionService { start(): Promise<void>; stop(): Promise<void>; }
export async function createCompanionService(stateDirectory = join(homedir(), ".strathex-switchyard")): Promise<CompanionService> {
  const configuration = await createCompanionConfiguration(stateDirectory);
  const store = new ProtectedStore(join(configuration.stateDirectory, "protected-store.json")); await store.load();
  const registry = new SessionRegistry(); const authorities = new AuthorityLedger();
  const sessionPath = join(configuration.stateDirectory, "sessions.json");
  const persistSessions = async (): Promise<void> => { await mkdir(configuration.stateDirectory, { recursive: true }); await writeFile(sessionPath, JSON.stringify(registry.list()), { encoding: "utf8", mode: 0o600 }); };
  try { for (const session of JSON.parse(await readFile(sessionPath, "utf8")) as Parameters<SessionRegistry["register"]>[0][]) registry.register({ ...session, status: session.status === "running" ? "stale" : session.status }); } catch (error: unknown) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
  const server = new CompanionIpcServer(configuration, async (method, params) => {
    if (method === "health") return { status: "healthy", protocol: "sxsy-b122-local-ipc-v1", stateDirectory: configuration.stateDirectory, sessions: registry.list().length };
    if (method === "sessions") return registry.list();
    if (method === "assignments") return assignments;
    if (method === "register") { const session = params as Parameters<SessionRegistry["register"]>[0]; const registered = registry.register(session); await persistSessions(); return registered; }
    if (method === "register-vscode") {
      const value = params as { id?: string; provider?: "claude" | "codex" | "generic"; terminalName?: string; terminalProcessId?: number; workspaceRoot?: string };
      if (!value.id || !value.workspaceRoot) throw new Error("VS Code registration requires a managed session ID and workspace root.");
      const target = await captureLiveTargetSnapshot(value.workspaceRoot);
      const registered = registry.register({ id: value.id, provider: value.provider ?? "generic", adapterVersion: "vscode-local-ipc-v1", surface: "vscode", windowId: `vscode:${value.workspaceRoot}`,
        terminalId: value.terminalProcessId?.toString() ?? value.terminalName, target, plannedFiles: [], capability: { registered: true, observable: false, controllable: false, mediated: false }, status: "unknown", lastHeartbeat: Date.now() });
      await persistSessions(); return registered;
    }
    if (method === "invoke") {
      const request = params as Parameters<OperationCoordinator["dispatch"]>[0];
      const target = request.target ?? registry.get(request.sessionId ?? "")?.target;
      if (!target) return { status: "incomplete", reason: "A selected managed session with a TargetSnapshot is required." };
      const session = registry.get(request.sessionId ?? ""); const provider = new LocalProcessProviderAdapter(session?.provider ?? "generic", registry.list());
      const execution = new LocalControlExecutionBroker(new LocalRepositoryBroker(target.gitRoot), new LocalTestEnvironmentBroker(), provider);
      return new OperationCoordinator(store, registry, authorities, new UnavailableAdapter("external"), execution, new LocalTestEnvironmentBroker()).dispatch(request);
    }
    throw new Error("Unsupported local IPC method.");
  });
  return { start: () => server.start(), stop: () => server.stop() };
}

if (process.argv[1]?.endsWith("service.js")) {
  createCompanionService().then((service) => service.start()).catch((error: Error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
