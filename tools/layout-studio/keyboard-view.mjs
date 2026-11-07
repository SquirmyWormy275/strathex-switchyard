import { boardBounds, outlinePoints } from "./geometry.mjs";
/** Shared actual geometry for the product preview and the editor. */
export function drawKeyboard(surface, profile, actions = [], { selectedKeyId = null, picking = false, onKey = null, compact = false } = {}) {
  surface.replaceChildren();
  const { width, height } = boardBounds(profile.keys), available = Math.max(240, surface.clientWidth - 28);
  const unit = Math.max(compact ? 12 : 26, Math.min(compact ? 40 : 56, Math.floor(available / width)));
  const pixel = (v) => Math.round(v * (window.devicePixelRatio || 1)) / (window.devicePixelRatio || 1);
  const inner = document.createElement("div"); inner.className = "keyboard-drawing";
  inner.style.width = `${Math.ceil(width * unit + 8)}px`; inner.style.height = `${Math.ceil(height * unit + 8)}px`;
  for (const key of profile.keys) {
    const assigned = actions.filter((a) => a.binding?.keyId === key.id), button = document.createElement(onKey ? "button" : "div");
    if (onKey) button.type = "button";
    button.className = `key${assigned.length ? " has-action" : ""}${selectedKeyId === key.id ? " selected-key" : ""}${picking ? " pick-target" : ""}${key.shape ? " shaped-key" : ""}`;
    button.style.left = `${pixel(key.x * unit)}px`; button.style.top = `${pixel(key.y * unit)}px`;
    button.style.width = `${pixel(key.w * unit - 3)}px`; button.style.height = `${pixel(key.h * unit - 3)}px`;
    if (key.rotation) { button.style.transform = `rotate(${key.rotation}deg)`; button.style.transformOrigin = "0 0"; }
    if (key.shape) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS(svg.namespaceURI, "path");
      svg.setAttribute("viewBox", `0 0 ${key.w * unit} ${key.h * unit}`); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("aria-hidden", "true");
      const points = outlinePoints(key).map(([x, y]) => [pixel(x * unit), pixel(y * unit)]);
      path.setAttribute("d", points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ") + " Z"); path.setAttribute("vector-effect", "non-scaling-stroke"); svg.append(path); button.append(svg);
      button.style.clipPath = `polygon(${outlinePoints(key).map(([x, y]) => `${x / key.w * 100}% ${y / key.h * 100}%`).join(",")})`;
    }
    const title = document.createElement("span"); title.textContent = key.label;
    button.append(title);
    if (!compact && assigned.length) { const hint = document.createElement("small"); hint.textContent = assigned[0].label; button.append(hint); }
    button.title = `${key.label} · ${key.baseKeycode ?? "typing layer unknown"}${assigned.length ? ` · ${assigned.map((a) => a.label).join(", ")}` : ""}`;
    if (onKey) { button.setAttribute("aria-label", button.title); button.addEventListener("click", () => onKey(key, assigned)); }
    inner.append(button);
  }
  surface.append(inner); surface.style.height = `${Math.max(compact ? 120 : 190, Math.ceil(height * unit + 36))}px`;
}
