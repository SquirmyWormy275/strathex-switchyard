#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultControlPlaneStorePath } from "../../../packages/control-plane/src/store.ts";
import {
  loadInstalledCouncilParticipantClient,
  type CouncilParticipantEnvironment,
  type CouncilParticipantPortProxyHandle
} from "./council-participant-client.ts";

type ParticipantOperation = "credential-health" | "port-echo";

/**
 * Fixed participant helper. There are no token, endpoint, path, command, or
 * executable arguments: the digest-pinned participant supplies only the
 * protected Council assignment environment.
 */
export async function runInstalledCouncilParticipant(
  argv: readonly string[],
  environment: CouncilParticipantEnvironment = process.env
): Promise<Readonly<{ code: number; keepAlive?: CouncilParticipantPortProxyHandle }>> {
  if (argv.length !== 0) throw new Error("The Council participant helper accepts no command-line options.");
  const operation = participantOperation(environment.SXSY_COUNCIL_PARTICIPANT_OPERATION);
  const client = await loadInstalledCouncilParticipantClient(dirname(defaultControlPlaneStorePath()), environment);
  if (operation === "credential-health") {
    const receipt = await client.credentialNetwork({
      leaseId: requiredEnvironment(environment, "SXSY_COUNCIL_SELECTED_CREDENTIAL_LEASE_ID"),
      credentialEnvironmentName: requiredEnvironment(environment, "SXSY_COUNCIL_SELECTED_CREDENTIAL_ENVIRONMENT_NAME"),
      routeId: "provider.health"
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return { code: 0 };
  }
  const keepAlive = await client.openPortProxy({
    leaseId: requiredEnvironment(environment, "SXSY_COUNCIL_SELECTED_PORT_LEASE_ID"),
    portEnvironmentName: requiredEnvironment(environment, "SXSY_COUNCIL_SELECTED_PORT_ENVIRONMENT_NAME"),
    onConnection(socket) { socket.pipe(socket); }
  });
  process.stdout.write(`${JSON.stringify(keepAlive.receipt)}\n`);
  return { code: 0, keepAlive };
}

function participantOperation(value: string | undefined): ParticipantOperation {
  if (value !== "credential-health" && value !== "port-echo") throw new Error("The protected Council participant operation is invalid.");
  return value;
}

function requiredEnvironment(environment: CouncilParticipantEnvironment, name: string): string {
  const value = environment[name];
  if (!value || value.length > 256 || /[\r\n\0]/.test(value)) throw new Error("The protected Council participant resource selection is invalid.");
  return value;
}

const launchedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (launchedDirectly) {
  let keepAlive: CouncilParticipantPortProxyHandle | undefined;
  runInstalledCouncilParticipant(process.argv.slice(2)).then((result) => {
    process.exitCode = result.code;
    keepAlive = result.keepAlive;
    if (!keepAlive) return;
    const stop = (): void => { void keepAlive?.close().finally(() => { process.exitCode = 0; }); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }).catch(() => {
    process.stderr.write("SXSY-B122 Council participant resource request failed closed.\n");
    process.exitCode = 1;
  });
}
