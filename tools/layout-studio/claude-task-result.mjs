/** Inspect a bounded private CLI envelope without storing raw diagnostics. */
export function verifiedClaudeTaskReply({ stdout: output, stderr = "", exitCode: code, status }, sessionId) {
  let r;
  try {
    r = JSON.parse(output);
    if (status !== "completed" || code !== 0 || r.type !== "result" || r.subtype !== "success" || r.is_error !== false || r.session_id !== sessionId || typeof r.result !== "string" || !r.result.trim() || Buffer.byteLength(r.result) > 32768 || r.permission_denials != null && (!Array.isArray(r.permission_denials) || r.permission_denials.length)) throw new Error();
    return r.result;
  } catch {
    const field = (v) => typeof v === "string" && /^[A-Za-z_-]{1,64}$/.test(v) ? v : "unverified";
    const summary = { schema: "switchyard-claude-result-shape/v1", exitCode: code, parsed: r != null, rootType: Array.isArray(r) ? "array" : r === null ? "null" : typeof r, frameCount: Array.isArray(r) ? r.length : null, terminalType: Array.isArray(r) ? field(r.at(-1)?.type) : null, type: field(r?.type), subtype: field(r?.subtype), isError: typeof r?.is_error === "boolean" ? r.is_error : null, exactSessionMatched: r?.session_id === sessionId, resultType: typeof r?.result, resultBytes: typeof r?.result === "string" ? Buffer.byteLength(r.result) : null, permissionDenials: Array.isArray(r?.permission_denials) ? r.permission_denials.length : null, stdoutBytes: Buffer.byteLength(output), stderrBytes: Buffer.byteLength(stderr) };
    summary.stderrCategories = [["workspace-trust", /workspace not trusted/i], ["session-unavailable", /no conversation|no session|session.*not found|invalid session/i], ["session-in-use", /session.*in use|already.*running|active.*writer|resum.*copy|\b(?:use|using)\b.*\battach\b/i], ["invalid-cli-option", /unknown option|invalid.*option|unsupported.*option|cannot be used|requires.*--|must.*--/i], ["permission-target", /permission.prompts|permission.prompt.tool/i], ["native-auth", /not logged in|authenticate|authentication|unauthorized|API.?key/i], ["account-limit", /quota|rate.limit|credit|usage limit|spending limit/i], ["native-error", /error/i]].filter(([, pattern]) => pattern.test(stderr)).map(([name]) => name);
    summary.referencedFlags = ["--safe-mode", "--output-format", "--tools", "--strict-mcp-config", "--mcp-config", "--settings", "--setting-sources", "--permission-mode", "--permission-prompts", "--no-chrome", "--resume", "--session-id"].filter((flag) => stderr.includes(flag));
    const observedSessionId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r?.session_id ?? "") ? r.session_id : null;
    throw Object.assign(new Error("The owned Claude result did not verify its exact native session and successful bounded reply. The original request remains for review."), { code: "NATIVE_RESULT_UNCONFIRMED", nativeResultSummary: summary, observedSessionId });
  }
}
