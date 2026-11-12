/** Reviewed Windows app navigation and normal Claude launch; no typing or account control. */
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { verifySuiteRelease } from "../../deployment/suite/release.mjs";
import { runRuntimeCommand } from "./runtime-command.mjs";
import { desktopEnvironment } from "./process-environment.mjs";

const targets = Object.freeze({
  "native-chatgpt.focus/v1": Object.freeze({ provider: "native-chatgpt", nativeProvider: "chatgpt_desktop", key: "nativeWindowsChatgpt", label: "ChatGPT" }),
  "native-vscode.focus/v1": Object.freeze({ provider: "native-vscode", nativeProvider: "vscode", key: "nativeWindowsVscode", label: "VS Code" }),
  "native-claude-desktop.focus/v1": Object.freeze({ provider: "claude-desktop", nativeProvider: "claude_desktop", key: "nativeWindowsClaude", label: "Claude Desktop" })
});
const targetFor = value => {
  if (typeof value !== "string" || !Object.hasOwn(targets, value)) throw Error("Native Windows focus for this application remains unfinished.");
  return targets[value];
};
const launchImplementation = "native-claude-desktop.launch/v1";
const launchTargetFor = value => {
  if (value !== launchImplementation) throw Error("Review only a normal native Claude Desktop launch.");
  return { ...targets["native-claude-desktop.focus/v1"], configurationImplementation: "native-claude-desktop.focus/v1" };
};
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scope = state => hash([state.policy, state.mode, state.modeSelectedAt ?? null, state.accounts, state.taskAuthorityEpoch ?? 0, state.nativeWindowsChatgpt ?? null, ...(state.nativeWindowsVscode ? [state.nativeWindowsVscode] : []), ...(state.nativeWindowsClaude ? [state.nativeWindowsClaude] : [])]);
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === keys.slice().sort().join();
const validOwner = value => exact(value, ["processId", "processStartTime"]) && Number.isSafeInteger(value.processId) && value.processId > 0 && value.processId <= 0x7fffffff && typeof value.processStartTime === "string" && /^[1-9][0-9]{0,19}$/.test(value.processStartTime) && BigInt(value.processStartTime) <= 0xffffffffffffffffn;
const same = (a, b) => hash(a) === hash(b);
// Windows implementations are loaded only after the platform/policy boundary.
// Linux packages keep their existing native compositor implementation.
const providerModule = () => import("../../apps/windows-companion/src/provider-desktop.ts");
const entryFor = async (target, path, signature) => {
  const module = await providerModule();
  return target.nativeProvider === "vscode" ? module.createWindowsEditorFocusTarget({ path, ...signature })
    : module.createFixedProviderDesktopCatalog({ [target.nativeProvider]: { path, ...signature } }).get(target.nativeProvider);
};
const signatureFor = identity => ({ signerSubject: identity.signerSubject, signerThumbprint: identity.signerThumbprint });
function exactSignatureProbe() {
  return { async inspect(path) {
    const { WindowsAuthenticodeSignatureProbe } = await providerModule();
    const root = process.env.SystemRoot;
    if (typeof root !== "string" || !/^[A-Za-z]:[\\/]/.test(root) || !win32.isAbsolute(root) || /[\0\r\n]/.test(root) || root.split(/[\\/]/).some(part => part === "." || part === "..")) throw Error("The exact Windows system directory is unavailable; no alternate signature runtime was selected.");
    return new WindowsAuthenticodeSignatureProbe().inspect(path);
  } };
}

async function packagedHelper() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const release = await verifySuiteRelease(root, { platform: "win32", checkRuntime: true });
  if (release.development) throw Error("Native focus requires a verified packaged Windows Suite.");
  const file = release.files.find(row => row.path === "runtime/hotkeys/Switchyard.Hotkeys.exe");
  if (!file) throw Error("The exact packaged Windows helper is unavailable.");
  return { path: join(root, file.path), sha256: file.sha256 };
}

export function validateNativeFocusOwnerExit(value, owner) {
  if (!validOwner(owner) || !exact(value, ["schema", "processId", "processStartTime", "state", "exited", "processAccessMask", "tokenAccessMask", "processTerminated", "windowFocused"])
    || value.schema !== "switchyard-native-focus-owner-result/v1" || value.processId !== owner.processId || value.processStartTime !== owner.processStartTime
    || typeof value.exited !== "boolean" || value.state !== (value.exited ? "exited" : "running") || value.processAccessMask !== (0x1000 | 0x100000)
    || value.tokenAccessMask !== 8 || value.processTerminated !== false || value.windowFocused !== false) throw Error("The original native focus helper exit observation did not verify.");
  return value.exited;
}

async function observeHelperExit(helper, owner, signal) {
  if (!validOwner(owner)) throw Error("The retained native focus helper identity is invalid.");
  const result = await runRuntimeCommand(helper.path, ["--native-desktop-owner-v1"], {
    windowsHelper: helper.path, cwd: dirname(helper.path), env: desktopEnvironment(), expectedExecutableSha256: helper.sha256,
    inputText: JSON.stringify({ schema: "switchyard-native-focus-owner-query/v1", ...owner }) + "\n",
    detailed: true, timeout: 10000, maxOutputBytes: 8192, signal
  });
  if (result.exitCode !== 0 || result.status !== "completed" || result.treeExitVerified !== true) throw Error("The original native focus helper exit remains unconfirmed.");
  return validateNativeFocusOwnerExit(JSON.parse(result.stdout), owner);
}

export function createWindowsNativeFocus({
  store, platform = process.platform, isActive = async () => true, now = Date.now,
  signatureProbe = exactSignatureProbe(), identityProbe = { inspect: async entry => new (await providerModule()).NodeProviderExecutableIdentityProbe(signatureProbe).inspect(entry) },
  helper = packagedHelper, observeExit = observeHelperExit,
  processFactory = async options => new (await import("../../apps/windows-companion/src/windows-provider-process.ts")).WindowsProviderDesktopProcessPort(options)
} = {}) {
  const reviews = new Map(), launchReviews = new Map(), pending = new Map(), ports = new Map(); let closed = false;
  const requirePlatform = () => { if (platform !== "win32") throw Error("This native focus configuration requires Windows."); };
  async function authorize(c, target) {
    requirePlatform();
    if (closed || !await isActive(c)) throw Error("Select the original native focus workspace before continuing.");
    await store.authorize(c, { provider: target.provider });
    return store.snapshot(c);
  }
  async function current(c, target, expected, signal, assertion) {
    if (signal?.aborted) throw Error("The native focus request was cancelled.");
    const state = await authorize(c, target);
    if (scope(state) !== expected) throw Error("The native focus workspace, account policy or reviewed application changed.");
    await assertion?.();
    return state;
  }
  const locked = fn => store.withResourceLock("native-focus", "current-user-desktop", fn);
  async function updateOperation(c, id, fn) {
    return store.update(c, "native-focus-operation", state => {
      const record = state.nativeFocusOperations?.find(row => row.id === id);
      if (!record) throw Error("The original native focus operation record is missing.");
      return fn(record, state);
    });
  }
  async function reconcile(native, c, id, signal) {
    for (const [key, entry] of ports) {
      if ((await entry.port.retireOwned()).stopped !== true) throw Error("The original native focus helper retirement remains unconfirmed. No replacement was started.");
      ports.delete(key);
    }
    for (const workspace of await store.list()) {
      for (const record of (await store.snapshot(workspace.id)).nativeFocusOperations ?? []) {
        if (record.id === id && workspace.id !== c) throw Error("The original native focus request belongs to another workspace.");
        for (const owned of record.helpers ?? []) {
          if (owned.stopped === true) continue;
          if (signal.aborted) throw Error("Native focus recovery was cancelled.");
          if (typeof owned.helperSha256 !== "string" || !/^[a-f0-9]{64}$/.test(owned.helperSha256) || !validOwner(owned.identity)) throw Error("Preserve the original native focus helper record; its exact executable or identity is invalid.");
          if (await observeExit(native, owned.identity, signal) !== true) throw Error("The original native focus helper has not verified exit. No replacement was started.");
          await updateOperation(workspace.id, record.id, row => {
            const item = row.helpers.find(value => same(value.identity, owned.identity));
            if (!item || item.helperSha256 !== owned.helperSha256) throw Error("The original helper retirement record changed.");
            item.stopped = true; item.stoppedAt = now();
            if (row.status !== "completed") row.status = row.effectAuthorized === false ? "refused" : "outcome-unconfirmed";
          });
        }
      }
    }
  }
  async function perform(c, id, kind, implementation, assertion, launchInput) {
    const target = kind === "launch" ? launchTargetFor(implementation) : targetFor(implementation), provider = target.provider;
    if (!uuid(id)) throw Error("Native focus needs an exact request UUID.");
    if (pending.has(c)) throw Error("Wait for this workspace's existing native focus request.");
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 20000);
    const operation = Promise.resolve().then(() => locked(async lease => {
      const before = await authorize(c, target), expected = scope(before), profile = before[target.key];
      if (!profile || profile.implementation !== (target.configurationImplementation ?? implementation) || !profile.identity) throw Error("Review and configure the exact Windows " + target.label + " executable first.");
      const native = await helper();
      await reconcile(native, c, id, controller.signal);
      const check = async () => { lease.assert(); return current(c, target, expected, controller.signal, assertion); };
      await check();
      const records = (await store.snapshot(c)).nativeFocusOperations ?? [], previous = records.find(row => row.id === id);
      if (previous) {
        if (previous.scope !== expected || (previous.implementation ?? "native-chatgpt.focus/v1") !== implementation || previous.kind !== kind || previous.status !== "completed" || !previous.result
          || kind === "launch" && (previous.launchReviewId !== launchInput.reviewId || previous.launchConfirmationDigest !== hash(launchInput.confirmation))) throw Error("The original native focus request cannot be replayed; its outcome or scope is uncertain.");
        return { ...previous.result, replayed: true };
      }
      const launchReview = kind === "launch" ? launchReviews.get(launchInput.reviewId) : null;
      const checkLaunchReview = async () => {
        if (kind === "launch" && (!launchReview || launchReviews.get(launchReview.id) !== launchReview || launchReview.c !== c || launchReview.implementation !== implementation
          || launchReview.scope !== expected || launchReview.confirmation !== launchInput.confirmation || launchReview.expiresAt <= now())) throw Error("The exact native launch review is missing, changed or expired.");
        await launchReview?.assertCurrent?.();
      };
      await checkLaunchReview();
      await store.update(c, "native-focus-reserve", state => {
        if (scope(state) !== expected) throw Error("The native focus scope changed before reservation.");
        const retained = (state.nativeFocusOperations ?? []).filter(row => !["completed", "refused"].includes(row.status) || row.helpers?.some(value => !value.stopped));
        const settled = (state.nativeFocusOperations ?? []).filter(row => !retained.includes(row)).slice(-63);
        if (retained.length >= 64) throw Error("Reconcile this workspace's unresolved native focus history first.");
        state.nativeFocusOperations = [...retained, ...settled, { id, kind, implementation, scope: expected, status: "reserved", effectAuthorized: false, at: now(), helpers: [],
          ...(kind === "launch" ? { launchReviewId: launchReview.id, launchConfirmationDigest: hash(launchInput.confirmation) } : {}) }];
      }, { provider });
      try {
        const processes = await processFactory({
          helperPath: native.path, helperSha256: native.sha256, ...(kind === "launch" ? { claudeLaunchOnly: true } : { focusOnly: true }),
          onHelperOwned: async identity => {
            await check();
            if (!validOwner(identity)) throw Error("The native focus helper owner did not verify.");
            await updateOperation(c, id, row => {
              if (row.helpers.some(value => !value.stopped) || row.helpers.length >= 2) throw Error("An original native focus helper still owns this operation.");
              row.helpers.push({ identity: structuredClone(identity), helperSha256: native.sha256, stopped: false }); row.status = "started";
            });
          },
          onHelperStopped: identity => updateOperation(c, id, row => {
            const item = row.helpers.find(value => same(value.identity, identity));
            // A rejected owner write sent no request. Never alter another owner.
            if (item) { item.stopped = true; item.stoppedAt = now(); }
          })
        });
        ports.set(id, { c, port: processes });
        const verifyImage = async () => {
          await check();
          const observed = await identityProbe.inspect(await entryFor(target, profile.identity.canonicalExecutablePath, signatureFor(profile.identity)));
          if (!same(observed, profile.identity)) throw Error("The reviewed native executable, signer or file identity changed.");
          await check();
        };
        await verifyImage();
        const rows = await processes.listRunning(profile.identity, controller.signal);
        if (kind === "launch" ? rows.length !== 0 : rows.length !== 1) throw Error(kind === "launch"
          ? "Claude Desktop already has an existing window. Use its separate focus control; no new application was launched."
          : "Open exactly one verified native application main window before using this connection.");
        const windowObservation = rows[0];
        let result = { available: true, implementation, provider, windowFocusVerified: false, accountVerified: false, projectVerified: false, taskResumptionVerified: false, modelPromptSubmitted: false };
        if (kind === "focus") {
          const focused = await processes.focusExisting({ provider: target.nativeProvider, operationId: id, identity: profile.identity, process: windowObservation, signal: controller.signal, shell: false, beforeEffect: async () => {
            await verifyImage();
            // Durable uncertainty begins before native focus authorization can
            // be sent. Earlier refusals cannot have focused the application.
            await updateOperation(c, id, row => { row.effectAuthorized = true; });
            await check();
          } });
          if (focused.processId !== windowObservation.processId) throw Error("The exact native focus process changed.");
          result = { ...result, status: "verified", windowFocusVerified: true, summary: "The exact reviewed Windows " + target.label + " window was focused and read back. Account, project, conversation and task resumption are not established." };
        }
        if (kind === "launch") {
          const launched = await processes.launch({ provider: target.nativeProvider, operationId: id, identity: profile.identity, args: [], requireDistinctSurface: false,
            signal: controller.signal, shell: false, beforeEffect: async () => {
              await verifyImage(); await checkLaunchReview(); launchReviews.delete(launchReview.id);
              await updateOperation(c, id, row => { row.effectAuthorized = true; });
              await check();
            } });
          if (!validOwner({ processId: launched.processId, processStartTime: launched.processStartTime }) || !/^hwnd:[a-f0-9]+$/i.test(launched.surfaceId) || launched.distinctSurface !== true) throw Error("The newly launched Claude process and window did not verify.");
          result = { ...result, status: "verified", applicationOpenedVerified: true, processId: launched.processId, processStartTime: launched.processStartTime, surfaceId: launched.surfaceId,
            summary: "The reviewed Windows Claude Desktop application opened one verified process and window. Account, project, conversation, task resumption and foreground focus are not established." };
        }
        await check();
        await updateOperation(c, id, (row, state) => {
          if (scope(state) !== expected) throw Error("The native focus scope changed before its result could be recorded.");
          if (row.helpers.some(value => !value.stopped)) throw Error("The original native focus helper retirement remains unconfirmed.");
          row.status = "completed"; row.result = result; row.finishedAt = now();
        });
        await check();
        return result;
      } catch (error) {
        if (launchReview) launchReviews.delete(launchReview.id);
        await updateOperation(c, id, row => { row.status = row.effectAuthorized === true ? "outcome-unconfirmed" : "refused"; row.finishedAt = now(); });
        throw error;
      }
    }));
    pending.set(c, { controller, operation });
    try { return await operation; }
    finally { clearTimeout(deadline); if (pending.get(c)?.operation === operation) pending.delete(c); }
  }
  return {
    async reviewLaunch(c, input, { assertCurrent } = {}) {
      if (!exact(input, ["implementation"])) throw Error("Review one exact native Claude Desktop launch without arguments.");
      const implementation = input.implementation, target = launchTargetFor(implementation), state = await authorize(c, target), expected = scope(state), profile = state[target.key];
      await assertCurrent?.();
      if (!profile || profile.implementation !== target.configurationImplementation || !profile.identity) throw Error("Configure the exact Windows Claude Desktop executable before reviewing its launch.");
      const observed = await identityProbe.inspect(await entryFor(target, profile.identity.canonicalExecutablePath, signatureFor(profile.identity)));
      if (!same(observed, profile.identity)) throw Error("The configured Claude executable changed; review its identity again.");
      await current(c, target, expected, undefined, assertCurrent);
      for (const [id, row] of launchReviews) if (row.expiresAt <= now()) launchReviews.delete(id);
      if (launchReviews.size >= 32) throw Error("Finish or let existing native launch reviews expire first.");
      const id = randomUUID(), confirmation = "Launch Windows Claude Desktop " + hash([id, observed]).slice(0, 12), expiresAt = now() + 300000;
      launchReviews.set(id, { id, c, implementation, scope: expected, confirmation, expiresAt, assertCurrent });
      return { status: "requires-confirmation", implementation, reviewId: id, confirmation, expiresAt, identity: structuredClone(observed), arguments: [], existingWindowPolicy: "refuse-new-launch", applicationLaunched: false, windowFocused: false };
    },
    async launch(c, input, { assertCurrent } = {}) {
      if (!exact(input, ["implementation", "reviewId", "confirmation", "requestId"]) || !uuid(input.reviewId) || !uuid(input.requestId) || typeof input.confirmation !== "string" || input.confirmation.length > 128) throw Error("Confirm one exact native launch review with its original request identity.");
      launchTargetFor(input.implementation);
      return perform(c, input.requestId, "launch", input.implementation, assertCurrent, input);
    },
    async review(c, input) {
      if (!exact(input, ["implementation", "executablePath"])) throw Error("Review one supported native Windows application and its exact executable path.");
      const implementation = input.implementation, target = targetFor(implementation);
      const state = await authorize(c, target), expected = scope(state);
      const candidate = await entryFor(target, input.executablePath, { signerSubject: "CN=Unreviewed", signerThumbprint: "a".repeat(40) });
      const signature = await signatureProbe.inspect(candidate.executablePath);
      const identity = await identityProbe.inspect(await entryFor(target, candidate.executablePath, signature));
      await current(c, target, expected);
      for (const [id, row] of reviews) if (row.expiresAt <= now()) reviews.delete(id);
      if (reviews.size >= 32) throw Error("Finish or let existing native application reviews expire first.");
      const id = randomUUID(), confirmation = "Trust Windows " + target.label + " " + hash(identity).slice(0, 12);
      const row = { id, c, implementation, scope: expected, identity: structuredClone(identity), confirmation, expiresAt: now() + 300000 }; reviews.set(id, row);
      return { status: "requires-confirmation", reviewId: id, implementation, identity: structuredClone(identity), confirmation, expiresAt: row.expiresAt, applicationLaunched: false, windowFocused: false };
    },
    async configure(c, input) {
      if (!exact(input, ["reviewId", "confirmation"]) || !uuid(input.reviewId)) throw Error("Confirm one exact reviewed native application.");
      const row = reviews.get(input.reviewId);
      if (!row || row.c !== c || row.confirmation !== input.confirmation || row.expiresAt <= now()) throw Error("The exact native application review is missing, changed or expired.");
      const implementation = row.implementation, target = targetFor(implementation), provider = target.provider;
      return locked(async lease => {
        const exactReview = () => { if (reviews.get(row.id) !== row || row.expiresAt <= now()) throw Error("The original native application review expired or was retired."); };
        exactReview();
        await current(c, target, row.scope); lease.assert();
        const observed = await identityProbe.inspect(await entryFor(target, row.identity.canonicalExecutablePath, signatureFor(row.identity)));
        if (!same(observed, row.identity)) throw Error("The reviewed application changed before configuration.");
        await current(c, target, row.scope); lease.assert(); exactReview(); reviews.delete(row.id);
        await store.update(c, "native-focus-configure", state => {
          if (scope(state) !== row.scope) throw Error("The native application review scope changed.");
          state[target.key] = { implementation, identity: structuredClone(row.identity), configuredAt: now() };
        }, { provider });
        return { configured: true, implementation, executableSha256: row.identity.executableSha256, applicationLaunched: false, windowFocused: false };
      });
    },
    inspect: (c, value) => {
      targetFor(value);
      return perform(c, randomUUID(), "inspect", value);
    },
    focus: (c, value, { requestId, assertCurrent } = {}) => {
      targetFor(value);
      return perform(c, requestId, "focus", value, assertCurrent);
    },
    async recover(c) {
      requirePlatform();
      if (pending.has(c)) throw Error("Wait for this workspace's existing native focus request.");
      const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 20000);
      const check = async () => { if (closed || controller.signal.aborted || !await isActive(c)) throw Error("Select the original workspace before observing native focus retirement."); };
      const operation = Promise.resolve().then(() => locked(async lease => {
          await check(); await store.snapshot(c); lease.assert();
          await reconcile(await helper(), c, randomUUID(), controller.signal);
          await check(); lease.assert();
          return { helpersRetired: true, originalFocusOutcomeVerified: false, applicationClosed: false, windowFocused: false };
      }));
      pending.set(c, { controller, operation });
      try { return await operation; }
      finally { clearTimeout(deadline); if (pending.get(c)?.operation === operation) pending.delete(c); }
    },
    async stopCompartment(c) {
      for (const [id, row] of reviews) if (row.c === c) reviews.delete(id);
      for (const [id, row] of launchReviews) if (row.c === c) launchReviews.delete(id);
      const active = pending.get(c); active?.controller.abort();
      await Promise.allSettled(active ? [active.operation] : []);
      let stopped = true;
      for (const [id, entry] of ports) if (entry.c === c) {
        if ((await entry.port.retireOwned()).stopped === true) ports.delete(id);
        else stopped = false;
      }
      return { stopped: stopped && ((await store.snapshot(c)).nativeFocusOperations ?? []).every(row => (row.helpers ?? []).every(owner => owner.stopped === true)), applicationClosed: false };
    },
    async close() {
      closed = true; reviews.clear(); launchReviews.clear();
      for (const active of pending.values()) active.controller.abort();
      const ids = new Set([...pending.keys(), ...[...ports.values()].map(entry => entry.c)]);
      if (platform === "win32") for (const workspace of await store.list()) {
        if (((await store.snapshot(workspace.id)).nativeFocusOperations ?? []).some(row => row.helpers?.some(owner => owner.stopped !== true))) ids.add(workspace.id);
      }
      const results = await Promise.all([...ids].map(c => this.stopCompartment(c)));
      if (results.some(result => !result.stopped)) throw Error("Original native focus helper retirement remains unconfirmed.");
    }
  };
}
