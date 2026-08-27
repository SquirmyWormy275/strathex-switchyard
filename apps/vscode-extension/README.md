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
discovery. The extension also provides a searchable, read-only 65-chord quick
reference; transition-only background notifications for companion-verified
Blocked and Finished sessions; a repository-bound Compound workflow palette;
and a Pipeline status surface that keeps local receipts separate from exact-head
hosted evidence and cycles the current bounded failure set on repeated Normal
presses. Alt Pipeline renders the companion-selected exact-head failure excerpt
and diagnosis as bounded read-only evidence; it never substitutes a generic
output panel for missing trace data. A second Normal VS Code press inside the bounded repeat window cycles
to the next open VS Code window; the first press only focuses the last-used
window.

Durable workflow provider results are validated against the exact prepared
artifact ID, digest, and result kind before the extension renders bounded
read-only Proof, decision, plan, Handoff, focus, authority, or voice
result details. A Quick Pick selection never approves or executes a returned
option. Normal Voice opens the extension-owned native Voice Center; it can
start/focus the current conversation, mute/resume it, switch the exact provider,
bind one exact matching VS Code managed session, end it, or delete its retained
transcript. A repeated Normal Voice press inside the bounded repeat window
toggles mute/resume. Ending remains an explicit reviewed Voice Center choice
until physical long-press timing is accepted. Voice start and switch use the
companion-owned native runtime and never open provider web pages.

Normal Re-anchor uses its dedicated lifecycle, never the generic command or
workflow route. The extension lists only existing eligible authority grants,
auto-selects exactly one or presents a bounded authority picker, then shows the
companion's read-only exact-scope preview. Apply requires the exact modal
confirmation `Confirm exact Re-anchor without resuming`. The final surface is a
structured post-stop provider report whose result is
`reanchored_without_resume`. Re-anchor cannot create or broaden authority,
resume the provider, roll it back, or offer a generic workflow action.

There is intentionally no Configure Local Companion command. The
extension reads only the companion-created canonical endpoint record under the
host-owned local state directory, opens its DPAPI CurrentUser-sealed token, and
uses it only for bounded authenticated named-pipe requests. It is safe when the
companion or provider is unavailable and never falls back to workspace
configuration, TCP, shell execution, or UI automation for consequential
actions.

Managed terminal launch profiles carry Authenticode/product/hash identity plus
exact device/inode values encoded as canonical unsigned decimal strings. The
extension re-reads those identities with bigint filesystem metadata before and
after authorization, and passes the same exact strings to the native launcher;
it never rounds a Windows file identity through an unsafe JavaScript number.

Run `npm run build:vscode` before packaging; it emits the CommonJS extension
entry point at `dist/apps/vscode-extension/src/extension.js` named by the extension manifest. The VSIX contains the exact compiled control-plane and protocol modules used by the extension's untrusted-response validators; it has no runtime dependency on repository source files.
