/** CI-only fixed phase observation. Delegates every call and never accepts a result. */
import { runtimeStartupFailureEvidence, runtimeWorkerStartFailureEvidence } from "../tools/layout-studio/runtime-command.mjs";
const reasons = new Map([
  ["Runtime worker exit could not be fully verified. Preserve its staging/recovery state.", "worker-exit"],
  ["The native runtime guardian did not verify readiness.", "readiness"],
  ["The runtime start acknowledgement was not committed.", "acknowledgement"],
  ["The native runtime guardian is unavailable.", "unavailable"],
  ["The exact native Windows setup identity did not verify.", "identity-response"],
  ["The fixed Windows storage helper returned no bounded structured result.", "structured-result"],
  ["The original Windows storage guardian has no independently verified exit.", "independent-exit"],
  ["The owned native command did not verify complete input and process exit.", "input-or-exit"],
  ["The original fixed broker transport did not verify.", "broker-response"],
  ["The read-only broker exchange capability did not verify.", "capability-response"],
  ["The original broker capability did not authenticate.", "authentication"],
]);

export function createWindowsOwnerProbeObservation() {
  let operation = "native", failure = null, returned = null;
  const record = (stage, error) => {
    // No exception text, path, child output or account identifier is projected.
    const native = runtimeStartupFailureEvidence(error?.runtimeStartupFailure);
    const worker = runtimeWorkerStartFailureEvidence(error?.runtimeWorkerStartFailure);
    const query = native?.selfTokenQuery;
    const queryStage = !query ? "" : !query.handlesClosedVerified ? "-qclose" : query.opened ? "-qopen" : query.error === 5 ? "-qdenied" : "-qfailed";
    const reason = reasons.get(error?.message) ?? "refused";
    const result = reason === "structured-result" && returned ? `-code${returned.exitCode}-bytes${returned.stdoutBytes}` : "";
    failure ??= native ? `probe-${operation}-${stage}-native-${native.phase}${native.nativeCode === null ? "" : "-code" + native.nativeCode}${queryStage}`
      : worker ? `probe-${operation}-${stage}-worker-${worker.phase}${worker.nativeCode === null ? "" : "-code" + worker.nativeCode}`
      : `probe-${operation}-${stage}-${reason}${result}`;
  };
  return {
    get failurePhase() { return failure; },
    command(command) {
      return async (executable, args, options) => {
        let stage = "startup"; returned = null;
        try {
          const result = await command(executable, args, { ...options,
            onGuardianChild: child => { stage = "created"; return options.onGuardianChild?.(child); },
            onGuardianReady: async frame => {
              stage = "ready";
              await options.onGuardianReady?.(frame);
              stage = "committed";
            },
          });
          // Only fixed numeric metadata is retained; output, paths and arguments
          // remain private. This does not accept the original transport result.
          if (Number.isSafeInteger(result?.exitCode) && result.exitCode >= 0 && result.exitCode <= 0xffffffff && typeof result.stdout === "string" && result.stdout.length <= 16384) {
            const bytes = Buffer.byteLength(result.stdout);
            if (bytes <= 16384) returned = { exitCode: result.exitCode, stdoutBytes: bytes };
          }
          return result;
        } catch (error) { record(stage, error); throw error; }
      };
    },
    native(native) {
      const observed = { ...native };
      for (const [method, label] of [["reconcile", "reconcile"], ["identity", "identity"], ["probeExchange", "capability"]]) {
        observed[method] = async (...args) => {
          const previous = operation; operation = label; returned = null;
          try { return await native[method](...args); }
          catch (error) { record("return", error); throw error; }
          finally { operation = previous; }
        };
      }
      return observed;
    },
  };
}
