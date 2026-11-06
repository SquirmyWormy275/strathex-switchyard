/** Short-lived helpers retain only a kernel-lock path, never protected state or keys. */
export function createKeylessLeasePool({ spawnWorker, idleMs = 1000, timeoutMs = 15000, maxWorkers = 64 }) {
  if (typeof spawnWorker !== "function" || !Number.isInteger(idleMs) || idleMs < 1 || idleMs > 2000 || !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 15000 || !Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 64) throw new Error("The bounded private lease pool configuration is invalid.");
  const workers = new Map(); let stopped = false;
  const unavailable = () => new Error("The private state lock helper is unavailable. Existing data was preserved.");
  const busy = () => Object.assign(new Error("The private state lock is busy. Existing data was preserved."), { code: "STATE_LOCK_BUSY" });
  function start(key) {
    if (stopped || workers.size >= maxWorkers) throw unavailable();
    const child = spawnWorker(key);
    const worker = { child, alive: true, closing: false, exited: false, held: false, sequence: 0, depth: 0, tail: Promise.resolve(), buffer: "", progress: "not-observed", pending: undefined };
    let closed; worker.closed = new Promise(resolve => { closed = resolve; });
    function fail(error) {
      worker.pending?.reject(error); worker.pending = undefined;
      if (worker.closing && !worker.alive) return;
      worker.alive = false; worker.closing = true; child.stdin.end();
      if (child.exitCode === null) child.kill();
    }
    worker.wait = (expected, limit = timeoutMs, phase = "worker-startup") => new Promise((resolve, reject) => {
      if (!worker.alive || worker.pending) { reject(unavailable()); return; }
      const timer = setTimeout(() => fail(Object.assign(new Error(`Private state lock timed out during ${phase} (worker progress: ${worker.progress}). Existing data was preserved.`), { code: "STATE_LOCK_TIMEOUT", lockPhase: phase, workerProgress: worker.progress })), Math.max(1, limit));
      worker.pending = { expected, resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
    });
    worker.ready = worker.wait(["READY"]);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      worker.buffer += chunk;
      if (Buffer.byteLength(worker.buffer) > 256) { fail(unavailable()); return; }
      let end;
      while ((end = worker.buffer.indexOf("\n")) >= 0) {
        const line = worker.buffer.slice(0, end).replace(/\r$/, ""); worker.buffer = worker.buffer.slice(end + 1);
        const pending = worker.pending;
        if (!pending || !pending.expected.includes(line)) { fail(unavailable()); return; }
        worker.pending = undefined; pending.resolve(line);
      }
    });
    // Retain only fixed progress labels, never raw PowerShell diagnostics, paths,
    // account metadata or caller-controlled content. These labels grant no lease.
    let diagnostic = "", discarding = false;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", chunk => {
      for (const character of chunk) {
        if (character === "\n") {
          const label = diagnostic.replace(/\r$/, "");
          if (!discarding && ["lease-entered", "lease-input-read", "lease-request-read", "lease-owner-found"].includes(label)) worker.progress = label;
          diagnostic = ""; discarding = false;
        } else if (!discarding && diagnostic.length < 64) diagnostic += character;
        else { diagnostic = ""; discarding = true; }
      }
    });
    child.stdin.on("error", () => fail(unavailable()));
    child.once("error", () => fail(unavailable()));
    child.once("close", () => { clearTimeout(worker.idle); worker.alive = false; worker.closing = true; worker.exited = true; worker.pending?.reject(unavailable()); worker.pending = undefined; if (workers.get(key) === worker) workers.delete(key); closed(); });
    worker.exchange = async (request, expected, limit, phase) => { const answer = worker.wait(expected, limit, phase); try { child.stdin.write(request + "\n"); } catch { fail(unavailable()); } return answer; };
    workers.set(key, worker); return worker;
  }
  async function closeWorker(worker) {
    clearTimeout(worker.idle); worker.closing = true; worker.child.stdin.end();
    let timer;
    await Promise.race([worker.closed, new Promise(resolve => { timer = setTimeout(() => { if (worker.child.exitCode === null) worker.child.kill(); resolve(); }, 2000); })]); clearTimeout(timer);
    if (!worker.exited) {
      let last; const exited = await Promise.race([worker.closed.then(() => true), new Promise(resolve => { last = setTimeout(() => resolve(false), 1000); })]); clearTimeout(last); if (!exited) throw unavailable();
    }
  }
  function idle(worker) { if (!worker.depth && worker.alive && !worker.closing) worker.idle = setTimeout(() => { void closeWorker(worker).catch(() => {}); }, idleMs); }
  return {
    async withLease(key, fn, { nonBlocking = false, onProgress } = {}) {
      if (stopped || typeof key !== "string" || !key || key.length > 32768 || typeof fn !== "function" || typeof nonBlocking !== "boolean") throw unavailable();
      let worker = workers.get(key);
      if (worker?.closing) { await closeWorker(worker); worker = workers.get(key); }
      if (nonBlocking && worker?.depth) throw busy();
      worker ??= start(key); clearTimeout(worker.idle);
      if (worker.depth >= 64) throw busy();
      worker.depth++;
      const use = worker.tail.catch(() => {}).then(async () => {
        const deadline = Date.now() + timeoutMs;
        await worker.ready;
        if (!worker.alive || worker.closing) throw unavailable();
        const sequence = ++worker.sequence;
        const answer = await worker.exchange(`ACQUIRE ${sequence} ${nonBlocking ? 1 : 0}`, [`LOCKED ${sequence}`, ...(nonBlocking ? [`BUSY ${sequence}`] : [])], Math.min(timeoutMs, deadline - Date.now()), "lease-acquire");
        if (answer === `BUSY ${sequence}`) throw busy();
        worker.held = true;
        const lease = { assert() { if (!worker.alive || worker.closing || !worker.held || worker.sequence !== sequence || worker.child.exitCode !== null) throw new Error("The private state lock was lost. Existing data must be re-read before retrying."); } };
        let result, failure;
        try { lease.assert(); onProgress?.("lease-ready"); result = await fn(lease); lease.assert(); }
        catch (error) { failure = error; }
        finally {
          worker.held = false;
          if (worker.alive && !worker.closing) { try { await worker.exchange(`RELEASE ${sequence}`, [`RELEASED ${sequence}`], Math.min(timeoutMs, 2000), "lease-release"); } catch (error) { failure ??= error; } }
        }
        if (failure) throw failure;
        return result;
      });
      worker.tail = use;
      try { return await use; }
      finally { worker.depth--; idle(worker); }
    },
    async close() {
      stopped = true; const result = await Promise.allSettled([...workers.values()].map(closeWorker));
      if (result.some(r => r.status === "rejected")) throw unavailable();
    }
  };
}
