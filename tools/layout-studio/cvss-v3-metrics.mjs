/** FIRST CVSS 3.0/3.1 equations. Supplied metrics never prove a local environment. */
import { cvssV3Base, cvssV3BaseAlgorithm } from "./cvss-v3-base.mjs";

const baseValues = Object.freeze({ AV: "NALP", AC: "LH", PR: "NLH", UI: "NR", S: "UC", C: "HLN", I: "HLN", A: "HLN" });
const temporal = Object.freeze({ E: "XHFPU", RL: "XUWTO", RC: "XCRU" });
const environmental = Object.freeze({ CR: "XHML", IR: "XHML", AR: "XHML", MAV: "XNALP", MAC: "XLH", MPR: "XNLH", MUI: "XNR", MS: "XUC", MC: "XNHL", MI: "XNHL", MA: "XNHL" });
const values = { ...baseValues, ...temporal, ...environmental };
const impactValue = { H: 0.56, L: 0.22, N: 0 }, requirement = { X: 1, H: 1.5, M: 1, L: 0.5 };
const roundUp = input => { const integer = Math.round(input * 100000); return integer % 10000 === 0 ? integer / 100000 : (Math.floor(integer / 10000) + 1) / 10; };
export const cvssV3MetricsAlgorithm = "switchyard-cvss-v3-metrics/1";

export function cvssV3Metrics(vector) {
  if (typeof vector !== "string" || vector.length > 128 || /[\0\r\n]/.test(vector) || !/^CVSS:3\.[01]\//.test(vector)) throw Error("Choose a bounded CVSS 3.0/3.1 vector.");
  const [version, ...parts] = vector.split("/"), metrics = {};
  if (parts.length < 8 || parts.length > 22) throw Error("Every base metric and only supported optional metrics are required.");
  for (const part of parts) {
    const match = /^([A-Z]{1,3}):([A-Z])$/.exec(part);
    if (!match || !Object.hasOwn(values, match[1]) || !values[match[1]].includes(match[2]) || Object.hasOwn(metrics, match[1])) throw Error("Duplicate, unknown or malformed CVSS metric.");
    metrics[match[1]] = match[2];
  }
  if (Object.keys(baseValues).some(key => !Object.hasOwn(metrics, key))) throw Error("Every base metric is required.");
  const base = cvssV3Base(version + "/" + Object.keys(baseValues).map(key => key + ":" + metrics[key]).join("/"));
  const temporalSupplied = Object.keys(temporal).some(key => metrics[key] && metrics[key] !== "X");
  const environmentalSupplied = Object.keys(environmental).some(key => metrics[key] && metrics[key] !== "X");
  for (const key of [...Object.keys(temporal), ...Object.keys(environmental)]) metrics[key] ??= "X";
  const rounding = version === "CVSS:3.0" ? input => Math.ceil(input * 10) / 10 : roundUp;
  const e = ({ X: 1, H: 1, F: 0.97, P: 0.94, U: 0.91 })[metrics.E], rl = ({ X: 1, U: 1, W: 0.97, T: 0.96, O: 0.95 })[metrics.RL], rc = ({ X: 1, C: 1, R: 0.96, U: 0.92 })[metrics.RC];
  const adjusted = score => rounding(score * e * rl * rc);
  const modified = key => metrics["M" + key] === "X" ? metrics[key] : metrics["M" + key];
  const changed = modified("S") === "C";
  const miss = Math.min(1 - (1 - requirement[metrics.CR] * impactValue[modified("C")]) * (1 - requirement[metrics.IR] * impactValue[modified("I")]) * (1 - requirement[metrics.AR] * impactValue[modified("A")]), 0.915);
  const modifiedImpact = changed ? 7.52 * (miss - 0.029) - 3.25 * (version === "CVSS:3.1" ? (miss * 0.9731 - 0.02) ** 13 : (miss - 0.02) ** 15) : 6.42 * miss;
  const modifiedExploitability = 8.22 * ({ N: 0.85, A: 0.62, L: 0.55, P: 0.2 })[modified("AV")] * ({ L: 0.77, H: 0.44 })[modified("AC")] * ({ N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 })[modified("PR")] * ({ N: 0.85, R: 0.62 })[modified("UI")];
  const environmentalScore = modifiedImpact <= 0 ? 0 : adjusted(rounding(Math.min((changed ? 1.08 : 1) * (modifiedImpact + modifiedExploitability), 10)));
  return { algorithm: cvssV3MetricsAlgorithm, baseAlgorithm: cvssV3BaseAlgorithm, version: base.version, vector: version + "/" + Object.keys(values).filter(key => Object.hasOwn(baseValues, key) || metrics[key] !== "X").map(key => key + ":" + metrics[key]).join("/"), baseVector: base.vector, baseScore: base.score, severity: base.severity, temporalScore: adjusted(base.score), environmentalScore, temporalSupplied, environmentalSupplied };
}
