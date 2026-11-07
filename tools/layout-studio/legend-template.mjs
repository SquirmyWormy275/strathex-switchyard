/** Lossless packaging of the retained upstream template; no alternate artwork fallback. */
import packageMetadata from "../../package.json" with { type: "json" };
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const expected = "06bb168f1cf6b7cf4d2a84041626d032a62d41b41e1dff2377fcaa32355ec2b3";
export function decodeLegendTemplate(bytes, encoding) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 800000 || !["svg/v1", "gzip-svg/v1"].includes(encoding)) throw Error("The retained print template encoding or size is unsupported.");
  const raw = encoding === "gzip-svg/v1" ? gunzipSync(bytes, { maxOutputLength: 800000 }) : bytes;
  if (createHash("sha256").update(raw).digest("hex") !== expected) throw Error("The retained print template did not verify. No geometry was substituted.");
  return new TextDecoder("utf-8", { fatal: true }).decode(raw);
}
export async function readLegendTemplate() {
  const encoding = packageMetadata.name === "strathex-switchyard" ? "svg/v1"
    : packageMetadata.name === "strathex-switchyard-private-suite" && packageMetadata.legendTemplate === "gzip-svg/v1" ? "gzip-svg/v1" : null;
  if (!encoding) throw Error("This application does not declare a supported print template encoding.");
  const path = "../../third-party/cyber_engineer/pure-template.svg" + (encoding === "gzip-svg/v1" ? ".gz" : "");
  return decodeLegendTemplate(await readFile(new URL(path, import.meta.url)), encoding);
}
