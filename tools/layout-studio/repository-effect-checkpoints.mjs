/** Recoverable index/target copies stay encrypted, separate from immutable ledger references. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { stableJson } from "../../packages/control-plane/src/store.ts";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
const hash = value => createHash("sha256").update(value).digest("hex");
export function createRepositoryEffectCheckpoints({ store, compartment, task, authorize }) {
  const reader = new NodeFileDigestReader({ maxFileBytes: 524288 });
  return {
    checkpointCapture: { async capture({ definition, operationId, target }) {
      if (definition.action !== "local_commit" || target.repositoryRoot !== task.repositoryRoot || !/^[a-f0-9-]{36}$/.test(operationId)) throw new Error("Only the exact host local-commit target can create this checkpoint.");
      await authorize(); await verifyRepositoryIdentity(task);
      const captured = await reader.read(join(task.repositoryRoot, ".git"), "index");
      try {
        const recovery = { schema: "switchyard-repository-index-checkpoint/v1", operationId, taskId: task.id, target: JSON.parse(JSON.stringify(target)), indexSha256: captured.digest.slice(7), indexBase64: captured.bytes.toString("base64") };
        const content = stableJson(recovery), sha256 = hash(content), artifactId = `index-${operationId}`;
        await authorize();
        await store.update(compartment, "repository-effect-checkpoint", state => {
          state.repositoryEffectCheckpoints ??= [];
          const prior = state.repositoryEffectCheckpoints.find(r => r.recovery.operationId === operationId);
          if (prior) { if (prior.sha256 !== sha256) throw new Error("The existing operation checkpoint cannot be replaced."); return; }
          const record = { sha256, bytes: Buffer.byteLength(content), recovery };
          if (state.repositoryEffectCheckpoints.length >= 64 || Buffer.byteLength(stableJson([...state.repositoryEffectCheckpoints, record])) > 2 * 1024 * 1024) throw new Error("The encrypted index-checkpoint inventory is full. Existing recovery data was preserved.");
          state.repositoryEffectCheckpoints.push(record);
        }, { provider: task.provider });
        return { reason: "Preserve the exact original index and approved target before a host local commit.", artifacts: [{ id: artifactId, kind: "archive", reference: `suite-index-checkpoint:${operationId}`, sha256, bytes: Buffer.byteLength(content) }], recovery: { artifactIds: [artifactId], steps: ["Inspect the protected operation, expected reference update and independently stopped native guardian identities.", "Read the preserved target and original index from this encrypted workspace checkpoint.", "Compare the actual branch, HEAD, index identity and tree before requesting any separately reviewed recovery. Never automatically restore, delete, stash or overwrite work."] } };
      } finally { captured.bytes.fill(0); }
    } },
    checkpointVerifier: { async verify(artifact) {
      const match = /^suite-index-checkpoint:([a-f0-9-]{36})$/.exec(artifact.reference);
      if (!match) return { available: false, detail: "Unknown host checkpoint reference." };
      const record = (await store.snapshot(compartment)).repositoryEffectCheckpoints?.find(r => r.recovery.operationId === match[1]);
      if (!record) return { available: false, detail: "The exact encrypted recovery copy is unavailable." };
      const content = stableJson(record.recovery), bytes = Buffer.from(record.recovery.indexBase64, "base64");
      try {
        const sha256 = hash(content);
        if (bytes.length > 524288 || bytes.toString("base64") !== record.recovery.indexBase64 || hash(bytes) !== record.recovery.indexSha256 || record.bytes !== Buffer.byteLength(content) || record.sha256 !== sha256) return { available: false, detail: "The encrypted index checkpoint did not verify." };
        return { available: true, sha256, detail: "The target and exact original index copy independently match their protected digest." };
      } finally { bytes.fill(0); }
    } }
  };
}
