import {
  InMemoryAutomationBroker,
  type AutomationBroker,
  type AutomationRequest,
  type BrokerOutcome,
  type ContainmentGuard,
  type PermitVerifier
} from "../../../packages/control-plane/src/brokers.ts";
import {
  automationRequestSchema,
  createAutomationIntent,
  parseAutomationEnvelope,
  type AutomationAction,
  type AutomationEnvelope
} from "../../../packages/control-plane/src/automation-protocol.ts";
import type { AutomationManifestContext } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import {
  AutomationEffectExecutionError,
  type AutomationEffectReceipt,
  type AutomationInstructionFileConsent
} from "./automation-effect-executor.ts";

export interface HostLocalAutomationExecutorInput {
  readonly envelope: AutomationEnvelope;
  readonly currentManifestContext: AutomationManifestContext;
  readonly instructionFileConsent?: AutomationInstructionFileConsent;
}

export interface HostLocalAutomationExecutorPort {
  execute(input: HostLocalAutomationExecutorInput): Promise<AutomationEffectReceipt>;
}

export interface HostLocalAutomationBrokerOptions {
  /** A fresh request-bound executor carries the exact final-current guard. */
  readonly createExecutor: (request: AutomationRequest, envelope: AutomationEnvelope) => HostLocalAutomationExecutorPort;
}

/**
 * Installed automation effect boundary. The configured provider may prepare
 * exact proposal bytes, but only this host-local broker may apply them.
 */
export function createHostLocalAutomationBroker(
  policy: PermitVerifier,
  containment: ContainmentGuard,
  options: HostLocalAutomationBrokerOptions
): AutomationBroker {
  const broker = new InMemoryAutomationBroker(policy, containment);
  for (const action of ["compound_capture", "compound_refresh", "lfg", "repair_mission"] as const) {
    broker.register(action, (request) => executeHostLocalAutomation(request, action, options));
  }
  return broker;
}

async function executeHostLocalAutomation(
  request: AutomationRequest,
  action: AutomationAction,
  options: HostLocalAutomationBrokerOptions
): Promise<BrokerOutcome> {
  if (request.action !== action || !request.session || !request.authority || !request.effectGuard
    || !request.reviewedManifest || !request.manifestApproval || !request.confirmation) {
    return blocked("Host-local automation requires one exact operation, target, mediated session, authority, final-current guard, reviewed manifest, approval, and confirmation.");
  }
  const current = await request.effectGuard.assertCurrent({
    action: request.action,
    operationId: request.operationId,
    target: request.target,
    session: request.session,
    authority: request.authority
  });
  if (!current.allowed) return blocked(current.reason);

  let intent;
  try {
    intent = createAutomationIntent(
      action,
      {
        digest: request.confirmation.confirmationDigest,
        scopeDigest: request.confirmation.confirmationScopeDigest ?? ""
      },
      request.testEnvironment ? {
        id: request.testEnvironment.id,
        digest: request.reviewedManifest.proposal.kind === "repair_mission"
          ? request.reviewedManifest.proposal.testEnvironment.digest
          : undefined,
        egress: request.testEnvironment.egress,
        databaseName: request.testEnvironment.databaseName
      } : undefined,
      { manifest: request.reviewedManifest, approval: request.manifestApproval }
    );
  } catch {
    return blocked("The host-local automation intent lacks its exact protected manifest, approval, confirmation, or isolated-environment binding.");
  }

  let envelope: AutomationEnvelope;
  try {
    envelope = parseAutomationEnvelope({
      schema: automationRequestSchema(action),
      version: 1,
      action,
      operationId: request.operationId,
      target: targetDocument(request),
      session: sessionDocument(request),
      authorityId: request.authority.id,
      manifest: request.reviewedManifest,
      approval: request.manifestApproval,
      intent
    });
  } catch {
    return blocked("The exact host-local automation envelope changed from its reviewed target, session, authority, or proposal binding.");
  }

  let executor: HostLocalAutomationExecutorPort;
  try { executor = options.createExecutor(request, envelope); }
  catch { return unavailable("The installed host-local automation executor could not be constructed; no effect was started."); }

  const manifest = envelope.manifest;
  const instructionFileConsent = manifest.proposal.kind === "compound_capture" && manifest.proposal.instructionFileMutation.kind === "edit_existing"
    ? {
        path: manifest.proposal.instructionFileMutation.path,
        approvalId: envelope.approval.id,
        confirmationDigest: envelope.approval.confirmationDigest
      }
    : undefined;
  try {
    const receipt = await executor.execute({
      envelope,
      currentManifestContext: {
        repositoryRoot: manifest.repositoryRoot,
        targetSnapshotId: manifest.targetSnapshotId,
        sessionId: manifest.sessionId,
        authorityId: manifest.authorityId,
        taskId: manifest.taskId,
        planRevision: manifest.planRevision,
        provider: manifest.provider,
        createdAt: manifest.createdAt,
        expiresAt: manifest.expiresAt
      },
      ...(instructionFileConsent ? { instructionFileConsent } : {})
    });
    return receiptOutcome(receipt);
  } catch (error) {
    if (error instanceof AutomationEffectExecutionError && error.receipt) return receiptOutcome(error.receipt);
    return { status: "failed", summary: "The host-local automation executor ended without a terminal durable receipt; exact recovery is required.", effectDisposition: "ambiguous" };
  }
}

function receiptOutcome(receipt: AutomationEffectReceipt): BrokerOutcome {
  const data = {
    receiptDigest: receipt.digest,
    manifestId: receipt.manifestId,
    manifestDigest: receipt.manifestDigest,
    proposalDigest: receipt.proposalDigest,
    finalTargetSnapshotId: receipt.targetTransition?.toTargetSnapshotId ?? null,
    childCount: receipt.children.length
  };
  if (receipt.status === "committed") {
    return { status: "completed", summary: "The exact reviewed automation effects committed locally with a durable host receipt.", effectDisposition: "committed", data };
  }
  if (receipt.status === "compensated") {
    return { status: "failed", summary: "The local automation attempt failed and every committed effect was durably compensated.", effectDisposition: "compensated", data };
  }
  return { status: "failed", summary: "The local automation effect state requires exact recovery before replay.", effectDisposition: "ambiguous", data };
}

function targetDocument(request: AutomationRequest): Readonly<Record<string, unknown>> {
  return {
    id: request.target.id,
    repositoryRoot: request.target.repositoryRoot,
    ...(request.target.branch ? { branch: request.target.branch } : {}),
    ...(request.target.head ? { head: request.target.head } : {}),
    policyVersion: request.target.policyVersion,
    trackedManifest: request.target.trackedManifest,
    untrackedManifest: request.target.untrackedManifest
  };
}

function sessionDocument(request: AutomationRequest): Readonly<Record<string, unknown>> {
  const session = request.session!;
  return {
    id: session.id,
    provider: session.provider,
    surface: session.surface,
    capabilities: session.capabilities,
    taskId: session.taskId,
    planRevision: session.planRevision,
    plannedFiles: session.plannedFiles
  };
}

function blocked(summary: string): BrokerOutcome {
  return { status: "blocked", summary, effectDisposition: "not_started" };
}

function unavailable(summary: string): BrokerOutcome {
  return { status: "unavailable", summary, effectDisposition: "not_started" };
}
