/** Vendor platform metadata, never executable identity, launch permission or account evidence. */
import { open } from "node:fs/promises";
import { arch } from "node:os";

const limit = 16384;
const source = "https://code.claude.com/docs/en/desktop-linux";
const keys = new Set(["ID", "ID_LIKE", "VERSION_ID"]);

function releaseFields(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > limit || /[\0\r]/.test(text)) throw Error("Unsupported release metadata");
  const fields = {};
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) throw Error("Malformed release metadata");
    if (!keys.has(match[1])) continue;
    if (Object.hasOwn(fields, match[1])) throw Error("Ambiguous release metadata");
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    // No shell expansion, escapes, sourced files or arbitrary display names.
    if (!/^[a-zA-Z0-9._ -]{1,128}$/.test(value)) throw Error("Unsupported release field");
    fields[match[1]] = value;
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(fields.ID ?? "")) throw Error("Missing distribution identity");
  return fields;
}

export function assessClaudeDesktopLinuxHost(input = {}) {
  const base = { schema: "switchyard-linux-desktop-host-support/v1", source, checkedAt: "2026-11-09", supported: false,
    applicationObserved: false, executableVerified: false, accountVerified: false, authorityGranted: false };
  const unknown = () => ({ ...base, status: "unverified-host", summary: "Linux desktop host: distribution, version or architecture could not be verified from local system metadata. No native application has been inspected." });
  if (!input || typeof input !== "object" || Array.isArray(input)) return unknown();
  const { osRelease, architecture } = input;
  let fields;
  try { fields = releaseFields(osRelease); } catch { return unknown(); }
  if (typeof architecture !== "string" || !/^[a-z0-9_]{1,16}$/.test(architecture)) return unknown();
  const identity = { distribution: fields.ID, version: fields.VERSION_ID ?? null, architecture };
  if (!["x64", "arm64"].includes(architecture)) return { ...base, ...identity, status: "unsupported-architecture", summary: `Linux desktop host: ${architecture} is unsupported by the vendor's x64/arm64 desktop beta.` };
  if (!["ubuntu", "debian"].includes(fields.ID)) {
    const derivative = (fields.ID_LIKE ?? "").split(" ").some(id => ["ubuntu", "debian"].includes(id));
    return { ...base, ...identity, status: derivative ? "untested-distribution" : "unsupported-distribution", summary: `Linux desktop host: ${fields.ID} is ${derivative ? "not an officially tested distribution" : "unsupported by the desktop beta"}. Vendor-tested distributions are Ubuntu 22.04+ and Debian 12+. This does not select Claude Code or a web app.` };
  }
  const version = /^(0|[1-9][0-9]{0,2})(?:\.([0-9]{1,3}))?(?:\.([0-9]{1,3}))?$/.exec(fields.VERSION_ID ?? "");
  if (!version || fields.ID === "ubuntu" && version[2] === undefined) return unknown();
  const major = Number(version[1]), minor = Number(version[2] ?? 0), supported = fields.ID === "debian" ? major >= 12 : major > 22 || major === 22 && minor >= 4;
  return { ...base, ...identity, supported, status: supported ? "vendor-baseline-matched" : "unsupported-version", summary: supported
    ? `Linux desktop host: ${fields.ID} ${fields.VERSION_ID} (${architecture}) matches the vendor's distribution baseline. Installed app identity, desktop compatibility, account and launch/focus integration are not established.`
    : `Linux desktop host: ${fields.ID} ${fields.VERSION_ID} is unsupported by the vendor's Ubuntu 22.04+ / Debian 12+ desktop beta.` };
}

/** Read one bounded metadata file; do not discover, start or inspect applications. */
export async function readLinuxDesktopHost() {
  if (process.platform !== "linux") return {};
  let file;
  try {
    file = await open("/etc/os-release", "r");
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) return {};
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) { const row = await file.read(bytes, length, bytes.length - length); if (!row.bytesRead) break; length += row.bytesRead; }
    const after = await file.stat({ bigint: true });
    if (length > limit || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) return {};
    return { osRelease: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)), architecture: arch() };
  } catch { return {}; } finally { await file?.close(); }
}
