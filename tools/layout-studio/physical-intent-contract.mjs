/** Closed physical meanings; no account, executable, content or compartment selection. */
const intents = ["summon", "resume", "review", "handoff", "status", "cancel"];
export function closedIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Physical shortcut is outside the closed intent contract.");
  if (["native-chatgpt.focus/v1", "native-vscode.focus/v1", "native-claude-desktop.focus/v1"].includes(value.implementation)) return { implementation: value.implementation };
  if (value.implementation === "switchyard.role/v1" && typeof value.roleId === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value.roleId) && intents.includes(value.intent)) return { implementation: value.implementation, roleId: value.roleId, intent: value.intent };
  throw Error("Physical shortcut is outside the closed intent contract.");
}
export function physicalIntentDispatch(value) {
  const intent = closedIntent(value);
  if (Object.keys(value).sort().join() !== [...Object.keys(intent), "requestId"].sort().join() || typeof value.requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.requestId)) throw Error("A physical dispatch requires its exact closed intent and invocation identity.");
  return Object.freeze({ ...intent, requestId: value.requestId });
}
