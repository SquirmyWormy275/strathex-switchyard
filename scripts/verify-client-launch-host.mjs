#!/usr/bin/env node
/** Explicit installed Linux proof: one real GitHub Copilot homepage request; zero prompts. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { applicationStateRoot } from "../deployment/suite/application.mjs";
import { privateRead, privateWrite } from "../tools/layout-studio/private-fs.mjs";
import { createSuiteStore } from "../tools/layout-studio/suite-store.mjs";
import { runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";
if (process.platform !== "linux" || process.argv.length !== 3 || process.argv[2] !== "--synthetic") throw new Error("Usage: node scripts/verify-client-launch-host.mjs --synthetic (one real fixed GitHub Copilot homepage request through the normal installed API; no prompt or repository selection)");
const store = createSuiteStore(), c = "authority-validation", requestId = randomUUID(), checks = [], hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex"), definitions = s => hash([s.profile, s.workflow, s.roleBindings ?? [], s.mode]);
const endpoint = JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))), url = new URL(endpoint.url), token = /^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1]; assert.ok(token && url.protocol === "http:" && url.hostname === "127.0.0.1");
async function api(path, body = {}, expected = 200, authenticated = true) { const r = await fetch(new URL("/api/suite/" + path, url.origin), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Origin: url.origin, ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); const value = await r.json(); assert.equal(r.status, expected, `Installed ${path}: ${typeof value.error === "string" ? value.error.slice(0, 300) : "unexpected status"}`); return value; }
const selection = await store.selection(), selected = await store.snapshot(selection), personal = definitions(await store.snapshot("personal")), baseline = await store.snapshot(c);
assert.equal(selected.observations.some(o => o.status === "recording") || selected.voice.some(v => v.status === "recording"), false); assert.equal(baseline.mode, "keyboard-only"); assert.equal((baseline.clientLaunches ?? []).length, 0); assert.equal((baseline.repositoryEffects ?? []).length, 0); assert.equal((baseline.codingTurns ?? []).some(t => ["reserved", "submitting", "submitted"].includes(t.status)), false);
const evidence = { schema: "switchyard-installed-client-launch/v1", at: new Date().toISOString(), checks, requestedProvider: "github-copilot", realFixedHomepageRequest: true, modelPromptsSubmitted: 0, providerAccountVerified: false, sessionIdentified: false, applicationOpenedVisuallyVerified: false, frontendVisualAcceptance: false };
let failure;
try {
  await api("compartment/select", { compartment: c });
  const catalog = await api("integrations/catalog", { compartment: c }); const github = catalog.entries.find(e => e.provider === "github-copilot"); assert.equal(github.capabilities.hostLaunchConnected, true); assert.equal(github.account, "not-verified"); assert.equal(github.session, "not-identified");
  const offline = await api("integrations/recipe", { compartment: c, id: github.id }); assert.equal(offline.hostActionAuthorized, false); assert.equal(offline.recipe.importedAuthority, false);
  await api("integrations/recipe", { compartment: c, id: github.id, command: "untrusted" }, 409); await api("integrations/launch", { compartment: c, id: github.id, requestId }, 401, false); await api("integrations/launch", { compartment: c, id: github.id, requestId }, 409);
  checks.push("installed catalog and exact portable recipe preserve distinct provider/account/capability limits; authentication, broader fields and keyboard-only gates reject effects");
  await api("mode", { compartment: c, mode: "personal-companion" }); const request = { compartment: c, id: github.id, requestId };
  const result = await api("integrations/launch", request); assert.equal(result.status, "launch-requested", JSON.stringify(result)); assert.equal(result.portalResponse, 0); assert.equal(result.applicationOpenedVerified, false); assert.equal(result.providerAccountVerified, false); assert.equal(result.sessionIdentified, false); assert.equal(result.modelPromptSubmitted, false);
  checks.push("normal installed API received a successful real OpenURI Response for one fixed GitHub Copilot homepage, without a prompt or repository/session selection");
  const record = (await store.snapshot(c)).clientLaunches.find(r => r.requestId === requestId); assert.equal(record.status, "settled"); assert.equal(record.stoppedVerified, true); assert.equal(await runtimeGuardianStopped(record.ownedRuntime), true); assert.equal(record.cleanupPending, false); await assert.rejects(access(record.scratch), { code: "ENOENT" });
  checks.push("protected exact native ownership independently verified exit and its empty private scratch was removed");
  const replay = await api("integrations/launch", request); assert.equal(replay.replayed, true); assert.equal(replay.requestId, requestId); assert.equal((await store.snapshot(c)).clientLaunches.length, 1); assert.equal((await store.snapshot(c)).clientLaunches[0].ownedRuntime.id, record.ownedRuntime.id);
  await api("integrations/launch", { ...request, id: "figma-web" }, 409);
  checks.push("duplicate request returned its same protected result/owner without another helper; a substituted recipe under that UUID was rejected");
  const view = await api("integrations/launches", { compartment: c }); assert.equal(view[0].nativeOwnerStoppedVerified, true); assert.equal(JSON.stringify(view).includes(record.scratch), false); assert.equal(Object.hasOwn(await api("snapshot", { compartment: c }), "clientLaunches"), false);
  checks.push("sanitized launch inventory and ordinary snapshot omit native scratch/ownership details");
} catch(e) { failure = e; evidence.failure = e.message; }
finally {
  try {
    await api("mode", { compartment: c, mode: "keyboard-only" }); if (await store.selection() === c) await api("compartment/select", { compartment: selection });
    const state = await store.snapshot(c); for (const r of state.clientLaunches ?? []) if (r.ownedRuntime) assert.equal(await runtimeGuardianStopped(r.ownedRuntime), true);
    if (!failure) { const exact = hash(state.clientLaunches); await store.update(c, "synthetic-client-launch-cleanup", s => { assert.equal(hash(s.clientLaunches), exact); assert.equal(s.clientLaunches.length, 1); assert.equal(s.clientLaunches[0].requestId, requestId); assert.equal(s.clientLaunches[0].stoppedVerified, true); if (baseline.clientLaunches === undefined) delete s.clientLaunches; else s.clientLaunches = structuredClone(baseline.clientLaunches); }); evidence.localValidationRecordsRemoved = true; }
    assert.equal(await store.selection(), selection); assert.equal(definitions(await store.snapshot(c)), definitions(baseline)); assert.equal(definitions(await store.snapshot("personal")), personal); assert.equal(JSON.parse(await privateRead(join(applicationStateRoot(), "endpoint.json"))).url, endpoint.url);
    checks.push("keyboard-only cleanup restored selection/definitions/private link and removed only successful local test records; the external browser was not closed");
  } catch(e) { failure ??= e; evidence.cleanupFailure = e.message; }
}
const receipt = join(homedir(), ".local/state/strathex-switchyard/runtime-verification", `installed-client-launch-${Date.now()}.json`); await privateWrite(receipt, JSON.stringify(evidence, null, 2) + "\n"); console.log(JSON.stringify({ receipt, checks: checks.length, localValidationRecordsRemoved: evidence.localValidationRecordsRemoved ?? false, modelPromptsSubmitted: 0, failure: failure?.message ?? null })); if (failure) throw failure;
