import { isAbsolute } from "node:path";

import type {
  AdapterOutcome,
  AdapterRequest,
  CommandAdapter
} from "../../../packages/control-plane/src/adapters.ts";
import type { CommandAction } from "../../../packages/control-plane/src/command-catalog.ts";
import type {
  DesktopProviderId,
  InstalledProviderDesktopLifecycle,
  ManagedTerminalProfile,
  ManagedTerminalProviderId,
  ProviderLifecycleOutcome
} from "./provider-desktop.ts";

export type InstalledProviderDesktopLifecyclePort = Pick<
  InstalledProviderDesktopLifecycle,
  "open" | "managedTerminal"
>;

type DesktopBinding = Readonly<{
  kind: "desktop";
  provider: DesktopProviderId;
  mode: "normal" | "fresh";
}>;

type TerminalBinding = Readonly<{
  kind: "terminal";
  provider: ManagedTerminalProviderId;
}>;

type ProviderCommandBinding = DesktopBinding | TerminalBinding;

export const installedProviderDesktopActions = [
  "open_claude",
  "fresh_claude",
  "open_managed_claude_terminal",
  "open_chatgpt",
  "fresh_chatgpt",
  "open_managed_codex_terminal"
] as const satisfies readonly CommandAction[];

const commandBindings: Readonly<Partial<Record<CommandAction, ProviderCommandBinding>>> = {
  open_claude: { kind: "desktop", provider: "claude_desktop", mode: "normal" },
  fresh_claude: { kind: "desktop", provider: "claude_desktop", mode: "fresh" },
  open_managed_claude_terminal: { kind: "terminal", provider: "claude_code" },
  open_chatgpt: { kind: "desktop", provider: "chatgpt_desktop", mode: "normal" },
  fresh_chatgpt: { kind: "desktop", provider: "chatgpt_desktop", mode: "fresh" },
  open_managed_codex_terminal: { kind: "terminal", provider: "codex" }
};

/**
 * Exact command adapter for installed provider applications.
 *
 * The lifecycle owns executable attestation, cancellation polling and its
 * admission/final effect fence. This adapter only binds an audited B122 action
 * to one fixed lifecycle operation; it has no provider or web fallback.
 */
export class InstalledProviderDesktopCommandAdapter implements CommandAdapter {
  readonly id = "installed-provider-desktop-v1";
  readonly kind = "desktop" as const;
  private readonly lifecycle: InstalledProviderDesktopLifecyclePort;

  constructor(lifecycle: InstalledProviderDesktopLifecyclePort) {
    this.lifecycle = lifecycle;
  }

  async execute(request: AdapterRequest): Promise<AdapterOutcome> {
    const binding = commandBindings[request.definition.action];
    if (!binding) {
      return unavailable("The installed provider adapter has no exact binding for this command.");
    }

    const operationId = boundedOperationId(request.operationId);
    if (!operationId || !request.executionControl) {
      return unavailable("Installed provider commands require a durable operation and bounded execution control.");
    }
    if (request.executionControl.operationId !== operationId) {
      return blocked("The provider execution control is bound to another durable operation.");
    }

    if (binding.kind === "desktop" && binding.mode === "fresh") {
      const confirmation = request.confirmation;
      if (!confirmation) {
        return {
          status: "awaiting_confirmation",
          summary: "A fresh provider surface requires exact current-user confirmation.",
          effectDisposition: "not_started"
        };
      }
      if (confirmation.action !== request.definition.action
        || confirmation.currentUserConfirmed !== true
        || !sha256(confirmation.confirmationDigest)) {
        return blocked("The fresh-provider confirmation is malformed or bound to another command.");
      }
    }

    if (binding.kind === "desktop") {
      const outcome = await this.lifecycle.open({
        provider: binding.provider,
        mode: binding.mode,
        operationId,
        control: request.executionControl
      });
      return desktopOutcome(outcome);
    }

    const outcome = await this.lifecycle.managedTerminal({
      provider: binding.provider,
      operationId,
      control: request.executionControl
    });
    if (outcome.status !== "completed") {
      return {
        status: outcome.status,
        summary: boundedSummary(outcome.summary),
        effectDisposition: "not_started"
      };
    }
    const profile = safeTerminalProfile(outcome.profile, binding.provider, request.executionControl.deadline);
    if (!profile) {
      return {
        status: "failed",
        summary: "The provider lifecycle returned an invalid or substituted managed-terminal profile.",
        effectDisposition: "not_started"
      };
    }
    return {
      status: "completed",
      summary: boundedSummary(outcome.summary),
      effectDisposition: "not_started",
      data: {
        kind: "managed_terminal_profile",
        version: 1,
        operationId,
        commandAction: request.definition.action,
        deadline: request.executionControl.deadline,
        profile
      }
    };
  }
}

function desktopOutcome(outcome: ProviderLifecycleOutcome): AdapterOutcome {
  return {
    status: outcome.status,
    summary: boundedSummary(outcome.summary),
    effectDisposition: outcome.status === "completed"
      ? "committed"
      : outcome.status === "blocked" || outcome.status === "unavailable"
        ? "not_started"
        : "ambiguous",
    ...(outcome.effect ? {
      data: {
        effect: outcome.effect,
        ...(outcome.processId !== undefined ? { processId: outcome.processId } : {}),
        ...(outcome.surfaceId !== undefined ? { surfaceId: outcome.surfaceId } : {})
      }
    } : {})
  };
}

function safeTerminalProfile(
  value: ManagedTerminalProfile | undefined,
  provider: ManagedTerminalProviderId,
  operationDeadline: string
): ManagedTerminalProfile | undefined {
  if (!value || value.provider !== provider || value.shell !== false
    || value.requiresFinalIdentityVerification !== true
    || !isAbsolute(value.canonicalExecutablePath)
    || value.canonicalExecutablePath.length > 4_096
    || !/\.exe$/i.test(value.canonicalExecutablePath)
    || /[\0\r\n]/.test(value.canonicalExecutablePath)
    || !sha256(value.executableSha256)
    || !sha256(value.catalogDigest)
    || !boundedReference(value.installationId, 256)
    || !Array.isArray(value.args)
    || value.args.length !== 0) return undefined;

  const identity = terminalIdentity(provider);
  if (value.profileName !== identity.profileName
    || value.productIdentity.productId !== identity.productId
    || value.productIdentity.displayName !== identity.displayName
    || value.productIdentity.publisher !== identity.publisher
    || value.productIdentity.role !== "managed_terminal") return undefined;

  const issuedAt = Date.parse(value.issuedAt);
  const validUntil = Date.parse(value.validUntil);
  const deadline = Date.parse(operationDeadline);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(validUntil) || !Number.isFinite(deadline)
    || validUntil <= issuedAt || validUntil > deadline || validUntil - issuedAt > 30_000) return undefined;

  return {
    provider: value.provider,
    profileName: value.profileName,
    canonicalExecutablePath: value.canonicalExecutablePath,
    executableSha256: value.executableSha256,
    productIdentity: { ...value.productIdentity },
    args: [...value.args],
    shell: false,
    installationId: value.installationId,
    catalogDigest: value.catalogDigest,
    issuedAt: new Date(issuedAt).toISOString(),
    validUntil: new Date(validUntil).toISOString(),
    requiresFinalIdentityVerification: true
  };
}

function terminalIdentity(provider: ManagedTerminalProviderId): Readonly<{
  profileName: string;
  productId: string;
  displayName: string;
  publisher: string;
}> {
  return provider === "claude_code"
    ? {
        profileName: "SXSY-B122 Claude Code",
        productId: "anthropic.claude-code",
        displayName: "Claude Code",
        publisher: "Anthropic, PBC"
      }
    : {
        profileName: "SXSY-B122 Codex",
        productId: "openai.codex",
        displayName: "Codex",
        publisher: "OpenAI, L.L.C."
      };
}

function unavailable(summary: string): AdapterOutcome {
  return { status: "unavailable", summary, effectDisposition: "not_started" };
}

function blocked(summary: string): AdapterOutcome {
  return { status: "blocked", summary, effectDisposition: "not_started" };
}

function boundedOperationId(value: string | undefined): string | undefined {
  return boundedReference(value, 256) ? value : undefined;
}

function boundedReference(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && value.length <= maximum
    && value.trim().length > 0
    && !/[\0\r\n]/.test(value);
}

function boundedSummary(value: string): string {
  const summary = typeof value === "string" ? value.replace(/[\0\r\n]+/g, " ").trim().slice(0, 512) : "";
  return summary || "The installed provider command returned no trusted summary.";
}

function sha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
