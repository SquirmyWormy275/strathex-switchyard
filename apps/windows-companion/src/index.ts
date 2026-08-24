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
export { CompanionService, type CompanionServiceOptions, type MediatedCommandExecutor, type CancellableMediatedCommandExecutor, type ConfirmationCapableMediatedCommandExecutor } from "./service.ts";
export { DurableCompanionEndpoint, DurableCompanionEndpointError } from "./durable-endpoint.ts";
export { WindowsDpapiJournalAuthenticator } from "./windows-authenticator.ts";
export { createDefaultLocalComposition, type DefaultLocalComposition } from "./default-composition.ts";
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
export * from "./provider-gateway.ts";
export * from "./pipeline-adapters.ts";
export * from "./repository-runtime-broker.ts";
export * from "./windows-sandbox.ts";
export * from "./git-review.ts";
export * from "./hardware-signal-queue.ts";
export * from "./local-checkpoints.ts";
export * from "./operation-control.ts";
export * from "./operation-recovery.ts";
export * from "./receipt-evidence.ts";
export * from "./raw-hid-installation.ts";
export * from "./raw-hid-protocol.ts";
export { packagedRawHidHelperPath, packagedRepositoryRuntimeHelperPath, runStandaloneCompanion } from "./main.ts";
