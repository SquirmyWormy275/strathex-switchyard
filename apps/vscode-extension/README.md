# VS Code extension

The extension persists registration/adoption of VS Code windows and focused
terminals, selection among managed sessions, tagged managed-agent terminal
creation, lifecycle downgrade when a terminal closes, and truthful status/
capability display. It does not intercept terminal commands, inspect another
agent's state, or grant mediation. A registered session must never be represented
as Observable, Controllable, or Mediated until a companion/provider adapter
supplies independently verifiable evidence.

Commands are exposed for Register/Adopt/Select/Show Managed Sessions, Create
Managed Agent Terminal, Invoke Control, and verified Blocked/Finished
discovery. There is intentionally no Configure Local Companion command. The
extension reads only the companion-created canonical endpoint record under the
host-owned local state directory, opens its DPAPI CurrentUser-sealed token, and
uses it only for bounded authenticated named-pipe requests. It is safe when the
companion or provider is unavailable and never falls back to workspace
configuration, TCP, shell execution, or UI automation for consequential
actions.

Run `npm run build:vscode` before packaging; it emits the CommonJS extension
entry point at `dist/extension.js` named by the extension manifest.
