#!/usr/bin/env node
/** Small loopback-only server for the dependency-free, offline layout studio. */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHostBridge, discoverHost } from "./host.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/model.mjs", ["model.mjs", "text/javascript; charset=utf-8"]],
  ["/workspace.mjs", ["workspace.mjs", "text/javascript; charset=utf-8"]],
  ["/connection.mjs", ["connection.mjs", "text/javascript; charset=utf-8"]],
  ["/vial-snapshot.mjs", ["vial-snapshot.mjs", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/sample-info.json", ["sample-info.json", "application/json; charset=utf-8"]],
  ["/sample-keymap.json", ["sample-keymap.json", "application/json; charset=utf-8"]],
  ["/sample-study-report.json", ["sample-study-report.json", "application/json; charset=utf-8"]]
]);

export function createStudioServer({ token = randomBytes(32).toString("base64url"), bridge = createHostBridge(), discover = discoverHost } = {}) {
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    const authority = `127.0.0.1:${server.address()?.port}`;
    const json = (status, value) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); };
    if (request.headers.host !== authority || (request.headers.origin && request.headers.origin !== `http://${authority}`) || ["cross-site", "same-site"].includes(request.headers["sec-fetch-site"])) { json(403, { error: "This request is outside the local workspace origin." }); return; }
    if (request.url?.startsWith("/api/")) {
      const supplied = Buffer.from(String(request.headers.authorization ?? ""));
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { json(401, { error: "Open the private access link printed at startup to connect this workspace." }); return; }
      try {
        if (request.method === "GET" && request.url === "/api/discovery") { json(200, await discover()); return; }
        if (request.method === "GET" && request.url === "/api/transactions") { json(200, await bridge.transactions()); return; }
        if (request.method !== "POST" || request.headers.origin !== `http://${authority}` || request.headers["content-type"] !== "application/json") { json(403, { error: "A same-origin JSON request is required." }); return; }
        if (!["/api/review", "/api/apply", "/api/restore", "/api/keep", "/api/trial"].includes(request.url)) { json(404, { error: "Unknown local action." }); return; }
        let bytes = 0; const chunks = [];
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 256 * 1024) { json(413, { error: "The proposal exceeds 256 KiB." }); return; } chunks.push(chunk); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { json(400, { error: "Choose valid proposal JSON." }); return; }
        if (!body || typeof body !== "object" || Array.isArray(body)) { json(400, { error: "A local action needs an object." }); return; }
        if (request.url === "/api/review") json(200, await bridge.review(body.plan, body.actionId, body.implementation));
        else if (request.url === "/api/apply") json(200, await bridge.apply(body.reviewId));
        else if (request.url === "/api/restore") json(200, await bridge.restore(body.id));
        else if (request.url === "/api/keep") json(200, await bridge.keep(body.id));
        else json(200, await bridge.trial(body.id));
      } catch (error) { json(409, { error: error instanceof Error ? error.message : "The local action could not be verified. Your plan is preserved." }); }
      return;
    }
    const route = request.url && files.get(request.url);
    if (request.method !== "GET" || !route) { response.writeHead(404); response.end("Not found\n"); return; }
    try {
      const content = await readFile(join(directory, route[0]));
      response.writeHead(200, { "Content-Type": route[1], "Content-Length": content.length });
      response.end(content);
    } catch { response.writeHead(500); response.end("The local studio file is unavailable.\n"); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.accessToken = token;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1]) || Number(args[1]) < 1024 || Number(args[1]) > 65535)) throw new Error("Usage: npm run layout:studio -- [--port 43177]");
  const server = createStudioServer();
  server.listen(Number(args[1] ?? 0), "127.0.0.1", async () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/#access=${server.accessToken}`;
    if (process.env.XDG_RUNTIME_DIR) {
      const root = join(process.env.XDG_RUNTIME_DIR, "switchyard-studio");
      await mkdir(root, { recursive: true, mode: 0o700 });
      await writeFile(join(root, `${address.port}.json`), JSON.stringify({ url, pid: process.pid }), { mode: 0o600 });
    }
    process.stdout.write(`Switchyard Layout Studio: ${url}\nPress Ctrl+C to stop. Host changes require review and Apply. No files leave this machine.\n`);
  });
}
