/** Deterministic inputs only; no scoring formula or reference implementation. */
const base = { AV: ["L", "A", "N"], AC: ["H", "M", "L"], Au: ["M", "S", "N"], C: ["N", "P", "C"], I: ["N", "P", "C"], A: ["N", "P", "C"] };
const temporal = { E: ["U", "POC", "F", "H", "ND"], RL: ["OF", "TF", "W", "U", "ND"], RC: ["UC", "UR", "C", "ND"] };
const requirements = { CR: ["L", "M", "H", "ND"], IR: ["L", "M", "H", "ND"], AR: ["L", "M", "H", "ND"] };
const environment = { CDP: ["N", "L", "LM", "MH", "H", "ND"], TD: ["N", "L", "M", "H", "ND"] };
function* combinations(axes, i = 0, parts = []) {
  const keys = Object.keys(axes);
  if (i === keys.length) { yield parts.join("/"); return; }
  const key = keys[i]; for (const value of axes[key]) yield* combinations(axes, i + 1, [...parts, key + ":" + value]);
}
export function* cvssV2Cases(representatives = []) {
  for (const metrics of combinations(base)) {
    yield { cohort: "base", vector: metrics };
    for (const context of combinations(temporal)) yield { cohort: "all-base-temporal", vector: metrics + "/" + context };
    for (const context of combinations(requirements)) yield { cohort: "all-base-requirements", vector: metrics + "/" + context };
  }
  // Independently chosen representative for every distinct rounded adjusted base
  // crosses every temporal and distribution choice, including undefined defaults.
  for (const metrics of representatives) for (const context of combinations(temporal)) for (const env of combinations(environment)) yield { cohort: "adjusted-temporal-distribution", vector: metrics + "/" + context + "/" + env };
}
