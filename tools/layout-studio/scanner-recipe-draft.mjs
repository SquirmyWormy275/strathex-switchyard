/** Assemble reviewable scanner control files. Never write the repository or start a process. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";
import { validateRepositoryInputs } from "../../apps/windows-companion/src/repository-inputs.ts";
import { validateShieldRequest } from "./shield-scanner-engine.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const reader = new NodeFileDigestReader({ maxFileBytes: 2 * 1024 * 1024 });
const exactText = bytes => { const text = bytes.toString("utf8"); if (!Buffer.from(text).equals(bytes)) throw Error("Draft control files require exact UTF-8 bytes."); return text; };

export async function assembleScannerRecipeDraft({ result, preparation, sources, authorize = async () => {}, id = randomUUID() }) {
  const root = result.task.repositoryRoot, action = result.proposed.actions[0];
  if (!isAbsolute(root) || result.proposed.actions.length !== 1 || !Array.isArray(sources) || sources.length < 1 || sources.length > 2) throw Error("Prepare one scanner action with one scanner and optional advisory feed.");
  const scanner = sources.find(s => s.fixture.kind === "scanner"), advisory = sources.find(s => s.fixture.kind === "advisory");
  if (!scanner || sources.length !== 1 + Number(Boolean(advisory)) || new Set(sources.map(s => s.fixture.id)).size !== sources.length) throw Error("Draft feeds must have distinct scanner and advisory identities.");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw Error("Use a host-generated draft identity.");
  const prefix = `switchyard-scan-${id}`, files = [], current = [];
  const generated = (name, bytes) => { const file = { path: `${prefix}/${name}`, sha256: sha(bytes), size: bytes.length, encoding: "utf8", content: exactText(bytes) }; files.push(file); return file; };
  const witnesses = new Map([...result.files.tracked, ...result.files.untracked, ...result.files.ignored.filter(file => file.classification === "included")].map(file => [file.path, file]));
  let total = 0;
  for (const path of result.proposed.paths) {
    if (path.toLowerCase() === prefix || path.toLowerCase().startsWith(prefix + "/")) throw Error("The generated draft directory collides with existing inputs.");
    await authorize(); const source = await reader.read(root, path);
    try {
      if (source.digest !== witnesses.get(path)?.digest) throw Error("A current scanner input changed while preparing its draft.");
      total += source.bytes.length; if (total > 16 * 1024 * 1024) throw Error("The scanner draft exceeds the current-input byte bound.");
      current.push({ path, sha256: source.digest.slice(7), size: source.bytes.length });
    } finally { source.bytes.fill(0); }
  }
  const engine = generated("engine.mjs", await readFile(new URL("./shield-scanner-engine.mjs", import.meta.url)));
  const feed = item => {
    if (!(item.bytes instanceof Uint8Array) || item.bytes.length > 2 * 1024 * 1024 || sha(item.bytes) !== item.fixture.contentSha256 || item.fixture.toolName !== "switchyard-baseline-scanner" || item.fixture.toolVersion !== "1") throw Error("The draft feed does not match the installed baseline scanner.");
    const file = generated(`${item.fixture.kind}.json`, Buffer.from(item.bytes));
    return { id: item.fixture.id, path: file.path, sha256: file.sha256 };
  };
  const request = validateShieldRequest({ schema: "switchyard-shield-scan/v1", version: 1, action, scope: "reviewed-inputs", files: [...current, ...(preparation.indexInputs ?? []), ...(preparation.historyInputs ?? [])], scanner: feed(scanner), advisory: advisory ? feed(advisory) : null });
  const requestFile = generated("request.json", Buffer.from(JSON.stringify(request)));
  if (requestFile.size > 128 * 1024) throw Error("The scanner request exceeds its existing 128 KiB bound.");
  const inputFiles = validateRepositoryInputs([...files.map(({ path, sha256, size }) => ({ path, sha256, size })), ...request.files.map(({ path, sha256, size }) => ({ path, sha256, size }))].map(file => ({ ...file, classification: "non-production" })));
  if (inputFiles.length > 256) throw Error("The complete scanner recipe exceeds its 256-input bound.");
  const recipe = { kind: "process", executable: process.execPath, args: [engine.path, requestFile.path], cwd: ".", environment: { NODE_ENV: "test" }, lifecycle: "foreground", isolation: "disposable", workspaceMode: "read-only", timeoutMs: 10000, maxOutputBytes: 524288, inputFiles };
  const manifest = { schema: "sxsy-b122.repository-runtime", version: 1, repositoryRoot: root, allowedHttpsUrls: [], recipes: { [action]: recipe } };
  const manifestFile = generated("recipe.json", Buffer.from(JSON.stringify(manifest)));
  if (manifestFile.size > 128 * 1024 || result.proposed.paths.length + files.length > 256) throw Error("The complete draft exceeds its existing manifest or authority bound.");
  await authorize();
  return { schema: "switchyard-scanner-recipe-draft/v1", status: "draft", id, action, targetSnapshotId: result.snapshot.id, repositoryRoot: root, directory: prefix,
    binding: { taskId: result.task.id, provider: result.task.provider, sessionId: result.task.sessionId, taskDigest: result.binding, workspaceDigest: result.workspace },
    files, manifestPath: manifestFile.path, manifestSha256: manifestFile.sha256, request, recipe, feeds: sources.map(item => structuredClone(item.fixture)),
    authorityProposal: { ...result.proposed, paths: [...result.proposed.paths, ...files.map(file => file.path)].sort(), classifications: { ...result.proposed.classifications, includedUntracked: [...result.proposed.classifications.includedUntracked, ...files.map(file => file.path)].sort() } },
    preparation, sourceBytesReturned: false, filesWritten: false, authorityGranted: false, scanPerformed: false, securityCoverageComplete: false,
    nextStep: "Review and save these exact new control files, then obtain a fresh task authority review and a separate execution review. This draft grants neither." };
}
