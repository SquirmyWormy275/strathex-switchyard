import assert from "node:assert/strict";
import { once } from "node:events";
import { fixture } from "./role-dispatch.mjs";
import { createStudioServer } from "../serve.mjs";

// A small event/selection surface for interaction contracts, not a visual browser substitute.
class Element extends EventTarget {
  constructor() { super(); this.children = []; this.value = ""; this.textContent = ""; this.disabled = false; this.open = false; }
  replaceChildren(...children) { this.children = children; this.value = children[0]?.value ?? ""; }
  append(...children) { this.children.push(...children); }
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter(child => child.value === this.value); }
  showModal() { this.open = true; }
  focus() { this.focused = true; }
  scrollIntoView(options) { this.scrollOptions = options; }
  close() { if (this.open) { this.open = false; queueMicrotask(() => this.dispatchEvent(new Event("close"))); } }
}
function surface() {
  const document = new EventTarget(), elements = new Map();
  document.createElement = () => new Element();
  document.createTextNode = text => ({ textContent: text });
  document.getElementById = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const $ = document.getElementById;
  const intent = new Element(); intent.value = "status"; intent.textContent = "Check progress"; $("role-intent").replaceChildren(intent);
  return { document, $, change(id, value) { $(id).value = value; $(id).dispatchEvent(new Event("change")); }, click(id) { assert.equal($(id).disabled, false, `${id} must be available`); $(id).dispatchEvent(new Event("click")); } };
}
export async function until(check) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() >= end) throw Error("UI interaction did not settle within two seconds"); await new Promise(resolve => setTimeout(resolve, 5)); }
}
export async function browserSurfaceFixture(fn, overrides = {}) {
  return fixture(context => withBrowserSurface(context, fn), overrides);
}
export async function withBrowserSurface(context, fn) {
    const ui = surface(), previous = { document: globalThis.document, location: globalThis.location, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
    // The outer fixture owns Suite retirement. The HTTP server borrows it so
    // its asynchronous close hook cannot race the fixture's state cleanup.
    const token = "r".repeat(43), server = createStudioServer({ suite: { ...context.suite, close: async () => {} }, token, bridge: { close() {} } });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`, calls = [], responses = [];
    globalThis.document = ui.document; globalThis.location = { hash: "" }; globalThis.localStorage = { getItem: () => token };
    globalThis.fetch = (path, options) => {
      calls.push({ path, body: options.body ? JSON.parse(options.body) : null });
      const request = () => previous.fetch(origin + path, { ...options, headers: { ...options.headers, Origin: origin } });
      const response = context.timings ? context.timings.measure("http-request", request).finally(() => context.timings.report("http-response")) : request();
      responses.push({ path, response }); return response;
    };
    const refresh = async () => ui.document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: await context.store.snapshot("personal") }));
    try {
      await fn({ ...context, ...ui, calls, responses, refresh });
    } finally {
      // Retire pending browser work before taking away its document and HTTP host.
      ui.document.dispatchEvent(new Event("switchyard-workspace-changing"));
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await server.cleanup();
      Object.assign(globalThis, previous);
    }
}
