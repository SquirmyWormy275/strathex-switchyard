/** A host-pinned file allowlist describes bytes; importing it grants no authority. */
export interface RepositoryInputFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly classification: "non-production";
}
export const repositoryInputLimits = Object.freeze({ files: 4096, fileBytes: 4 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 });
export function validateRepositoryInputs(value: unknown): readonly RepositoryInputFile[] {
  if (!Array.isArray(value) || !value.length || value.length > repositoryInputLimits.files) throw new Error("Disposable execution requires 1–4096 exact, host-reviewed non-production input files; whole-repository copying is prohibited.");
  const seen = new Set<string>(); let bytes = 0;
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "classification,path,sha256,size") throw new Error("Each reviewed execution input requires only its literal path, SHA-256, size and non-production classification.");
    const { path, sha256, size, classification } = item;
    if (typeof path !== "string" || path.length > 512 || /[\\\x00-\x1f\x7f:*?\[\]]/.test(path) || path.split("/").some((part: string) => !part || part === "." || part === ".." || /[. ]$/.test(part) || part.toLowerCase() === ".git" || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("Execution inputs must use literal portable repository-relative file paths without aliases, traversal or Git metadata.");
    const key = path.toLowerCase(); if (seen.has(key)) throw new Error("Execution input paths collide across supported platforms."); seen.add(key);
    if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size < 0 || size > repositoryInputLimits.fileBytes || classification !== "non-production") throw new Error("Review exact non-production input digests and sizes within the 4 MiB per-file bound.");
    bytes += size; if (bytes > repositoryInputLimits.totalBytes) throw new Error("Reviewed execution inputs exceed the 64 MiB total bound.");
    return Object.freeze({ path, sha256, size, classification });
  });
}
