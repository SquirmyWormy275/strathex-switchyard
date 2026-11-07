import type { TerminalLike, VscodeLike } from "./vscode-like.ts";

/** Reveal one object identity; titles and an arbitrary active terminal are not targets. */
export async function revealExactTerminal(
  window: Pick<VscodeLike["window"], "terminals" | "activeTerminal" | "onDidChangeActiveTerminal" | "onDidCloseTerminal">,
  terminal: TerminalLike, assertCurrent: () => void | Promise<void>, timeoutMs = 5_000
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000) throw new Error("Exact terminal selection requires a bounded readback.");
  await assertCurrent();
  if (!window.terminals.includes(terminal)) throw new Error("The exact selected terminal closed before focus.");
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // A synchronous close/show failure must not leave an unhandled readiness rejection.
  void ready.catch(() => undefined);
  const timer = setTimeout(() => rejectReady(new Error("VS Code did not verify the exact active terminal within the bounded readback.")), timeoutMs);
  let active: { dispose(): unknown } | undefined, closed: { dispose(): unknown } | undefined;
  try {
    active = window.onDidChangeActiveTerminal?.(candidate => { if (candidate === terminal) resolveReady(); });
    closed = window.onDidCloseTerminal(candidate => { if (candidate === terminal) rejectReady(new Error("The exact selected terminal closed during focus.")); });
    await assertCurrent();
    if (!window.terminals.includes(terminal)) throw new Error("The exact selected terminal closed before focus.");
    terminal.show(false);
    if (window.activeTerminal === terminal) resolveReady();
    await ready;
    await assertCurrent();
    if (!window.terminals.includes(terminal) || window.activeTerminal !== terminal) throw new Error("The exact active terminal changed before focus could be accepted.");
  } finally { clearTimeout(timer); active?.dispose(); closed?.dispose(); }
}
