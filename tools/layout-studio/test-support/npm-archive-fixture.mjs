import { gzipSync } from "node:zlib";
export function archiveHeaderChecksum(header) {
  header.fill(32, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return header;
}
export function ustarFixture(entries, { terminators = 2 } = {}) {
  const chunks = [];
  for (const { path, prefix = "", type = "0", content = "", changeHeader } of entries) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content), header = Buffer.alloc(512);
    header.write(path, 0, 100, "utf8"); header.write(prefix, 345, 155, "utf8");
    for (const offset of [100, 108, 116, 329, 337]) header.write("0000000\0", offset);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136); header[156] = type.charCodeAt(0);
    header.write("ustar\0" + "00", 257); changeHeader?.(header);
    chunks.push(archiveHeaderChecksum(header), bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(512 * terminators)]);
}
export function npmArchiveFixture({ name = "synthetic", version = "1.0.0", malformed = false, manifest, entries = [] } = {}) {
  const tar = ustarFixture([{ path: "package/package.json", content: manifest ?? JSON.stringify({ name, version, scripts: { install: "NEVER_EXECUTE_PACKAGE_SCRIPT" } }) }, ...entries]);
  if (malformed) tar[148] ^= 1;
  return gzipSync(tar);
}

// Generated offline by the installed npm CLI, with every lifecycle disabled.
// Synthetic package; no registry bytes or third-party source.
export const npmCliArchiveFixture = () => Buffer.from("H4sIAAAAAAAC/+3WTUvDMBjA8X6UkEs27Lr0ZRXqxdFVEUHHNsXb6NpnLrOmNUntxth3l+EUkSk7zMIkv0ugDzkE+icp4uQpfoT2NBcTlqbArbk0DoxS6nse2vV9w6Y2MtyOT23b96mHDGrbHc9BBjVqUEoVC4PSAxySUoo+1yMh4KVkAhqE5ykEU0maViWYgguWwXDJkwYZhoOr/mgcPUTh3SjqERORksOigERBSpqGdsyKbf+Mp7D4g/b36J92/O/901PH1/3XQc1EXiEOFYqEyEWD3ET30eCj9nG/G153L6NxeNuLSPNM9/Jf+9+u1lzmvOb+Xcfdcf97uv86rDCPnwEH+FxWTCWzZSzS1pQtVCmgHYtkxl6hxVLgiqklNvErCMlyjgNsW47ltiagYss+mZQsS7GJZSJYoSQOVrgQsPmpcIA3Twv09YGJzfepgJ+muVS/bGZcqjjLdk7Xax21pmnaHt4Af9r+PQAQAAA=", "base64");
