import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScannerAuthority, signScannerFixture } from "../../../scripts/b122-scanner-fixture.mjs";
import { createSuiteStore } from "../suite-store.mjs";
import { createScannerFixtures } from "../scanner-fixtures.mjs";

export async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sx-fixtures-")), keys = new Map(); let time = Date.UTC(2026, 10, 4), active = "personal";
  const store = createSuiteStore({ root: join(root, "private"), secrets: { get: async (c,p) => keys.get(c+p), set: async (c,p,v) => { keys.set(c+p,v); } } });
  await store.initialize("personal"); await store.update("personal", "synthetic-companion", s => { s.mode = "personal-companion"; });
  const now = () => time, authority = await createScannerAuthority({ outputDirectory: join(root, "authority"), authorityId: "synthetic-authority", allowedKinds: ["scanner", "advisory"], expiresAt: new Date(time + 86400000).toISOString(), now: new Date(time) });
  const policy = JSON.parse(await readFile(authority.trustPolicyPath, "utf8")), stateDirectory = join(root, "fixtures"), service = createScannerFixtures({ store, stateDirectory, isActive: async c => active === c, now });
  async function perform(action, payload) { const review = await service.review("personal", { requestId: randomUUID(), action, ...payload }); const input = { requestId: review.review.requestId, token: review.confirmation.token }; return { review, input, result: await service.apply("personal", input) }; }
  async function signed(id = "synthetic-feed", kind = "scanner") {
    const contentPath = join(root, id + "-source.bin"); await writeFile(contentPath, "synthetic signed evidence bytes");
    const outputDirectory = join(root, id);
    await signScannerFixture({ ...authority, contentPath, outputDirectory, id, kind, feedVersion: "synthetic-v1", toolName: "synthetic-tool", toolVersion: "1.0.0", expiresAt: new Date(time + 3600000).toISOString(), maximumAgeSeconds: 3600, now: new Date(time) });
    return join(outputDirectory, "manifest.json");
  }
  t.after(async () => { active = "personal"; await service.close(); await rm(root, { recursive: true, force: true }); });
  return { root, store, service, policy, stateDirectory, now, signed, perform, trust: () => perform("install-trust", { policy }), advance: ms => { time += ms; }, active: c => { active = c; } };
}

