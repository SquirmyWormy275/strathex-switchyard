#!/usr/bin/env node
/** Small loopback-only server for the dependency-free, offline layout studio. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/model.mjs", ["model.mjs", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/sample-info.json", ["sample-info.json", "application/json; charset=utf-8"]],
  ["/sample-keymap.json", ["sample-keymap.json", "application/json; charset=utf-8"]],
  ["/sample-study-report.json", ["sample-study-report.json", "application/json; charset=utf-8"]]
]);

export function createStudioServer() {
  return createServer(async (request, response) => {
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    const route = request.url && files.get(request.url);
    if (request.method !== "GET" || !route) { response.writeHead(404); response.end("Not found\n"); return; }
    try {
      const content = await readFile(join(directory, route[0]));
      response.writeHead(200, { "Content-Type": route[1], "Content-Length": content.length });
      response.end(content);
    } catch { response.writeHead(500); response.end("The local studio file is unavailable.\n"); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createStudioServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    process.stdout.write(`Switchyard Layout Studio: http://127.0.0.1:${address.port}/\nPress Ctrl+C to stop. No files leave this machine.\n`);
  });
}
