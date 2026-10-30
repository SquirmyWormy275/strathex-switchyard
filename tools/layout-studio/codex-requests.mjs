/** Protocol-specific refusal for the restricted native client; no approval grants. */
export function deniedCodexServerRequest(message) {
  const id = message.id;
  switch (message.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval": return { id, result: { decision: "cancel" } };
    case "item/permissions/requestApproval": return { id, result: { permissions: {}, scope: "turn" } };
    case "mcpServer/elicitation/request": return { id, result: { action: "cancel", content: null } };
    case "item/tool/requestUserInput": return { id, result: { answers: {} } };
    case "item/tool/call": return { id, result: { success: false, contentItems: [{ type: "inputText", text: "Switchyard's restricted client cannot execute tools or grant authority." }] } };
    default: return { id, error: { code: -32601, message: "This restricted client does not support that server request." } };
  }
}
