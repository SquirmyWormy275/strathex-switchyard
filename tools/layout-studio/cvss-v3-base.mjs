/** Numeric CVSS v3 base metrics only; no text, URLs, temporal or environment inference. */
const values = Object.freeze({ AV: "NALP", AC: "LH", PR: "NLH", UI: "NR", S: "UC", C: "HLN", I: "HLN", A: "HLN" });
export const cvssV3BaseAlgorithm = "switchyard-cvss-v3-base/1";
export function cvssV3Base(vector) {
  if (typeof vector !== "string" || vector.length > 128 || !/^CVSS:3\.[01]\//.test(vector)) throw Error("Only closed CVSS 3.0/3.1 base vectors are supported.");
  const [version, ...parts] = vector.split("/"), metrics = {};
  if (parts.length !== 8) throw Error("Every base metric is required, without additional metric groups.");
  for (const part of parts) {
    const match = /^([A-Z]{1,2}):([A-Z])$/.exec(part);
    if (!match || !Object.hasOwn(values, match[1]) || !values[match[1]].includes(match[2]) || Object.hasOwn(metrics, match[1])) throw Error("Duplicate, unknown or malformed base metric.");
    metrics[match[1]] = match[2];
  }
  const changed = metrics.S === "C", impactValue = { H: 0.56, L: 0.22, N: 0 };
  const iss = 1 - (1 - impactValue[metrics.C]) * (1 - impactValue[metrics.I]) * (1 - impactValue[metrics.A]);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploitability = 8.22 * ({ N: 0.85, A: 0.62, L: 0.55, P: 0.2 })[metrics.AV] * ({ L: 0.77, H: 0.44 })[metrics.AC] * ({ N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 })[metrics.PR] * ({ N: 0.85, R: 0.62 })[metrics.UI];
  // FIRST v3.1 Appendix A: round five decimal places before the tenth ceiling.
  const integer = Math.round(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10) * 100000);
  const score = impact <= 0 ? 0 : integer % 10000 === 0 ? integer / 100000 : (Math.floor(integer / 10000) + 1) / 10;
  return { algorithm: cvssV3BaseAlgorithm, version: version.slice(5), vector: version + "/" + Object.keys(values).map(key => key + ":" + metrics[key]).join("/"), score, severity: score === 0 ? "none" : score < 4 ? "low" : score < 7 ? "medium" : score < 9 ? "high" : "critical" };
}
