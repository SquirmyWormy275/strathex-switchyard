/** Fixed NTFS scanner controls with durable ownership of every native helper. */
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { directoryIdentity } from "./private-fs.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { scopeHash } from "./confirmations.mjs";

const schema = "switchyard-windows-scanner-save/v1", ownerSchema = "switchyard-windows-scanner-save-owner/v1";
const nativeHelper = fileURLToPath(new URL("../../runtime/hotkeys/Switchyard.Hotkeys.exe", import.meta.url));
const names = ["engine.mjs", "scanner.json", "advisory.json", "request.json", "recipe.json"];
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const identity = value => exact(value, ["device", "inode"]) && [value.device, value.inode].every(v => typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n);
const same = (a, b) => identity(a) && identity(b) && a.device === b.device && a.inode === b.inode;
const metadata = (draft, file) => ({ path: file.path.slice(draft.directory.length + 1), sha256: file.sha256, size: file.size });

export function validateWindowsScannerDraft(draft) {
  if (!uuid(draft?.id) || draft.directory !== "switchyard-scan-" + draft.id || typeof draft.repositoryRoot !== "string" || draft.repositoryRoot.length > 2048 || !Array.isArray(draft.files) || ![4, 5].includes(draft.files.length)) throw Error("Choose one exact generated Windows scanner draft.");
  const found = new Set();
  for (const file of draft.files) {
    const name = file.path?.slice(draft.directory.length + 1);
    if (!file.path?.startsWith(draft.directory + "/") || !names.includes(name) || found.has(name) || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 320 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error("Windows scanner control files must use the fixed names and existing 320 KiB private-pipe bound.");
    found.add(name);
    if (Object.hasOwn(file, "content") && (typeof file.content !== "string" || Buffer.byteLength(file.content) !== file.size || sha(file.content) !== file.sha256)) throw Error("The Windows scanner control bytes changed.");
  }
  if (names.filter(name => name !== "advisory.json").some(name => !found.has(name))) throw Error("The exact Windows scanner control set is incomplete.");
}

export function createWindowsScannerRecipeFiles({ store, platform = process.platform, helper = nativeHelper, command = (exe, args, options) => runRuntimeCommand(exe, args, { ...options, windowsHelper: helper }), guardianStopped = scope => runtimeGuardianStopped(scope, { windowsHelper: helper }) } = {}) {
  const resources = new Map(), generations = new Map(), seen = new Set(); let closed = false;
  const rowIn = (s, id) => { const row = s.scannerRecipeNativeOwners?.find(row => row.id === id); if (!row || row.schema !== ownerSchema) throw Error("Preserve the original Windows scanner helper owner record."); return row; };
  const update = (c, id, sequence, operation, fn) => store.update(c, operation, s => { const row = rowIn(s, id); if (row.sequence !== sequence) throw Error("The exact Windows scanner helper sequence changed."); return fn(row); });
  async function retire(c) {
    seen.add(c); let stopped = true;
    for (const row of (await store.snapshot(c)).scannerRecipeNativeOwners ?? []) {
      if (row.stoppedVerified === true) continue;
      if (row.schema !== ownerSchema || !uuid(row.id) || !uuid(row.sequence)) throw Error("Preserve unfamiliar Windows scanner helper ownership.");
      if (resources.has(c) || !row.ownedRuntime || !await guardianStopped(row.ownedRuntime).catch(() => false)) { stopped = false; continue; }
      await update(c, row.id, row.sequence, "scanner-native-exit-observed", value => { value.stoppedVerified = true; value.status = "stopped"; });
    }
    return { stopped };
  }
  async function call(c, draft, request, authorize) {
    if (platform !== "win32") throw Error("The native Windows scanner file boundary requires Windows.");
    const text = JSON.stringify(request); if (Buffer.byteLength(text) > 524288) throw Error("The Windows scanner request exceeds its existing private-pipe bound.");
    const digest = sha(text), generation = generations.get(c) ?? 0;
    if (resources.has(c)) throw Error("Wait for the exact Windows scanner helper to retire.");
    const resource = { controller: new AbortController(), clients: new Set(), done: null }; resources.set(c, resource); seen.add(c);
    const check = async () => {
      if (closed || generation !== (generations.get(c) ?? 0) || resource.controller.signal.aborted) throw Error("The Windows scanner filesystem operation was stopped.");
      const state = await store.snapshot(c); if (state.policy !== "personal") throw Error("Windows scanner files require the original Personal workspace.");
      await authorize();
    };
    let sequence, owner;
    resource.done = store.withResourceLock("repository-execution", scopeHash([ownerSchema, c]), async lease => {
      const guard = async () => { lease.assert(); await check(); lease.assert(); };
      await guard();
      // Previous native ownership must be settled before another helper starts.
      const previous = (await store.snapshot(c)).scannerRecipeNativeOwners ?? [];
      for (const row of previous) if (row.stoppedVerified !== true) {
        if (!row.ownedRuntime || !await guardianStopped(row.ownedRuntime).catch(() => false)) throw Error("The original Windows scanner helper exit is unconfirmed; preserve its output.");
        await update(c, row.id, row.sequence, "scanner-native-exit-observed", value => { value.stoppedVerified = true; value.status = "stopped"; });
      }
      sequence = randomUUID();
      await store.update(c, "scanner-native-reserved", s => {
        s.scannerRecipeNativeOwners ??= []; const old = s.scannerRecipeNativeOwners.find(row => row.id === draft.id);
        if (old && (old.schema !== ownerSchema || old.stoppedVerified !== true) || !old && s.scannerRecipeNativeOwners.length >= 32) throw Error("Reconcile the original Windows scanner helper history before another operation.");
        const value = { schema: ownerSchema, id: draft.id, sequence, operation: request.operation, requestSha256: digest, status: "reserved", stoppedVerified: false, ownedRuntime: null };
        if (old) Object.assign(old, value); else s.scannerRecipeNativeOwners.push(value);
      });
      await guard();
      const result = await runOwnedNativeCommand({ executable: helper, args: ["--scanner-recipe-files"], cwd: draft.repositoryRoot, env: {}, text, resource, signal: resource.controller.signal, timeout: 45000, maxOutputBytes: 4096, captureStderrBytes: 1024, command, guardianStopped,
        onReady: async scope => {
          await guard(); owner = scope;
          await update(c, draft.id, sequence, "scanner-native-ready", row => { if (row.status !== "reserved" || row.ownedRuntime) throw Error("The Windows scanner helper readiness changed."); row.ownedRuntime = scope; row.status = "running"; });
          await guard();
        },
        onStopped: async scope => {
          if (!owner || JSON.stringify(scope) !== JSON.stringify(owner)) throw Error("The Windows scanner helper retirement identity changed.");
          await update(c, draft.id, sequence, "scanner-native-stopped", row => { if (JSON.stringify(row.ownedRuntime) !== JSON.stringify(scope)) throw Error("The protected Windows scanner owner changed."); row.stoppedVerified = true; row.status = "stopped"; });
        }
      });
      if (result.status !== "completed" || result.exitCode !== 0 || result.outputTruncated === true) throw Error("The exact Windows scanner filesystem operation did not complete.");
      const proof = JSON.parse(result.stdout);
      if (!exact(proof, ["schema", "operationId", "operation", "requestSha256", "rootIdentity", "directoryIdentity", "files", "authorityGranted", "scanPerformed"]) || proof.schema !== schema || proof.operationId !== draft.id || proof.operation !== request.operation || proof.requestSha256 !== digest || !same(proof.rootIdentity, request.rootIdentity) || !identity(proof.directoryIdentity) || request.directoryIdentity && !same(proof.directoryIdentity, request.directoryIdentity) || proof.authorityGranted !== false || proof.scanPerformed !== false || !Array.isArray(proof.files)) throw Error("The exact Windows scanner helper result did not verify.");
      const expected = request.operation === "create-directory" ? [] : request.operation === "write-file" ? [...request.existingFiles, request.file] : request.files;
      if (proof.files.length !== expected.length) throw Error("The Windows scanner helper returned another file set.");
      for (const [index, file] of proof.files.entries()) {
        const want = expected[index];
        if (!exact(file, ["path", "sha256", "size", "identity"]) || file.path !== want.path || file.sha256 !== want.sha256 || file.size !== want.size || !identity(file.identity) || want.identity && !same(file.identity, want.identity)) throw Error("The Windows scanner helper returned changed file ownership or bytes.");
      }
      await guard(); return proof;
    });
    try { return await resource.done; }
    finally {
      const stopped = await Promise.all([...resource.clients].map(client => client.closed ? true : client.stop().catch(() => false)));
      if (stopped.every(Boolean)) {
        if (sequence && !owner) await update(c, draft.id, sequence, "scanner-native-start-refused", row => { if (row.ownedRuntime) throw Error("Preserve newly observed Windows scanner ownership."); row.stoppedVerified = true; row.status = "not-started"; });
        if (resources.get(c) === resource) resources.delete(c);
      }
    }
  }
  const request = (draft, rootIdentity, operation, extra = {}) => ({ schema, operationId: draft.id, operation, repositoryRoot: draft.repositoryRoot, rootIdentity, ...extra });
  return {
    preflight: validateWindowsScannerDraft,
    async root(path) { const stat = await directoryIdentity(path); return { device: String(stat.dev), inode: String(stat.ino) }; },
    async write(draft, rootIdentity, record, authorize, context) {
      validateWindowsScannerDraft(draft); if (!identity(rootIdentity) || !context?.compartment) throw Error("Bind the exact Windows scanner save workspace and root.");
      if (draft.files.some(file => typeof file.content !== "string")) throw Error("Rebuild exact Windows scanner bytes before saving.");
      await authorize(); await record({ kind: "directory-intent" });
      const directory = await call(context.compartment, draft, request(draft, rootIdentity, "create-directory"), authorize);
      await record({ kind: "directory-created", identity: directory.directoryIdentity });
      let files = [];
      for (const file of draft.files) {
        await authorize(); await record({ kind: "file-intent", path: file.path });
        const bytes = Buffer.from(file.content, "utf8");
        let proof;
        try { proof = await call(context.compartment, draft, request(draft, rootIdentity, "write-file", { directoryIdentity: directory.directoryIdentity, existingFiles: files, file: { ...metadata(draft, file), contentBase64: bytes.toString("base64") } }), authorize); }
        finally { bytes.fill(0); }
        const created = proof.files.at(-1); files = proof.files;
        await record({ kind: "file-verified", path: file.path, identity: created.identity });
      }
      await authorize(); return { directoryIdentity: directory.directoryIdentity };
    },
    async inspect(draft, rootIdentity, progress, context) {
      validateWindowsScannerDraft(draft);
      if (!(await retire(context.compartment)).stopped) return { complete: false, stopped: false };
      if (!identity(rootIdentity) || !identity(progress.directoryIdentity) || draft.files.some(file => progress.files?.[file.path]?.status !== "verified" || !identity(progress.files[file.path].identity))) return { complete: false, stopped: true };
      const files = draft.files.map(file => ({ ...metadata(draft, file), identity: progress.files[file.path].identity }));
      await call(context.compartment, draft, request(draft, rootIdentity, "inspect-files", { directoryIdentity: progress.directoryIdentity, files }), context.authorize);
      return { complete: true, stopped: true };
    },
    retire,
    async stopCompartment(c) {
      generations.set(c, (generations.get(c) ?? 0) + 1); const resource = resources.get(c); resource?.controller.abort();
      await resource?.done?.catch(() => {});
      const exits = await Promise.all([...(resource?.clients ?? [])].map(client => client.stop().catch(() => false)));
      if (exits.every(Boolean) && resources.get(c) === resource) resources.delete(c);
      return exits.every(Boolean) ? retire(c) : { stopped: false };
    },
    async close() { closed = true; const results = await Promise.all([...seen].map(c => this.stopCompartment(c))); if (results.some(r => !r.stopped)) throw Error("The original Windows scanner helper exit remains unconfirmed."); }
  };
}
