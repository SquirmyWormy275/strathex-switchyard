/** Editable process definitions. Observation provenance never becomes intent evidence. */
const id = /^[A-Za-z0-9_.:-]{1,64}$/;
const short = (s, max = 160) => typeof s === "string" && s.trim() && s.length <= max && !/[\0\r\n]/.test(s);
export function parseWorkflow(value) {
  if (value?.schema !== undefined && value.schema !== "switchyard-workflow/v1") throw new Error("This workflow version is unsupported. Preserve the original profile.");
  if (!value || !short(value.name, 120) || !Array.isArray(value.steps) || value.steps.length > 40 || !Array.isArray(value.roles) || value.roles.length > 16) throw new Error("A workflow needs a name, up to 40 steps, and up to 16 roles.");
  const roles = value.roles.map((r, i) => typeof r === "string" ? { id: `role-${i + 1}`, label: r } : { id: r.id, label: r.label });
  const seen = new Set();
  const labels = new Set();
  for (const r of roles) { if (!id.test(r.id) || seen.has(r.id) || !short(r.label) || labels.has(r.label.trim())) throw new Error("Workflow role identity or label is invalid or duplicated."); seen.add(r.id); labels.add(r.label.trim()); }
  const steps = value.steps.map((s, i) => typeof s === "string" ? { id: `step-${i + 1}`, label: s, roleId: null, after: i ? [`step-${i}`] : [] } : { id: s.id, label: s.label, roleId: s.roleId ?? null, after: s.after ?? [] });
  const stepsSeen = new Set();
  for (const s of steps) { if (!id.test(s.id) || stepsSeen.has(s.id) || !short(s.label) || (s.roleId !== null && !seen.has(s.roleId)) || !Array.isArray(s.after) || s.after.length > 40 || s.after.some((r) => !steps.some((s) => s.id === r))) throw new Error("Workflow step or relationship is invalid."); stepsSeen.add(s.id); }
  const visited = new Set(), visiting = new Set();
  function visit(s) { if (visiting.has(s.id)) throw new Error("Workflow steps contain a cycle. Review their order."); if (visited.has(s.id)) return; visiting.add(s.id); for (const prev of s.after) visit(steps.find((x) => x.id === prev)); visiting.delete(s.id); visited.add(s.id); }
  for (const step of steps) visit(step);
  return { schema: "switchyard-workflow/v1", name: value.name.trim(), steps, roles };
}

/** Plain-text editors keep IDs for unchanged labels, including after reordering.
 * A renamed or ambiguous role receives a new ID instead of inheriting authority.
 */
export function reconcileWorkflow(value, previous) {
  if (!value || !Array.isArray(value.roles) || !Array.isArray(value.steps)) return parseWorkflow(value);
  const old = parseWorkflow(previous), roles = value.roles.map((r) => {
    if (typeof r !== "string") return r;
    const matches = old.roles.filter((p) => p.label.trim() === r.trim());
    return { id: matches.length === 1 ? matches[0].id : `role-${crypto.randomUUID()}`, label: r };
  });
  const steps = value.steps.map((s, i) => {
    if (typeof s !== "string") return s;
    const matches = old.steps.filter((p) => p.label.trim() === s.trim()), prior = matches.length === 1 ? matches[0] : null;
    return { id: prior?.id ?? `step-${crypto.randomUUID()}`, label: s, roleId: roles.some((r) => r.id === prior?.roleId) ? prior.roleId : null, after: [] };
  });
  steps.forEach((step, i) => { if (typeof value.steps[i] === "string") step.after = i ? [steps[i - 1].id] : []; });
  return parseWorkflow({ ...value, roles, steps });
}

export function observationSummary(session) {
  const byKind = {};
  for (const event of session.events) { const row = byKind[event.kind] ??= { count: 0, sources: [] }; row.count++; if (!row.sources.includes(event.provenance)) row.sources.push(event.provenance); }
  const suggestions = [];
  if (byKind.handoff?.count) suggestions.push({ question: "Could these handoffs share one reviewable context packet?", evidence: `${byKind.handoff.count} marked handoffs`, provenance: "heuristic suggestion; user must confirm intent" });
  if (byKind.interruption?.count || byKind.resume?.count) suggestions.push({ question: "Would one named resume step make interruptions easier to recover from?", evidence: `${byKind.interruption?.count ?? 0} marked interruptions; ${byKind.resume?.count ?? 0} resumes`, provenance: "heuristic suggestion; no measured time saving" });
  return { id: session.id, status: session.status, events: session.events.length, byKind, focusCategories: session.focusCategories ?? {}, suggestions, boundary: "Categories describe app focus. Deliberate marks describe user observations. Neither proves an exact agent outcome." };
}
