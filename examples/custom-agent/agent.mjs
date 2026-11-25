/** Executable synthetic application. Credentials arrive on stdin, never in profiles or argv. */
import { switchyardAgent } from "../../integrations/agent-sdk.mjs";
import { randomUUID } from "node:crypto";
import { readEnrollment } from "../../integrations/supervised-enrollment.mjs";
const enrollment = await readEnrollment(), sdk = switchyardAgent(enrollment), sessionId = randomUUID();
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopped = true; });
await sdk.publish(sessionId, "ready");
while (!stopped) {
  const { command } = await sdk.poll();
  if (command) {
    if (command.sessionId !== sessionId) throw new Error("Wrong exact session");
    // A real app maps only its explicitly supported handlers here. This example
    // performs no filesystem, network, model, terminal or repository operation.
    await sdk.publish(sessionId, "busy");
    await sdk.acknowledge(command.id, command.intent === "cancel" ? "cancelled" : "completed");
    await sdk.publish(sessionId, "idle");
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
await sdk.publish(sessionId, "stopped");
