/** CI-only fixed phase observation. Delegates every call and never accepts a result. */
import { runtimeStartupFailureEvidence } from "../tools/layout-studio/runtime-command.mjs";
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
  let operation = "native", failure = null;
  const record = (stage, error) => {
    // No raw exception, code, path, child output or account identifier is projected.
    const native = runtimeStartupFailureEvidence(error?.runtimeStartupFailure);
    const query = native?.selfTokenQuery;
    const queryStage = !query ? "" : !query.handlesClosedVerified ? "-qclose" : query.opened ? "-qopen" : query.error === 5 ? "-qdenied" : "-qfailed";
    failure ??= native ? `probe-${operation}-${stage}-native-${native.phase}${native.nativeCode === null ? "" : "-code" + native.nativeCode}${queryStage}` : `probe-${operation}-${stage}-${reasons.get(error?.message) ?? "refused"}`;
  };
  return {
    get failurePhase() { return failure; },
    command(command) {
      return async (executable, args, options) => {
        let stage = "startup";
        try {
          const result = await command(executable, args, { ...options,
            onGuardianChild: child => { stage = "created"; return options.onGuardianChild?.(child); },
            onGuardianReady: async frame => {
              stage = "ready";
              await options.onGuardianReady?.(frame);
              stage = "committed";
            },
          });
          return result;
        } catch (error) { record(stage, error); throw error; }
      };
    },
    native(native) {
      const observed = { ...native };
      for (const [method, label] of [["reconcile", "reconcile"], ["identity", "identity"], ["probeExchange", "capability"]]) {
        observed[method] = async (...args) => {
          const previous = operation; operation = label;
          try { return await native[method](...args); }
          catch (error) { record("return", error); throw error; }
          finally { operation = previous; }
        };
      }
      return observed;
    },
  };
}
