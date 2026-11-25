/** Separate read-only historical permission; never current-file ownership. */
import { historySelection } from "./git-history-inputs.mjs";
const actions = ["shield_codebase_audit", "release_shield"];
export function taskHistoryScope(value, allowedActions) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "depth,head,metadataSha256,paths"
    || !allowedActions.length || allowedActions.some(action => !actions.includes(action)) || typeof value.depth !== "number"
    || typeof value.head !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.head) || /^0+$/.test(value.head)
    || typeof value.metadataSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.metadataSha256)) throw Error("Historical permission requires an exact read-only Codebase Audit or Release scope and immutable history witness.");
  return { ...historySelection(value.paths, value.depth), head: value.head, metadataSha256: value.metadataSha256 };
}
export function assertTaskHistoryWitness(scope, report) {
  if (!report || report.schema !== "switchyard-git-history-inputs/v1" || report.sourceBytesWitnessed !== true || report.sourceBytesReturned !== false
    || report.head !== scope.head || report.requestedDepth !== scope.depth || JSON.stringify(report.paths) !== JSON.stringify(scope.paths)
    || report.historyMetadataSha256 !== scope.metadataSha256 || !Array.isArray(report.versions)
    || scope.paths.some(path => !report.versions.some(row => row.path === path))) throw Error("The exact reviewed historical scope changed or has no witnessed version. Review history again.");
}
export function taskOwnsScannerSource(proposal, source) {
  if (source?.kind === "git-history" && proposal.history) return proposal.history.depth === source.depth && proposal.history.paths.includes(source.path);
  return Boolean(source && proposal.paths.includes(source.path));
}
