/** Borrow exact index/history inputs sequentially; never nest native reader leases. */
import { gitIndexLimits } from "./git-index-inputs.mjs";
import { shieldIndexStagingBytes } from "./shield-index-inputs.mjs";
import { shieldHistoryStagingBytes } from "./shield-history-inputs.mjs";

export async function withShieldGitInputs(shield, ports, consume) {
  const index = shield?.indexWitness, history = shield?.historyWitness;
  if (typeof consume !== "function" || index && typeof ports?.useIndexInputs !== "function" || history && typeof ports?.useHistoryInputs !== "function") throw Error("Private scanner inputs require their exact task-bound consumers.");
  if (index && history && index.head !== history.head) throw Error("Current, staged and historical inputs must retain one reviewed HEAD.");
  const historical = indexBytes => ports.useHistoryInputs(history.paths, history.requestedDepth, (report, bytes) => consume({ ...(indexBytes ? { indexBytes } : {}), historyBytes: shieldHistoryStagingBytes(shield, report, bytes) }));
  if (!index) return history ? historical() : consume({});
  if (!history) return ports.useIndexInputs(index.rows.map(row => row.path), (report, bytes) => consume({ indexBytes: shieldIndexStagingBytes(shield, report, bytes) }));
  const retained = new Map(); let total = 0;
  try {
    // The first reader clears its borrowed bytes on exit. Retain only bounded
    // copies until the independently reauthorized historical consumer settles.
    await ports.useIndexInputs(index.rows.map(row => row.path), (report, bytes) => {
      for (const [path, file] of shieldIndexStagingBytes(shield, report, bytes)) {
        total += file.bytes.byteLength;
        if (total > gitIndexLimits.totalBytes) throw Error("Combined scanner input retention exceeds the original index byte limit.");
        retained.set(path, { bytes: Buffer.from(file.bytes), mode: file.mode });
      }
    });
    return await historical(retained);
  } finally { for (const file of retained.values()) file.bytes.fill(0); retained.clear(); }
}
