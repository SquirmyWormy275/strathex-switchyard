import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authorityFixture } from "./task-authority-fixture.mjs";
import { scannerFixture } from "./shield-scanner-fixture.mjs";
import { createTaskAuthority } from "../task-authority.mjs";
import { createScannerFixtures } from "../scanner-fixtures.mjs";
import { createScannerAuthority, signScannerFixture } from "../../../scripts/b122-scanner-fixture.mjs";
import { connectedExecutionActions } from "../repository-execution-actions.mjs";

export const draftInput = f => ({ taskId: f.task.id, action: "shield_codebase_audit", planRevision: "draft-1", scannerFixtureId: "synthetic-scanner", advisoryFixtureId: "synthetic-advisory" });
export async function scannerDraftFixture(t, overrides = {}) {
  const f = await authorityFixture(t, { executionActions: connectedExecutionActions("linux") });
  const feeds = createScannerFixtures({ store: f.store, stateDirectory: join(f.stage, "feeds"), now: f.now }); f.onCleanup(() => feeds.close());
  const perform = async (action, body) => { const r = await feeds.review("personal", { requestId: randomUUID(), action, ...body }); const result = await feeds.apply("personal", { requestId: r.review.requestId, token: r.confirmation.token }); assert.equal(result.status, "completed"); };
  const signing = await createScannerAuthority({ outputDirectory: join(f.stage, "signing"), authorityId: "draft-test", allowedKinds: ["scanner", "advisory"], expiresAt: new Date(f.now() + 86400000).toISOString() });
  await perform("install-trust", { policy: JSON.parse(await readFile(signing.trustPolicyPath, "utf8")) });
  const sample = scannerFixture({ advisory: [] });
  for (const [kind, feed] of [["scanner", sample.request.scanner], ["advisory", sample.request.advisory]]) {
    const contentPath = join(f.stage, kind + ".json"); await writeFile(contentPath, sample.content.get(feed.path));
    const outputDirectory = join(f.stage, kind + "-signed");
    await signScannerFixture({ ...signing, contentPath, outputDirectory, id: feed.id, kind, feedVersion: "synthetic-v1", toolName: "switchyard-baseline-scanner", toolVersion: "1", generatedAt: new Date(f.now() - 1000).toISOString(), expiresAt: new Date(f.now() + 3600000).toISOString(), maximumAgeSeconds: 7200 });
    await perform("install-fixture", { manifestPath: join(outputDirectory, "manifest.json") });
  }
  const service = createTaskAuthority({ store: f.store, inspection: f.inspection, now: f.now, executionActions: connectedExecutionActions("linux"), checkNative: async () => {}, readScannerSources: (c, i) => feeds.readSources(c, i), resolveScannerFixtures: (c, i) => feeds.resolve(c, i), ...overrides });
  f.onCleanup(() => service.close());
  return { ...f, feeds, perform, service };
}
