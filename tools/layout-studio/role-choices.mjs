/** Saved connection choices for guided role setup; never native observations. */
import { createHash } from "node:crypto";
import { agentIntents } from "../../integrations/agent-protocol.mjs";
import { clientCatalog, clientRecipe } from "../../integrations/client-recipes.mjs";

const names = { codex: "Codex", "claude-code": "Claude Code", "microsoft-365-copilot": "Microsoft 365 Copilot", "custom-agent": "Custom agent" };
const short = value => typeof value === "string" && value.trim().length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value);
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const key = row => JSON.stringify([row.provider, row.targetKind, row.targetId]);

export function roleChoiceBinding(state, selection) {
  const { roleId, intent, provider, targetKind, targetId } = selection;
  if (!agentIntents.includes(intent) || state.workflow.roles.filter(role => role.id === roleId).length !== 1) throw Error("Choose an existing workflow role and supported intent.");
  if (targetKind === "client-surface") {
    const recipe = clientRecipe(targetId);
    if (recipe.provider !== provider || recipe.target.kind !== "https" || intent !== "summon") throw Error("This documented client supports a homepage launch only.");
    return { bindingId: "saved-choice-preview", roleId, intent, provider, targetKind, targetId, recipeDigest: recipe.digest };
  }
  const rows = targetKind === "coding-task" ? state.codingSessions : targetKind === "conversation" ? state.conversations : targetKind === "custom-agent" && provider === "custom-agent" ? state.agents : null;
  if (!Array.isArray(rows)) throw Error("Choose a supported saved connection kind.");
  const matches = rows.filter(row => row.id === targetId && (targetKind === "custom-agent" || row.provider === provider));
  if (matches.length !== 1 || !matches[0].sessionId) throw Error("The original saved connection is missing or ambiguous. Refresh the role choices.");
  const target = matches[0];
  if (typeof target.sessionId !== "string" || target.sessionId.length > 4096 || /[\x00-\x1f\x7f]/.test(target.sessionId)) throw Error("The saved connection has no supported session identity.");
  return { bindingId: "saved-choice-preview", roleId, intent, provider, targetKind, targetId, sessionId: target.sessionId, ...(provider === "custom-agent" ? { credentialEpoch: target.credentialEpoch ?? "legacy" } : {}) };
}

export function roleChoiceDigest(state, selection, selectionDigest) {
  if (typeof selectionDigest !== "string" || !/^[a-f0-9]{64}$/.test(selectionDigest)) throw Error("The saved workspace selection identity is unavailable.");
  const binding = roleChoiceBinding(state, selection), role = state.workflow.roles.find(row => row.id === selection.roleId);
  const rows = selection.targetKind === "coding-task" ? state.codingSessions : selection.targetKind === "custom-agent" ? state.agents : state.conversations;
  const target = selection.targetKind === "client-surface" ? null : rows.find(row => row.id === selection.targetId && (selection.targetKind === "custom-agent" || row.provider === selection.provider));
  // Heartbeats and message content are not identities. Account/session, capability,
  // policy and role changes must invalidate the choice before a binding is saved.
  const fields = ["schema", "name", "label", "accountFingerprint", "accountBinding", "credentialEpoch", "enrollmentStatus", "capabilities", "reportedStatus", "status", "repositoryRoot", "repositoryIdentity", "launchPolicy", "nativeTransport", "backgroundId"];
  const identity = target ? fields.map(field => [field, target[field] ?? null]) : null;
  return digest(["switchyard-role-choice/v1", state.id, state.policy, state.mode ?? "keyboard-only", state.accounts, selectionDigest, role, state.roleBindings?.find(row => row.roleId === selection.roleId && row.intent === selection.intent) ?? null, binding, identity]);
}

export function roleChoices(state, { roleId, intent }, validateBinding, platform, selectionDigest) {
  if (!agentIntents.includes(intent) || !Array.isArray(state.workflow?.roles) || state.workflow.roles.length > 16) throw Error("Choose a saved workflow role and supported intent.");
  const roles = state.workflow.roles.filter(role => role.id === roleId);
  if (roles.length !== 1 || !short(roles[0].label)) throw Error("The original workflow role is missing or ambiguous.");
  if (!["personal-companion", "managed-companion"].includes(state.mode) || !Array.isArray(state.policyRules?.providers)) throw Error("Choose companion mode deliberately before connecting a workflow role.");
  const candidates = [], seen = new Set();
  for (const [targetKind, rows] of [["coding-task", state.codingSessions ?? []], ["conversation", state.conversations ?? []], ["custom-agent", state.agents ?? []]]) {
    if (!Array.isArray(rows) || rows.length > 256) throw Error("Saved role choices exceed their complete inventory bound.");
    for (const row of rows) {
      const provider = targetKind === "custom-agent" ? "custom-agent" : row.provider;
      if (!Object.hasOwn(names, provider) || !state.policyRules.providers.includes(provider) || targetKind !== "custom-agent" && provider === "custom-agent") continue;
      const selection = { roleId, intent, provider, targetKind, targetId: row.id }, id = key(selection);
      if (!short(row.id) || seen.has(id)) throw Error("Saved connection identities are ambiguous; no partial role choices were returned.");
      seen.add(id);
      if (!row.sessionId) continue;
      const label = row.label ?? row.name ?? `${names[provider]} ${targetKind === "coding-task" ? "task" : "conversation"}`;
      if (!short(label)) throw Error("A saved connection label is invalid; preserve it and review the original connection.");
      candidates.push({ ...selection, label: label.trim() });
    }
  }
  if (intent === "summon") for (const client of clientCatalog({ policy: state.policy, mode: state.mode, platform })) {
    if (client.recipe.target.kind === "https" && client.recipePlatformSupported && state.policyRules.providers.includes(client.provider)) candidates.push({ roleId, intent, provider: client.provider, targetKind: "client-surface", targetId: client.id, label: client.name });
  }
  const choices = [];
  for (const candidate of candidates) {
    let binding;
    try {
      binding = roleChoiceBinding(state, candidate);
      validateBinding({ ...state, roleBindings: [binding] }, roleId, intent);
    } catch { continue; }
    choices.push({ provider: candidate.provider, targetKind: candidate.targetKind, targetId: candidate.targetId, label: candidate.label, choiceDigest: roleChoiceDigest(state, candidate, selectionDigest) });
  }
  const result = { schema: "switchyard-role-choices/v1", compartment: state.id, role: { id: roleId, label: roles[0].label }, intent, choices, complete: true, nativeObserved: false, authorityGranted: false, bindingRequired: true };
  if (choices.length > 128 || Buffer.byteLength(JSON.stringify(result)) > 65536) throw Error("Saved role choices exceed their complete response bound; no partial list was returned.");
  return result;
}
