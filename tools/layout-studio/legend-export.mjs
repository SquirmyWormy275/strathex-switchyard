/** Profile-derived print exports. No local bindings, device writes or host effects. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { importProfile } from "./workspace.mjs";
import { analyzePlan } from "./model.mjs";
import { packageDefinition, packageSchema, parsePortablePackage } from "./portable-package.mjs";
import { boardBounds, keyBounds, outlinePoints } from "./geometry.mjs";
import templateFaces from "../../third-party/cyber_engineer/template-faces.json" with { type: "json" };

const digest = (v) => createHash("sha256").update(v).digest("hex");
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const number = (v) => Number(v.toFixed(4));
const sourcePdf = "a16192b9c8cc7f1031527a9b5e60b25fe1aa8eaf1592b9be4d6abc97be4b6040";
const sourceSvg = "06bb168f1cf6b7cf4d2a84041626d032a62d41b41e1dff2377fcaa32355ec2b3";
const sourceUrl = new URL("../../third-party/cyber_engineer/pure-template.svg", import.meta.url);
const modifier = (value) => value === "none" ? "Plain" : value.split("_").map((v) => ({ gui: "GUI", ctrl: "Ctrl", alt: "Alt", shift: "Shift" })[v]).join("+");
const pageStart = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="210mm" height="297mm" viewBox="0 0 595.276 841.89" role="img">';
const guidance = "Print A4 at 100% / actual size. Disable fit and shrink. Measure the source 15 mm reference with a ruler before cutting. Trial-fit one insert; cap fit on this keyboard is unverified.";

function wrap(text, size, width) {
  // Conservative widths keep complete words inside the cap face. Never split
  // an ordinary word or silently abbreviate the meaning to make it fit.
  const widthOf = (v) => [...v].reduce((n, c) => n + (/[^\x20-\x7e]/u.test(c) ? 1.15 : /[mwMW@#%]/.test(c) ? 1 : .65), 0) * size;
  const lines = []; let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    if (widthOf(word) > width) return null;
    if (line && widthOf(`${line} ${word}`) > width) { lines.push(line); line = ""; }
    line = line ? `${line} ${word}` : word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
function fitted(text, width, height) {
  for (let size = 6.5; size >= 4.75; size -= .25) {
    const lines = wrap(text, size, width);
    if (lines && lines.length * size * 1.15 <= height) return { size, lines };
  }
  throw new Error("A legend label will not fit legibly. Supply a shorter print label for that action; the assignment reference retains its full meaning.");
}
function textLines(text, x, y, width, height) {
  const { size, lines } = fitted(text, width, height), step = size * 1.15;
  return lines.map((line, i) => `<text x="${x}" y="${number(y + (i - (lines.length - 1) / 2) * step)}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="${size}" font-weight="600" fill="#fff">${esc(line)}</text>`).join("");
}
function insert(face, item) {
  // Leave the original face outline and clip-clearance cuts visible. Positions
  // and dimensions come directly from the pinned source's rectangle paths.
  const x = face.x + face.w / 2, y = face.y + face.h / 2, width = face.w - 1, height = face.h - 1;
  return `<g><rect x="${number(x - width / 2)}" y="${number(y - height / 2)}" width="${width}" height="${height}" fill="#18283b"/><rect x="${number(x - width / 2)}" y="${number(y - height / 2)}" width="${width}" height="7" fill="#244b79"/>${textLines(String(item.number).padStart(2, "0"), x, y - 14.5, width - 3, 6)}${textLines(item.printLabel, x, y + 1, width - 4, 20)}</g>`;
}
function overlay(items, page, count, revision) {
  return `<g aria-label="Switchyard assignment legends">${items.map((a, i) => insert(templateFaces.compact[i], a)).join("")}${items.map((a, i) => insert(templateFaces.full[i], a)).join("")}<text x="18" y="826" font-family="sans-serif" font-size="5.5" fill="#18283b">SWITCHYARD / ${revision.slice(0, 12)} / ${page + 1} OF ${count} / NUMBERS REFER TO ASSIGNMENT REFERENCE</text></g>`;
}
function keyboard(profile, assignments) {
  const bounds = boardBounds(profile.keys), left = Math.min(0, ...profile.keys.map((k) => keyBounds(k).left)), top = Math.min(0, ...profile.keys.map((k) => keyBounds(k).top));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${number(left - .2)} ${number(top - .2)} ${number(bounds.width - left + .4)} ${number(bounds.height - top + .4)}" role="img" aria-label="Keyboard assignment reference; geometry in key units, not a cutting template">${profile.keys.map((k) => {
    const rows = assignments.filter((a) => a.keyId === k.id);
    return `<g transform="translate(${k.x} ${k.y}) rotate(${k.rotation ?? 0})"><polygon points="${outlinePoints(k).map((p) => p.join(",")).join(" ")}" fill="${rows.length ? "#e5edf7" : "#fafbfc"}" stroke="#8b98a7" stroke-width=".025"/><text x="${k.w / 2}" y="${k.h / 2}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size=".2" fill="#18283b" textLength="${number(Math.min(k.w - .14, [...k.label].length * .11))}" lengthAdjust="spacingAndGlyphs">${esc(k.label)}</text>${rows.length ? `<text x="${k.w / 2}" y="${k.h - .15}" text-anchor="middle" font-family="sans-serif" font-size=".13" fill="#244b79">${esc(rows.map((a) => a.number).join(", "))}</text>` : ""}</g>`;
  }).join("")}</svg>`;
}
function html(title, content, { template = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>@page{size:A4;margin:${template ? "0" : "14mm"}}*{box-sizing:border-box}body{margin:0;color:#18283b;background:#e8edf2;font:14px/1.5 sans-serif}main{max-width:1100px;margin:32px auto;padding:32px;background:white}h1{font-size:28px;line-height:1.15;margin:8px 0 16px}h2{font-size:19px;margin-top:28px}.eyebrow{font-size:11px;letter-spacing:.12em;font-weight:700;color:#244b79}.note{color:#4c5d70;max-width:85ch}svg{display:block;width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #d7dfe7;padding:10px 8px}th{color:#4c5d70;font-size:10px;text-transform:uppercase;letter-spacing:.06em}code{overflow-wrap:anywhere}.sheet{width:210mm;height:297mm;background:white;margin:18px auto;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.sheet svg{width:210mm;height:297mm}.source-defs{position:absolute;width:0;height:0;overflow:hidden}tr{break-inside:avoid}thead{display:table-header-group}.revision{font:11px monospace;overflow-wrap:anywhere}@media print{body{background:white}main{max-width:none;margin:0;padding:0}.screen-only{display:none}.sheet{margin:0}h1,h2{break-after:avoid}svg{break-inside:avoid}}</style></head><body>${content}</body></html>`;
}
export async function exportAssignmentLegends(document, { format = "review-html", page = 0, labels = {} } = {}) {
  const portable = document?.schema === packageSchema ? parsePortablePackage(document) : null;
  const profile = portable ? packageDefinition(portable) : importProfile(document), plan = profile.plan;
  for (const text of [profile.name, plan.profile.name, plan.profile.layout, ...plan.profile.keys.map((k) => k.label), ...plan.actions.map((a) => a.label)]) if (!text.isWellFormed() || /[\u0000-\u001f\u007f\ufffe\uffff]/u.test(text)) throw new Error("Export text contains unsupported control characters. Review the saved labels.");
  if (!["review-html", "template-svg", "template-html"].includes(format) || !Number.isInteger(page) || page < 0 || !labels || typeof labels !== "object" || Array.isArray(labels) || Object.keys(labels).length > 256) throw new Error("Choose a supported assignment export and bounded page.");
  const ids = new Set(plan.actions.map((a) => a.id));
  for (const [id, label] of Object.entries(labels)) if (!ids.has(id) || typeof label !== "string" || !label.trim() || label.length > 40 || !label.isWellFormed() || /[\u0000-\u001f\u007f\ufffe\uffff]/u.test(label)) throw new Error("Print labels must name an existing action and use 1-40 printable characters.");
  const assignments = plan.actions.map((a, i) => { const intent = portable?.intentAssignments.find((v) => v.actionId === a.id); return { number: i + 1, actionId: a.id, label: a.label, printLabel: Object.hasOwn(labels, a.id) ? labels[a.id].trim() : a.label, keyId: a.binding?.keyId ?? null, keyLabel: plan.profile.keys.find((k) => k.id === a.binding?.keyId)?.label ?? null, modifier: a.binding ? modifier(a.binding.modifier) : null, confirmation: a.confirmation, consequence: a.consequence, meaning: intent ? { roleId: intent.roleId, roleLabel: profile.workflow.roles.find((r) => r.id === intent.roleId).label, intent: intent.intent } : null }; });
  const revision = digest(JSON.stringify({ profile: portable ?? profile, labels })), bound = assignments.filter((a) => a.keyId), pageCount = Math.max(1, Math.ceil(bound.length / 15));
  if (page >= pageCount || page !== 0 && format !== "template-svg") throw new Error("Choose an existing template page; multi-page HTML starts with page zero.");
  const manifest = { schema: "switchyard-assignment-legends/v1", profileId: profile.id, name: profile.name, revision, assignments, reviewIssues: analyzePlan(plan).issues, geometry: "reference in key units; no physical key pitch inferred", template: { source: "cyber_engineer IBM-compatible relegendable cap template", sourcePdfSha256: sourcePdf, sourceSvgSha256: sourceSvg, paper: "A4", widthMm: 210, heightMm: 297, calibrationMm: 15, capFitVerified: false, pageCount, instructions: guidance, credit: "cyber_engineer (GeekHack), @Mates_ENGINEER" }, unassigned: assignments.filter((a) => !a.keyId).map((a) => a.actionId) };
  let content, mimeType;
  if (format === "review-html") {
    const rows = assignments.map((a) => `<tr><td>${a.number}</td><td><strong>${esc(a.label)}</strong><br><code>${esc(a.actionId)}</code>${a.meaning ? `<br>${esc(a.meaning.roleLabel)} / ${esc(a.meaning.intent)} (portable meaning; connect locally)` : ""}${a.printLabel !== a.label ? `<br>Print label: ${esc(a.printLabel)}` : ""}</td><td>${a.keyId ? `${esc(a.modifier)} + ${esc(a.keyLabel)}<br><code>${esc(a.keyId)}</code>` : "Unassigned"}</td><td>${esc(a.consequence.replaceAll("_", " "))}${a.confirmation ? " / confirmation required" : ""}</td></tr>`).join("");
    content = html(profile.name, `<main><p class="eyebrow">SWITCHYARD / ASSIGNMENT REFERENCE</p><h1>${esc(profile.name)}</h1><p class="note">${esc(plan.profile.name)} / ${esc(plan.profile.layout)}. This is the saved configuration, not proof of a live device or an applied shortcut. Ordinary typing is ${plan.profile.keys.every((k) => k.baseKeycode) ? "recorded in the profile" : "not fully recorded"}.</p>${keyboard(plan.profile, assignments)}${manifest.reviewIssues.length ? `<h2>Review before use</h2><ul>${manifest.reviewIssues.map((i) => `<li>${esc(i.severity)}: ${esc(i.message)}</li>`).join("")}</ul>` : ""}<h2>Your controls</h2><table><thead><tr><th>No.</th><th>Action</th><th>Physical position / modifier</th><th>Consequence</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No actions assigned yet.</td></tr>'}</tbody></table><h2>Printing legends</h2><p class="note">${guidance} The keyboard drawing above is a reference, not an insert cutting template. The separate template export retains the source cut lines and creator credit. Each printed number identifies one exact modifier/action row here; it does not invent a physical matrix position.</p><p class="revision">Revision ${revision}</p></main>`); mimeType = "text/html";
  } else {
    // Validate all labels before returning any page, so pagination cannot hide a
    // missing or illegible action. Both source variants are always preserved.
    for (const a of bound) fitted(a.printLabel, Math.min(...templateFaces.compact.map((f) => f.w)) - 5, 20);
    const svg = await readFile(sourceUrl, "utf8");
    if (Buffer.byteLength(svg) > 800000 || digest(svg) !== sourceSvg) throw new Error("The retained print template did not verify. No geometry was substituted.");
    const inner = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"));
    if (format === "template-svg") { content = `${pageStart}<title>${esc(profile.name)} / assignment legends / page ${page + 1}</title><desc>${esc(guidance)}</desc>${inner}${overlay(bound.slice(page * 15, page * 15 + 15), page, pageCount, revision)}</svg>`; mimeType = "image/svg+xml"; }
    else { content = html(`${profile.name} / print legends`, `<main class="screen-only"><p class="eyebrow">SWITCHYARD / PRINT LEGENDS</p><h1>${esc(profile.name)}</h1><p>${guidance}</p><p>Keep the assignment reference with this sheet. Each number names one modifier/action row. ${manifest.unassigned.length} unassigned action(s) remain in the reference and have no insert.</p><p class="revision">Revision ${revision}</p></main><svg class="source-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><g id="source-template">${inner}</g></defs></svg>${Array.from({ length: pageCount }, (_, i) => `<section class="sheet">${pageStart}<title>${esc(profile.name)} / page ${i + 1}</title><use href="#source-template"/>${overlay(bound.slice(i * 15, i * 15 + 15), i, pageCount, revision)}</svg></section>`).join("")}`, { template: true }); mimeType = "text/html"; }
  }
  if (Buffer.byteLength(content) > 3 * 1024 * 1024) throw new Error("The print export exceeds its bounded size.");
  return { manifest, format, page, mimeType, filename: `switchyard-${format}-${revision.slice(0, 12)}${format === "template-svg" ? `-${page + 1}.svg` : ".html"}`, sha256: digest(content), content };
}
