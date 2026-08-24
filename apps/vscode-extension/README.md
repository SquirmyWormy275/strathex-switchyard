# VS Code extension

The extension can register the current VS Code window as `Managed` and display
a routed B122 intent. It does not intercept terminal commands, inspect another
agent's state, or grant a session mediation. A registered session must never be
represented as controlled or policy-enforced.

Run `npm run build:vscode` before packaging; it emits the CommonJS extension
entry point at `dist/extension.js` named by the extension manifest.
