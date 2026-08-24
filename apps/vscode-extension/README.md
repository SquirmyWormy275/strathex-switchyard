# VS Code extension

The extension persists registration/adoption of VS Code windows and focused
terminals, selection among managed sessions, tagged managed-agent terminal
creation, lifecycle downgrade when a terminal closes, and truthful status/
capability display. It does not intercept terminal commands, inspect another
agent's state, or grant mediation. A registered session must never be represented
as Observable, Controllable, or Mediated until a companion/provider adapter
supplies independently verifiable evidence.

Commands are exposed for Register/Adopt/Select/Show Managed Sessions and
canonical chord dispatch. Start the Windows companion, then set
`sxsy-b122.companionConfigurationPath` to its per-user `config.json`. The
extension reads its local pipe and token only at request time and uses them
only for authenticated named-pipe requests. It is safe when the companion or
provider is unavailable and never falls back to UI automation for consequential
actions.

Run `npm run build:vscode` before packaging; it emits the CommonJS extension
entry point at `dist/extension.js` named by the extension manifest.
