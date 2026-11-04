/** Exact Windows Run manifest/catalog validation; importing bytes grants no authority. */
import { createHash } from "node:crypto";
import { validateRepositoryInputs } from "../../apps/windows-companion/src/repository-inputs.ts";
import { NodeFileDigestReader } from "../../packages/control-plane/src/git-inspector.ts";

export const windowsReviewedRunSchema = "switchyard-windows-reviewed-run/v1";
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const object = value => value && typeof value === "object" && !Array.isArray(value);
function exact(value, fields) {
  if (!object(value) || Object.keys(value).sort().join() !== [...fields].sort().join()) throw Error("The Windows Run document requires its exact closed fields.");
}
function relative(value, dot = false) {
  if (dot && value === ".") return true;
  try { validateRepositoryInputs([{ path: value, sha256: "a".repeat(64), size: 0, classification: "non-production" }]); return true; } catch { return false; }
}
const secret = /bearer\s+[a-z0-9._~+/-]{8,}|-----BEGIN[ A-Z]+PRIVATE KEY-----|(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)\s*[:=]\s*\S+/i;
function scalar(value, maximum, traversal = true) {
  if (typeof value !== "string" || Buffer.byteLength(value) > maximum || /[\x00-\x1f\x7f]/.test(value) || secret.test(value)
    || traversal && value.split(/[\\/]/).includes("..") || /\{[A-Z_]+\}/.test(value.replace(/\{(?:INPUT|EXCHANGE|WORK|OUTPUT)_ROOT\}/g, ""))) throw Error("Windows Run arguments/environment must be bounded literal non-secret guest values.");
}

export function parseWindowsReviewedRun(bytes, expectedSha256) {
  if (!digest(expectedSha256) || bytes.byteLength < 1 || bytes.byteLength > 1024 * 1024 || sha(bytes) !== expectedSha256) throw Error("The exact reviewed Windows Run manifest bytes changed.");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  exact(value, ["schema", "version", "recipeId", "catalogPath", "catalogSha256", "inputFiles"]);
  if (value.schema !== windowsReviewedRunSchema || value.version !== 1 || value.recipeId !== "run_target" || !relative(value.catalogPath) || value.catalogPath.length > 512 || !digest(value.catalogSha256)) throw Error("Choose one exact Windows Run catalog and fixed Run recipe.");
  const inputFiles = validateRepositoryInputs(value.inputFiles), catalog = inputFiles.find(file => file.path === value.catalogPath);
  if (!catalog || catalog.sha256 !== value.catalogSha256 || catalog.size < 1 || catalog.size > 256 * 1024) throw Error("The exact Windows guest catalog must belong to the selected non-production input set.");
  return { ...value, inputFiles };
}

export function parseWindowsRunCatalog(bytes, manifest, recipeRuntimeSha256) {
  if (!digest(recipeRuntimeSha256) || bytes.byteLength < 1 || bytes.byteLength > 256 * 1024 || sha(bytes) !== manifest.catalogSha256) throw Error("The Windows guest catalog bytes or trusted Node runtime digest changed.");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  exact(value, ["schema", "version", "recipes"]);
  if (value.schema !== "sxsy-b122.windows-sandbox-catalog" || value.version !== 1 || !Array.isArray(value.recipes) || value.recipes.length !== 1) throw Error("Connected Windows Run requires one displayed fixed guest recipe.");
  const recipe = value.recipes[0];
  exact(recipe, ["id", "executable", "executableSha256", "arguments", "workingRoot", "workingDirectory", "environment", "timeoutMs", "maxOutputBytes", "artifacts"]);
  if (recipe.id !== "run_target" || recipe.executable !== "C:\\B122\\tools\\node.exe" || recipe.executableSha256 !== recipeRuntimeSha256
    || !["input", "work"].includes(recipe.workingRoot) || !relative(recipe.workingDirectory, true) || recipe.workingRoot === "work" && recipe.workingDirectory !== "."
    || !Number.isSafeInteger(recipe.timeoutMs) || recipe.timeoutMs < 50 || recipe.timeoutMs > 540000
    || !Number.isSafeInteger(recipe.maxOutputBytes) || recipe.maxOutputBytes < 1 || recipe.maxOutputBytes > 524288) throw Error("The Windows Run recipe must use the pinned guest Node runtime and bounded resources.");
  if (!Array.isArray(recipe.arguments) || recipe.arguments.length < 1 || recipe.arguments.length > 128) throw Error("Windows Run requires a selected script and bounded literal arguments.");
  recipe.arguments.forEach(value => scalar(value, 4096));
  const script = /^\{INPUT_ROOT\}[\\/](.+\.(?:mjs|cjs|js))$/i.exec(recipe.arguments[0]);
  if (!script || !manifest.inputFiles.some(file => file.path === script[1].replaceAll("\\", "/"))) throw Error("Windows Run starts only a script in the exact read-only input set; inline code and host paths are not accepted.");
  if (!object(recipe.environment) || Object.keys(recipe.environment).length > 64) throw Error("The guest environment exceeds its closed bound.");
  const names = new Set();
  for (const [name, value] of Object.entries(recipe.environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || /(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|AUTHORIZATION|COOKIE|API_KEY|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DSN)(?:$|_)/i.test(name)
      || /^(?:SystemRoot|WINDIR|TEMP|TMP|NODE_OPTIONS|NODE_PATH)$/i.test(name) || names.has(name.toLowerCase())) throw Error("The guest environment cannot override fixed entries, inject Node startup options or include credentials.");
    names.add(name.toLowerCase()); scalar(value, 8192, false);
  }
  if (!Array.isArray(recipe.artifacts) || recipe.artifacts.length > 128 || recipe.artifacts.some(path => !relative(path)) || new Set(recipe.artifacts.map(path => path.toLowerCase())).size !== recipe.artifacts.length) throw Error("Select only bounded, distinct guest artifact paths.");
  return structuredClone(recipe);
}

export async function loadWindowsReviewedRun({ repositoryRoot, manifestPath, manifestSha256, allowedFiles, recipeRuntimeSha256, reader = new NodeFileDigestReader({ maxFileBytes: 4 * 1024 * 1024 }) }) {
  const witnesses = new Map(allowedFiles.map(file => [file.path, file.digest]));
  if (witnesses.size !== allowedFiles.length) throw Error("The exact task-owned snapshot contains ambiguous duplicate file witnesses.");
  if (witnesses.get(manifestPath) !== `sha256:${manifestSha256}`) throw Error("The Windows Run manifest must belong to the exact task-owned file grant.");
  const read = await reader.read(repositoryRoot, manifestPath); let manifest;
  try { manifest = parseWindowsReviewedRun(read.bytes, manifestSha256); } finally { read.bytes.fill(0); }
  let recipe;
  for (const input of manifest.inputFiles) {
    if (witnesses.get(input.path) !== `sha256:${input.sha256}`) throw Error("Every Windows Run input must match this exact task-owned snapshot.");
    const selected = await reader.read(repositoryRoot, input.path);
    try {
      if (selected.bytes.length !== input.size || selected.digest !== `sha256:${input.sha256}`) throw Error("An exact Windows Run input changed after review.");
      if (input.path === manifest.catalogPath) recipe = parseWindowsRunCatalog(selected.bytes, manifest, recipeRuntimeSha256);
    } finally { selected.bytes.fill(0); }
  }
  return { manifest, recipe, timeoutMs: recipe.timeoutMs + 60000 };
}
