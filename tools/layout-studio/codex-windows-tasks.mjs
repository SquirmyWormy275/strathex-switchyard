/** Windows task metadata using the original supervised app-server Job. */
import { createCodexStdioTasks } from './codex-stdio-tasks.mjs';
import { codexDesignConfig } from './agents.mjs';
import { openWindowsCodexOwner } from './codex-windows-owner.mjs';

export function createCodexWindowsTasks({ openOwner = openWindowsCodexOwner, resolveMcp, onReserved = async () => {}, onReady = async () => {}, onListening = async () => {}, onAuthenticated = async () => {}, ...options } = {}) {
  const factory = async (executable, cwd, serverNames, context, probe = false) => {
    let owner, client, closed = false;
    const current = () => { if (closed || owner?.closed || client?.closed) throw client?.closeReason ?? Error('The original Windows Codex task owner is closed.'); };
    const managed = {
      get closed() { return closed || owner?.closed || client?.closed || false; },
      get closeReason() { return client?.closeReason; }, get accountEpoch() { return client?.accountEpoch ?? 0; }, get serverNames() { return serverNames; },
      async initialize() { current(); await context.authorize(); client = await owner.connect(); current(); await context.authorize(); await onAuthenticated(context.compartment, owner); current(); await context.authorize(); },
      async configuration() { current(); const config = await owner.configuration(); current(); return config; },
      async request(...args) { current(); if (!client) throw Error('Initialize the original owned task client first.'); return client.request(...args); },
      async recheckAccount() { current(); if (!client) throw Error('Initialize the original owned task account first.'); return client.recheckAccount(); },
      close() { closed = true; owner?.close(); },
      async stop() { managed.close(); return owner ? owner.stop() : { stopped: true }; }
    };
    context.onClient(managed);
    owner = await openOwner({ executable, cwd, serverNames, authorize: context.authorize,
      onOwner: async value => { owner = value; if (closed) owner.close(); current(); await context.authorize(); if (!probe) await onReserved(context.compartment, owner); current(); await context.authorize(); },
      onReady: async (scope, value) => { if (!probe) await onReady(context.compartment, scope, value); }
    });
    current(); await context.authorize(); if (!probe) await onListening(context.compartment, owner); current(); await context.authorize(); return managed;
  };
  const probeConfiguration = async (executable, cwd, { onProbe, authorize, compartment }) => {
    let owned;
    // createCodexStdioTasks retains and independently stops this probe in its
    // finally block, including failed startup or malformed configuration.
    owned = await factory(executable, cwd, [], { authorize, compartment, onClient: onProbe }, true);
    const config = await owned.configuration();
    if (!config?.mcp_servers || typeof config.mcp_servers !== 'object' || Array.isArray(config.mcp_servers)) throw Error('The owned Codex tool configuration is unavailable.');
    const names = Object.entries(config.mcp_servers).filter(([, value]) => value.enabled !== false).map(([name]) => name).sort(); codexDesignConfig(names); return names;
  };
  return createCodexStdioTasks({ ...options, resolveMcp: resolveMcp ?? probeConfiguration, clientFactory: factory });
}
