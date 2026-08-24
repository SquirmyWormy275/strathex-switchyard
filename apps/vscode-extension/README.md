# VS Code extension

The extension persists registration/adoption of VS Code windows and focused
terminals, selection among managed sessions, tagged managed-agent terminal
creation, lifecycle downgrade when a terminal closes, and truthful status/
capability display. It does not intercept terminal commands, inspect another
agent's state, or grant mediation. A registered session must never be represented
as Observable, Controllable, or Mediated until a companion/provider adapter
supplies independently verifiable evidence.

Commands are exposed for Register Managed Session, Adopt Focused Terminal,
Select/Show Managed Sessions, Create Managed Agent Terminal, and Show Routed
Intent. Companion IPC remains an adapter seam: the extension is safe when the
companion or provider is unavailable and never falls back to UI automation for
consequential actions.

Run `npm run build:vscode` before packaging; it emits the CommonJS extension
entry point at `dist/extension.js` named by the extension manifest.
