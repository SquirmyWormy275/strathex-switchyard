/** Private bounded stdin packet; never persist or return its encoded source bytes. */
import { createHash } from "node:crypto";
import { validateRepositoryInputs } from "../../apps/windows-companion/src/repository-inputs.ts";
import { gitIndexPaths, gitIndexLimits, gitIndexWindowsRawLimit } from "./git-index-inputs.mjs";
import { shieldActions, shieldIndexPrefix } from "./shield-scanner-engine.mjs";
export const windowsIndexRawLimit = gitIndexWindowsRawLimit;
export const windowsIndexRequestLimit = 512 * 1024;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === fields.slice().sort().join();
export function buildWindowsIndexPacket({ action, indexWitness, indexBytes, inputFiles }) {
  const files = validateRepositoryInputs(inputFiles), witness = indexWitness;
  if (!shieldActions.includes(action) || !exact(witness, ["source", "head", "indexMetadataSha256", "rows"]) || witness.source !== "git-index" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(witness.head ?? "") || !/^[a-f0-9]{64}$/.test(witness.indexMetadataSha256 ?? "") || !Array.isArray(witness.rows) || !(indexBytes instanceof Map)) throw Error("Private Windows index packets require the exact current Shield witness and reviewed input map.");
  const paths = gitIndexPaths(witness.rows.map(row => row?.path)), allowed = new Map(files.map(file => [file.path, file])), encoded = []; let total = 0;
  if (indexBytes.size !== paths.length || files.filter(file => file.path.startsWith(shieldIndexPrefix)).length !== paths.length || JSON.stringify(paths) !== JSON.stringify(witness.rows.map(row => row.path))) throw Error("The exact reserved Windows input set does not match its index witness.");
  for (const row of witness.rows) {
    const path = shieldIndexPrefix + row.path, declared = allowed.get(path), content = indexBytes.get(path);
    if (!exact(row, ["path", "mode", "objectId", "size", "sha256"]) || !["100644", "100755"].includes(row.mode) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(row.objectId ?? "") || /^0+$/.test(row.objectId) || row.objectId.length !== witness.head.length || !/^[a-f0-9]{64}$/.test(row.sha256 ?? "") || !Number.isSafeInteger(row.size) || row.size < 0 || row.size > gitIndexLimits.fileBytes || !declared || declared.size !== row.size || declared.sha256 !== row.sha256 || !exact(content, ["bytes", "mode"]) || content.mode !== row.mode || !(content.bytes instanceof Uint8Array) || content.bytes.byteLength !== row.size) throw Error("A private Windows index source does not match its exact reviewed bytes and origin.");
    total += row.size; if (total > windowsIndexRawLimit) throw Error("Private Windows index content exceeds the 320 KiB encoded-transport subset.");
    const objectId = createHash(row.objectId.length === 40 ? "sha1" : "sha256").update(`blob ${row.size}\0`).update(content.bytes).digest("hex");
    if (objectId !== row.objectId || sha(content.bytes) !== row.sha256) throw Error("Private Windows index bytes changed before native packet construction.");
    encoded.push({ path, contentBase64: Buffer.from(content.bytes.buffer, content.bytes.byteOffset, content.bytes.byteLength).toString("base64") });
  }
  return { schema: "switchyard-windows-index-bytes/v1", action, witness: structuredClone(witness), files: encoded };
}
export function windowsIndexRequest(base, packet) {
  if (!base || typeof base !== "object" || Object.hasOwn(base, "indexInputs")) throw Error("Use one newly constructed private Windows index request.");
  const request = { ...base, indexInputs: packet }, text = JSON.stringify(request);
  if (Buffer.byteLength(text) > windowsIndexRequestLimit) throw Error("The complete private Windows index request exceeds the original 512 KiB native stdin bound.");
  return { request, text, packetSha256: sha(JSON.stringify(packet)), witnessSha256: sha(JSON.stringify(packet.witness)) };
}
