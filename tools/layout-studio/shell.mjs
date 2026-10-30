export function showWorkspace(view) {
  for (const panel of document.querySelectorAll("[data-workspace-view]")) panel.hidden = panel.dataset.workspaceView !== view;
  for (const button of document.querySelectorAll("[data-view]")) { if (button.dataset.view === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); }
  if (view === "keyboard") window.dispatchEvent(new Event("resize"));
  if (view === "home") window.dispatchEvent(new Event("resize"));
}
export function showInspector(view) {
  for (const panel of document.querySelectorAll("[data-inspector-panel]")) panel.hidden = panel.dataset.inspectorPanel !== view;
  for (const button of document.querySelectorAll("[data-inspector]")) { if (button.dataset.inspector === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); }
}
for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => showWorkspace(button.dataset.view));
for (const button of document.querySelectorAll("[data-inspector]")) button.addEventListener("click", () => showInspector(button.dataset.inspector));
document.querySelector(".wordmark").addEventListener("click", (event) => { event.preventDefault(); showWorkspace("home"); });
document.getElementById("open-profile").addEventListener("click", () => document.getElementById("profile-dialog").showModal());
document.getElementById("close-profile").addEventListener("click", () => document.getElementById("profile-dialog").close());
