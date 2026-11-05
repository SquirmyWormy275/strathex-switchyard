/** Deterministic vector inputs; no scoring formula or external implementation. */
const base = { AV: "NALP", AC: "LH", PR: "NLH", UI: "NR", S: "UC", C: "HLN", I: "HLN", A: "HLN" };
const temporal = { E: "XHFPU", RL: "XUWTO", RC: "XCRU" };
const environmental = { CR: "HML", IR: "HML", AR: "HML", MAV: "NALP", MAC: "LH", MPR: "NLH", MUI: "NR", MS: "UC", MC: "NHL", MI: "NHL", MA: "NHL" };
function* combinations(axes, index = 0, parts = []) {
  const keys = Object.keys(axes);
  if (index === keys.length) { yield parts.join("/"); return; }
  const key = keys[index]; for (const value of axes[key]) yield* combinations(axes, index + 1, [...parts, key + ":" + value]);
}
export function* cvssV3ContextCases(version, environmentalRepresentatives = []) {
  if (!["3.0", "3.1"].includes(version)) throw Error("Choose an exact CVSS v3 reference cohort.");
  const prefix = `CVSS:${version}/`, baseline = prefix + "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H";
  for (const metrics of combinations(base)) for (const context of combinations(temporal)) yield { cohort: "all-base-and-temporal", vector: prefix + metrics + "/" + context };
  for (const metrics of combinations(environmental)) yield { cohort: "all-effective-environmental", vector: baseline + "/" + metrics };
  for (const metrics of combinations(base)) {
    yield { cohort: "environmental-inheritance", vector: prefix + metrics + "/" + Object.keys(environmental).map(key => key + ":X").join("/") };
    for (const [key, values] of Object.entries(environmental)) for (const value of "X" + values) yield { cohort: "environmental-inheritance", vector: prefix + metrics + "/" + key + ":" + value };
  }
  // The environmental equation rounds its inner score before applying the
  // temporal multiplier. Reference-selected representatives cover each distinct
  // inner numeric result crossed with every temporal combination.
  for (const vector of environmentalRepresentatives) for (const context of combinations(temporal)) yield { cohort: "environmental-temporal-rounding", vector: vector + "/" + context };
}
