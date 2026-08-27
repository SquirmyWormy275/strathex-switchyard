export { ControlRouter, type RouteContext, type RoutedIntent, type SessionState } from "./router.ts";
export {
  companionBridgeVersion,
  InProcessCompanionBridge,
  UnavailableCompanionBridge,
  type CompanionBridge,
  type CompanionMethod,
  type CompanionRequest,
  type CompanionResponse,
  type DispatchPayload,
  type ConfirmationRequestPayload,
  type OperationCancellationPayload
} from "./bridge.ts";
export { CompanionService, type CompanionServiceOptions, type MediatedCommandExecutor, type CancellableMediatedCommandExecutor, type ConfirmationCapableMediatedCommandExecutor, type ProviderMediatedFinalCurrentServicePort } from "./service.ts";
export { DurableCompanionEndpoint, DurableCompanionEndpointError } from "./durable-endpoint.ts";
export { WindowsDpapiJournalAuthenticator } from "./windows-authenticator.ts";
export { createDefaultLocalComposition, type DefaultLocalComposition } from "./default-composition.ts";
export {
  InstalledCouncilParticipantClient,
  loadInstalledCouncilParticipantClient,
  type CouncilParticipantEnvironment,
  type CouncilParticipantPortProxyHandle
} from "./council-participant-client.ts";
export {
  InstalledCouncilResourceBroker,
  type CouncilCredentialNetworkRequest,
  type CouncilPortProxyRequest,
  type CouncilResourceBrokerPort
} from "./council-resource-broker.ts";
export { createDurableWindowsCompanion, type DurableWindowsCompanionOptions } from "./bootstrap.ts";
export { handleJsonLine, runCompanionStdio, serveJsonLines, type CompanionRequestHandler } from "./stdio.ts";
export {
  AuthenticatedPipeClient,
  AuthenticatedPipeServer,
  createPipeConfiguration,
  defaultPipePath,
  loadPipeConfiguration,
  savePipeConfiguration,
  type AuthenticatedPipeConfiguration
} from "./authenticated-pipe.ts";
export {
  DpapiJournalAuthenticator,
  FakeUserSecretProtector,
  WindowsDpapiCurrentUserProtector,
  type UserSecretProtector
} from "./windows-secret.ts";
export { LocalMediatedGitHandler, SpawnLocalGitRunner, type LocalGitRunner, type MediatedGitHandlerOptions } from "./mediated-git.ts";
export { DurableHostActionAdapter, DurableHostActionQueue, hostActionCommandActions, localHostActionKinds, type HostActionIntent, type LocalHostActionKind } from "./host-actions.ts";
export {
  DurableCredentialReferenceVault,
  StdinCredentialSecretReader,
  type CredentialAdapterPort,
  type CredentialLease,
  type CredentialLeaseRequest,
  type CredentialReferenceSummary,
  type CredentialScope,
  type ProvisionCredentialReference
} from "./durable-credentials.ts";
export {
  ConfiguredHttpsNetworkBroker,
  DirectPinnedHttpsTransport,
  SystemNetworkAddressResolver,
  createDirectConfiguredNetworkBroker,
  loadConfiguredNetworkPolicy,
  type ConfiguredNetworkPolicy,
  type ConfiguredNetworkRequest,
  type ConfiguredNetworkResult,
  type ConfiguredNetworkRoute
} from "./configured-network.ts";
export {
  PowerShellWindowsUserPresenceRunner,
  WindowsHelloConfirmationAttestor,
  type WindowsUserPresenceResult,
  type WindowsUserPresenceRunner
} from "./windows-user-presence.ts";
export * from "./repository-runtime.ts";
export * from "./runtime-registry.ts";
export * from "./runtime-provisioning.ts";
export * from "./sandbox-installation.ts";
export * from "./host-provisioning.ts";
export * from "./remote-adapters.ts";
export * from "./automation-manifest-review.ts";
export * from "./automation-manifest-coordinator.ts";
export * from "./automation-proposal-source.ts";
export * from "./automation-effect-executor.ts";
export * from "./automation-child-effects.ts";
export * from "./automation-high-consequence.ts";
export * from "./automation-installed-runtime.ts";
export * from "./automation-refresh-git.ts";
export * from "./local-automation-broker.ts";
export * from "./effect-target-transition.ts";
export * from "./provider-gateway.ts";
export * from "./configured-provider-host.ts";
export * from "./provider-dispatch-lease.ts";
export * from "./provider-mediated-final-current.ts";
export * from "./reanchor-runtime.ts";
export * from "./pipeline-adapters.ts";
export * from "./repository-runtime-broker.ts";
export * from "./windows-sandbox.ts";
export * from "./git-review.ts";
export * from "./hardware-signal-queue.ts";
export * from "./local-checkpoints.ts";
export * from "./operation-control.ts";
export * from "./operation-recovery.ts";
export * from "./council-epoch-lifecycle.ts";
export * from "./receipt-evidence.ts";
export * from "./raw-hid-installation.ts";
export * from "./raw-hid-protocol.ts";
export { packagedRawHidHelperPath, packagedRepositoryRuntimeHelperPath, packagedProviderDesktopHelperPath, packagedVoiceHelperPath, runStandaloneCompanion } from "./main.ts";
export * from "./provider-desktop.ts";
export * from "./provider-desktop-adapter.ts";
export * from "./provider-desktop-configuration.ts";
export * from "./windows-provider-process.ts";
export * from "./voice-gateway.ts";
export * from "./voice-runtime.ts";
export * from "./windows-voice-port.ts";
export * from "./windows-voice-transcript-vault.ts";
