/** Host implementation capabilities; imported profiles cannot extend this list. */
export const linuxPipelineActions = Object.freeze(["pipeline_local_gate","pipeline_clean_reproduction"]);
export const windowsPipelineActions = Object.freeze(["pipeline_local_gate", "pipeline_clean_reproduction"]);
export function connectedExecutionActions(platform = process.platform) {
  return platform === "linux" ? ["run_target",...linuxPipelineActions] : platform === "win32" ? ["run_target",...windowsPipelineActions] : [];
}
