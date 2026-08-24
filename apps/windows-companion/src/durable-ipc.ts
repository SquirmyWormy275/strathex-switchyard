import { createServer, type Server, type Socket } from "node:net";
import type { CompanionConfiguration } from "./local-runtime.ts";
import { companionBridgeVersion, isCompanionRequest, type CompanionResponse } from "./bridge.ts";
import type { CompanionRequestHandler } from "./stdio.ts";

interface AuthenticatedEnvelope { readonly token?: unknown; readonly request?: unknown; }

/** A per-user named-pipe server: every request is token-authenticated before it reaches the durable endpoint. */
export class DurableLocalIpcServer {
  private server?: Server;
  private readonly configuration: CompanionConfiguration;
  private readonly handler: CompanionRequestHandler;
  constructor(configuration: CompanionConfiguration, handler: CompanionRequestHandler) { this.configuration = configuration; this.handler = handler; }

  async start(): Promise<void> {
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolveStart, reject) => {
      this.server!.once("error", reject); this.server!.listen(this.configuration.ipcPath, resolveStart);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolveStop, reject) => this.server!.close((error) => error ? reject(error) : resolveStop()));
    this.server = undefined;
  }

  private accept(socket: Socket): void {
    let pending = "";
    socket.on("data", (chunk) => {
      pending += chunk.toString("utf8");
      if (Buffer.byteLength(pending, "utf8") > 64 * 1024) { socket.destroy(); return; }
      let index: number;
      while ((index = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        void this.handleLine(line).then((response) => socket.write(`${JSON.stringify(response)}\n`));
      }
    });
  }

  private async handleLine(line: string): Promise<CompanionResponse> {
    let envelope: AuthenticatedEnvelope;
    try { envelope = JSON.parse(line) as AuthenticatedEnvelope; } catch { return unavailable("invalid", "Malformed local companion request."); }
    const request = envelope.request;
    if (envelope.token !== this.configuration.token || !isCompanionRequest(request)) return unavailable(isRequestId(request), "Local companion authentication or request validation failed.");
    try { return await this.handler.handle(request); } catch { return unavailable(request.id, "The durable local companion is unavailable."); }
  }
}

function isRequestId(value: unknown): string { return typeof value === "object" && value !== null && "id" in value && typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : "invalid"; }
function unavailable(id: string, message: string): CompanionResponse { return { version: companionBridgeVersion, id, ok: false, error: { code: "companion_unavailable", message } }; }
