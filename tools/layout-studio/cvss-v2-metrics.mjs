/** FIRST CVSS 2.0 equations. Source metrics do not verify a local environment. */
const base = { AV: ["L", "A", "N"], AC: ["H", "M", "L"], Au: ["M", "S", "N"], C: ["N", "P", "C"], I: ["N", "P", "C"], A: ["N", "P", "C"] };
const temporal = { E: ["U", "POC", "F", "H", "ND"], RL: ["OF", "TF", "W", "U", "ND"], RC: ["UC", "UR", "C", "ND"] };
const environmental = { CDP: ["N", "L", "LM", "MH", "H", "ND"], TD: ["N", "L", "M", "H", "ND"], CR: ["L", "M", "H", "ND"], IR: ["L", "M", "H", "ND"], AR: ["L", "M", "H", "ND"] };
const values = { ...base, ...temporal, ...environmental };
// Integer fractions preserve decimal half-up ties through both rounding stages.
const q = (n, d = 1) => [BigInt(n), BigInt(d)];
const add = (a, b) => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const mul = (a, b) => [a[0] * b[0], a[1] * b[1]];
const sub = (a, b) => add(a, [-b[0], b[1]]);
const round = a => { const sign = a[0] < 0n ? -1n : 1n, n = a[0] * sign * 10n; return [sign * ((2n * n + a[1]) / (2n * a[1])), 10n]; };
const score = a => Math.max(0, Number(a[0]) / Number(a[1]));
export const cvssV2BaseAlgorithm = "switchyard-cvss-v2-base/1";
export const cvssV2MetricsAlgorithm = "switchyard-cvss-v2-metrics/1";
export function cvssV2Metrics(vector) {
  if (typeof vector !== "string" || vector.length > 128 || /[\0\r\n]/.test(vector)) throw Error("Choose a bounded CVSS 2.0 vector.");
  const parts = vector.split("/"), metrics = {};
  if (parts.length < 6 || parts.length > 14) throw Error("Every base metric and only supported optional metrics are required.");
  for (const part of parts) {
    const match = /^(AV|AC|Au|C|I|A|E|RL|RC|CDP|TD|CR|IR|AR):([A-Z]{1,3})$/.exec(part);
    if (!match || !values[match[1]].includes(match[2]) || Object.hasOwn(metrics, match[1])) throw Error("Duplicate, unknown or malformed CVSS metric.");
    metrics[match[1]] = match[2];
  }
  if (Object.keys(base).some(key => !Object.hasOwn(metrics, key))) throw Error("Every base metric is required.");
  const temporalSupplied = Object.keys(temporal).some(key => metrics[key] && metrics[key] !== "ND");
  const environmentalSupplied = Object.keys(environmental).some(key => metrics[key] && metrics[key] !== "ND");
  for (const key of [...Object.keys(temporal), ...Object.keys(environmental)]) metrics[key] ??= "ND";
  const weight = (key, table, denominator = 100) => q(table[metrics[key]], denominator);
  const exploit = mul(q(20), mul(weight("AV", { L: 395, A: 646, N: 1000 }, 1000), mul(weight("AC", { H: 35, M: 61, L: 71 }), weight("Au", { M: 450, S: 560, N: 704 }, 1000))));
  const impact = adjusted => {
    let residual = q(1);
    for (const key of ["C", "I", "A"]) {
      let value = weight(key, { N: 0, P: 275, C: 660 }, 1000);
      if (adjusted) value = mul(value, weight(key + "R", { L: 50, M: 100, H: 151, ND: 100 }));
      residual = mul(residual, sub(q(1), value));
    }
    const result = mul(q(1041, 100), sub(q(1), residual));
    return adjusted && result[0] > 10n * result[1] ? q(10) : result;
  };
  const baseScoreFor = adjusted => { const i = impact(adjusted); return i[0] === 0n ? q(0) : round(mul(sub(add(mul(q(6, 10), i), mul(q(4, 10), exploit)), q(15, 10)), q(1176, 1000))); };
  const context = value => round(mul(value, mul(weight("E", { U: 85, POC: 90, F: 95, H: 100, ND: 100 }), mul(weight("RL", { OF: 87, TF: 90, W: 95, U: 100, ND: 100 }), weight("RC", { UC: 90, UR: 95, C: 100, ND: 100 })))));
  const baseValue = baseScoreFor(false), adjusted = context(baseScoreFor(true));
  const environmentValue = round(mul(add(adjusted, mul(sub(q(10), adjusted), weight("CDP", { N: 0, L: 10, LM: 30, MH: 40, H: 50, ND: 0 }))), weight("TD", { N: 0, L: 25, M: 75, H: 100, ND: 100 })));
  const baseScore = score(baseValue), baseVector = Object.keys(base).map(key => key + ":" + metrics[key]).join("/");
  return { algorithm: cvssV2MetricsAlgorithm, baseAlgorithm: cvssV2BaseAlgorithm, version: "2.0", vector: Object.keys(values).filter(key => Object.hasOwn(base, key) || metrics[key] !== "ND").map(key => key + ":" + metrics[key]).join("/"), baseVector, baseScore, severity: baseScore < 4 ? "low" : baseScore < 7 ? "medium" : "high", temporalScore: score(context(baseValue)), environmentalScore: score(environmentValue), temporalSupplied, environmentalSupplied };
}
