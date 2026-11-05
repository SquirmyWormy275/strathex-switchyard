/** Host implementation capabilities; imported profiles cannot extend this list. */
export const linuxPipelineActions = Object.freeze(["pipeline_local_gate","pipeline_clean_reproduction"]);
export const linuxShieldActions = Object.freeze(["shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"]);
export const windowsShieldActions = Object.freeze(["shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"]);
export const windowsPipelineActions = Object.freeze(["pipeline_local_gate", "pipeline_clean_reproduction"]);
export function connectedExecutionActions(platform = process.platform) {
  return platform === "linux" ? ["run_target",...linuxPipelineActions,...linuxShieldActions] : platform === "win32" ? ["run_target",...windowsPipelineActions,...windowsShieldActions] : [];
}
