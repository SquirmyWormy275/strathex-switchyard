/** Executable synthetic application. Credentials arrive on stdin, never in profiles or argv. */
import { switchyardAgent } from "../../integrations/agent-sdk.mjs";
import { randomUUID } from "node:crypto";
let input = ""; for await (const chunk of process.stdin) { input += chunk; if (input.length > 8192) throw new Error("Enrollment exceeds its bound."); }
const enrollment = JSON.parse(input), sdk = switchyardAgent(enrollment), sessionId = randomUUID();
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
