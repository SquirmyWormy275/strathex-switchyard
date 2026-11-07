/** Reviewed host authority for exact task-owned paths; native model permissions stay unchanged. */
import { randomUUID } from "node:crypto";
import { AuthorityLedger } from "../../packages/control-plane/src/authority.ts";
import { scopeHash, suiteConfirmations } from "./confirmations.mjs";
import { verifyRepositoryIdentity } from "./coding-task-identity.mjs";
import { createRepositoryInspection } from "./repository-inspection.mjs";
import { connectedExecutionActions, linuxShieldActions } from "./repository-execution-actions.mjs";
import { ignoredTreeRoots } from "./ignored-tree-policy.mjs";
import { gitIndexPaths, gitIndexTreeFromEntries, gitIndexWindowsRawLimit } from "./git-index-inputs.mjs";
import { historySelection } from "./git-history-inputs.mjs";
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const taskDigest = t => scopeHash([t.id, t.provider, t.sessionId, t.repositoryRoot, t.repositoryIdentity, t.accountFingerprint, t.status, t.nativeTransport, t.nativeIdentityVerified, t.launchPolicy]);
const workspaceDigest = s => scopeHash([s.id, s.policy, s.mode, s.modeSelectedAt ?? null, s.accounts, s.taskAuthorityEpoch ?? 0]);
const prohibited = ["pr_upsert", "pr_merge", "direct_main", "run_target", "debug_target", "plan_approval"];
function path(value) {
  if (typeof value !== "string" || value.length > 512 || /[\\\0\r\n:*?\[\]]/.test(value) || value.startsWith("/") || value.split("/").some(p => !p || /[\x00-\x1f\x7f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(p) || p === "." || p === ".." || p.toLowerCase() === ".git")) throw new Error("Choose literal repository-relative file paths without traversal or platform aliases.");
  return value;
}
function paths(value, field, max = 256) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Choose a bounded ${field} list.`);
  const output = value.map(path); if (new Set(output.map(p => process.platform === "win32" ? p.toLowerCase() : p)).size !== output.length) throw new Error(`The ${field} list repeats a path.`); return output.sort();
}
function proposal(input, executionActions = []) {
  if (!uuid(input.taskId) || typeof input.planRevision !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(input.planRevision)) throw new Error("Select one exact task UUID and a bounded plan revision.");
  const ownedPaths = paths(input.paths, "owned paths"); if (!ownedPaths.length) throw new Error("Review at least one exact task-owned file.");
  const lifetimeMinutes = input.lifetimeMinutes ?? 15;
  if (!Number.isSafeInteger(lifetimeMinutes) || lifetimeMinutes < 1 || lifetimeMinutes > 60) throw new Error("Choose an authority lifetime of 1–60 minutes.");
  const actions = input.actions ?? ["local_commit"];
  if (!Array.isArray(actions) || !actions.length || actions.length > 2 || new Set(actions).size !== actions.length || actions.some(a => !["local_commit", ...executionActions].includes(a))) throw new Error("Only host-mediated local commit and explicitly connected execution actions are available in this route.");
  const classifications = input.classifications ?? {};
  if (!classifications || typeof classifications !== "object" || Array.isArray(classifications) || Object.keys(classifications).some(key => !["includedUntracked", "excludedUntracked", "includedIgnored", "excludedIgnored", "excludedIgnoredTrees"].includes(key))) throw Error("Use only the closed file classification fields.");
  const includedUntracked = paths(classifications.includedUntracked ?? [], "included untracked files"), excludedUntracked = paths(classifications.excludedUntracked ?? [], "excluded untracked files"), includedIgnored = paths(classifications.includedIgnored ?? [], "read-only ignored scanner inputs"), excludedIgnored = paths(classifications.excludedIgnored ?? [], "excluded ignored files");
  const all = [...includedUntracked, ...excludedUntracked, ...includedIgnored, ...excludedIgnored];
  if (new Set(all.map(p => process.platform === "win32" ? p.toLowerCase() : p)).size !== all.length) throw new Error("Every untracked or ignored path needs exactly one classification.");
  if (includedIgnored.length && (actions.some(action => !linuxShieldActions.includes(action)) || includedIgnored.some(p => !ownedPaths.includes(p)))) throw Error("Ignored files may be explicitly owned only as read-only inputs to the pinned Shield scanner; commit, Run and pipeline authority are refused.");
  const excludedIgnoredTrees = ignoredTreeRoots(classifications.excludedIgnoredTrees ?? []);
  if (excludedIgnoredTrees.length && (actions.some(action => !linuxShieldActions.includes(action)) || [...all, ...ownedPaths].some(path => excludedIgnoredTrees.some(root => { const p = path.toLowerCase(), r = root.toLowerCase(); return p === r || p.startsWith(r + "/"); })))) throw Error("Generated-tree exclusions are explicit Shield-only policy outside every owned or individually classified path; commit, Run and pipeline authority are refused.");
  return { taskId: input.taskId, planRevision: input.planRevision, paths: ownedPaths, lifetimeMinutes, actions: [...actions].sort(), classifications: { includedUntracked, excludedUntracked, ...(includedIgnored.length ? { includedIgnored } : {}), excludedIgnored, ...(excludedIgnoredTrees.length ? { excludedIgnoredTrees } : {}) } };
}
function taskIn(s, id) {
  const t = s.codingSessions?.find(t => t.id === id);
  if (!t || t.schema !== "switchyard-coding-session/v1" || !["codex", "claude-code"].includes(t.provider) || t.status !== "registered" || !t.sessionId || !t.repositoryIdentity || !/^[a-f0-9]{64}$/.test(t.accountFingerprint ?? "") || !["owned-stdio", "owned-print"].includes(t.nativeTransport) || t.provider === "claude-code" && t.nativeIdentityVerified !== true) throw new Error("Bind a verified native coding task before reviewing host authority.");
  if (s.codingTurns?.some(turn => turn.taskId === id && (["reserved", "submitting", "submitted", "outcome-unconfirmed", "cancellation-requested", "interrupted"].includes(turn.status) || turn.ownedRuntime && turn.ownedRuntimeStoppedVerified !== true))) throw new Error("Settle this task's uncertain turn and owned process before reviewing host authority.");
  return t;
}
function ledger(state, now) {
  state.taskAuthorityJournal ??= [];
  return new AuthorityLedger({
    readEntries: async () => structuredClone(state.taskAuthorityJournal),
    transaction: async fn => fn({ readEntries: async () => structuredClone(state.taskAuthorityJournal), append: async (kind, payload) => {
      if (state.taskAuthorityJournal.length >= 512) throw new Error("The authority journal is full. Existing grants were preserved.");
      const entry = { schemaVersion: 1, sequence: (state.taskAuthorityJournal.at(-1)?.sequence ?? 0) + 1, id: randomUUID(), kind, at: new Date(now()).toISOString(), payload: structuredClone(payload) };
      entry.hash = scopeHash(entry); state.taskAuthorityJournal.push(entry); return structuredClone(entry);
    } })
  }, { clock: () => new Date(now()).toISOString() });
}
/** Receipt-time check over already locked protected state; performs no nested store I/O. */
export async function assertTaskAuthorityReceiptState(state, review, receipt, now = Date.now) {
  const record=state.taskAuthorities?.find(record=>record.id===review.authorityId);
  if(!record||record.grant.revokedAt||state.policy!=="personal"||state.mode!=="personal-companion"||record.taskDigest!==review.taskDigest||record.workspaceDigest!==review.workspaceDigest||workspaceDigest(state)!==review.workspaceDigest||record.targetSnapshot.id!==review.targetSnapshotId||receipt.authorityId!==record.id||receipt.action!==review.action||receipt.targetSnapshotId!==review.targetSnapshotId)throw Error("The exact task/account/workspace authority changed before receipt commit.");
  const task=taskIn(state,record.taskId);
  if(taskDigest(task)!==record.taskDigest||task.id!==review.taskId||task.sessionId!==review.sessionId||task.repositoryRoot!==review.repositoryRoot)throw Error("The exact native task binding changed before receipt commit.");
  const decision=await ledger(state,now).evaluate({authorityId:record.id,repositoryRoot:task.repositoryRoot,sessionId:task.sessionId,taskId:task.id,planRevision:record.grant.planRevision,action:review.action});
  if(!decision.allowed)throw Error("The exact execution authority was revoked, expired or changed before receipt commit.");
}
export function createTaskAuthority({ store, checkNative, isActive = async () => true, inspection = createRepositoryInspection({ store, ownerKind: "task-authority" }), localCommitExecutionImplemented = false, executionActions = [], now = () => Date.now() } = {}) {
  if (!Array.isArray(executionActions) || new Set(executionActions).size!==executionActions.length || executionActions.some(a => !connectedExecutionActions("linux").includes(a))) throw new Error("Choose only execution actions connected by this host implementation.");
  const generations = new Map(), pending = new Set(), seen = new Set(); let closed = false;
  const current = (c, generation) => { if (closed || generation !== (generations.get(c) ?? 0)) throw new Error("This task authority operation was stopped."); };
  async function access(c, id, generation, expectedProvider) {
    current(c, generation); if (!await isActive(c)) throw new Error("Select this workspace before reviewing task authority.");
    const state = await store.snapshot(c, expectedProvider ? { provider: expectedProvider } : undefined), task = taskIn(state, id);
    if (expectedProvider) { if (task.provider !== expectedProvider) throw new Error("The exact native provider binding changed. Review again."); }
    else await store.authorize(c, { provider: task.provider });
    current(c, generation);
    if (state.policy !== "personal" || state.mode !== "personal-companion") throw new Error("Local task authority requires the permitted Personal companion workspace.");
    await verifyRepositoryIdentity(task); return { state, task };
  }
  async function capture(c, proposed, generation) {
    const { state, task } = await access(c, proposed.taskId, generation), binding = taskDigest(task), workspace = workspaceDigest(state);
    if (typeof checkNative !== "function") throw new Error("The native task identity verifier is unavailable.");
    await checkNative(c, task);
    const authorize = async () => { const fresh = await access(c, task.id, generation, task.provider); if (taskDigest(fresh.task) !== binding || workspaceDigest(fresh.state) !== workspace) throw new Error("The exact task, account or workspace policy changed. Review again."); };
    await authorize(); const result = await inspection.capture(c, task, proposed.classifications, authorize); await authorize(); await checkNative(c, task); await authorize();
    const { snapshot, files } = result;
    if (snapshot.completeness !== "complete") throw new Error("The repository snapshot is incomplete. Classify every untracked/ignored input and keep files within supported inspection bounds before reviewing authority.");
    if (!snapshot.defaultBranch || !snapshot.branch || snapshot.branch === snapshot.defaultBranch || snapshot.detached) throw new Error("Select a verified non-default feature branch before reviewing local commit authority.");
    if (Object.keys(snapshot.submodules).length) throw new Error("Task authority for repositories with submodules is not implemented yet.");
    const selectedIgnored = proposed.classifications.includedIgnored ?? [];
    if (selectedIgnored.length && proposed.actions.some(action => !linuxShieldActions.includes(action))) throw Error("Ignored input ownership cannot authorize general execution or commits.");
    const tracked = new Set(files.tracked.map(f => f.path)), included = new Set([...files.untracked, ...files.ignored.filter(f => selectedIgnored.includes(f.path))].filter(f => f.classification === "included").map(f => f.path));
    if (proposed.paths.some(p => !tracked.has(p) && !included.has(p))) throw new Error("Each task-owned file must be tracked or explicitly included in this exact snapshot.");
    const actualUntracked = new Set(files.untracked.map(f => f.path)), actualIgnored = new Set(files.ignored.map(f => f.path));
    if ([...proposed.classifications.includedUntracked, ...proposed.classifications.excludedUntracked].some(p => !actualUntracked.has(p)) || [...selectedIgnored, ...proposed.classifications.excludedIgnored, ...(proposed.classifications.excludedIgnoredTrees ?? [])].some(p => !actualIgnored.has(p))) throw new Error("A reviewed input classification no longer matches the actual repository.");
    return { task, binding, workspace, snapshot, proposed, files };
  }
  async function exclusive(c, fn) {
    if (pending.has(c)) throw new Error("Wait for the current task authority inspection to settle.");
    pending.add(c); seen.add(c); try { return await fn(generations.get(c) ?? 0); } finally { pending.delete(c); }
  }
  const scope = (c, result) => scopeHash(["switchyard-task-authority/v1", c, result.binding, result.workspace, result.snapshot.id, result.proposed]);
  const view = record => ({ ...structuredClone(record), status: record.grant.revokedAt ? "revoked" : Date.parse(record.grant.expiresAt) <= now() ? "expired" : "issued", targetCurrentness: "requires-revalidation", nativePermissionsChanged: false, providerTaskCompletionVerified: false, localCommitExecutionImplemented: Boolean(localCommitExecutionImplemented), connectedExecutionActions: [...executionActions] });
  async function scannerInventory(c, input, generation) {
    const { state, task } = await access(c, input.taskId, generation), binding = taskDigest(task), workspace = workspaceDigest(state);
    if (typeof checkNative !== "function" || typeof inspection.scannerInputs !== "function") throw Error("The native scanner inventory verifier is unavailable.");
    const authorize = async () => { const fresh = await access(c, task.id, generation, task.provider); if (taskDigest(fresh.task) !== binding || workspaceDigest(fresh.state) !== workspace) throw Error("The exact task, account or workspace changed during scanner inventory."); };
    await checkNative(c, task); await authorize();
    const report = await inspection.scannerInputs(c, task, authorize);
    await authorize(); await checkNative(c, task); await authorize();
    return { report, task, binding, workspace };
  }
  async function reviewCaptured(c, result, generation) {
    current(c, generation);
    const confirmation = await suiteConfirmations(store, c, result.task.provider, now).issue({ action: "issue_task_authority", sessionId: result.task.sessionId, targetSnapshotId: result.snapshot.id, scopeDigest: scope(c, result),
      reason: "Authorize only the displayed connected host actions for these literal files, plan revision, native task/account and repository snapshot. Explicitly included ignored files are read-only inputs to the pinned Shield scanner, never commit or general execution inputs. Provider tools and native permissions stay unchanged. Every effect still needs its separate exact review." + (result.proposed.classifications.excludedIgnoredTrees?.length ? " The displayed ignored generated trees are excluded by explicit Shield-only policy: their directory identities are witnessed, their contents are not scanned or hashed, and this cannot establish a complete security pass." : ""), reauthenticated: false });
    current(c, generation); return { status: "requires-confirmation", confirmation, scope: { ...result.proposed, provider: result.task.provider, sessionId: result.task.sessionId, accountFingerprint: result.task.accountFingerprint, repositoryRoot: result.task.repositoryRoot, repositoryIdentity: result.task.repositoryIdentity, targetSnapshot: result.snapshot, allowedActions: result.proposed.actions }, nativePermissionsChanged: false };
  }
  return {
    async reviewScanner(c, input) { return exclusive(c, async generation => {
      if (!input || Object.keys(input).some(key => !["taskId", "compartment", "action", "planRevision", "lifetimeMinutes", "includeIndex"].includes(key)) || input.compartment !== undefined && input.compartment !== c || Object.hasOwn(input, "includeIndex") && typeof input.includeIndex !== "boolean" || !linuxShieldActions.includes(input.action)) throw Error("Prepare only one connected Shield action for one exact task; includeIndex must be a boolean, and custom paths, exclusions and imported approvals require their separate review.");
      // Validate action/revision/lifetime before any native query; real paths
      // replace this validation-only placeholder after the bounded inventory.
      const base = proposal({ ...input, paths: ["placeholder"], actions: [input.action] }, executionActions);
      const inventory = await scannerInventory(c, input, generation), rows = inventory.report.rows;
      if (rows.some(row => row.recommendation === "needs-classification")) throw Error("Ignored paths still require explicit classification. Use the scanner input preview and exact file review.");
      const selected = rows.filter(row => row.kind === "file-path"), proposed = proposal({ ...base, paths: selected.map(row => row.path), classifications: {
        includedUntracked: selected.filter(row => row.source === "untracked").map(row => row.path),
        includedIgnored: selected.filter(row => row.source === "ignored").map(row => row.path),
        excludedIgnoredTrees: rows.filter(row => row.recommendation === "review-build-tree-exclusion").map(row => row.path)
      } }, executionActions);
      const result = await capture(c, proposed, generation);
      const capturedPaths = [...result.files.tracked, ...result.files.untracked, ...result.files.ignored.filter(file => file.classification === "included")].map(file => file.path).sort();
      if (result.snapshot.head !== inventory.report.head || result.binding !== inventory.binding || result.workspace !== inventory.workspace || JSON.stringify(capturedPaths) !== JSON.stringify(proposed.paths) || result.files.tracked.some(file => file.state === "tracked_missing")) throw Error("The complete proposed scanner file set, revision or task scope changed or has missing files. Review again.");
      const preparation = { policy: "bounded-current-files/v1", inventoryDigest: inventory.report.metadataDigest, fileCount: proposed.paths.length, excludedTreeCount: proposed.classifications.excludedIgnoredTrees?.length ?? 0, scanPerformed: false, authorityGranted: false, securityCoverageComplete: false };
      if (input.includeIndex === true) {
        const selected = gitIndexPaths(result.files.tracked.map(file => file.path));
        if (proposed.paths.length + selected.length > 256) throw Error("The combined current and staged scanner inputs exceed the 256-file bound.");
        if (typeof inspection.indexInputs !== "function") throw Error("The native index input verifier is unavailable.");
        const authorize = async () => {
          const fresh = await access(c, result.task.id, generation, result.task.provider);
          if (taskDigest(fresh.task) !== result.binding || workspaceDigest(fresh.state) !== result.workspace) throw Error("The exact task, account or workspace changed during automatic index preparation.");
        };
        await checkNative(c, result.task); await authorize();
        const witnessed = await inspection.indexInputs(c, result.task, selected, authorize);
        await authorize(); await checkNative(c, result.task); await authorize();
        const entries = witnessed.rows.map(({ path, mode, objectId }) => ({ path, mode, objectId }));
        if (JSON.stringify(gitIndexPaths(entries.map(row => row.path))) !== JSON.stringify(selected) || witnessed.head !== result.snapshot.head || gitIndexTreeFromEntries(entries) !== result.snapshot.indexTree) throw Error("The witnessed index tree does not match the complete reviewed index tree. Review again.");
        if (process.platform === "win32" && witnessed.rows.reduce((sum, row) => sum + row.size, 0) > gitIndexWindowsRawLimit) throw Error("The staged scanner inputs exceed the Windows 320 KiB transport subset.");
        const refreshed = await capture(c, proposed, generation);
        if (refreshed.snapshot.id !== result.snapshot.id || refreshed.binding !== result.binding || refreshed.workspace !== result.workspace) throw Error("The scanner target changed after index witnessing. Review again.");
        Object.assign(preparation, { policy: "bounded-current-and-index/v1", indexTree: result.snapshot.indexTree, indexMetadataSha256: witnessed.indexMetadataSha256,
          indexInputs: witnessed.rows.map(row => ({ path: ".switchyard-index/" + row.path, sha256: row.sha256, size: row.size, source: { kind: "git-index", path: row.path, objectId: row.objectId, mode: row.mode } })) });
      }
      return { ...await reviewCaptured(c, result, generation), preparation };
    }); },
    async historyInputs(c,input){return exclusive(c,async generation=>{
      if(!input||Object.keys(input).some(key=>!["taskId","compartment","paths","depth"].includes(key))||!uuid(input.taskId)||input.compartment!==undefined&&input.compartment!==c)throw Error("Witness only named bounded history inputs for one bound task; arbitrary commits, refs, commands and policies are refused.");
      const selected=historySelection(input.paths,input.depth),{state,task}=await access(c,input.taskId,generation),binding=taskDigest(task),workspace=workspaceDigest(state);
      if(typeof checkNative!=="function"||typeof inspection.historyInputs!=="function")throw Error("The native history input verifier is unavailable.");
      const authorize=async()=>{const fresh=await access(c,task.id,generation,task.provider);if(taskDigest(fresh.task)!==binding||workspaceDigest(fresh.state)!==workspace)throw Error("The exact task, account or workspace changed during history witnessing.");};
      await checkNative(c,task);await authorize();const result=await inspection.historyInputs(c,task,selected.paths,selected.depth,authorize);await authorize();await checkNative(c,task);await authorize();return{...result,taskId:task.id,provider:task.provider,nativePermissionsChanged:false};
    });},
    async useHistoryInputs(c,id,action,paths,depth,consume){return exclusive(c,async generation=>{
      if(!["shield_codebase_audit","release_shield"].includes(action)||typeof consume!=="function"||typeof inspection.useHistoryInputs!=="function"||typeof checkNative!=="function")throw Error("Private history bytes require the connected Codebase Audit or Release Shield path.");
      const selected=historySelection(paths,depth),initial=await this.assertCurrent(c,id,action),binding=initial.record.taskDigest,workspace=initial.record.workspaceDigest;
      if(selected.paths.some(path=>!initial.record.proposal.paths.includes(path)))throw Error("Every historical source path must belong to the exact task-owned file grant.");
      const authorize=async()=>{current(c,generation);const fresh=await this.assertCurrent(c,id,action);if(fresh.record.taskDigest!==binding||fresh.record.workspaceDigest!==workspace)throw Error("The reviewed history task or workspace binding changed.");};
      await checkNative(c,initial.task);await authorize();const result=await inspection.useHistoryInputs(c,initial.task,selected.paths,selected.depth,consume,authorize);await authorize();await checkNative(c,initial.task);await authorize();return result;
    });},
    async useIndexInputs(c, id, action, selectedPaths, consume) { return exclusive(c, async generation => {
      if (!linuxShieldActions.includes(action) || typeof consume !== "function" || typeof inspection.useIndexInputs !== "function" || typeof checkNative !== "function") throw Error("Private index input consumption is available only to the connected pinned Shield scanner.");
      const selected = gitIndexPaths(selectedPaths), initial = await this.assertCurrent(c, id, action), binding = initial.record.taskDigest, workspace = initial.record.workspaceDigest;
      if (selected.some(path => !initial.record.proposal.paths.includes(path))) throw Error("Every index source must belong to the exact task-owned file grant.");
      const authorize = async () => {
        current(c, generation); const fresh = await this.assertCurrent(c, id, action);
        if (fresh.record.taskDigest !== binding || fresh.record.workspaceDigest !== workspace) throw Error("The reviewed index task or workspace binding changed.");
      };
      await checkNative(c, initial.task); await authorize();
      const result = await inspection.useIndexInputs(c, initial.task, selected, consume, authorize);
      await authorize(); await checkNative(c, initial.task); await authorize(); return result;
    }); },
    async indexInputs(c, input) { return exclusive(c, async generation => {
      if (!input || Object.keys(input).some(key => !["taskId", "compartment", "paths"].includes(key)) || !uuid(input.taskId) || input.compartment !== undefined && input.compartment !== c) throw Error("Witness only named index inputs for one exact bound task; commands, object IDs and policies are refused.");
      const selected = gitIndexPaths(input.paths), { state, task } = await access(c, input.taskId, generation), binding = taskDigest(task), workspace = workspaceDigest(state);
      if (typeof checkNative !== "function" || typeof inspection.indexInputs !== "function") throw Error("The native index input verifier is unavailable.");
      const authorize = async () => {
        const fresh = await access(c, task.id, generation, task.provider);
        if (taskDigest(fresh.task) !== binding || workspaceDigest(fresh.state) !== workspace) throw Error("The exact task, account or workspace changed during index input witnessing.");
      };
      await checkNative(c, task); await authorize();
      const result = await inspection.indexInputs(c, task, selected, authorize);
      await authorize(); await checkNative(c, task); await authorize();
      return { ...result, taskId: task.id, provider: task.provider, nativePermissionsChanged: false };
    }); },
    async scannerInputs(c, input) { return exclusive(c, async generation => {
      if (!input || Object.keys(input).some(key => !["taskId", "compartment"].includes(key)) || !uuid(input.taskId) || input.compartment !== undefined && input.compartment !== c) throw Error("Inspect scanner inputs for one exact bound task; arbitrary paths, commands and policies are refused.");
      const { report, task } = await scannerInventory(c, input, generation);
      return { ...report, taskId: task.id, provider: task.provider, nativePermissionsChanged: false };
    }); },
    /** Host ports only. No public route accepts a grant, snapshot or native identity. */
    authorityLedger(c) {
      return new AuthorityLedger({
        readEntries: async () => (await store.snapshot(c)).taskAuthorityJournal ?? [],
        transaction: async () => { throw new Error("Issue and revoke task authority only through its separately reviewed host routes."); }
      }, { clock: () => new Date(now()).toISOString() });
    },
    async assertCurrent(c, id, action = "local_commit") {
      const generation = generations.get(c) ?? 0, s = await store.snapshot(c), record = s.taskAuthorities?.find(r => r.id === id);
      if (!record) throw new Error("That scoped task authority is unavailable.");
      const { state, task } = await access(c, record.taskId, generation, taskIn(s, record.taskId).provider), decision = await ledger(state, now).evaluate({ authorityId: id, repositoryRoot: record.grant.repositoryRoot, sessionId: record.grant.sessionId, taskId: record.taskId, planRevision: record.grant.planRevision, action });
      if (!decision.allowed || taskDigest(task) !== record.taskDigest || workspaceDigest(state) !== record.workspaceDigest) throw new Error("The exact task authority, native binding, account or workspace policy changed.");
      current(c, generation); return { task, record: structuredClone(record) };
    },
    async resolve(c, id, action = "local_commit") { return exclusive(c, async generation => {
      const state = await store.snapshot(c), record = state.taskAuthorities?.find(r => r.id === id);
      if (!record) throw new Error("That scoped task authority is unavailable.");
      const decision = await ledger(state, now).evaluate({ authorityId: id, repositoryRoot: record.grant.repositoryRoot, sessionId: record.grant.sessionId, taskId: record.taskId, planRevision: record.grant.planRevision, action });
      if (!decision.allowed) throw new Error(decision.reason);
      const actual = await capture(c, record.proposal, generation), fresh = await store.snapshot(c), latest = await ledger(fresh, now).evaluate({ authorityId: id, repositoryRoot: record.grant.repositoryRoot, sessionId: record.grant.sessionId, taskId: record.taskId, planRevision: record.grant.planRevision, action });
      current(c, generation);
      if (!latest.allowed || actual.binding !== record.taskDigest || actual.workspace !== record.workspaceDigest || actual.snapshot.id !== record.targetSnapshot.id) throw new Error("The exact task authority target changed. Review a new grant; this one was not redirected.");
      return { ...actual, record: structuredClone(record) };
    }); },
    async review(c, input) { return exclusive(c, async generation => {
      return reviewCaptured(c, await capture(c, proposal(input, executionActions), generation), generation);
    }); },
    async issue(c, input) { return exclusive(c, async generation => {
      if (!uuid(input.token)) throw new Error("Use the exact one-use approval from this task authority review.");
      const result = await capture(c, proposal(input, executionActions), generation);
      const decision = await suiteConfirmations(store, c, result.task.provider, now).consume({ action: "issue_task_authority", sessionId: result.task.sessionId, targetSnapshotId: result.snapshot.id, scopeDigest: scope(c, result), token: input.token });
      if (!decision.allowed) throw new Error(decision.reason);
      return store.update(c, "task-authority-issue", async s => {
        current(c, generation); if (taskDigest(taskIn(s, result.task.id)) !== result.binding || workspaceDigest(s) !== result.workspace) throw new Error("The reviewed task authority changed before issuance.");
        const all = s.taskAuthorities ?? [], live = all.filter(r => !r.grant.revokedAt && Date.parse(r.grant.expiresAt) > now());
        const history = all.filter(r => !live.includes(r)).slice(-16);
        s.taskAuthorities = [...live, ...history];
        const retained = new Set(s.taskAuthorities.map(r => r.id));
        s.taskAuthorityJournal = (s.taskAuthorityJournal ?? []).filter(e => retained.has(e.payload.grant?.id ?? e.payload.authorityId));
        if (s.taskAuthorities.length >= 64) throw new Error("The protected task authority inventory is full; existing records were preserved.");
        const grant = await ledger(s, now).issue({ repositoryRoot: result.task.repositoryRoot, sessionId: result.task.sessionId, taskId: result.task.id, planRevision: result.proposed.planRevision, allowedActions: result.proposed.actions, prohibitedActions: prohibited.filter(a => !result.proposed.actions.includes(a)), issuedBy: "authenticated-local-review", expiresAt: new Date(now() + result.proposed.lifetimeMinutes * 60000).toISOString() });
        current(c, generation); const record = { schema: "switchyard-task-authority/v1", id: grant.id, taskId: result.task.id, taskDigest: result.binding, workspaceDigest: result.workspace, grant, targetSnapshot: result.snapshot, proposal: result.proposed }; s.taskAuthorities.push(record); return view(record);
      }, { provider: result.task.provider });
    }); },
    async list(c) { return ((await store.snapshot(c)).taskAuthorities ?? []).map(view); },
    async revoke(c, id) {
      if (!uuid(id)) throw new Error("Choose the exact local authority UUID.");
      return store.update(c, "task-authority-revoke", async s => { const record = s.taskAuthorities?.find(r => r.id === id); if (!record) throw new Error("That authority is unavailable in this workspace."); record.grant = await ledger(s, now).revoke(id, "Explicit local operator revocation"); return view(record); });
    },
    async revalidate(c, id) { return exclusive(c, async generation => {
      const s = await store.snapshot(c), record = s.taskAuthorities?.find(r => r.id === id);
      if (!record) throw new Error("That authority is unavailable in this workspace.");
      const action = record.grant.allowedActions[0];
      const decision = await ledger(s, now).evaluate({ authorityId: id, repositoryRoot: record.grant.repositoryRoot, sessionId: record.grant.sessionId, taskId: record.taskId, planRevision: record.grant.planRevision, action });
      if (!decision.allowed) return { allowed: false, reason: decision.reason, nativePermissionsChanged: false };
      const actual = await capture(c, record.proposal, generation);
      const fresh = await store.snapshot(c), latest = await ledger(fresh, now).evaluate({ authorityId: id, repositoryRoot: record.grant.repositoryRoot, sessionId: record.grant.sessionId, taskId: record.taskId, planRevision: record.grant.planRevision, action });
      current(c, generation);
      const allowed = latest.allowed && actual.binding === record.taskDigest && actual.workspace === record.workspaceDigest && actual.snapshot.id === record.targetSnapshot.id;
      return { allowed, reason: !latest.allowed ? latest.reason : allowed ? "The exact scoped authority and repository snapshot remain current; a separately reviewed commit effect is still required." : "The task, policy or repository changed. Issue a newly reviewed authority; this grant was not redirected.", targetSnapshotId: actual.snapshot.id, nativePermissionsChanged: false, localCommitExecutionImplemented: Boolean(localCommitExecutionImplemented) };
    }); },
    async stopCompartment(c) {
      generations.set(c, (generations.get(c) ?? 0) + 1);
      const stopped = await inspection.stopCompartment(c);
      await store.update(c, "task-authority-suspend", async s => { s.taskAuthorityEpoch = (s.taskAuthorityEpoch ?? 0) + 1; for (const record of s.taskAuthorities ?? []) if (!record.grant.revokedAt) record.grant = await ledger(s, now).revoke(record.id, "Workspace authority was suspended"); });
      return stopped;
    },
    async close() { closed = true; await inspection.close(); for (const c of seen) { await store.update(c, "task-authority-shutdown", async s => { s.taskAuthorityEpoch = (s.taskAuthorityEpoch ?? 0) + 1; for (const r of s.taskAuthorities ?? []) if (!r.grant.revokedAt) r.grant = await ledger(s, now).revoke(r.id, "Owning suite closed"); }); } }
  };
}
