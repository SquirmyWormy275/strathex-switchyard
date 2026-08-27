import { randomUUID } from "node:crypto";

import {
  createAutomationProposalRequest,
  parseAutomationProposalResponse
} from "../../../packages/control-plane/src/automation-proposal-protocol.ts";
import type { AutomationOperationProposal } from "../../../packages/control-plane/src/automation-operation-manifest.ts";
import type { AutomationManifestProposalRequest, AutomationManifestProposalSource } from "./automation-manifest-coordinator.ts";
import type { ProviderCommandTransport } from "./remote-adapters.ts";

const maximumResponseBytes = 4 * 1024 * 1024;

/** Read-only configured-provider observation. It has no trusted dispatch/effect lease. */
export class ConfiguredAutomationManifestProposalSource implements AutomationManifestProposalSource {
  private readonly idFactory: () => string;

  constructor(
    private readonly transport: ProviderCommandTransport,
    options: Readonly<{ idFactory?: () => string }> = {}
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async propose(input: AutomationManifestProposalRequest): Promise<AutomationOperationProposal> {
    const request = createAutomationProposalRequest({
      requestId: this.idFactory(),
      action: input.action,
      target: input.target,
      session: input.session,
      authority: input.authority
    });
    const routeId = `automation.proposal.${input.action}`;
    const result = await this.transport.request({
      routeId,
      repositoryRoot: input.target.repositoryRoot,
      body: JSON.stringify(request)
    });
    if (result.routeId !== routeId || result.outcome !== "passed" || !result.body) {
      throw new Error(`Automation proposal transport was ${result.outcome}; no review manifest was created.`);
    }
    const body = Buffer.from(result.body);
    if (body.byteLength === 0 || body.byteLength > maximumResponseBytes) throw new Error("The automation proposal response is empty or oversized.");
    let value: unknown;
    try { value = JSON.parse(body.toString("utf8")); }
    catch { throw new Error("The automation proposal response is malformed JSON."); }
    const response = parseAutomationProposalResponse(value, request.requestId, request.action);
    if (response.status !== "completed" || !response.proposal) {
      throw new Error(`Automation proposal response was ${response.status}; no review manifest was created.`);
    }
    return response.proposal;
  }
}
