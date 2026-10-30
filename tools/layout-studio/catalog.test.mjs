import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { standardPreset, presetOptions } from "./catalog.mjs";
import { boardBounds, layoutChoices, outlinePoints, unpackChoices, vialGeometry } from "./geometry.mjs";
import { importProfile, compileConnection, rebaseTypingLayer } from "./workspace.mjs";
const catalog = JSON.parse(await readFile(new URL("./model-f-catalog.json", import.meta.url), "utf8"));

test("every named catalog and development reference builds a round-trippable four-control profile", () => {
  assert.equal(catalog.models.filter((m) => m.status === "listed-model").length, 19);
  let count = 0;
  for (const model of catalog.models) for (const variant of model.variants) {
    const { portable } = standardPreset(catalog, model.id, { variantId: variant.id });
    assert.deepEqual(importProfile(JSON.parse(JSON.stringify(portable))), portable);
    assert.equal(portable.plan.actions.length, 4);
    assert.equal(portable.workflow.roles.length, 2);
    assert.equal(portable.plan.profile.controller, "unknown");
    assert.equal(portable.plan.profile.evidence, "source-reference");
    assert.ok(portable.plan.actions.every((a) => a.binding?.modifier === "gui_ctrl"), `${model.id}/${variant.id} must have four real reference positions`);
    const keys = portable.plan.profile.keys;
    assert.equal(new Set(keys.map((k) => k.id)).size, keys.length);
    assert.equal(new Set(keys.map((k) => k.matrix.join(","))).size, keys.length);
    const bounds = boardBounds(keys); assert.ok(bounds.width < 32 && bounds.height < 16, `${model.id}/${variant.id} has displaced alternative keys`);
    count++;
  }
  assert.equal(count, 104);
});

test("F77 factory reference and independent Dvorak preset preserve number positions and forbid connection without actual typing evidence", () => {
  const q = standardPreset(catalog, "f77-classic"), d = standardPreset(catalog, "f77-classic", { typing: "dvorak" });
  assert.equal(q.portable.plan.profile.keys.length, 75);
  const qkey = q.portable.plan.profile.keys.find((k) => k.baseKeycode === "KC_Q");
  assert.equal(d.portable.plan.profile.keys.find((k) => k.id === qkey.id).baseKeycode, "KC_QUOTE");
  assert.deepEqual(q.portable.plan.actions, d.portable.plan.actions);
  assert.equal(q.portable.plan.profile.keys.find((k) => k.id === qkey.id).baseKeycode, "KC_Q");
  assert.throws(() => compileConnection(q.portable.plan, "task-resume", "native-chatgpt.focus/v1"), /reference typing layer/);
  assert.equal(JSON.stringify(q).includes("keymap_raw"), false);
});

test("every individual documented physical choice can be rendered, including ISO Enter and both split halves", () => {
  let variations = 0;
  for (const model of catalog.models.filter((m) => m.variants.length)) {
    const original = standardPreset(catalog, model.id), options = presetOptions(catalog, model.id);
    for (let part = 0; part < options.length; part++) for (let choice = 0; choice < options[part].length; choice++) for (let selected = 0; selected < options[part][choice].options.length; selected++) {
      const selections = structuredClone(original.choices); selections[part][choice] = selected;
      const candidate = standardPreset(catalog, model.id, { choices: selections });
      const bounds = boardBounds(candidate.portable.plan.profile.keys);
      assert.ok(bounds.width < 32 && bounds.height < 16, `${model.id} option ${part}/${choice}/${selected}`);
      candidate.portable.plan.profile.keys.forEach((key) => assert.ok(outlinePoints(key).length >= 4)); variations++;
    }
  }
  assert.ok(variations > 200);
  const split = standardPreset(catalog, "fortho").portable.plan.profile;
  assert.ok(split.keys.some((k) => k.rotation === 30));
  assert.ok(split.keys.some((k) => k.rotation === -30));
  assert.ok(split.keys.some((k) => k.id.startsWith("left:")));
  assert.ok(split.keys.some((k) => k.id.startsWith("right:") && k.matrix[0] >= 128));
  const iso = standardPreset(catalog, "f77-classic", { variantId: "f77-iso_opt1" }).portable.plan.profile;
  assert.ok(iso.keys.some((k) => k.shape && outlinePoints(k).length >= 6));
});

test("choice packing matches upstream references and displaced alternatives align at their real physical location", () => {
  const def = catalog.definitions["wcass:f77"].definition;
  assert.deepEqual(unpackChoices(def, 72), [0, 0, 2, 0, 1, 0, 0, 0]);
  const geometry = vialGeometry({ layouts: { labels: ["Split"], keymap: [[{ w: 2 }, "0,0\n\n\n0,0", { x: 3 }, "0,0\n\n\n0,1", "0,1\n\n\n0,1"]] } }, [1]);
  assert.deepEqual(geometry.map((k) => [k.x, k.y, k.w]), [[0, 0, 1], [1, 0, 1]]);
  assert.throws(() => unpackChoices(def, -1), /Invalid/);
  assert.throws(() => standardPreset(catalog, "f77-classic", { choices: [[999]] }), /every physical/);
  assert.throws(() => standardPreset(catalog, "f6x12"), /no verified final geometry/);
  assert.throws(() => standardPreset(catalog, "b62", { variantId: "f77-ansi_opt1" }), /exact keyboard/);
});

test("importing actual typing evidence retains planned intents and unassigns missing or ambiguous keys", () => {
  const { portable } = standardPreset(catalog, "f77-classic");
  const profile = structuredClone(portable.plan.profile); profile.evidence = "saved-snapshot";
  profile.keys = profile.keys.map((k) => ({ ...k, id: `actual:${k.id}` }));
  const one = profile.keys.find((k) => k.baseKeycode === "KC_1"), two = profile.keys.find((k) => k.baseKeycode === "KC_2");
  profile.keys.find((k) => k.baseKeycode === "KC_3").baseKeycode = "KC_NO";
  profile.keys.find((k) => k.baseKeycode === "KC_4").baseKeycode = "KC_2";
  const result = rebaseTypingLayer(portable.plan, profile);
  assert.equal(result.actions[0].binding.keyId, one.id);
  assert.equal(result.actions[1].binding, null);
  assert.equal(result.actions[2].binding, null);
  assert.equal(result.actions[3].binding, null);
  assert.equal(result.profile.evidence, "saved-snapshot");
  assert.equal(portable.plan.profile.evidence, "source-reference");
});
