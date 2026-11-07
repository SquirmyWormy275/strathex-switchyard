import { standardPreset, presetOptions, taskControls } from "./catalog.mjs";
import { drawKeyboard } from "./keyboard-view.mjs";
import { showWorkspace } from "./shell.mjs";
const $ = (id) => document.getElementById(id);
const option = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; return o; };
export function mountHome({ getProfile, usePreset, notify }) {
  let catalog, current, resizeTimer;
  const examples = [
    ["01 / Return", "Back to the task you left.", "Your builder is working on the export screen. Return opens that same conversation, so you can continue without hunting through tabs."],
    ["02 / Progress", "Know what needs your attention.", "The builder reports that its draft is ready for review. The status includes its source; an agent’s report is kept separate from verified test evidence."],
    ["03 / Review", "Put the work in front of your reviewer.", "Open the connected review target with the context you chose to share. Review what changed and the evidence before accepting a result."],
    ["04 / Handoff", "Tomorrow starts with a next step.", "Prepare a handoff: what changed, what was checked, what remains, and where to continue. You review the context before it goes to another target."]
  ];
  const exampleButtons = taskControls.map((control, i) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "secondary"; button.textContent = ["Return", "Progress", "Review", "Handoff"][i];
    button.setAttribute("aria-pressed", String(i === 0));
    button.addEventListener("click", () => { exampleButtons.forEach((b, n) => b.setAttribute("aria-pressed", String(n === i))); $("example-label").textContent = examples[i][0]; $("example-title").textContent = examples[i][1]; $("example-body").textContent = examples[i][2]; });
    return button;
  });
  $("example-controls").replaceChildren(...exampleButtons);
  function draw() { if (current) drawKeyboard($("catalog-keyboard"), current.portable.plan.profile, current.portable.plan.actions, { compact: true }); }
  function selections() { return [...$("catalog-physical-options").querySelectorAll(".part-options")].map((part) => [...part.querySelectorAll("select")].map((s) => Number(s.value))); }
  function preview(resetChoices = false) {
    current = null; $("use-standard-preset").disabled = true;
    const model = catalog.models.find((m) => m.id === $("catalog-model").value);
    $("catalog-note").textContent = model.note;
    $("catalog-source").href = model.product;
    if (!model.variants.length) {
      $("catalog-options").hidden = true; $("catalog-keyboard").replaceChildren(); $("catalog-keyboard").style.height = "140px";
      const message = document.createElement("p"); message.className = "board-empty"; message.textContent = "Proposed model · awaiting verified physical geometry"; $("catalog-keyboard").append(message);
      $("catalog-controls").replaceChildren(); $("catalog-evidence").textContent = "A physical configuration cannot be built from a product proposal. Existing board presets remain available."; return;
    }
    $("catalog-options").hidden = false;
    const variant = model.variants.find((v) => v.id === $("catalog-variant").value) ?? model.variants.find((v) => v.id === model.recommended);
    $("catalog-variant").value = variant.id;
    if (resetChoices) {
      const parts = presetOptions(catalog, model.id, variant.id).map((choices, part) => {
        const group = document.createElement("fieldset"); group.className = "part-options";
        const legend = document.createElement("legend"); legend.textContent = variant.parts.length > 1 ? `${part ? "Right" : "Left"} half` : "Physical options"; group.append(legend);
        choices.forEach((choice, i) => { const label = document.createElement("label"); label.textContent = choice.label; const select = document.createElement("select"); select.append(...choice.options.map((o, n) => option(String(n), o))); select.value = String(variant.parts[part].choices[i]); select.addEventListener("change", () => preview()); label.append(select); group.append(label); });
        return group;
      });
      $("catalog-physical-options").replaceChildren(...parts);
    }
    try {
      current = standardPreset(catalog, model.id, { variantId: variant.id, choices: selections(), typing: $("catalog-typing").value });
      draw(); $("catalog-controls").replaceChildren(...current.portable.plan.actions.map((action, i) => {
        const row = document.createElement("div"), kbd = document.createElement("kbd"), text = document.createElement("div"), title = document.createElement("strong"), detail = document.createElement("span");
        row.className = "starter-control";
        const key = current.portable.plan.profile.keys.find((k) => k.id === action.binding?.keyId);
        kbd.textContent = key ? `Super Ctrl ${key.label}` : "Choose key"; title.textContent = taskControls[i].label; detail.textContent = taskControls[i].detail; text.append(title, detail); row.append(kbd, text); return row;
      }));
      $("catalog-evidence").textContent = `${model.status === "development-reference" ? "Development reference. " : "Reference configuration. "}Previewing ${current.portable.plan.profile.keys.length} keys. Your keyboard and shortcuts change only after a separate live read and review.`;
      $("use-standard-preset").disabled = false;
    } catch (e) { $("catalog-evidence").textContent = e.message; $("catalog-keyboard").replaceChildren(); $("catalog-controls").replaceChildren(); notify(e.message); }
  }
  function chooseModel() {
    const model = catalog.models.find((m) => m.id === $("catalog-model").value);
    $("catalog-variant").replaceChildren(...model.variants.map((v) => option(v.id, v.label))); $("catalog-variant").value = model.recommended ?? ""; preview(true);
  }
  $("catalog-model").addEventListener("change", chooseModel);
  $("catalog-variant").addEventListener("change", () => preview(true)); $("catalog-typing").addEventListener("change", () => preview());
  $("use-standard-preset").addEventListener("click", () => {
    if (!current || !usePreset(current.portable)) return;
    showWorkspace("home"); $("home-setup-status").textContent = `${current.model.name}: four controls and the Keep my place workflow are in your editable plan. Next, read your actual typing layer and connect your tools. No shortcuts have been installed.`;
    $("setup-next").classList.add("setup-selected"); $("setup-next").scrollIntoView({ behavior: "smooth", block: "nearest" }); notify("Starting layout ready. Your typing and firmware have not changed.");
  });
  $("customize-setup").addEventListener("click", () => { if (!getProfile() && current && !usePreset(current.portable)) return; showWorkspace("keyboard"); });
  $("home-read-keyboard").addEventListener("click", () => { showWorkspace("keyboard"); const panel = $("discover-devices").closest("details"); panel.open = true; panel.scrollIntoView({ block: "nearest" }); $("discover-devices").click(); });
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 100); });
  fetch("/model-f-catalog.json").then((r) => { if (!r.ok) throw new Error("The offline model catalog is unavailable."); return r.json(); }).then((value) => {
    catalog = value; $("catalog-model").replaceChildren(...["Model F", "Beam Spring", "Proposed designs"].map((name) => { const group = document.createElement("optgroup"); group.label = name; group.append(...catalog.models.filter((m) => m.group === name).map((m) => option(m.id, `${m.name}${m.status !== "listed-model" ? " · proposed" : ""}`))); return group; }));
    $("catalog-model").value = "f77-classic";
    $("catalog-coverage").textContent = `${catalog.models.filter((m) => m.status === "listed-model").length} listed models · ${catalog.models.filter((m) => m.status !== "listed-model").length} proposed designs · checked ${catalog.checkedAt}`; chooseModel();
  }).catch((e) => { $("catalog-evidence").textContent = e.message; notify(e.message); });
}
