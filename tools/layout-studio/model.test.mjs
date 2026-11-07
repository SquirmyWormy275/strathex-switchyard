import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzePlan, attachQmkBaseLayer, newPlan, parseBoardProfile, parsePlan, parseQmkInfo, parseStudyReport, planMarkdown, studySuggestions } from "./model.mjs";
import { createStudioServer } from "./serve.mjs";

const sample = (name) => readFile(fileURLToPath(new URL(name, import.meta.url)), "utf8").then(JSON.parse);
const action = (binding, overrides = {}) => ({ id: "review-1", label: "Review finished agent", family: "review", consequence: "read_only",
  confirmation: false, frequencyPerDay: 8, secondsSaved: 20, binding, ...overrides });

test("QMK geometry and exact base layer produce a reviewable, non-flashable plan", async () => {
  const info = await sample("./sample-info.json");
  const keymap = await sample("./sample-keymap.json");
  const profile = attachQmkBaseLayer(parseQmkInfo(info, "LAYOUT_sample"), keymap);
  assert.equal(profile.keys.length, 8);
  assert.deepEqual(profile.keys[0].matrix, [0, 0]);
  assert.equal(profile.keys[0].baseKeycode, "KC_F1");
  const plan = newPlan(profile);
  plan.actions.push(action({ keyId: "m0_0", modifier: "ctrl_shift" }));
  const review = analyzePlan(plan);
  assert.equal(review.readyForReview, true);
  assert.deepEqual(review.issues, []);
  assert.equal(review.estimatedMinutesPerDay, 8 * 20 / 60);
  assert.match(planMarkdown(plan), /does not flash firmware/);
  assert.deepEqual(parsePlan(JSON.parse(JSON.stringify(plan))), parsePlan(plan));
});

test("planner detects duplicate chords, normal typing override, and missing high-consequence confirmation", async () => {
  const profile = attachQmkBaseLayer(parseQmkInfo(await sample("./sample-info.json"), "LAYOUT_sample"), await sample("./sample-keymap.json"));
  const plan = newPlan(profile);
  plan.actions.push(action({ keyId: "m0_0", modifier: "none" }));
  plan.actions.push(action({ keyId: "m0_0", modifier: "none" }, { id: "approval-1", label: "Approve mutation", family: "authority", consequence: "high_consequence" }));
  const findings = analyzePlan(plan).issues;
  assert.ok(findings.some((issue) => issue.severity === "error" && /both use/.test(issue.message)));
  assert.ok(findings.some((issue) => issue.severity === "error" && /replace ordinary KC_F1/.test(issue.message)));
  assert.ok(findings.some((issue) => issue.severity === "error" && /no explicit confirmation/.test(issue.message)));
  assert.equal(analyzePlan(plan).readyForReview, false);
});

test("missing typing evidence and unassigned actions remain visible", async () => {
  const plan = newPlan(parseQmkInfo(await sample("./sample-info.json")));
  plan.actions.push(action(null));
  const review = analyzePlan(plan);
  assert.equal(review.readyForReview, false);
  assert.ok(review.issues.some((issue) => /typing layer/.test(issue.message)));
  assert.ok(review.issues.some((issue) => /no key assignment/.test(issue.message)));
});

test("cross-platform modifiers are reviewable and flag AltGr or OS shortcut risks", async () => {
  const profile = attachQmkBaseLayer(parseQmkInfo(await sample("./sample-info.json")), await sample("./sample-keymap.json"));
  const plan = newPlan(profile);
  plan.actions.push(action({ keyId: "m0_0", modifier: "ctrl_alt" }));
  plan.actions.push(action({ keyId: "m0_1", modifier: "gui_shift" }, { id: "review-2", label: "Route to second agent" }));
  const review = analyzePlan(plan);
  assert.equal(review.readyForReview, true);
  assert.ok(review.issues.some((issue) => /AltGr/.test(issue.message)));
  assert.ok(review.issues.some((issue) => /operating-system shortcut/.test(issue.message)));
});

test("aggregate study evidence suggests intents without retaining focus data or task aliases", async () => {
  const report = await sample("./sample-study-report.json");
  report.taskAlias = "private-client";
  const summary = parseStudyReport(report);
  assert.equal(summary.sessionsCompleted, 3);
  assert.equal(summary.focusDurationMs, undefined);
  assert.equal(summary.taskAlias, undefined);
  assert.deepEqual(studySuggestions(summary).map((item) => item.kind), ["resume", "failure", "review"]);
  const plan = newPlan(attachQmkBaseLayer(parseQmkInfo(await sample("./sample-info.json")), await sample("./sample-keymap.json")));
  plan.study = summary;
  const saved = parsePlan(JSON.parse(JSON.stringify(plan)));
  assert.equal(saved.study.events, 5);
  assert.match(planMarkdown(saved), /Counts describe observed event kinds, not exact intents or daily frequency/);
});

test("study importer rejects raw logs and inconsistent aggregate counts", async () => {
  const report = await sample("./sample-study-report.json");
  assert.throws(() => parseStudyReport([{ type: "event", kind: "resume" }]), /must be an object/);
  assert.throws(() => parseStudyReport({ ...report, events: 4 }), /do not match/);
  assert.throws(() => parseStudyReport({ ...report, byKind: { ...report.byKind, unknown: { count: 1 } } }), /unknown action kind/);
});

test("import rejects ambiguous layouts, wrong keymap, duplicate matrix positions, and Vial definitions", async () => {
  const info = await sample("./sample-info.json");
  const profile = parseQmkInfo(info);
  const keymap = await sample("./sample-keymap.json");
  assert.throws(() => attachQmkBaseLayer(profile, { ...keymap, keyboard: "some/other-board" }), /keyboard ID does not match/);
  assert.throws(() => attachQmkBaseLayer(profile, { layout: "LAYOUT_other", layers: [[]] }), /does not match/);
  assert.throws(() => parseBoardProfile({ ...profile, keys: [profile.keys[0], { ...profile.keys[0], id: "other" }] }), /Matrix position/);
  assert.throws(() => parseQmkInfo({ layouts: { LAYOUT_a: { layout: [] }, LAYOUT_b: { layout: [] } } }), /Choose one QMK layout/);
  assert.throws(() => parseQmkInfo({ matrix: { rows: 8, cols: 18 }, layouts: { keymap: [] } }), /no supported physical layout/);
});

test("review sheet escapes imported labels and remains plain data", async () => {
  const profile = attachQmkBaseLayer(parseQmkInfo(await sample("./sample-info.json")), await sample("./sample-keymap.json"));
  const plan = newPlan(profile);
  plan.actions.push(action({ keyId: "m0_1", modifier: "shift_alt" }, { label: "Review | <draft>" }));
  assert.match(planMarkdown(plan), /Review \\\| &lt;draft>/);
});

test("studio serves only fixed local assets over loopback", async () => {
  const server = createStudioServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
    assert.match(await page.text(), /Switchyard · Keyboard workspace/);
    const example = await fetch(`${base}/sample-study-report.json`);
    assert.equal(example.status, 200);
    assert.equal(parseStudyReport(await example.json()).events, 5);
    assert.equal((await fetch(`${base}/secret`)).status, 404);
    assert.equal((await fetch(base, { method: "POST", body: "test" })).status, 404);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test("studio controls referenced by the browser module exist in the page", async () => {
  const html = await readFile(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
  const script = await readFile(fileURLToPath(new URL("./app.mjs", import.meta.url)), "utf8");
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const ids = new Set(allIds);
  assert.equal(ids.size, allIds.length, "UI IDs must be unique");
  for (const match of script.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(ids.has(match[1]), `Missing UI control ${match[1]}`);
  for (const stage of ["board", "patterns", "mapping", "review"]) assert.match(html, new RegExp(`id="${stage}"`));
});
