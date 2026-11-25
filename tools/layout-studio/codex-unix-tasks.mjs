/** Explicit Linux task adapter; production composition remains on stdio. */
import { createCodexStdioTasks } from "./codex-stdio-tasks.mjs";
import { openOwnedCodexListener } from "./codex-owned-listener.mjs";

export function createCodexUnixTasks({ runtimeRoot, openListener = openOwnedCodexListener, onReserved = async () => {}, onReady = async () => {}, onListening = async () => {}, onAuthenticated = async () => {}, ...options } = {}) {
  return createCodexStdioTasks({ ...options, clientFactory: async (executable, cwd, serverNames, context) => {
    let owner, client, closed = false;
    const current = () => { if (closed || owner?.closed || client?.closed) throw client?.closeReason ?? Error("The original owned Codex task listener is closed."); };
    const managed = {
      get closed() { return closed || owner?.closed || client?.closed || false; },
      get closeReason() { return client?.closeReason; },
      get accountEpoch() { return client?.accountEpoch ?? 0; },
      get serverNames() { return serverNames; },
      async initialize() { current(); await context.authorize(); client = await owner.connect(); current(); await context.authorize(); await onAuthenticated(context.compartment, owner); current(); await context.authorize(); },
      async request(...args) { current(); if (!client) throw Error("The owned task client has not initialized."); return client.request(...args); },
      async recheckAccount() { current(); if (!client) throw Error("The owned task account has not initialized."); return client.recheckAccount(); },
      close() { closed = true; owner?.close(); },
      async stop() { managed.close(); return owner ? owner.stop() : { stopped: true, evidence: "no owned listener reserved" }; }
    };
    // Register before the asynchronous listener can reserve a directory or spawn.
    context.onClient(managed);
    owner = await openListener({ executable, cwd, serverNames, runtimeRoot, authorize: context.authorize,
      async onOwner(value) { owner = value; if (closed) owner.close(); current(); await context.authorize(); await onReserved(context.compartment, owner); current(); await context.authorize(); },
      onReady: (scope, value) => onReady(context.compartment, scope, value)
    });
    current(); await context.authorize(); await onListening(context.compartment, owner); current(); await context.authorize(); return managed;
  } });
}
