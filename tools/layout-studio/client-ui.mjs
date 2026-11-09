import { api } from "./connection.mjs";
const option = (value, label) => { const item = document.createElement("option"); item.value = value; item.textContent = label; return item; };
/** Documented client navigation stays distinct from account, task and editor control. */
export function mountClients({ notify, download }) {
  const $ = id => document.getElementById(id);
  let state = null, entries = [], launches = [], generation = 0, busy = false, reviewed = null;
  const selected = () => entries.find(entry => entry.id === $("client-picker").value);
  function invalidate() { generation++; reviewed = null; $("client-review-dialog").close(); controls(); }
  function controls() {
    const entry = selected(), permitted = !!entry?.policyPermitsProvider;
    $("client-picker").disabled = busy || !entries.length;
    $("refresh-clients").disabled = busy || !state;
    $("review-client-launch").disabled = busy || !permitted || !entry.companionModeSelected || !entry.recipePlatformSupported || !entry.capabilities.hostLaunchConnected;
    $("download-client-recipe").disabled = busy || !permitted || !state?.policyRules.export;
    $("confirm-client-launch").disabled = busy || !reviewed;
  }
  function render() {
    const entry = selected(); $("client-facts").replaceChildren();
    $("client-source").hidden = !entry;
    if (!entry) { $("client-launch-history").replaceChildren(); $("client-status").textContent = "Choose a documented client in this workspace."; controls(); return; }
    const availability = !entry.policyPermitsProvider ? "Unavailable under this workspace policy" : !entry.recipePlatformSupported ? "This platform is not supported by the recipe" : !entry.capabilities.hostLaunchConnected ? "Native launch integration is unfinished" : !entry.companionModeSelected ? "Choose companion mode to enable an explicit launch" : "Ready for an explicitly reviewed launch request";
    const facts = [["Surface", entry.surface], ["Destination", entry.recipe.target.url ?? entry.recipe.target.applicationId], ["Availability", availability], ["Before use", entry.requirements.join(". ")], ["Scope", entry.limits.join(". ")], ["Account and task", "Not verified or selected by opening this surface"]];
    $("client-facts").append(...facts.flatMap(([name, value]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = name; dd.textContent = value; return [dt, dd]; }));
    $("client-source").href = entry.source.url; $("client-source").textContent = `Vendor documentation · source checked ${entry.source.verifiedAt}`;
    $("client-launch-history").replaceChildren(...launches.filter(row => row.recipeId === entry.id).slice(-5).reverse().map(row => { const item = document.createElement("li"); item.textContent = `${row.result?.status ?? row.status} · native helper exit ${row.nativeOwnerStoppedVerified === true ? "verified" : "unconfirmed"}${row.cleanupPending ? " · cleanup pending" : ""}. ${row.result?.summary ?? "No application, account or task acceptance is inferred."}`; return item; }));
    controls();
  }
  async function load() {
    if (!state) return;
    const previous = $("client-picker").value; entries = []; launches = []; $("client-picker").replaceChildren(); invalidate(); render(); const version = generation, compartment = state.id;
    try {
      const [catalog, history] = await Promise.all([api("/api/suite/integrations/catalog", { compartment }), api("/api/suite/integrations/launches", { compartment })]);
      if (version !== generation || state?.id !== compartment) return;
      entries = catalog.entries; launches = history;
      $("client-picker").replaceChildren(...entries.map(entry => option(entry.id, entry.name + (entry.policyPermitsProvider ? "" : " · unavailable in this workspace"))));
      $("client-picker").value = entries.some(e => e.id === previous && e.policyPermitsProvider) ? previous : entries.find(e => e.policyPermitsProvider)?.id ?? entries[0]?.id ?? "";
      $("client-status").textContent = "Choose the exact product surface. Browsing this catalog opens no app and contacts no provider."; render();
    } catch (error) { if (version === generation) { entries = []; launches = []; render(); $("client-status").textContent = error.message; notify(error.message); } }
  }
  async function run(fn) { if (busy) return; busy = true; controls(); const version = generation, compartment = state?.id; try { await fn({ compartment, current: () => generation === version && state?.id === compartment }); } catch (error) { if (generation === version) { $("client-status").textContent = error.message; notify(error.message); } } finally { busy = false; controls(); } }
  $("client-picker").addEventListener("change", () => { invalidate(); render(); });
  $("refresh-clients").addEventListener("click", () => { void load(); });
  $("download-client-recipe").addEventListener("click", () => run(async ({ compartment, current }) => {
    const entry = selected(); if (!entry?.policyPermitsProvider || !state?.policyRules.export) return;
    const value = await api("/api/suite/integrations/recipe", { compartment, id: entry.id }); if (!current()) return;
    if (value.recipe.digest !== entry.recipe.digest) throw Error("The client recipe changed. Refresh and review it again.");
    download(`switchyard-${entry.id}.json`, JSON.stringify(value.recipe, null, 2) + "\n", "application/json");
    $("client-status").textContent = "Downloaded a declarative recipe. It includes no credential, account, session or execution approval.";
  }));
  $("review-client-launch").addEventListener("click", () => run(async ({ compartment, current }) => {
    const entry = selected(); if (!entry?.policyPermitsProvider || !entry.companionModeSelected || !entry.recipePlatformSupported || !entry.capabilities.hostLaunchConnected) return;
    const value = await api("/api/suite/integrations/recipe", { compartment, id: entry.id }); if (!current()) return;
    if (value.recipe.digest !== entry.recipe.digest) throw Error("The client recipe changed. Refresh and review it again.");
    reviewed = { id: entry.id, requestId: crypto.randomUUID() };
    $("client-review-summary").textContent = `Request ${entry.name}: ${entry.surface}\n\nDestination: ${value.recipe.target.url}\nWorkspace: ${compartment}\n\nThe operating system will receive this fixed web destination. Your browser may use its existing signed-in account; Switchyard does not verify or change that account. No repository, file, conversation or agent task is selected, and no prompt is submitted.\n\n${entry.requirements.join(". ")}.\n\n${entry.limits.join(". ")}.`;
    $("client-review-dialog").showModal();
  }));
  $("cancel-client-launch").addEventListener("click", () => { reviewed = null; $("client-review-dialog").close(); controls(); });
  $("client-review-dialog").addEventListener("close", () => { reviewed = null; controls(); });
  $("confirm-client-launch").addEventListener("click", () => run(async ({ compartment, current }) => {
    if (!reviewed) return; const request = reviewed; reviewed = null; $("client-review-dialog").close();
    try {
      const result = await api("/api/suite/integrations/launch", { compartment, ...request }); if (!current()) return;
      $("client-status").textContent = result.status === "launch-requested" ? "The operating system accepted the launch request. Check the opened page and its account yourself; application opening and exact-task attachment are not verified." : `Launch result: ${result.status}. No automatic retry was made; check the external application before requesting another launch.`;
    } finally {
      if (current()) { try { const history = await api("/api/suite/integrations/launches", { compartment }); if (current()) { launches = history; render(); } } catch (error) { if (current()) notify(`Launch history unavailable: ${error.message}`); } }
    }
  }));
  document.addEventListener("switchyard-workspace-changing", () => { state = null; entries = []; launches = []; invalidate(); render(); });
  document.addEventListener("switchyard-compartment-state", event => { state = event.detail; void load(); });
  controls();
}

/** Exact native navigation. Reading saved setup never probes or focuses a window. */
export function mountNativeFocus({ notify }) {
  const $ = id => document.getElementById(id);
  let state = null, catalog = null, generation = 0, busy = false, reviewed = null;
  const selected = () => catalog?.entries.find(row => row.implementation === $("native-app-picker").value);
  const current = (version, c) => generation === version && state?.id === c;
  function invalidate() { generation++; reviewed = null; $("native-app-review-dialog").close(); controls(); }
  function controls() {
    const allowed = !!catalog?.supported && !!catalog?.permitted, windows = catalog?.platform === "win32";
    $("native-app-picker").disabled = busy || !catalog;
    $("refresh-native-apps").disabled = busy || !state;
    $("native-app-setup").hidden = !windows;
    $("native-app-path").disabled = busy || !allowed;
    $("review-native-app-setup").disabled = busy || !allowed || !windows || !$("native-app-path").value.trim();
    $("review-native-app-focus").disabled = busy || !allowed || !selected()?.configured;
    $("recover-native-app").hidden = !windows;
    $("recover-native-app").disabled = busy || !windows || !catalog.history.some(row => !row.helpersRetired);
    $("confirm-native-app-review").disabled = busy || !reviewed;
  }
  function render() {
    const app = selected();
    $("native-app-detail").textContent = !app ? "Connect a workspace to see supported native apps." : !catalog.supported ? "Native window navigation is not implemented for this platform." : !catalog.permitted ? "Native app navigation requires a Personal workspace in companion mode." : catalog.platform === "linux" ? `${app.name} uses its fixed local executable and an exact current-user main window. ChatGPT uses the repaired native launcher. Open the app before returning to it.` : app.identity ? `Saved ${app.name} executable: ${app.identity.executablePath}\nSHA-256: ${app.identity.sha256}\nSigner: ${app.identity.signer}\nInstallation changes require a new review.` : `Review the installed ${app.name} executable before returning to its window.`;
    $("native-app-history").replaceChildren(...(catalog?.history ?? []).filter(row => row.implementation === app?.implementation).slice(-5).reverse().map(row => {
      const item = document.createElement("li"); item.textContent = `${row.kind} · ${row.status} · request ${row.requestId}\nHelper retirement ${row.helpersRetired ? "verified" : "unconfirmed"}. ${row.summary ?? (row.effectAuthorized ? "The effect may have occurred. No automatic retry is made." : "No focus authorization was recorded.")}`; return item;
    }));
    controls();
  }
  async function load({ preserveStatus = false } = {}) {
    if (!state) return;
    const choice = $("native-app-picker").value, c = state.id; catalog = null; invalidate(); render(); const version = generation;
    try {
      const value = await api("/api/suite/native-focus/catalog", { compartment: c }); if (!current(version, c)) return;
      catalog = value; $("native-app-picker").replaceChildren(...value.entries.map(row => option(row.implementation, row.name)));
      if (value.entries.some(row => row.implementation === choice)) $("native-app-picker").value = choice;
      if (!preserveStatus) $("native-app-status").textContent = "Saved setup loaded. No app was opened, inspected or focused.";
      render();
    } catch (error) { if (current(version, c)) { $("native-app-status").textContent = error.message; notify(error.message); } }
  }
  async function run(fn) {
    if (busy) return; busy = true; controls(); const version = generation, c = state?.id;
    try { await fn({ c, valid: () => current(version, c) }); }
    catch (error) { if (current(version, c)) { $("native-app-status").textContent = error.message; notify(error.message); } }
    finally { busy = false; controls(); }
  }
  function show(kind, value, summary) {
    reviewed = { kind, ...value }; $("native-app-review-summary").textContent = summary;
    $("confirm-native-app-review").textContent = kind === "configure" ? "Save this exact application" : kind === "recover" ? "Check original helper retirement" : "Return to this open app";
    $("native-app-review-dialog").showModal(); controls();
  }
  $("refresh-native-apps").addEventListener("click", () => { void load(); });
  $("native-app-picker").addEventListener("change", () => { $("native-app-path").value = ""; invalidate(); render(); });
  $("native-app-path").addEventListener("input", () => { invalidate(); controls(); });
  $("review-native-app-setup").addEventListener("click", () => run(async ({ c, valid }) => {
    const app = selected(); if (!catalog?.permitted || catalog.platform !== "win32" || !app) return;
    const review = await api("/api/suite/native-focus/review", { compartment: c, implementation: app.implementation, executablePath: $("native-app-path").value.trim() }); if (!valid()) return;
    show("configure", { reviewId: review.reviewId, confirmation: review.confirmation, implementation: app.implementation, sha256: review.identity.executableSha256 }, `Save ${app.name} for workspace ${c}\n\nExecutable: ${review.identity.canonicalExecutablePath}\nSHA-256: ${review.identity.executableSha256}\nSigner: ${review.identity.signerSubject}\nCertificate: ${review.identity.signerThumbprint}\nExpires: ${new Date(review.expiresAt).toISOString()}\n\nThis saves an exact local executable identity. It does not open the app, focus a window, change an account or attach a task.`);
  }));
  $("review-native-app-focus").addEventListener("click", () => {
    const app = selected(); if (busy || !catalog?.permitted || !catalog.supported || !app?.configured) return;
    show("focus", { implementation: app.implementation, requestId: crypto.randomUUID() }, `Return to the open ${app.name} app in workspace ${state.id}\n\nSwitchyard will verify the current app process and its single main window, then focus and read back that window. A missing, ambiguous or changed target refuses. No app is started.\n\nThis chooses the app's current verified main window, not a particular account, project, conversation or coding task. It sends no text and does not resume work.`);
  });
  $("recover-native-app").addEventListener("click", () => {
    if (busy || catalog?.platform !== "win32") return;
    show("recover", {}, `Check retained helper retirement in workspace ${state.id}\n\nObserve the exact original Switchyard helpers. This does not retry focus, close the external app, or turn an uncertain earlier effect into a verified success.`);
  });
  $("cancel-native-app-review").addEventListener("click", () => { reviewed = null; $("native-app-review-dialog").close(); controls(); });
  $("native-app-review-dialog").addEventListener("close", () => { if (!$("native-app-review-dialog").open) { reviewed = null; controls(); } });
  $("confirm-native-app-review").addEventListener("click", () => run(async ({ c, valid }) => {
    if (!reviewed) return; const review = reviewed; reviewed = null; $("native-app-review-dialog").close();
    try {
      const result = review.kind === "configure" ? await api("/api/suite/native-focus/configure", { compartment: c, reviewId: review.reviewId, confirmation: review.confirmation }) : review.kind === "recover" ? await api("/api/suite/native-focus/recover", { compartment: c }) : await api("/api/suite/native-focus/focus", { compartment: c, implementation: review.implementation, requestId: review.requestId });
      if (!valid()) return;
      if (review.kind === "configure") { if (result.configured !== true || result.executableSha256 !== review.sha256) throw Error("The saved application acknowledgement did not match this exact review."); $("native-app-path").value = ""; $("native-app-status").textContent = "Exact application saved. Open it before returning to its window."; }
      else if (review.kind === "recover") { if (result.helpersRetired !== true) throw Error("Original helper retirement is still unconfirmed."); $("native-app-status").textContent = "Original helpers retired. Earlier uncertain focus outcomes remain unverified; the external app was not closed."; }
      else { if (result.windowFocusVerified !== true || result.taskResumptionVerified !== false) throw Error("The focus acknowledgement did not verify; no repeat was attempted."); $("native-app-status").textContent = result.summary; }
    } catch (error) {
      if (valid()) { const message = `${error.message} ${review.kind === "configure" ? "Saved setup is refreshed below; the confirmation is not replayed." : review.kind === "focus" ? `Request ${review.requestId}. Focus may have occurred if its reply was lost. Check the app before another deliberate request.` : "The original helpers remain subject to independent exit verification."}`; $("native-app-status").textContent = message; notify(message); }
    } finally {
      if (valid()) {
        await load({ preserveStatus: true });
        // Refresh the shared saved setup after either a confirmed save or a
        // lost acknowledgement, so shortcut choices use server readback.
        if (review.kind === "configure" && state?.id === c) document.dispatchEvent(new Event("switchyard-refresh-request"));
      }
    }
  }));
  document.addEventListener("switchyard-workspace-changing", () => { state = null; catalog = null; $("native-app-path").value = ""; $("native-app-status").textContent = "Choose a workspace."; invalidate(); render(); });
  document.addEventListener("switchyard-compartment-state", event => { state = event.detail; $("native-app-path").value = ""; void load(); });
  render();
}
