import { api, setActiveCompartment } from "/connection.mjs";
const $ = (id) => document.getElementById(id);

export function mountSuite({ getProfile, loadProfile, previewProposal, notify, saved, onPolicy, onWorkflow }) {
  let compartment = "personal", state = null, conversationId = null, proposedWorkflow = null, saveTimer, recorder, stream, audioSession, segmentTimer, voicePending = Promise.resolve(), voicePaused = true;
  const lines = (id) => $(id).value.split("\n").map((s) => s.trim()).filter(Boolean);
  async function run(fn) { try { return await fn(); } catch (e) { $("suite-status").textContent = e.message; notify(e.message); return null; } }
  function workflowForm(workflow) { $("workflow-name").value = workflow.name; $("workflow-steps").value = workflow.steps.map((s) => typeof s === "string" ? s : s.label).join("\n"); $("workflow-roles").value = workflow.roles.map((r) => typeof r === "string" ? r : r.label).join("\n"); }
  async function refresh() {
    state = await api("/api/suite/snapshot", { compartment });
    onPolicy(state.policyRules.export);
    onWorkflow(state.workflow);
    $("operating-mode").value = state.mode ?? (state.policy === "work" ? "managed-companion" : "personal-companion");
    document.dispatchEvent(new CustomEvent("switchyard-compartment-state", { detail: state }));
    $("policy-summary").textContent = `${state.policy === "work" ? "Copilot-only Work" : "Personal"} · ${state.policyRules.providers.join(", ")} · ${state.policyRules.recording ? "recording allowed by policy" : "recording prohibited"} · ${state.policyRules.export ? "portable export allowed" : "exports prohibited"} · ${state.policyRules.retentionDays}-day session retention. This is an application routing boundary, not an OS sandbox.`;
    for (const id of ["export-json", "export-markdown", "copy-json", "copy-assistant-context"]) $(id).disabled = !state.policyRules.export || !getProfile();
    $("start-observation").disabled = !state.policyRules.recording;
    $("start-voice").disabled = !state.policyRules.recording;
    const provider = $("conversation-provider").value;
    $("conversation-provider").replaceChildren(...state.policyRules.providers.filter((p) => ["codex", "claude-code", "microsoft-365-copilot"].includes(p)).map((p) => { const o = document.createElement("option"); o.value = p; o.textContent = ({ codex: "Codex · installed account", "claude-code": "Claude Code · installed account", "microsoft-365-copilot": "Microsoft 365 Copilot · approved account" })[p]; return o; }));
    if ([...$("conversation-provider").options].some((o) => o.value === provider)) $("conversation-provider").value = provider;
    const roleSelection = $("role-picker").value, targetSelection = $("role-target").value;
    $("role-picker").replaceChildren(...state.workflow.roles.map((r) => { const o = document.createElement("option"); o.value = r.id; o.textContent = r.label; return o; }));
    if ([...$("role-picker").options].some((o) => o.value === roleSelection)) $("role-picker").value = roleSelection;
    $("role-target").replaceChildren(...[
      ...state.conversations.filter((c) => c.sessionId && state.policyRules.providers.includes(c.provider)).map((c) => ({ value: `${c.provider}|${c.id}`, label: `${c.provider} · exact conversation ${c.sessionId.slice(0, 10)}` })),
      ...state.agents.filter((a) => a.sessionId).map((a) => ({ value: `custom-agent|${a.id}`, label: `${a.name} · ${a.reportedStatus} · authenticated self-report` }))
    ].map((target) => { const o = document.createElement("option"); o.value = target.value; o.textContent = target.label; return o; }));
    if ([...$("role-target").options].some((o) => o.value === targetSelection)) $("role-target").value = targetSelection;
    $("role-summary").textContent = state.roleBindings?.length ? state.roleBindings.map((b) => `${state.workflow.roles.find((r) => r.id === b.roleId)?.label ?? b.roleId}: ${b.intent} → ${b.provider}`).join(" · ") : "Save workflow roles, connect a conversation or example, then bind an exact target. Missing or stale targets never launch a replacement.";
    const latestIntent = state.intentResults?.at(-1);
    if (latestIntent) $("role-result").textContent = `${latestIntent.intent}: ${latestIntent.result.reply ?? latestIntent.result.status ?? "reported"}. ${latestIntent.result.provenance ?? ""}`;
    const history = $("conversation-history"); history.replaceChildren();
    for (const c of state.conversations.slice(-4)) for (const m of c.messages) { const article = document.createElement("p"); article.className = `message ${m.role}`; const label = document.createElement("strong"); label.textContent = m.role === "user" ? "You" : c.provider; const content = document.createElement("span"); content.textContent = m.text; article.append(label, content); history.append(article); }
    const active = state.observations.find((o) => o.status === "recording" || o.status === "paused") ?? state.observations.at(-1);
    $("observation-status").textContent = active ? `${active.status} · ${active.events.length} marked events · ${active.sources.join(", ")}` : "No observation session. Nothing is being recorded.";
    for (const id of ["mark-observation", "pause-observation", "stop-observation", "delete-observation"]) $(id).disabled = !active;
    $("pause-observation").textContent = active?.status === "recording" ? "Pause" : "Resume";
    $("observation-summary").replaceChildren(...(state.observationSummaries.at(-1)?.suggestions ?? []).map((s) => { const p = document.createElement("p"); p.textContent = `${s.question} ${s.evidence}. ${s.provenance}.`; return p; }));
    const v = state.voice.at(-1);
    if (v && !recorder?.state?.includes("recording") && document.activeElement !== $("voice-transcript")) $("voice-transcript").value = v.reviewedTranscript || v.transcript;
    $("voice-status").textContent = v ? `${v.status} · ${v.chunks.filter((c) => c.status === "transcribed").length} transcribed segments · ${v.chunks.filter((c) => c.pendingAudio).length} saved audio segments awaiting retry` : "Local CPU transcription. Microphone starts only when you choose Start voice. Audio is removed after successful transcription; transcript stays encrypted until its retention period or deletion.";
    $("suite-status").textContent = "Private workspace connected. Saves use an independent OS-protected key for this compartment.";
    const previousProfile = $("saved-profile").value;
    const profiles = state.profiles?.length ? state.profiles.map((p) => p.profile) : state.profile ? [state.profile] : [];
    $("saved-profile").replaceChildren(...profiles.map((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; return o; }));
    if (profiles.some((p) => p.id === previousProfile)) $("saved-profile").value = previousProfile;
    else if (state.profile) $("saved-profile").value = state.profile.id;
    profileRevisions();
    $("profile-library-status").textContent = `${profiles.length} saved layouts · ${state.profileHistory?.length ?? 0} previous revisions. Opening a version changes the plan, not installed shortcuts or devices.`;
  }
  async function persist() {
    const p = getProfile(); if (!p || !state) return;
    const serialized = JSON.stringify(p), target = compartment;
    await api("/api/suite/profile/save", { compartment: target, profile: p });
    if (target === compartment && JSON.stringify(getProfile()) === serialized) {
      saved();
      if (p.workflow && JSON.stringify(state.workflow) !== JSON.stringify(p.workflow)) { await refresh(); workflowForm(state.workflow); }
    }
  }
  document.addEventListener("switchyard-plan-change", () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { void run(persist); }, 450); });
  $("save-workspace").addEventListener("click", () => run(async () => { await persist(); notify("Profile saved privately. It will reopen after restart."); }));
  function profileRevisions() {
    const id = $("saved-profile").value;
    const items = state?.profileHistory?.filter((r) => r.profile.id === id).toReversed() ?? [];
    $("profile-revision").replaceChildren(...[{ revision: "", label: "Current saved version" }, ...items.map((r) => ({ revision: r.revision, label: `${new Date(r.at).toLocaleString()} · ${r.profile.name}` }))].map((r) => { const o = document.createElement("option"); o.value = r.revision; o.textContent = r.label; return o; }));
  }
  $("saved-profile").addEventListener("change", profileRevisions);
  $("load-saved-profile").addEventListener("click", () => run(async () => {
    const profileId = $("saved-profile").value, revision = $("profile-revision").value || null;
    if (!profileId) throw new Error("Save a layout first.");
    clearTimeout(saveTimer); await persist();
    const p = await api("/api/suite/profile/select", { compartment, profileId, revision });
    loadProfile(p); await refresh(); workflowForm(state.workflow); notify("Saved layout opened. Device programming and installed shortcuts have not changed.");
  }));
  $("save-profile-copy").addEventListener("click", () => run(async () => {
    const p = getProfile(), name = $("profile-copy-name").value.trim();
    if (!p || !name) throw new Error("Open a layout and enter a name for its copy.");
    clearTimeout(saveTimer); await persist();
    const copy = { ...p, id: `profile-${crypto.randomUUID()}`, name };
    await api("/api/suite/profile/save", { compartment, profile: copy });
    loadProfile(copy); await refresh(); workflowForm(state.workflow); $("profile-copy-name").value = ""; notify("Separate layout saved privately. The previous profile remains available.");
  }));
  $("compartment-picker").addEventListener("change", () => run(async () => {
    if (!voicePaused || recorder?.state === "recording") { $("compartment-picker").value = compartment; throw new Error("Pause or stop voice before switching compartments."); }
    await voicePending; await persist(); compartment = $("compartment-picker").value; setActiveCompartment(compartment);
    await api("/api/suite/compartment/select", { compartment }); conversationId = null;
    await refresh(); workflowForm(state.workflow);
    if (state.profile) loadProfile(state.profile); else loadProfile(null);
  }));
  $("operating-mode").addEventListener("change", () => run(async () => {
    const mode = $("operating-mode").value;
    if (mode === "keyboard-only") { await releaseMicrophone(); if (audioSession) await api("/api/suite/voice/state", { compartment, id: audioSession, status: "paused" }); }
    await api("/api/suite/mode", { compartment, mode }); await refresh();
  }));
  $("create-work-compartment").addEventListener("click", () => run(async () => { await api("/api/suite/compartment/create", { compartment: "work", policy: "work" }); const bootstrap = await api("/api/suite/bootstrap", {}); fillCompartments(bootstrap.compartments); notify("Copilot-only Work compartment created with its own protected key. No work account or client data was accessed."); }));
  $("copilot-work-setup").addEventListener("click", () => run(async () => { await api("/api/suite/compartment/create", { compartment: "work", policy: "work" }); const bootstrap = await api("/api/suite/bootstrap", {}); fillCompartments(bootstrap.compartments); notify("Copilot-only Work is ready. Select it in the workspace menu; account enrollment remains a separate, deliberate step."); }));
  $("connect-copilot").addEventListener("click", () => run(async () => {
    const login = await api("/api/suite/copilot/login", { compartment, tenantId: $("copilot-tenant").value.trim(), clientId: $("copilot-client").value.trim(), approved: $("copilot-approved").checked });
    $("copilot-status").textContent = `Open ${login.verificationUrl} yourself and enter ${login.userCode}. Review Microsoft's requested permissions before consenting. This code expires in ${Math.floor(login.expiresIn / 60)} minutes.`;
    for (let n = 0; n < Math.floor(login.expiresIn / login.interval); n++) {
      await new Promise((resolve) => setTimeout(resolve, login.interval * 1000));
      const result = await api("/api/suite/copilot/poll", { compartment, loginId: login.loginId });
      if (result.status === "connected") { $("copilot-status").textContent = "Approved work account enrolled. Graph preview conversation capabilities will be checked on use. No GitHub Copilot or personal-provider fallback is enabled."; await refresh(); break; }
    }
  }));
  function fillCompartments(list) { $("compartment-picker").replaceChildren(...list.map((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.id === "work" ? "Work · Copilot only" : c.id === "personal" ? "Personal" : c.id; return o; })); $("compartment-picker").value = compartment; }
  $("save-workflow").addEventListener("click", () => run(async () => { const workflow = { name: $("workflow-name").value, steps: lines("workflow-steps"), roles: lines("workflow-roles") }; await api("/api/suite/workflow/save", { compartment, workflow }); proposedWorkflow = null; await refresh(); notify("Workflow saved. Steps and roles remain editable."); }));
  $("conversation-provider").addEventListener("change", () => { conversationId = null; $("design-status").textContent = "The next message starts a deliberate connection with the selected provider. Earlier conversations and key assignments are preserved."; });
  $("new-design-conversation").addEventListener("click", () => { conversationId = null; $("design-status").textContent = "Ready for a new conversation. Earlier conversations are kept in this compartment."; });
  $("refresh-agent-targets").addEventListener("click", () => run(refresh));
  for (const [button, example] of [["start-custom-example", "custom"], ["start-langchain-example", "langchain"]]) $(button).addEventListener("click", () => run(async () => { const r = await api("/api/suite/agents/example", { compartment, example }); $("role-result").textContent = `${r.status}. Refresh targets after its authenticated ready event.`; }));
  $("bind-agent-role").addEventListener("click", () => run(async () => { const [provider, targetId] = $("role-target").value.split("|"); await api("/api/suite/roles/bind", { compartment, provider, targetId, roleId: $("role-picker").value, intent: $("role-intent").value }); await refresh(); notify("Exact role target saved locally. Portable profiles keep the role meaning, without this account or session binding."); }));
  $("try-agent-role").addEventListener("click", () => run(async () => { const r = await api("/api/suite/roles/dispatch", { compartment, roleId: $("role-picker").value, intent: $("role-intent").value, content: $("role-handoff").value }); $("role-result").textContent = `${r.reply ?? r.status ?? "reported"}. ${r.provenance ?? ""}`; if (r.proposal) previewProposal(r.proposal); await refresh(); }));
  $("design-form").addEventListener("submit", (event) => { event.preventDefault(); void run(async () => {
    if (!getProfile()) throw new Error("Load your keyboard before asking for a key arrangement.");
    const message = $("design-message").value; $("send-design").disabled = true;
    $("design-status").textContent = `Connecting to ${$("conversation-provider").value} with this layout and your message. Tools are disabled for configuration design.`;
    try {
      await persist();
      const response = await api("/api/suite/design", { compartment, provider: $("conversation-provider").value, message, plan: getProfile().plan, conversationId });
      conversationId = response.conversationId; proposedWorkflow = response.workflow; workflowForm(proposedWorkflow);
      if (response.proposal) previewProposal(response.proposal);
      $("design-status").textContent = `${response.reply}\nReview the proposed layout above and the proposed process below. Save only what you want to keep.`;
      $("design-message").value = ""; await refresh();
    } finally { $("send-design").disabled = false; }
  }); });
  $("cancel-design").addEventListener("click", () => run(async () => { await api("/api/suite/design/cancel", { compartment, conversationId }); $("design-status").textContent = "Cancellation requested for the exact owned turn. Your draft is preserved."; }));
  $("start-observation").addEventListener("click", () => run(async () => { const sources = ["deliberate", ...($("observe-focus").checked ? ["foreground-category"] : [])]; await api("/api/suite/observation/start", { compartment, sources, exclusions: $("exclude-browser").checked ? ["browser"] : [], consent: true }); await refresh(); }));
  const observation = () => state?.observations.find((o) => ["recording", "paused"].includes(o.status)) ?? state?.observations.at(-1);
  $("mark-observation").addEventListener("click", () => run(async () => { await api("/api/suite/observation/mark", { compartment, id: observation()?.id, kind: $("observation-kind").value }); await refresh(); }));
  for (const [control, status] of [["pause-observation", null], ["stop-observation", "stopped"]]) $(control).addEventListener("click", () => run(async () => { const o = observation(); await api("/api/suite/observation/state", { compartment, id: o.id, status: status ?? (o.status === "recording" ? "paused" : "recording") }); await refresh(); }));
  $("delete-observation").addEventListener("click", () => run(async () => { await api("/api/suite/observation/delete", { compartment, id: observation()?.id }); await refresh(); }));

  async function sendSegment(blob, id, segmentCompartment, segmentSession) {
    if (!blob.size) return;
    if (blob.size > 175000) throw new Error("This audio segment is too large. Pause and retry a shorter segment; the current transcript is preserved.");
    const data = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (const byte of data) binary += String.fromCharCode(byte);
    await api("/api/suite/voice/segment", { compartment: segmentCompartment, id: segmentSession, chunkId: id, audio: btoa(binary) });
    await refresh();
  }
  async function releaseMicrophone() {
    voicePaused = true; clearTimeout(segmentTimer);
    const active = recorder;
    let stopped = Promise.resolve();
    if (active?.state === "recording") { stopped = new Promise((resolve) => active.addEventListener("stop", resolve, { once: true })); active.stop(); }
    for (const track of stream?.getTracks() ?? []) track.stop(); stream = null;
    await stopped; await voicePending;
  }
  function captureSegment() {
    if (voicePaused || !stream) return;
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000, ...(mimeType ? { mimeType } : {}) });
    const chunks = [], id = crypto.randomUUID(), segmentCompartment = compartment, segmentSession = audioSession, segmentRecorder = recorder;
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { voicePending = voicePending.then(() => sendSegment(new Blob(chunks, { type: segmentRecorder.mimeType }), id, segmentCompartment, segmentSession)).catch((e) => { voicePaused = true; clearTimeout(segmentTimer); if (recorder?.state === "recording") recorder.stop(); for (const track of stream?.getTracks() ?? []) track.stop(); stream = null; void api("/api/suite/voice/state", { compartment: segmentCompartment, id: segmentSession, status: "paused" }).catch(() => {}); $("voice-status").textContent = `Microphone paused. ${e.message}`; notify(e.message); }); if (!voicePaused) captureSegment(); };
    recorder.start(); segmentTimer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 20000);
  }
  $("start-voice").addEventListener("click", () => run(async () => {
    if (!voicePaused || recorder?.state === "recording") throw new Error("Voice is already recording. Pause or stop the current session first.");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("This browser does not support microphone recording. Import audio through the supported local transcription route instead.");
    const v = await api("/api/suite/voice/start", { compartment, consent: true }); audioSession = v.id;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); voicePaused = false; captureSegment(); $("voice-status").textContent = "Recording microphone to local CPU transcription. Pause or Stop at any time."; }
    catch (e) { await api("/api/suite/voice/state", { compartment, id: audioSession, status: "paused" }); throw e; }
  }));
  $("pause-voice").addEventListener("click", () => run(async () => {
    audioSession ??= state.voice.at(-1)?.id; if (!audioSession) throw new Error("Start a voice session first.");
    voicePaused = !voicePaused;
    if (voicePaused) { await releaseMicrophone(); await api("/api/suite/voice/state", { compartment, id: audioSession, status: "paused" }); }
    else { stream ??= await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); await api("/api/suite/voice/state", { compartment, id: audioSession, status: "recording" }); captureSegment(); }
    $("pause-voice").textContent = voicePaused ? "Resume voice" : "Pause voice";
  }));
  $("stop-voice").addEventListener("click", () => run(async () => { await releaseMicrophone(); audioSession ??= state.voice.at(-1)?.id; await api("/api/suite/voice/state", { compartment, id: audioSession, status: "stopped" }); await refresh(); }));
  $("review-transcript").addEventListener("click", () => run(async () => { await api("/api/suite/voice/review", { compartment, id: audioSession ?? state.voice.at(-1)?.id, transcript: $("voice-transcript").value }); $("design-message").value = $("voice-transcript").value; notify("Corrected transcript saved and placed in the design message for your review. Send it when ready."); }));
  $("delete-voice").addEventListener("click", () => run(async () => { await releaseMicrophone(); await api("/api/suite/voice/delete", { compartment, id: audioSession ?? state.voice.at(-1)?.id }); audioSession = null; $("voice-transcript").value = ""; await refresh(); }));
  $("retry-voice").addEventListener("click", () => run(async () => { await api("/api/suite/voice/retry", { compartment, id: audioSession ?? state.voice.at(-1)?.id }); await refresh(); }));
  window.addEventListener("pagehide", () => { voicePaused = true; clearTimeout(segmentTimer); for (const track of stream?.getTracks() ?? []) track.stop(); });
  const bootstrapWorkspace = () => run(async () => { const bootstrap = await api("/api/suite/bootstrap", {}); compartment = bootstrap.activeCompartment; setActiveCompartment(compartment); fillCompartments(bootstrap.compartments); $("local-voice-detail").textContent = bootstrap.voice.available ? bootstrap.voice.destination : bootstrap.voice.reason; await refresh(); workflowForm(state.workflow); if (state.profile && !getProfile()) loadProfile(state.profile); });
  document.addEventListener("switchyard-local-connected", bootstrapWorkspace);
  void bootstrapWorkspace();
  return { persist, refresh: () => run(refresh) };
}
