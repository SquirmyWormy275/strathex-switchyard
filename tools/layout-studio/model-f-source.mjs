/** The private bundle shares its verified catalog with the frozen frontend. */
import { readFile } from "node:fs/promises";
import boundary from "../../package.json" with { type: "json" };
const locations = {
  "strathex-switchyard": "./model-f-catalog.json",
  "strathex-switchyard-private-suite": "../../frontend/model-f-catalog.json"
};
if (!Object.hasOwn(locations, boundary.name)) throw Error("The Model F catalog package boundary is unsupported.");
export default JSON.parse(await readFile(new URL(locations[boundary.name], import.meta.url), "utf8"));
