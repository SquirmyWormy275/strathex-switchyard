import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NamedPipeJsonLineTransport, ProvisionedNamedPipeJsonLineTransport, WindowsDpapiSecretReader, type ExtensionSecretReader, type StoredCompanionPipeConfiguration } from "../src/named-pipe-transport.ts";
import { WindowsDpapiCurrentUserProtector } from "../../windows-companion/src/windows-secret.ts";

class FakeSecretReader implements ExtensionSecretReader {
  async open(): Promise<Uint8Array> { return Buffer.alloc(32, 7); }
}

test("VS Code named-pipe transport authenticates exactly one candidate JSON-line request", async (context) => {
  const pipePath = process.platform === "win32"
    ? `\\\\.\\pipe\\sxsy-b122-vscode-${Date.now()}`
    : `${process.cwd()}/.tmp-sxsy-b122-vscode-${Date.now()}.sock`;
  const configuration: StoredCompanionPipeConfiguration = { version: 1, pipePath, sealedToken: "opaque-dpapi-envelope" };
  let received: unknown;
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (!buffer.includes("\n")) return;
      received = JSON.parse(buffer.trim());
      const request = (received as { request: { id: string } }).request;
      socket.end(`${JSON.stringify({ version: 1, id: request.id, ok: true, result: { state: "ready" } })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(pipePath, resolve); });
  context.after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

  const transport = new NamedPipeJsonLineTransport(configuration, new FakeSecretReader());
  const response = await transport.request(JSON.stringify({ version: 1, id: "vscode-ping", method: "ping" }));
  assert.deepEqual(JSON.parse(response), { version: 1, id: "vscode-ping", ok: true, result: { state: "ready" } });
  assert.deepEqual(received, {
    version: 1,
    token: Buffer.alloc(32, 7).toString("base64"),
    request: { version: 1, id: "vscode-ping", method: "ping" }
  });
});

test("VS Code named-pipe transport refuses TCP-like endpoint metadata", () => {
  assert.throws(() => new NamedPipeJsonLineTransport({ version: 1, pipePath: "http://127.0.0.1:9999", sealedToken: "opaque" }, new FakeSecretReader()), /invalid/i);
});

test("provisioned VS Code transport reads only the companion-owned sealed state record", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-b122-vscode-state-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const pipePath = process.platform === "win32"
    ? `\\\\.\\pipe\\sxsy-b122-vscode-state-${Date.now()}`
    : join(directory, "sxsy-b122-vscode-state.sock");
  const configurationPath = join(directory, "authenticated-pipe.json");
  await writeFile(configurationPath, JSON.stringify({ version: 1, pipePath, sealedToken: "opaque-dpapi-envelope" }), "utf8");
  const server = createServer((socket) => socket.once("data", (chunk: Buffer) => {
    const request = (JSON.parse(chunk.toString("utf8").trim()) as { request: { id: string } }).request;
    socket.end(`${JSON.stringify({ version: 1, id: request.id, ok: true, result: { state: "ready" } })}\n`);
  }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(pipePath, resolve); });
  context.after(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
  const transport = new ProvisionedNamedPipeJsonLineTransport(configurationPath, new FakeSecretReader());
  const response = await transport.request(JSON.stringify({ version: 1, id: "state-ping", method: "ping" }));
  assert.equal((JSON.parse(response) as { id: string }).id, "state-ping");
});

test("the VS Code DPAPI reader opens only the current user's companion-sealed test value", { skip: process.platform !== "win32" ? "Windows-only DPAPI integration check." : false }, async () => {
  const companionProtector = new WindowsDpapiCurrentUserProtector();
  const cleartext = Buffer.from("sxsy-b122-extension-dpapi-smoke-v1", "utf8");
  const sealed = await companionProtector.seal(cleartext);
  const opened = Buffer.from(await new WindowsDpapiSecretReader().open(sealed));
  assert.deepEqual(opened, cleartext);
  opened.fill(0);
});
