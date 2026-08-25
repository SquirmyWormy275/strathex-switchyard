import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HandoffPackageStore } from "../../../packages/control-plane/src/context-packages.ts";
import type { ManagedSession } from "../../../packages/control-plane/src/contracts.ts";
import { ProtectedJsonStore } from "../../../packages/control-plane/src/store.ts";
import { VoiceCoordinator } from "../../../packages/control-plane/src/voice.ts";
import { WorkflowArtifactStore } from "../../../packages/control-plane/src/workflow-artifacts.ts";
import type { CompanionMethod } from "../src/bridge.ts";
import { CompanionService } from "../src/service.ts";
import { VoiceGatewayError } from "../src/voice-gateway.ts";

const at = "2026-08-24T12:00:00.000Z";
const session = (id: string): ManagedSession => ({ id, provider: "codex", surface: "bridge", capabilities: ["registered", "observable", "controllable", "mediated"], status: "running", workspaceRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), taskId: "task-1", planRevision: "plan-1", plannedFiles: ["src/index.ts"], lastHeartbeat: at, adapterVersion: "test", metadata: {} });

test("installed service creates exact Handoff/workflow artifacts and privacy-bound voice state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-workflow-service-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    let id = 0;
    let artifactId = 0;
    const service = new CompanionService({
      now: () => at,
      handoffs: new HandoffPackageStore(store, { clock: () => at, idFactory: () => "handoff-1" }),
      workflowArtifacts: new WorkflowArtifactStore(store, { clock: () => at, idFactory: () => `artifact-${++artifactId}` }),
      workflowCoordinator: {
        async prepare(request) {
          assert.equal(request.action, "handoff_queue");
          assert.equal(request.authorityId, "authority-1");
          assert.deepEqual(request.intent, { kind: "handoff", recipientSessionId: "coder", route: "queue" });
          return { kind: "handoff", packageId: "handoff-1", route: "queue", sourceSessionId: "planner", recipientSessionId: "coder", authorityId: "authority-1" };
        }
      },
      voice: new VoiceCoordinator(store, { clock: () => at, idFactory: () => `voice-${++id}` }),
      voicePresence: { async verify() { return { verified: true, operator: "DOMAIN\\operator" }; } }
    });
    service.installTrustedSession(session("planner"));
    service.installTrustedSession(session("coder"));
    let sequence = 0;
    const call = async (method: CompanionMethod, payload?: unknown) => {
      const response = await service.handle({ version: 1, id: `request-${++sequence}`, method, payload });
      assert.equal(response.ok, true, response.error?.message);
      return response.result as Record<string, unknown>;
    };
    const created = await call("handoff.create", { sessionId: "planner", recipientSessionId: "coder", routing: "queue", authorityId: "authority-1", plan: "Implement the approved plan.", decisions: ["Use typed IPC."], documentation: ["docs/spec.md"], references: [], constraints: ["No authority in context."], openQuestions: [], nextActions: ["Read the plan."] });
    const handoff = created.handoff as { id: string; digest: string; executionAuthorized: boolean };
    assert.equal(handoff.id, "handoff-1");
    assert.match(handoff.digest, /^[a-f0-9]{64}$/);
    assert.equal(handoff.executionAuthorized, false);
    const prepared = await call("workflow.prepare", { action: "handoff_queue", sessionId: "planner", authorityId: "authority-1", intent: { kind: "handoff", recipientSessionId: "coder", route: "queue" } });
    assert.equal((prepared.artifact as { status: string }).status, "prepared");
    const clientAuthored = await service.handle({ version: 1, id: "request-client-payload", method: "workflow.prepare", payload: { action: "proof", sessionId: "planner", authorityId: "authority-1", intent: { kind: "none" }, evidence: { shell: "git diff" } } });
    assert.equal(clientAuthored.ok, false);
    assert.equal(clientAuthored.error?.code, "invalid_request");

    const consentResult = await call("voice.consent", { handoffId: handoff.id, provider: "claude", transcript: "off", retentionMinutes: 0, expiresInMinutes: 15 });
    const consent = consentResult.consent as { id: string };
    const started = await call("voice.start", { consentId: consent.id, voiceSessionId: "voice-session-1", managedSessionId: "coder" });
    const binding = started.binding as { id: string; provider: string; managedSessionId: string; transcript: string };
    assert.equal(binding.provider, "claude");
    assert.equal(binding.managedSessionId, "coder");
    assert.equal(binding.transcript, "off");
    const nextConsent = (await call("voice.consent", { handoffId: handoff.id, provider: "chatgpt", transcript: "off", retentionMinutes: 0, expiresInMinutes: 15 })).consent as { id: string };
    const switched = await call("voice.switch", { bindingId: binding.id, consentId: nextConsent.id, voiceSessionId: "voice-session-2" });
    assert.equal((switched.binding as { provider: string }).provider, "chatgpt");
    const current = await call("voice.current", undefined);
    assert.equal((current.binding as { provider: string }).provider, "chatgpt");
    const voiceWorkflow = await call("workflow.prepare", { action: "bind_voice_session", sessionId: "coder", authorityId: "authority-1", intent: { kind: "none" } });
    const voiceArtifact = voiceWorkflow.artifact as { action: string; sessionId: string; payload: { kind: string; voiceSessionId: string; consentId: string } };
    assert.equal(voiceArtifact.action, "bind_voice_session");
    assert.equal(voiceArtifact.sessionId, "coder");
    assert.deepEqual(voiceArtifact.payload, {
      kind: "voice_binding",
      voiceSessionId: "voice-session-2",
      provider: "generic",
      contextPackageId: "handoff-1",
      consentId: nextConsent.id
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("installed service refuses voice binding to a different exact target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-workflow-scope-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const voice = new VoiceCoordinator(store, { clock: () => at, idFactory: (() => { let id = 0; return () => `voice-${++id}`; })() });
    const consent = await voice.grantConsent({ repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), contextPackageId: "handoff-1", contextDigest: "b".repeat(64), provider: "claude", operatorPresenceId: "presence", transcript: "off", retentionMinutes: 0, expiresAt: "2026-08-24T12:15:00.000Z" });
    const service = new CompanionService({ now: () => at, voice });
    service.installTrustedSession({ ...session("other"), targetSnapshotId: "f".repeat(64) });
    const response = await service.handle({ version: 1, id: "request-1", method: "voice.start", payload: { consentId: consent.id, voiceSessionId: "voice-session-1", managedSessionId: "other" } });
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "capability_denied");
    assert.equal(await voice.active(), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("installed service opens the configured voice runtime and ends the binding when native startup is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b122-workflow-runtime-"));
  try {
    const store = new ProtectedJsonStore({ filePath: join(directory, "journal.jsonl") });
    const voice = new VoiceCoordinator(store, { clock: () => at, idFactory: (() => { let id = 0; return () => `voice-${++id}`; })() });
    const consent = await voice.grantConsent({ repositoryRoot: "C:\\repo", targetSnapshotId: "a".repeat(64), contextPackageId: "handoff-1", contextDigest: "b".repeat(64), provider: "claude", operatorPresenceId: "presence", transcript: "off", retentionMinutes: 0, expiresAt: "2026-08-24T12:15:00.000Z" });
    const opened: string[] = [];
    const service = new CompanionService({
      now: () => at,
      voice,
      voiceRuntime: {
        async open(id) { opened.push(id); throw new VoiceGatewayError("provider_unavailable", "missing route"); },
        async switchProvider() { throw new Error("not used"); }, async bindManagedSession() { throw new Error("not used"); },
        async mute() { throw new Error("not used"); }, async resume() { throw new Error("not used"); }, async interrupt() { throw new Error("not used"); },
        async end() { throw new Error("not used"); }, async deleteTranscript() { throw new Error("not used"); }
      }
    });
    service.installTrustedSession(session("coder"));
    const unbound = await service.handle({ version: 1, id: "request-unbound", method: "voice.start", payload: { consentId: consent.id, voiceSessionId: "voice-session-unbound" } });
    assert.equal(unbound.ok, false);
    assert.equal(unbound.error?.code, "capability_denied");
    assert.equal(await voice.active(), undefined);
    const response = await service.handle({ version: 1, id: "request-1", method: "voice.start", payload: { consentId: consent.id, voiceSessionId: "voice-session-1", managedSessionId: "coder" } });
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "companion_unavailable");
    assert.equal(opened.length, 1);
    assert.equal((await voice.getBinding(opened[0]!))?.status, "ended");
    assert.equal(await voice.active(), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
