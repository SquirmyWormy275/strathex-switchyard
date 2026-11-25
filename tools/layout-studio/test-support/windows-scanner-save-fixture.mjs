// Real protected state and exact filesystem bytes; native process creation is an explicit double.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { scannerDraftFixture, draftInput } from "./scanner-draft-fixture.mjs";
import { createWindowsScannerRecipeFiles } from "../windows-scanner-recipe-files.mjs";
import { createScannerRecipeSave } from "../scanner-recipe-save.mjs";
const sha = value => createHash("sha256").update(value).digest("hex");
const identity = async path => { const s = await lstat(path, { bigint: true }); return { device: String(s.dev), inode: String(s.ino) }; };
export async function windowsScannerSaveFixture(t, { authority = {}, transform = proof => proof, uncertain = false, writer } = {}) {
  const f = await scannerDraftFixture(t, authority), owners = new Map(), commands = [], effects = [];
  const command = async (exe, args, options) => {
    assert.equal(exe, process.execPath); assert.deepEqual(args, ["--scanner-recipe-files"]); assert.equal(options.timeout, 45000); assert.equal(options.maxOutputBytes, 4096); assert.equal(options.captureStderrBytes, 1024); assert.ok(Buffer.byteLength(options.inputText) <= 524288);
    const request = JSON.parse(options.inputText), frame = { schema: "switchyard-runtime-command/v1", id: randomUUID(), guardianPid: 12345, birth: "1", containment: "windows-job" };
    owners.set(frame.id, false); commands.push(request.operation); await options.onGuardianReady(frame);
    const owner = (await f.store.snapshot("personal")).scannerRecipeNativeOwners.find(row => row.id === request.operationId);
    assert.deepEqual(owner.ownedRuntime, frame); assert.equal(owner.stoppedVerified, false); assert.equal(owner.requestSha256, sha(options.inputText));
    if (uncertain) return { status: "failed", exitCode: 1, inputDelivered: true, treeExitVerified: false, stdout: "" };
    const directory = join(f.root, "switchyard-scan-" + request.operationId);
    assert.deepEqual(await identity(f.root), request.rootIdentity); let files = [];
    if (request.operation === "create-directory") { await mkdir(directory); effects.push("directory"); }
    else {
      assert.deepEqual(await identity(directory), request.directoryIdentity);
      files = request.operation === "write-file" ? request.existingFiles : request.files;
      assert.deepEqual((await readdir(directory)).sort(), files.map(file => file.path).sort());
      for (const file of files) { assert.deepEqual(await identity(join(directory, file.path)), file.identity); const bytes = await readFile(join(directory, file.path)); assert.equal(bytes.length, file.size); assert.equal(sha(bytes), file.sha256); }
      if (request.operation === "write-file") { const { contentBase64, ...file } = request.file, bytes = Buffer.from(contentBase64, "base64"); assert.equal(bytes.length, file.size); assert.equal(sha(bytes), file.sha256); await writeFile(join(directory, file.path), bytes, { flag: "wx" }); files = [...files, { ...file, identity: await identity(join(directory, file.path)) }]; effects.push(file.path); }
    }
    const proof = { schema: request.schema, operationId: request.operationId, operation: request.operation, requestSha256: sha(options.inputText), rootIdentity: request.rootIdentity, directoryIdentity: await identity(directory), files, authorityGranted: false, scanPerformed: false };
    owners.set(frame.id, true);
    return { status: "completed", exitCode: 0, inputDelivered: true, treeExitVerified: true, stdout: JSON.stringify(transform(proof)) };
  };
  const filesystem = createWindowsScannerRecipeFiles({ store: f.store, platform: "win32", helper: process.execPath, command, guardianStopped: async scope => owners.get(scope.id) === true });
  const saver = createScannerRecipeSave({ store: f.store, authority: f.service, platform: "win32", filesystem, now: f.now, ...(writer ? { writer: (...args) => writer(filesystem, ...args) } : {}) });
  f.onCleanup(() => saver.close()); f.onCleanup(async () => { for (const id of owners.keys()) owners.set(id, true); });
  return { ...f, filesystem, saver, owners, commands, effects, prepare: () => saver.review("personal", draftInput(f)) };
}
