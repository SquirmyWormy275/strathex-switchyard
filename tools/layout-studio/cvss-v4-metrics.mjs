/** FIRST CVSS 4.0 section 8 interpolation. Supplied context is not a local assessment. */
import { cvssV4Data } from "./cvss-v4-data.mjs";

const base = { AV: "NALP", AC: "LH", AT: "NP", PR: "NLH", UI: "NPA", VC: "HLN", VI: "HLN", VA: "HLN", SC: "HLN", SI: "HLN", SA: "HLN" };
const environment = { CR: "XHML", IR: "XHML", AR: "XHML", MAV: "XNALP", MAC: "XLH", MAT: "XNP", MPR: "XNLH", MUI: "XNPA", MVC: "XHLN", MVI: "XHLN", MVA: "XHLN", MSC: "XHLN", MSI: "XSHLN", MSA: "XSHLN" };
const supplemental = { S: "XNP", AU: "XNY", R: "XAUI", V: "XDC", RE: "XLMH", U: ["X", "Clear", "Green", "Amber", "Red"] };
const values = { ...base, E: "XAPU", ...environment, ...supplemental }, order = Object.keys(values), baseOrder = Object.keys(base);
const steps = { AV: "NALP", PR: "NLH", UI: "NPA", AC: "LH", AT: "NP", VC: "HLN", VI: "HLN", VA: "HLN", SC: "SHLN", SI: "SHLN", SA: "SHLN", CR: "HML", IR: "HML", AR: "HML" };
const impact = ["VC", "VI", "VA", "SC", "SI", "SA"];
const groups = [["AV", "PR", "UI"], ["AC", "AT"], ["VC", "VI", "VA", "CR", "IR", "AR"], ["SC", "SI", "SA"]];
const maxima = Object.fromEntries(Object.entries(cvssV4Data.highest).filter(([key]) => key !== "eq5").map(([key, entries]) => [key, key === "eq3"
  ? Object.fromEntries(Object.entries(entries).map(([eq, rows]) => [eq, Object.fromEntries(Object.entries(rows).map(([req, vectors]) => [req, vectors.map(parseHighest)]))]))
  : Object.fromEntries(Object.entries(entries).map(([eq, vectors]) => [eq, vectors.map(parseHighest)]))]));
function parseHighest(vector) { return Object.fromEntries(vector.slice(0, -1).split("/").map(part => part.split(":"))); }
export const cvssV4BaseAlgorithm = "switchyard-cvss-v4-base/1";
export const cvssV4MetricsAlgorithm = "switchyard-cvss-v4-metrics/1";

function effective(metrics) {
  const result = {};
  for (const key of baseOrder) result[key] = metrics["M" + key] && metrics["M" + key] !== "X" ? metrics["M" + key] : metrics[key];
  for (const key of ["E", "CR", "IR", "AR"]) result[key] = metrics[key] && metrics[key] !== "X" ? metrics[key] : key === "E" ? "A" : "H";
  return result;
}
function score(metrics) {
  const m = effective(metrics);
  if (impact.every(key => m[key] === "N")) return 0;
  const eq1 = m.AV === "N" && m.PR === "N" && m.UI === "N" ? 0 : m.AV !== "P" && ["AV", "PR", "UI"].some(key => m[key] === "N") ? 1 : 2;
  const eq2 = m.AC === "L" && m.AT === "N" ? 0 : 1;
  const eq3 = m.VC === "H" && m.VI === "H" ? 0 : ["VC", "VI", "VA"].some(key => m[key] === "H") ? 1 : 2;
  const eq4 = m.SI === "S" || m.SA === "S" ? 0 : ["SC", "SI", "SA"].some(key => m[key] === "H") ? 1 : 2;
  const eq5 = "APU".indexOf(m.E), eq6 = [["VC", "CR"], ["VI", "IR"], ["VA", "AR"]].some(([i, r]) => m[i] === "H" && m[r] === "H") ? 0 : 1;
  const macro = [eq1, eq2, eq3, eq4, eq5, eq6], value = cvssV4Data.scores[macro.join("")];
  const lower = (changes) => cvssV4Data.scores[macro.map((v, i) => v + (changes[i] ?? 0)).join("")];
  const combinedLower = eq3 === 0 && eq6 === 0 ? Math.max(lower({ 2: 1 }), lower({ 5: 1 }))
    : eq6 === 1 && eq3 < 2 ? lower({ 2: 1 }) : eq3 === 1 && eq6 === 0 ? lower({ 5: 1 }) : lower({ 2: 1, 5: 1 });
  const lowerScores = [lower({ 0: 1 }), lower({ 1: 1 }), combinedLower, lower({ 3: 1 }), lower({ 4: 1 })];
  const highest = [maxima.eq1[eq1], maxima.eq2[eq2], maxima.eq3[eq3][eq6], maxima.eq4[eq4]];
  const depths = [cvssV4Data.depth.eq1[eq1], cvssV4Data.depth.eq2[eq2], cvssV4Data.depth.eq3eq6[eq3][eq6], cvssV4Data.depth.eq4[eq4]];
  const distances = groups.map((keys, group) => {
    for (const candidate of highest[group]) {
      const distances = keys.map(key => steps[key].indexOf(m[key]) / 10 - steps[key].indexOf(candidate[key]) / 10);
      if (distances.every(d => d >= 0)) return distances.reduce((sum, d) => sum + d, 0);
    }
    throw Error("CVSS 4.0 interpolation has no matching highest vector.");
  });
  let adjustment = 0, count = 0;
  for (let group = 0; group < lowerScores.length; group++) {
    if (lowerScores[group] === undefined || Number.isNaN(lowerScores[group])) continue;
    count++;
    if (group < 4) adjustment += (value - lowerScores[group]) * (distances[group] / (depths[group] * 0.1));
  }
  const result = Math.round(Math.max(0, Math.min(10, value - (count ? adjustment / count : 0))) * 10) / 10;
  if (!Number.isFinite(result)) throw Error("CVSS 4.0 interpolation did not yield a score.");
  return result;
}
export function cvssV4Metrics(vector) {
  if (typeof vector !== "string" || vector.length > 256 || /[\0\r\n]/.test(vector) || !vector.startsWith("CVSS:4.0/")) throw Error("Choose a bounded CVSS 4.0 vector.");
  const parts = vector.split("/").slice(1), metrics = {}; let previous = -1;
  if (parts.length < 11 || parts.length > 32) throw Error("Every CVSS 4.0 base metric is required.");
  for (const part of parts) {
    const match = /^([A-Z]{1,3}):([A-Za-z]{1,5})$/.exec(part), index = match ? order.indexOf(match[1]) : -1;
    if (!match || index <= previous || !(typeof values[match[1]] === "string" ? [...values[match[1]]] : values[match[1]]).includes(match[2])) throw Error("CVSS 4.0 metrics must be valid, unique and in the specified order.");
    metrics[match[1]] = match[2]; previous = index;
  }
  if (baseOrder.some(key => !Object.hasOwn(metrics, key))) throw Error("Every CVSS 4.0 base metric is required.");
  const basic = Object.fromEntries(baseOrder.map(key => [key, metrics[key]])), baseScore = score(basic);
  const supplied = keys => keys.some(key => metrics[key] && metrics[key] !== "X");
  const threatSupplied = supplied(["E"]), environmentalSupplied = supplied(Object.keys(environment)), supplementalSupplied = supplied(Object.keys(supplemental));
  return { algorithm: cvssV4MetricsAlgorithm, baseAlgorithm: cvssV4BaseAlgorithm, version: "4.0",
    vector: "CVSS:4.0/" + order.filter(key => Object.hasOwn(metrics, key) && metrics[key] !== "X").map(key => key + ":" + metrics[key]).join("/"),
    baseVector: "CVSS:4.0/" + baseOrder.map(key => key + ":" + metrics[key]).join("/"), baseScore,
    severity: baseScore === 0 ? "none" : baseScore < 4 ? "low" : baseScore < 7 ? "medium" : baseScore < 9 ? "high" : "critical",
    threatScore: threatSupplied ? score({ ...basic, E: metrics.E }) : baseScore,
    environmentalScore: environmentalSupplied ? score({ ...metrics, E: "X" }) : baseScore,
    score: threatSupplied || environmentalSupplied ? score(metrics) : baseScore,
    nomenclature: "CVSS-B" + (threatSupplied ? "T" : "") + (environmentalSupplied ? "E" : ""),
    threatSupplied, environmentalSupplied, supplementalSupplied };
}
