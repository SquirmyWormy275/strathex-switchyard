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
export { CompanionService, type CompanionServiceOptions, type LocalHostAction, type MediatedCommandExecutor, type CancellableMediatedCommandExecutor, type ConfirmationCapableMediatedCommandExecutor } from "./service.ts";
export { DurableCompanionEndpoint, DurableCompanionEndpointError } from "./durable-endpoint.ts";
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
export { runStandaloneCompanion } from "./main.ts";

/**
 * Platform-specific Raw HID discovery remains deferred until the selected B122
 * firmware target is available. The exported companion service is local
 * JSON-lines control-plane transport only; it does not claim hardware support.
 */
