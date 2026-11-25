/** One explicit metadata encoding per source/package; corrupt files never fall back. */
import packageMetadata from "../../package.json" with { type: "json" };
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function decodeCatalogSource(bytes, encoding) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024 || !["json/v1", "gzip-json/v1"].includes(encoding)) throw Error("The catalog provenance encoding or size is unsupported.");
  const raw = encoding === "gzip-json/v1" ? gunzipSync(bytes, { maxOutputLength: 1024 * 1024 }) : bytes;
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
}
const encoding = packageMetadata.name === "strathex-switchyard" ? "json/v1"
  : packageMetadata.name === "strathex-switchyard-private-suite" && packageMetadata.catalogProvenance === "gzip-json/v1" ? "gzip-json/v1" : null;
if (!encoding) throw Error("This application does not declare a supported catalog provenance encoding.");
const path = "../../third_party/model-f-catalog/SOURCES.json" + (encoding === "gzip-json/v1" ? ".gz" : "");
export default decodeCatalogSource(readFileSync(new URL(path, import.meta.url)), encoding);
