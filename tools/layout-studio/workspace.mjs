/** Portable configuration and untrusted assistant proposals. No host effects. */
import { analyzePlan, parsePlan } from "./model.mjs";

export const portableSchema = "switchyard-profile/v1";
export const proposalSchema = "switchyard-proposal/v1";
const identifier = /^[A-Za-z0-9_.:-]{1,64}$/;
const object = (v) => v && typeof v === "object" && !Array.isArray(v);

export function portableProfile(plan, id = "my-workflow", name = plan.profile.name) {
  if (!identifier.test(id) || typeof name !== "string" || !name.trim() || name.length > 120 || /[\0\r\n]/.test(name)) throw new Error("Profile identity is invalid.");
  return { schema: portableSchema, id, name: name.trim(), plan: parsePlan(plan) };
}

/** Old Studio files migrate explicitly. Unknown versions leave the input intact. */
export function importProfile(value) {
  if (!object(value)) throw new Error("Choose a portable profile or Studio plan.");
  if (value.schema === "sxsy-agentic-layout-plan/v1") return portableProfile(value);
  if (value.schema !== portableSchema) throw new Error("This profile version is unsupported. Keep the original file; the open plan has not changed.");
  return portableProfile(value.plan, value.id, value.name);
}

export function proposalContext(input) {
  const basePlan = parsePlan(input);
  return {
    instruction: "Propose a Switchyard layout using switchyard-proposal/v1. Return JSON with basePlan unchanged, a short summary, and operations. Allowed operations: upsert-action (action with all Studio fields), move-action (actionId, keyId, modifier), remove-action (actionId). No commands, paths, credentials or permissions. Modified keys preserve ordinary typing. The user will review before adopting; this does not apply host or device changes.",
    schema: proposalSchema, basePlan, summary: "Describe the workflow improvement", operations: []
  };
}

/** Optimistic concurrency: a proposal cannot overwrite subsequent direct edits. */
export function reviewProposal(input, currentPlan) {
  if (!object(input) || input.schema !== proposalSchema || !Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 64) throw new Error("Proposal version or operation count is unsupported.");
  if (typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 500 || /\0/.test(input.summary)) throw new Error("A proposal needs a short, readable summary.");
  const base = parsePlan(input.basePlan);
  if (JSON.stringify(base) !== JSON.stringify(parsePlan(currentPlan))) throw new Error("This proposal targets an earlier plan. Give your assistant the current plan and try again; your direct edits are preserved.");
  let candidate = structuredClone(base);
  const changes = [];
  for (const op of input.operations) {
    if (!object(op)) throw new Error("A proposal operation must be an object.");
    if (op.type === "upsert-action") {
      const parsed = parsePlan({ ...candidate, actions: [op.action] }).actions[0];
      const exists = candidate.actions.some((a) => a.id === parsed.id);
      candidate.actions = [...candidate.actions.filter((a) => a.id !== parsed.id), parsed];
      changes.push(`${exists ? "Update" : "Add"} ${parsed.label}`);
    } else if (op.type === "move-action") {
      const action = candidate.actions.find((a) => a.id === op.actionId);
      if (!action) throw new Error("The proposal names an unknown action.");
      action.binding = { keyId: op.keyId, modifier: op.modifier };
      changes.push(`Move ${action.label} to ${op.keyId} + ${op.modifier}`);
    } else if (op.type === "remove-action") {
      const action = candidate.actions.find((a) => a.id === op.actionId);
      if (!action) throw new Error("The proposal names an unknown action.");
      candidate.actions = candidate.actions.filter((a) => a.id !== op.actionId);
      changes.push(`Remove ${action.label}`);
    } else throw new Error("That proposal operation is outside the supported design contract.");
    candidate = parsePlan(candidate);
  }
  const review = analyzePlan(candidate);
  if (review.issues.some((i) => i.severity === "error")) throw new Error(review.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" "));
  return { summary: input.summary.trim(), changes, plan: candidate, issues: review.issues };
}

const modifierValues = { shift: ["SHIFT", 1], ctrl: ["CTRL", 4], alt: ["ALT", 8], gui: ["SUPER", 64] };

/** A closed local implementation compiles a gesture; imported labels cannot select code. */
export function compileConnection(input, actionId, implementation) {
  if (implementation !== "native-chatgpt.focus/v1") throw new Error("That local action is unavailable. Choose an explicitly supported connection.");
  const review = analyzePlan(input);
  const action = review.plan.actions.find((a) => a.id === actionId);
  if (!action?.binding) throw new Error("Assign the action to a physical key and modifier first.");
  if (review.issues.some((i) => i.severity === "error")) throw new Error("Resolve layout conflicts before connecting an action.");
  if (action.consequence !== "navigation") throw new Error("Show ChatGPT is navigation. Revise the action's consequence before connecting it.");
  const key = review.plan.profile.keys.find((k) => k.id === action.binding.keyId);
  const match = /^KC_([A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.exec(key.baseKeycode ?? "");
  if (!match) throw new Error("This connection needs a recorded letter, digit, or F1–F24 base keycode. Firmware and special keys cannot be guessed.");
  const names = action.binding.modifier.split("_");
  if (!names.includes("gui") || names.some((n) => !modifierValues[n]) || names.length < 2) throw new Error("Choose Super plus at least one other modifier for this host shortcut, preserving ordinary typing and common app shortcuts.");
  return {
    implementation, actionId: action.id, label: "Show ChatGPT", key: match[1],
    shortcut: `${names.map((n) => modifierValues[n][0]).join(" + ")} + ${match[1]}`,
    modmask: names.reduce((sum, n) => sum + modifierValues[n][1], 0)
  };
}
