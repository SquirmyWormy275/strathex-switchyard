/** Stop a direct child owned by this process. This does not attest to a process tree. */
export async function stopOwnedChild(child, { graceMs = 1500, finalMs = 1500 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode != null) return { stopped: true, evidence: "owned direct child exited or never started" };
  return new Promise((resolve) => {
    let settled = false, forced, deadline;
    const finish = (stopped) => {
      if (settled) return; settled = true; clearTimeout(forced); clearTimeout(deadline);
      child.off("close", done);
      resolve({ stopped, evidence: stopped ? "owned direct child exited" : "owned child stop was not confirmed" });
    };
    const done = () => finish(true);
    child.once("close", done);
    try { if (!child.stdin?.destroyed && !child.stdin?.writableEnded) child.stdin?.end(); child.kill(); } catch { /* close event or bounded readback decides */ }
    forced = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* final readback below */ } }, graceMs);
    deadline = setTimeout(() => finish(child.exitCode !== null || child.signalCode != null), graceMs + finalMs);
    if (child.exitCode !== null || child.signalCode != null) finish(true);
  });
}
