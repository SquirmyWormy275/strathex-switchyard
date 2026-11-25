/** Bounded, content-free phase timings for the original slow UI journeys. */
const labels = new Set(["setup-git", "store-initialize", "store-snapshot", "store-update", "store-authorize", "guardian-ready", "query-git", "http-request"]);
const stages = new Set(["authority-ready", "scanner-ready", "execution-ready", "http-response", "cleanup"]);
export function fixtureTiming({ enabled = false, clock = () => performance.now(), emit = line => process.stdout.write(line + "\n") } = {}) {
  const started = clock(), rows = new Map(); let reports = 0;
  const report = stage => {
    if (!enabled) return;
    if (!stages.has(stage)) throw Error("Unknown fixture timing stage");
    if (stage !== "cleanup" && reports >= 8) return;
    reports++;
    // No arguments, results, exceptions, paths, task/account IDs or source text.
    emit("# fixture-timings " + JSON.stringify({ stage, elapsedMs: Math.round(clock() - started), columns: ["calls", "pending", "failed", "totalMs", "maxMs"], phases: Object.fromEntries([...rows].map(([key, r]) => [key, [r.calls, r.pending, r.failed, Math.round(r.total), Math.round(r.max)]])) }));
  };
  const measure = async (label, fn) => {
    if (!enabled) return fn();
    if (!labels.has(label)) throw Error("Unknown fixture timing phase");
    const row = rows.get(label) ?? { calls: 0, pending: 0, failed: 0, total: 0, max: 0 }; rows.set(label, row);
    row.calls++; row.pending++; const before = clock();
    try { return await fn(); }
    catch (error) { row.failed++; throw error; }
    finally { row.pending--; const elapsed = clock() - before; row.total += elapsed; row.max = Math.max(row.max, elapsed); }
  };
  const wrapStore = store => !enabled ? store : new Proxy(store, { get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    return ["initialize", "snapshot", "update", "authorize"].includes(property)
      ? (...args) => measure("store-" + property, () => Reflect.apply(value, target, args)) : value;
  } });
  return { measure, report, wrapStore };
}
